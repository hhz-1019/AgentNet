#!/usr/bin/env bash
# Stable across Docker's classic and containerd image stores. The archive's
# content-addressed config also binds its filesystem layer digests.
set -Eeuo pipefail
archive=${1:--}
if [[ "$archive" == - ]]; then
  tar -xOf - manifest.json
else
  gzip -dc "$archive" | tar -xOf - manifest.json
fi | jq -er 'if length == 1 then .[0].Config else error("Expected one image") end
  | capture("^(?:blobs/sha256/)?(?<hash>[a-f0-9]{64})(?:\\.json)?$")
  | "sha256:" + .hash'
