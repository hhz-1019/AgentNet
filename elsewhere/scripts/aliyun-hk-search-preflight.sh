#!/usr/bin/env bash
# Validate snapshot settings on a fresh isolated Elasticsearch node before source changes.
set -Eeuo pipefail
umask 077
mountpoint -q /srv/elsewhere
run="${1:-hk-search-preflight-20261018}"
[[ "$run" =~ ^hk-[a-zA-Z0-9-]+$ ]] || exit 2
root="/srv/elsewhere/rehearsals/$run"
name="elsewhere-es-$run"
test ! -e "$root"
! docker inspect "$name" >/dev/null 2>&1
mkdir -p "$root/data" "$root/evidence"
chown 1000:0 "$root/data"
trap 'docker stop --time 30 "$name" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$name" --network none --restart no --memory 2g --cpus 1 \
 --hostname hk-search-preflight --add-host hk-search-preflight:127.0.0.1 \
 -e discovery.type=single-node -e xpack.security.enabled=false \
 -e ES_JAVA_OPTS='-Xms512m -Xmx512m' \
 -e ES_SETTING_PATH_REPO=/usr/share/elasticsearch/data/migration-snapshots \
 --mount "type=bind,src=$root/data,dst=/usr/share/elasticsearch/data" \
 docker.elastic.co/elasticsearch/elasticsearch:8.11.0 > "$root/evidence/container.txt"
ready=false
for n in $(seq 1 120); do
 test "$(docker inspect --format '{{.State.Running}}' "$name")" = true
 if docker exec "$name" curl -fsS --max-time 5 http://127.0.0.1:9200/_cluster/health > "$root/evidence/health.json" 2>/dev/null; then ready=true; break; fi
 sleep 2
done
"$ready"
docker exec "$name" curl -fsS -XPUT http://127.0.0.1:9200/_snapshot/hk_migration \
 -H 'Content-Type: application/json' -d '{"type":"fs","settings":{"location":"/usr/share/elasticsearch/data/migration-snapshots/hk-migration"}}' > "$root/evidence/repository.json"
docker exec "$name" curl -fsS -XPUT 'http://127.0.0.1:9200/_snapshot/hk_migration/preflight?wait_for_completion=true' \
 -H 'Content-Type: application/json' -d '{"include_global_state":true}' > "$root/evidence/snapshot.json"
grep -q '"state":"SUCCESS"' "$root/evidence/snapshot.json"
docker inspect --format '{{.HostConfig.NetworkMode}} {{json .HostConfig.PortBindings}}' "$name" > "$root/evidence/isolation.txt"
printf 'SEARCH_SNAPSHOT_SETTINGS_PASSED\n' | tee "$root/evidence/result.txt"
