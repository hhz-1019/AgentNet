#!/usr/bin/env bash
# Restore initial Redis, etcd and Gorse snapshots in isolated, disposable copies.
set -Eeuo pipefail
umask 077
batch="${1:?Usage: aliyun-hk-state-rehearsal.sh BATCH}"
[[ "$batch" =~ ^hk-[a-zA-Z0-9-]+$ ]] || exit 2
run="${2:-$batch}"
[[ "$run" =~ ^hk-[a-zA-Z0-9-]+$ ]] || exit 2
mountpoint -q /srv/elsewhere
src="/srv/elsewhere/backups/$batch"
dst="/srv/elsewhere/rehearsals/$run"
redis="elsewhere-redis-$run"
etcd="elsewhere-etcd-$run"
test ! -e "$dst"
! docker inspect "$redis" >/dev/null 2>&1
! docker inspect "$etcd" >/dev/null 2>&1
command -v sqlite3 >/dev/null
(cd "$src" && sha256sum -c SHA256SUMS)
mkdir -p "$dst/evidence" "$dst/redis" "$dst/etcd" "$dst/gorse" "$dst/search-export"
cleanup() {
  docker stop --time 30 "$redis" >/dev/null 2>&1 || true
  docker stop --time 30 "$etcd" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker image inspect redis:7.4.11-alpine gcr.io/etcd-development/etcd:v3.5.17 --format '{{json .RepoDigests}}' > "$dst/evidence/images.txt"
docker run --rm --network none --mount "type=bind,src=$src,dst=/backup,readonly" redis:7.4.11-alpine redis-check-rdb /backup/redis.rdb > "$dst/evidence/redis-check.txt" 2>&1
cp "$src/redis.rdb" "$dst/redis/dump.rdb"
docker run -d --name "$redis" --network none --restart no --memory 256m --cpus 0.5 \
 --mount "type=bind,src=$dst/redis,dst=/data" redis:7.4.11-alpine \
 redis-server --appendonly no --save '' > "$dst/evidence/redis-container.txt"
ready=false
for n in $(seq 1 30); do
 if docker exec "$redis" redis-cli ping 2>/dev/null | grep -qx PONG; then ready=true; break; fi
 sleep 1
done
"$ready"
docker exec "$redis" redis-cli --raw INFO keyspace > "$dst/evidence/redis-keyspace.txt"
docker exec "$redis" redis-cli EVAL 'local n=0;local s=0;local g=0;local p=0;local cur="0";repeat local r=redis.call("SCAN",cur,"COUNT",1000);cur=r[1];for _,k in ipairs(r[2]) do n=n+1;if redis.call("TYPE",k).ok=="stream" then s=s+1;for _,a in ipairs(redis.call("XINFO","GROUPS",k)) do g=g+1;for i=1,#a,2 do if a[i]=="pending" then p=p+a[i+1] end end end end end until cur=="0";return {n,s,g,p}' 0 > "$dst/evidence/redis-stream-summary.txt"
docker run --rm --network none --entrypoint /usr/local/bin/etcdutl \
 --mount "type=bind,src=$src,dst=/backup,readonly" \
 gcr.io/etcd-development/etcd:v3.5.17 snapshot status /backup/etcd.db --write-out=json > "$dst/evidence/etcd-snapshot.json"
docker run --rm --network none --entrypoint /usr/local/bin/etcdutl \
 --mount "type=bind,src=$src,dst=/backup,readonly" --mount "type=bind,src=$dst/etcd,dst=/restore" \
 gcr.io/etcd-development/etcd:v3.5.17 snapshot restore /backup/etcd.db --data-dir=/restore/data \
 --name=rehearsal --initial-cluster=rehearsal=http://127.0.0.1:2380 \
 --initial-advertise-peer-urls=http://127.0.0.1:2380 > "$dst/evidence/etcd-restore.log" 2>&1
docker run -d --name "$etcd" --network none --restart no --memory 256m --cpus 0.5 \
 --mount "type=bind,src=$dst/etcd/data,dst=/etcd-data" \
 --entrypoint /usr/local/bin/etcd gcr.io/etcd-development/etcd:v3.5.17 \
 --name=rehearsal --data-dir=/etcd-data --listen-client-urls=http://127.0.0.1:2379 \
 --advertise-client-urls=http://127.0.0.1:2379 --listen-peer-urls=http://127.0.0.1:2380 \
 --initial-advertise-peer-urls=http://127.0.0.1:2380 \
 --initial-cluster=rehearsal=http://127.0.0.1:2380 > "$dst/evidence/etcd-container.txt"
ready=false
for n in $(seq 1 30); do
 if docker exec "$etcd" /usr/local/bin/etcdctl endpoint health >/dev/null 2>&1; then ready=true; break; fi
 sleep 1
done
"$ready"
docker exec "$etcd" /usr/local/bin/etcdctl endpoint status --write-out=json > "$dst/evidence/etcd-running.json"
docker exec "$etcd" /usr/local/bin/etcdctl get '' --prefix --count-only --write-out=fields > "$dst/evidence/etcd-live-key-count.txt"
for name in gorse search; do
 tar -tzf "$src/$name.tgz" > "$dst/evidence/$name-members.txt"
 if grep -Eq '(^/|(^|/)\.\.(/|$))' "$dst/evidence/$name-members.txt"; then echo 'Unsafe archive member'; exit 1; fi
done
tar --no-same-owner --no-same-permissions -xzf "$src/gorse.tgz" -C "$dst/gorse"
tar --no-same-owner --no-same-permissions -xzf "$src/search.tgz" -C "$dst/search-export"
for db in data cache; do
 sqlite3 -readonly "$dst/gorse/$db.db" 'PRAGMA integrity_check;' > "$dst/evidence/gorse-$db-integrity.txt"
 test "$(cat "$dst/evidence/gorse-$db-integrity.txt")" = ok
 sqlite3 -readonly "$dst/gorse/$db.db" "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" > "$dst/evidence/gorse-$db-tables.txt"
done
docker inspect --format '{{.Name}} {{.HostConfig.NetworkMode}} {{json .HostConfig.PortBindings}}' "$redis" "$etcd" > "$dst/evidence/isolation.txt"
printf 'REDIS_ETCD_GORSE_RESTORE_PASSED\n' > "$dst/evidence/result.txt"
echo "REDIS_ETCD_GORSE_RESTORE_PASSED evidence=$dst/evidence"
echo 'Search export extracted only; Elasticsearch and full application validation are separate gates.'
