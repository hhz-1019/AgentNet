#!/usr/bin/env bash
# Local safety copy only. Off-host backup and WAL archiving remain separate requirements.
set -Eeuo pipefail
umask 077
mountpoint -q /srv/elsewhere
exec 9>/run/elsewhere-pg-backup.lock
flock -n 9 || exit 0
base=/srv/elsewhere/backups/scheduled-postgres
install -d -m 0700 "$base"
available=$(df --output=avail -B1 "$base" | tail -1)
(( available >= 2147483648 )) || { echo 'Backup stopped: less than 2 GiB available' >&2; exit 1; }
batch=$(date -u +%Y%m%dT%H%M%SZ)
stage="$base/.partial-$batch"
mkdir -m 0700 "$stage"
# A failed directory remains visibly partial for diagnosis; it is never marked complete.
docker exec elsewhere-postgres pg_dumpall -U agentnet --globals-only > "$stage/globals.sql"
docker exec elsewhere-postgres pg_dump -U agentnet -d agentnet --format=custom > "$stage/agentnet.dump"
docker exec -i elsewhere-postgres pg_restore --list < "$stage/agentnet.dump" > "$stage/archive-list.txt"
(
  cd "$stage"
  sha256sum globals.sql agentnet.dump archive-list.txt > SHA256SUMS
  sha256sum --check SHA256SUMS
)
date -u +%FT%TZ > "$stage/completed-at"
mv "$stage" "$base/$batch"
echo "POSTGRES_LOCAL_BACKUP_COMPLETE $batch"
# No automatic pruning: set retention after off-host storage is verified.
