#!/usr/bin/env bash
# Restore an official snapshot into a fresh, disconnected Elasticsearch node.
set -Eeuo pipefail
umask 077
mountpoint -q /srv/elsewhere
run="${1:-hk-search-full-restore-20261018}"
[[ "$run" =~ ^hk-[a-zA-Z0-9-]+$ ]] || exit 2
root="/srv/elsewhere/rehearsals/$run"
backup_batch="${2:-hk-search-full-20261018}"
archive_sha="${3:-161e460592955f00764342f9c947b2d72b2dbee231c9744f4f04c1f8c54422ed}"
snapshot="${4:-preflight-20261018}"
[[ "$backup_batch" =~ ^hk-[a-zA-Z0-9-]+$ && "$snapshot" =~ ^[a-zA-Z0-9-]+$ && "$archive_sha" =~ ^[a-f0-9]{64}$ ]] || exit 2
backup="/srv/elsewhere/backups/$backup_batch"
name="elsewhere-es-$run"
test ! -e "$root"
! docker inspect "$name" >/dev/null 2>&1
mkdir -p "$root/data" "$root/repository" "$root/evidence"
echo "$archive_sha  $backup/search-snapshot.tgz" | sha256sum -c -
tar -xzf "$backup/search-snapshot.tgz" -C "$root/repository" --no-same-owner
chown -R 1000:0 "$root/data" "$root/repository"
chmod 750 "$root/repository"
trap 'docker stop --time 30 "$name" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$name" --network none --restart no --memory 2g --cpus 1 \
 --hostname hk-search-restore --add-host hk-search-restore:127.0.0.1 \
 -e discovery.type=single-node -e xpack.security.enabled=false \
 -e ES_JAVA_OPTS='-Xms512m -Xmx512m' -e indices.lifecycle.poll_interval=24h \
 -e ES_SETTING_PATH_REPO=/snapshots \
 --mount "type=bind,src=$root/data,dst=/usr/share/elasticsearch/data" \
 --mount "type=bind,src=$root/repository,dst=/snapshots,readonly" \
 docker.elastic.co/elasticsearch/elasticsearch:8.11.0@sha256:4cd9ce4ccb04618617114da1df8240473bbd004329c1bc0252cebeec089b629e > "$root/evidence/container.txt"
es() { docker exec "$name" curl -fsS --max-time 90 "$@"; }
ready=false
for n in $(seq 1 120); do
 test "$(docker inspect --format '{{.State.Running}}' "$name")" = true
 if es http://127.0.0.1:9200/_cluster/health > "$root/evidence/initial-health.json" 2>/dev/null; then ready=true; break; fi
 sleep 2
done
"$ready"
es -XPOST http://127.0.0.1:9200/_ilm/stop > "$root/evidence/ilm-stop-before.json"
es -XPUT http://127.0.0.1:9200/_snapshot/hk_migration -H 'Content-Type: application/json' \
 -d '{"type":"fs","settings":{"location":"/snapshots/hk-migration","readonly":true}}' > "$root/evidence/repository.json"
es "http://127.0.0.1:9200/_snapshot/hk_migration/$snapshot" > "$root/evidence/source-snapshot.json"
es -XPOST "http://127.0.0.1:9200/_snapshot/hk_migration/$snapshot/_restore?wait_for_completion=true" \
 -H 'Content-Type: application/json' -d '{"include_global_state":true}' > "$root/evidence/restore.json"
es -XPOST http://127.0.0.1:9200/_ilm/stop > "$root/evidence/ilm-stop-after.json"
es 'http://127.0.0.1:9200/_cluster/health?wait_for_status=yellow&wait_for_no_initializing_shards=true&timeout=60s' > "$root/evidence/health.json"
es 'http://127.0.0.1:9200/_cat/indices?format=json&expand_wildcards=all' > "$root/evidence/indices.json"
es 'http://127.0.0.1:9200/_data_stream/*?expand_wildcards=all' > "$root/evidence/data-streams.json"
es 'http://127.0.0.1:9200/_alias?expand_wildcards=all' > "$root/evidence/aliases.json"
es http://127.0.0.1:9200/_ilm/status > "$root/evidence/ilm-status.json"
docker run --rm --network none --mount "type=bind,src=$root/evidence,dst=/evidence,readonly" node:22-alpine node --input-type=module -e '
import fs from "node:fs";import assert from "node:assert/strict";
const read=n=>JSON.parse(fs.readFileSync("/evidence/"+n+".json"));
const snap=read("source-snapshot").snapshots[0],r=read("restore").snapshot;
assert.equal(r.shards.failed,0);assert.equal(r.shards.successful,snap.shards.total);
assert.deepEqual(read("indices").map(x=>x.index).sort(),snap.indices.slice().sort());
assert.deepEqual(read("data-streams").data_streams.map(x=>x.name).sort(),snap.data_streams.slice().sort());
assert.equal(read("health").timed_out,false);assert.equal(read("ilm-status").operation_mode,"STOPPED");
console.log(JSON.stringify({indices:snap.indices.length,successfulShards:r.shards.successful,failedShards:0,dataStreams:snap.data_streams.length}));
' > "$root/evidence/validation.json"
docker inspect --format '{{.HostConfig.NetworkMode}} {{json .HostConfig.PortBindings}}' "$name" > "$root/evidence/isolation.txt"
cat "$root/evidence/validation.json"
printf 'OFFICIAL_SEARCH_SNAPSHOT_RESTORE_PASSED\n' | tee "$root/evidence/result.txt"
