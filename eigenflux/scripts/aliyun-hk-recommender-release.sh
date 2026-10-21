#!/usr/bin/env bash
# Scoped release: update the recommender only, including its Dockerfile tests.
set -Eeuo pipefail
umask 077
revision="${1:?full Git revision}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
exec 9>/srv/elsewhere/deploy.lock
flock -n 9
mountpoint -q /srv/elsewhere
source_dir=$(git rev-parse --show-toplevel)
cd "$source_dir"
[[ "$(git rev-parse HEAD)" == "$revision" ]]
[[ -z "$(git status --porcelain --untracked-files=no)" ]]
root="/srv/elsewhere/releases/hk-recommender-$revision"
previous=$(readlink -f /srv/elsewhere/current)
[[ "$previous" == /srv/elsewhere/releases/* && "$previous" != "$root" ]]
test ! -e "$root/ACTIVATED"
mkdir -p "$root/evidence"
docker build --label "org.opencontainers.image.revision=$revision" -t "elsewhere-gorse:$revision" -f eigenflux/recommender/Dockerfile . > "$root/evidence/gorse-build.log" 2>&1
image=$(docker inspect --format '{{.Id}}' "elsewhere-gorse:$revision")
cp -a "$previous/env" "$previous/configs" "$root/"
cp eigenflux/recommender/gorse.toml "$root/configs/gorse-config.toml"
docker run --rm --network none --mount type=bind,src=/srv/elsewhere,dst=/srv/elsewhere --mount "type=bind,src=$source_dir/eigenflux/scripts,dst=/scripts,readonly" node:24-alpine node /scripts/aliyun-hk-recommender-release.mjs "$previous" "$root" "$image"
docker compose -f "$root/compose.json" config --quiet
printf '%s\n' "$previous" > "$root/evidence/previous-release"
printf '%s\n' "$revision" > "$root/evidence/recommender-revision"
rollback() {
  docker compose -f "$previous/compose.json" up -d --no-deps gorse > "$root/evidence/rollback.log" 2>&1 || true
}
trap rollback ERR
docker compose -f "$root/compose.json" up -d --no-deps gorse > "$root/evidence/activate.log" 2>&1
# Check the actual listening process and its two stores, without a model request.
ready=0
for attempt in $(seq 1 30); do
  if docker run --rm --network container:elsewhere-gorse node:24-alpine node -e 'fetch("http://127.0.0.1:8088/api/health/ready",{signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok)process.exit(1);console.log(await r.text())}).catch(()=>process.exit(1))' > "$root/evidence/gorse-health.json" 2>&1; then ready=1; break; fi
  sleep 2
done
[[ "$ready" == 1 ]]
[[ "$(docker inspect --format '{{.Image}}' elsewhere-gorse)" == "$image" ]]
public_origin=$(docker inspect elsewhere-core --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^PUBLIC_BASE_URL=//p')
[[ "$public_origin" =~ ^https://[a-zA-Z0-9.-]+$ ]]
curl -fsS --max-time 20 --resolve "${public_origin#https://}:443:127.0.0.1" "$public_origin/api/v1/website/stats" > "$root/evidence/website-stats.json"
curl -fsS --max-time 20 --resolve "${public_origin#https://}:443:127.0.0.1" "$public_origin/release.json" > "$root/evidence/public-release.json"
ln -s "$root" /srv/elsewhere/current.next
mv -Tf /srv/elsewhere/current.next /srv/elsewhere/current
trap - ERR
date -u +%FT%TZ > "$root/ACTIVATED"
echo "RECOMMENDER_ACTIVATED $revision"
