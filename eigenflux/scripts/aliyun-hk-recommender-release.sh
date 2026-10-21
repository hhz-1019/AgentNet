#!/usr/bin/env bash
# Scoped release: Gorse plus private CPU ranker; Core/Web remain unchanged.
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
bash eigenflux/scripts/prepare-local-model.sh > "$root/evidence/runtime-prepare.log" 2>&1
docker build --label "org.opencontainers.image.revision=$revision" -t "elsewhere-local-ranker:$revision" -f eigenflux/recommender/local_ranker/Dockerfile . > "$root/evidence/local-build.log" 2>&1
local_image=$(docker inspect --format '{{.Id}}' "elsewhere-local-ranker:$revision")
# Test the actual Linux/Conda/container combination before changing any service.
docker run --rm --network none --mount type=bind,src=/opt/elsewhere-model-runtime/env,dst=/runtime,readonly --entrypoint /runtime/bin/python "$local_image" -m unittest discover -s /app -v > "$root/evidence/local-tests.log" 2>&1
docker run --rm --network none --cpus 0.75 --memory 1536m --mount type=bind,src=/opt/elsewhere-model-runtime/env,dst=/runtime,readonly --mount type=bind,src=/opt/elsewhere-model-runtime/model,dst=/model,readonly --entrypoint /runtime/bin/python "$local_image" /app/smoke.py > "$root/evidence/local-smoke.log" 2>&1
docker build --label "org.opencontainers.image.revision=$revision" -t "elsewhere-gorse:$revision" -f eigenflux/recommender/Dockerfile . > "$root/evidence/gorse-build.log" 2>&1
image=$(docker inspect --format '{{.Id}}' "elsewhere-gorse:$revision")
cp -a "$previous/env" "$previous/configs" "$root/"
cp eigenflux/recommender/gorse.toml "$root/configs/gorse-config.toml"
docker run --rm --network none --mount type=bind,src=/srv/elsewhere,dst=/srv/elsewhere --mount "type=bind,src=$source_dir/eigenflux/scripts,dst=/scripts,readonly" node:24-alpine node /scripts/aliyun-hk-recommender-release.mjs "$previous" "$root" "$image" "$local_image"
docker compose -f "$root/compose.json" config --quiet
printf '%s\n' "$previous" > "$root/evidence/previous-release"
printf '%s\n' "$revision" > "$root/evidence/recommender-revision"
rollback() {
  docker compose -f "$previous/compose.json" up -d --no-deps gorse > "$root/evidence/rollback.log" 2>&1 || true
  if docker compose -f "$previous/compose.json" config --services | grep -qx local-ranker; then
    docker compose -f "$previous/compose.json" up -d --no-deps local-ranker >> "$root/evidence/rollback.log" 2>&1 || true
  else
    docker compose -f "$root/compose.json" stop local-ranker >> "$root/evidence/rollback.log" 2>&1 || true
  fi
}
trap rollback ERR
docker compose -f "$root/compose.json" up -d --no-deps --wait --wait-timeout 120 local-ranker > "$root/evidence/local-activate.log" 2>&1
docker compose -f "$root/compose.json" up -d --no-deps gorse > "$root/evidence/activate.log" 2>&1
# Check the actual listening process and its two stores, without a model request.
ready=0
for attempt in $(seq 1 30); do
  if docker run --rm --network container:elsewhere-gorse node:24-alpine node -e 'fetch("http://127.0.0.1:8088/api/health/ready",{signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok)process.exit(1);console.log(await r.text())}).catch(()=>process.exit(1))' > "$root/evidence/gorse-health.json" 2>&1; then ready=1; break; fi
  sleep 2
done
[[ "$ready" == 1 ]]
[[ "$(docker inspect --format '{{.Image}}' elsewhere-gorse)" == "$image" ]]
[[ "$(docker inspect --format '{{.Image}}' elsewhere-local-ranker)" == "$local_image" ]]
docker exec elsewhere-local-ranker /runtime/bin/python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8090/health").read().decode())' > "$root/evidence/local-health.json"
public_origin=$(docker inspect elsewhere-core --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^PUBLIC_BASE_URL=//p')
[[ "$public_origin" =~ ^https://[a-zA-Z0-9.-]+$ ]]
curl -fsS --max-time 20 --resolve "${public_origin#https://}:443:127.0.0.1" "$public_origin/api/v1/website/stats" > "$root/evidence/website-stats.json"
curl -fsS --max-time 20 --resolve "${public_origin#https://}:443:127.0.0.1" "$public_origin/release.json" > "$root/evidence/public-release.json"
ln -s "$root" /srv/elsewhere/current.next
mv -Tf /srv/elsewhere/current.next /srv/elsewhere/current
trap - ERR
date -u +%FT%TZ > "$root/ACTIVATED"
echo "RECOMMENDER_ACTIVATED $revision"
