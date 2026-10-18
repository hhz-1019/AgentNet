#!/usr/bin/env bash
# Build or activate a committed release without replacing live data volumes.
set -Eeuo pipefail
umask 077
mode="${1:?build or activate}"
revision="${2:?full Git revision}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
source_dir=/srv/elsewhere/builds/release-20261018
root="/srv/elsewhere/releases/hk-code-$revision"
mountpoint -q /srv/elsewhere
cd "$source_dir"
[[ "$(git rev-parse HEAD)" == "$revision" ]]
[[ -z "$(git status --porcelain --untracked-files=no)" ]]
mkdir -p "$root/evidence"
if [[ "$mode" == build ]]; then
  docker build --label "org.opencontainers.image.revision=$revision" -t "elsewhere-core:$revision" -f eigenflux/Dockerfile.core . > "$root/evidence/core-build.log" 2>&1
  docker build --label "org.opencontainers.image.revision=$revision" -t "elsewhere-web:$revision" -f eigenflux/Dockerfile.web . > "$root/evidence/web-build.log" 2>&1
  docker inspect --format '{{.Id}}' "elsewhere-core:$revision" > "$root/evidence/core-image-id"
  docker inspect --format '{{.Id}}' "elsewhere-web:$revision" > "$root/evidence/web-image-id"
  touch "$root/BUILT"
  echo "BUILD_COMPLETE $revision"
  exit 0
fi
[[ "$mode" == activate ]]
test -f "$root/BUILT"
test ! -e "$root/ACTIVATED"
previous=$(readlink -f /srv/elsewhere/current)
[[ "$previous" == /srv/elsewhere/releases/* && "$previous" != "$root" ]]
# The backup must succeed before changing any application container.
systemctl start elsewhere-pg-backup.service
[[ "$(systemctl show elsewhere-pg-backup.service -p Result --value)" == success ]]
printf '%s\n' "$previous" > "$root/evidence/previous-release"
cp -a "$previous/env" "$previous/configs" "$root/"
docker run --rm --network none --mount type=bind,src=/srv/elsewhere/releases,dst=/srv/elsewhere/releases --mount "type=bind,src=$source_dir/eigenflux/scripts,dst=/scripts,readonly" node:24-alpine node /scripts/aliyun-hk-code-compose.mjs "$previous" "$root"
docker compose -f "$root/compose.json" config --quiet
docker compose -f "$root/compose.json" run --rm --no-deps core migrate > "$root/evidence/migrate.log" 2>&1
rollback() {
  docker compose -f "$previous/compose.json" up -d --no-deps --wait --wait-timeout 300 core web > "$root/evidence/rollback.log" 2>&1 || true
}
trap rollback ERR
docker compose -f "$root/compose.json" up -d --no-deps --wait --wait-timeout 300 core web > "$root/evidence/activate.log" 2>&1
curl -fsS --max-time 20 --resolve elsewhere.twintalk.cn:443:127.0.0.1 https://elsewhere.twintalk.cn/api/v1/website/stats > "$root/evidence/website-stats.json"
curl -fsS --max-time 20 --resolve elsewhere.twintalk.cn:443:127.0.0.1 https://elsewhere.twintalk.cn/release.json > "$root/evidence/public-release.json"
grep -q 'elsewhere-hk-no-cost-20261018-r1' "$root/evidence/public-release.json"
ln -s "$root" /srv/elsewhere/current.next
mv -Tf /srv/elsewhere/current.next /srv/elsewhere/current
trap - ERR
date -u +%FT%TZ > "$root/ACTIVATED"
echo "ACTIVATED $revision"
