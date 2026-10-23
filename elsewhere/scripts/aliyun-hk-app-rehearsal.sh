#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
mountpoint -q /srv/elsewhere
root=/srv/elsewhere/rehearsals/hk-app-20261018
test ! -e "$root"
for name in elsewhere-pg-hk-preflight-20261017151447 elsewhere-redis-hk-state-preflight-20261018-r2 elsewhere-etcd-hk-state-preflight-20261018-r2 elsewhere-es-hk-search-full-restore-20261018; do
 test "$(docker inspect --format '{{.State.Running}}' "$name")" = false
done
grep -q OFFICIAL_SEARCH_SNAPSHOT_RESTORE_PASSED /srv/elsewhere/rehearsals/hk-search-full-restore-20261018/evidence/result.txt
grep -q SUPPORT_IMAGES_READY /srv/elsewhere/backups/pull-support-images.log
mkdir -p "$root/evidence" "$root/redis"
cp -a /srv/elsewhere/rehearsals/hk-preflight-20261017151447/data "$root/postgres"
cp -a /srv/elsewhere/rehearsals/hk-state-preflight-20261018-r2/etcd/data "$root/etcd"
cp -a /srv/elsewhere/rehearsals/hk-state-preflight-20261018-r2/gorse "$root/gorse"
cp -a /srv/elsewhere/rehearsals/hk-search-full-restore-20261018/data "$root/search"
cp -a /srv/elsewhere/rehearsals/hk-search-full-restore-20261018/repository "$root/search-repository"
cp /srv/elsewhere/backups/hk-state-preflight-20261018/redis.rdb "$root/redis/dump.rdb"
docker run --rm --network none --mount type=bind,src=/srv/elsewhere,dst=/srv/elsewhere node:22-alpine node /srv/elsewhere/backups/rehearsal-compose.mjs
docker compose -f "$root/compose.json" config --quiet
docker compose -f "$root/compose.json" up -d --wait --wait-timeout 300 > "$root/evidence/start.log" 2>&1
docker compose -f "$root/compose.json" ps --all --format json > "$root/evidence/containers.jsonl"
docker network inspect elsewhere-rehearsal_isolated --format '{{.Internal}}' > "$root/evidence/internal-network.txt"
test "$(cat "$root/evidence/internal-network.txt")" = true
docker exec elsewhere-rehearsal-core curl -fsS --max-time 10 http://127.0.0.1:8080/api/v1/website/stats > "$root/evidence/website-stats.json"
docker exec elsewhere-rehearsal-web wget -q -O /dev/null http://127.0.0.1:8080/
echo 'ISOLATED_APPLICATION_START_PASSED' | tee "$root/evidence/result.txt"
