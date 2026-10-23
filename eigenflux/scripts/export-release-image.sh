#!/usr/bin/env bash
set -Eeuo pipefail
service=${1:?service}
revision=${2:?revision}
[[ "$service" =~ ^(core|web|gorse|sync)$ && "$revision" =~ ^[a-f0-9]{40}$ ]]
case "$service" in
  core|web) source="agentnet-$service:verify" ;;
  *) source="elsewhere-$service:verify" ;;
esac
target="elsewhere-$service:$revision"
root="/tmp/release-$service"
mkdir -p "$root"
docker tag "$source" "$target"
printf '%s\n' "$revision" > "$root/revision"
docker save "$target" | gzip -1 > "$root/image.tar.gz"
bash "$(dirname "$0")/image-config-digest.sh" "$root/image.tar.gz" > "$root/image-id"
(cd "$root" && sha256sum image.tar.gz image-id revision > SHA256SUMS)
