#!/usr/bin/env bash
# Restore a verified archive into an isolated, fresh PostgreSQL 16 instance.
# Does not connect to production, publish ports, or run application workers.
set -Eeuo pipefail
umask 077
batch="${1:?Usage: aliyun-hk-pg-rehearsal.sh BATCH ARCHIVE_SHA256 GLOBALS_SHA256}"
archive_sha="${2:?Archive SHA-256 required}"
globals_sha="${3:?Globals SHA-256 required}"
[[ "$batch" =~ ^hk-[a-zA-Z0-9-]+$ ]] || exit 2
[[ "$archive_sha" =~ ^[a-f0-9]{64}$ && "$globals_sha" =~ ^[a-f0-9]{64}$ ]] || exit 2
mountpoint -q /srv/elsewhere
src="/srv/elsewhere/backups/$batch"
dst="/srv/elsewhere/rehearsals/$batch"
name="elsewhere-pg-$batch"
image='postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
printf '%s  %s\n' "$archive_sha" "$src/agentnet.dump" "$globals_sha" "$src/globals.sql" | sha256sum -c -
# Refuse to overwrite an existing rehearsal or attach to an existing container.
test ! -e "$dst"
! docker container inspect "$name" >/dev/null 2>&1
mkdir -p "$dst/data" "$dst/evidence"
openssl rand -hex 32 > "$dst/bootstrap-password"
cleanup() { docker stop --time 30 "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$name" --network none --restart no --memory 2g --cpus 1 \
  --mount "type=bind,src=$dst/data,dst=/var/lib/postgresql/data" \
  --mount "type=bind,src=$src,dst=/backup,readonly" \
  --mount "type=bind,src=$dst/bootstrap-password,dst=/run/bootstrap-password,readonly" \
  -e POSTGRES_USER=hk_restore_admin -e POSTGRES_DB=postgres \
  -e POSTGRES_PASSWORD_FILE=/run/bootstrap-password "$image" > "$dst/evidence/container-id"
ready=false
for attempt in $(seq 1 60); do
  if docker exec "$name" pg_isready -U hk_restore_admin -d postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
"$ready" || { echo 'PostgreSQL did not become ready'; exit 1; }
docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U hk_restore_admin -d postgres -f /backup/globals.sql > "$dst/evidence/globals-restore.log" 2>&1
docker exec "$name" pg_restore --exit-on-error --create -U hk_restore_admin -d postgres /backup/agentnet.dump > "$dst/evidence/archive-restore.log" 2>&1
docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U hk_restore_admin -d agentnet -Atc "SELECT format('SELECT %L AS table_name, count(*) AS rows FROM %I.%I;', schemaname||'.'||tablename, schemaname, tablename) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename" > "$dst/evidence/counts.sql"
docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U hk_restore_admin -d agentnet -At < "$dst/evidence/counts.sql" > "$dst/evidence/table-counts.txt"
docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U hk_restore_admin -d agentnet -Atc "SELECT version(); SELECT extname,extversion FROM pg_extension ORDER BY extname; SELECT count(*) FROM pg_constraint WHERE NOT convalidated;" > "$dst/evidence/schema-check.txt"
docker inspect --format '{{.HostConfig.NetworkMode}} {{json .HostConfig.PortBindings}} {{.HostConfig.RestartPolicy.Name}}' "$name" > "$dst/evidence/isolation.txt"
printf 'RESTORE_PASSED\n%s\n%s\n' "$archive_sha" "$globals_sha" > "$dst/evidence/result.txt"
echo "RESTORE_PASSED batch=$batch evidence=$dst/evidence"
echo 'Initial archive only: final cutover reconciliation is still required.'
