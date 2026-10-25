#!/usr/bin/env bash
# Only reproducible application images/cache. Never delete volumes, releases,
# backups, stopped containers, private configuration or user uploads.
set -Eeuo pipefail
umask 077
exec 9>/srv/elsewhere/deploy.lock
flock -n 9 || exit 0
mountpoint -q /srv/elsewhere
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
current=$(readlink -f /srv/elsewhere/current)
[[ "$current" == /srv/elsewhere/releases/* ]]
test -f "$current/compose.json"
# Raise the live edge process limit without interrupting existing connections.
edge_pid=$(docker inspect elsewhere-edge --format '{{.State.Pid}}')
if [[ "$edge_pid" =~ ^[1-9][0-9]*$ ]]; then prlimit --pid "$edge_pid" --nofile=65536:65536; fi
printf '%s\n' "$current" > "$work/releases"
find /srv/elsewhere/releases -maxdepth 2 -name ACTIVATED -printf '%T@ %h\n' | sort -nr | head -3 | cut -d' ' -f2- >> "$work/releases"
while read -r release; do
  jq -er '.services[].image' "$release/compose.json"
done < "$work/releases" > "$work/protected"
for container in $(docker ps -aq); do
  docker inspect --format '{{.Image}}' "$container"
done >> "$work/protected"
sort -u "$work/protected" -o "$work/protected"
while read -r reference; do
  [[ "$reference" =~ ^elsewhere-(core|web|gorse|sync):[a-f0-9]{40}$ ]] || continue
  id=$(docker image inspect --format '{{.Id}}' "$reference")
  if ! grep -Fxq "$id" "$work/protected" && ! grep -Fxq "$reference" "$work/protected"; then
    docker image rm "$reference" || true
  fi
done < <(docker image ls --format '{{.Repository}}:{{.Tag}}')
docker builder prune --all --force --reserved-space 2GB --max-used-space 4GB --min-free-space 20GB
df -h /srv/elsewhere
