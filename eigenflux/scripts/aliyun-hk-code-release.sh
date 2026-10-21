#!/usr/bin/env bash
# Run inside a clean, committed checkout on the Hong Kong deployment host.
set -Eeuo pipefail
umask 077
mode="${1:?build or activate}"
revision="${2:?full Git revision}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
source_dir=$(git rev-parse --show-toplevel)
root="/srv/elsewhere/releases/hk-code-$revision"
mountpoint -q /srv/elsewhere
cd "$source_dir"
[[ "$(git rev-parse HEAD)" == "$revision" ]]
[[ -z "$(git status --porcelain --untracked-files=no)" ]]
mkdir -p "$root/evidence"
if [[ "$mode" == build ]]; then
  for service in core web gorse sync; do
    case "$service" in
      core|web) recipe="eigenflux/Dockerfile.$service" ;;
      gorse) recipe=eigenflux/recommender/Dockerfile ;;
      sync) recipe=eigenflux/recommender/Dockerfile.sync ;;
    esac
    docker build --build-arg "RELEASE_REVISION=$revision" --label "org.opencontainers.image.revision=$revision" -t "elsewhere-$service:$revision" -f "$recipe" . > "$root/evidence/$service-build.log" 2>&1
    docker inspect --format '{{.Id}}' "elsewhere-$service:$revision" > "$root/evidence/$service-image-id"
  done
  touch "$root/BUILT"
  echo "BUILD_COMPLETE $revision"
  exit 0
fi
[[ "$mode" == activate ]]
test -f "$root/BUILT"
test ! -e "$root/ACTIVATED"
previous=$(readlink -f /srv/elsewhere/current)
[[ "$previous" == /srv/elsewhere/releases/* && "$previous" != "$root" ]]
# Use the live origin so a model-only release preserves concurrent domain changes.
public_origin=$(docker inspect elsewhere-core --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^PUBLIC_BASE_URL=//p')
[[ "$public_origin" =~ ^https://[a-zA-Z0-9.-]+$ ]]
public_host=${public_origin#https://}
cp -a "$previous/env" "$previous/configs" "$root/"
# Fail before changing live services if model configuration or mounts are invalid.
docker run --rm --network none --mount type=bind,src=/srv/elsewhere,dst=/srv/elsewhere --mount "type=bind,src=$source_dir/eigenflux/scripts,dst=/scripts,readonly" --mount "type=bind,src=$source_dir/eigenflux/recommender,dst=/recommender,readonly" node:24-alpine node /scripts/aliyun-hk-code-compose.mjs "$previous" "$root"
docker compose -f "$root/compose.json" config --quiet
docker run --rm --network container:elsewhere-gorse --env-file "$root/env/gorse.env" --mount "type=bind,src=$source_dir/eigenflux/scripts,dst=/scripts,readonly" node:24-alpine node /scripts/recommender-provider-preflight.mjs > "$root/evidence/reranker-preflight.log" 2>&1
systemctl start elsewhere-pg-backup.service
[[ "$(systemctl show elsewhere-pg-backup.service -p Result --value)" == success ]]
printf '%s\n' "$previous" > "$root/evidence/previous-release"
docker compose -f "$root/compose.json" run --rm --no-deps core migrate > "$root/evidence/migrate.log" 2>&1
rollback() {
  docker compose -f "$previous/compose.json" up -d --no-deps --wait --wait-timeout 300 core web gorse sync > "$root/evidence/rollback.log" 2>&1 || true
}
trap rollback ERR
docker compose -f "$root/compose.json" up -d --no-deps --wait --wait-timeout 300 core web gorse sync > "$root/evidence/activate.log" 2>&1
curl -fsS --max-time 20 --resolve "$public_host:443:127.0.0.1" "$public_origin/api/v1/website/stats" > "$root/evidence/website-stats.json"
curl -fsS --max-time 20 --resolve "$public_host:443:127.0.0.1" "$public_origin/release.json" > "$root/evidence/public-release.json"
docker run --rm --network none --mount "type=bind,src=$root/evidence,dst=/evidence,readonly" node:24-alpine node -e 'const r=require("/evidence/public-release.json");if(r.revision!==process.argv[1]||r.migration!==152)process.exit(1)' "$revision"
ln -s "$root" /srv/elsewhere/current.next
mv -Tf /srv/elsewhere/current.next /srv/elsewhere/current
trap - ERR
date -u +%FT%TZ > "$root/ACTIVATED"
echo "ACTIVATED $revision"
