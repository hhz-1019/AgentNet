#!/usr/bin/env bash
# Source writers must remain suspended until this release is reconciled.
set -Eeuo pipefail
umask 077
batch="${1:?Final backup batch required}"
[[ "$batch" =~ ^hk-cutover-[0-9]{14}$ ]] || exit 2
mountpoint -q /srv/elsewhere
backup="/srv/elsewhere/backups/$batch"
root="/srv/elsewhere/releases/$batch"
test -f "$root/NOT_LIVE"
test -f "$backup/target-decryption.json"
hash() { docker run --rm --network none --mount "type=bind,src=$backup,dst=/backup,readonly" node:22-alpine node -e 'const m=require("/backup/manifest.json");console.log(m.files.find(f=>f.file===process.argv[1]).sha256)' "$1"; }
bash /srv/elsewhere/backups/pg-rehearsal.sh "$batch" "$(hash agentnet.dump)" "$(hash globals.sql)"
pg="elsewhere-pg-$batch"
docker start "$pg" >/dev/null
trap 'docker stop --time 30 "$pg" >/dev/null 2>&1 || true' EXIT
for n in $(seq 1 30); do docker exec "$pg" pg_isready -U hk_restore_admin -d agentnet >/dev/null 2>&1 && break; sleep 1; done
docker exec -i "$pg" psql -X -At -v ON_ERROR_STOP=1 -U hk_restore_admin -d agentnet < /srv/elsewhere/backups/row-fingerprints.sql > "$root/evidence/target-row-fingerprints.txt"
cmp "$backup/row-fingerprints.txt" "$root/evidence/target-row-fingerprints.txt"
docker stop --time 30 "$pg" >/dev/null
trap - EXIT
cp -a "/srv/elsewhere/rehearsals/$batch/data" "$root/postgres"
bash /srv/elsewhere/backups/search-restore.sh "$batch-search" "$batch" "$(hash search-snapshot.tgz)" "$batch"
cp -a "/srv/elsewhere/rehearsals/$batch-search/data" "$root/search"
cp -a "/srv/elsewhere/rehearsals/$batch-search/repository" "$root/search-repository"
mkdir "$root/redis" "$root/etcd" "$root/gorse"
cp "$backup/redis.rdb" "$root/redis/dump.rdb"
docker run --rm --network none --mount "type=bind,src=$backup,dst=/backup,readonly" redis:7.4.11-alpine redis-check-rdb /backup/redis.rdb > "$root/evidence/redis-rdb-check.txt"
docker run --rm --network none --entrypoint /usr/local/bin/etcdutl \
 --mount "type=bind,src=$backup,dst=/backup,readonly" --mount "type=bind,src=$root/etcd,dst=/restore" \
 gcr.io/etcd-development/etcd:v3.5.17 snapshot restore /backup/etcd.db --data-dir=/restore \
 --name=agentnet --initial-cluster=agentnet=http://127.0.0.1:2380 --initial-advertise-peer-urls=http://127.0.0.1:2380 > "$root/evidence/etcd-restore.log" 2>&1
tar -tzf "$backup/gorse.tgz" > "$root/evidence/gorse-members.txt"
if grep -Eq '(^/|(^|/)\.\.(/|$))' "$root/evidence/gorse-members.txt"; then exit 1; fi
tar -xzf "$backup/gorse.tgz" -C "$root/gorse" --no-same-owner
for db in data cache; do
 sqlite3 -readonly "$root/gorse/$db.db" 'PRAGMA integrity_check;' > "$root/evidence/gorse-$db-integrity.txt"
 test "$(cat "$root/evidence/gorse-$db-integrity.txt")" = ok
done
docker compose -f "$root/compose.json" config --quiet
echo 'FINAL_RESTORE_AND_ALL_PG_ROW_FINGERPRINTS_MATCH' | tee "$root/evidence/restore-result.txt"
