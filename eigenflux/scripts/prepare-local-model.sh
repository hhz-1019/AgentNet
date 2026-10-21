#!/usr/bin/env bash
# Promote the already benchmarked Conda environment and pinned public weights.
# Everything is isolated on the system disk, not the nearly-full business disk.
set -Eeuo pipefail
runtime=/opt/elsewhere-model-runtime
seed=/opt/elsewhere-embedding-bench
revision=7999e1d3359715c523056ef9478215996d62a620
if [[ ! -f "$runtime/READY" ]]; then
  test -x "$seed/conda/bin/conda"
  test -x "$seed/env/bin/python"
  test -d "$seed/hf/hub/models--BAAI--bge-small-zh-v1.5/snapshots/$revision"
  mkdir -p "$runtime"
  if [[ ! -x "$runtime/env/bin/python" ]]; then
    "$seed/conda/bin/conda" create -y --offline --copy --prefix "$runtime/env" --clone "$seed/env"
  fi
  mkdir -p "$runtime/model"
  cp -aL "$seed/hf/hub/models--BAAI--bge-small-zh-v1.5/snapshots/$revision/." "$runtime/model/"
  printf '%s\n' "$revision" > "$runtime/model/REVISION"
  "$runtime/env/bin/python" -m pip freeze > "$runtime/requirements.lock"
  chmod -R a+rX "$runtime"
  date -u +%FT%TZ > "$runtime/READY"
fi
[[ "$(cat "$runtime/model/REVISION")" == "$revision" ]]
mkdir -p /opt/elsewhere-local-ranker-cache
chown 65532:65532 /opt/elsewhere-local-ranker-cache
chmod 700 /opt/elsewhere-local-ranker-cache
