#!/usr/bin/env bash
set -euo pipefail
cd /app
export CONSOLE_V2_PUBLIC_URL="${CONSOLE_V2_PUBLIC_URL:-${PUBLIC_BASE_URL:?PUBLIC_BASE_URL is required}}"
# The upstream safety client defaults to a different provider. Explicitly share
# the configured model provider only when no separate safety provider is set.
export SAFETY_LLM_API_KEY="${SAFETY_LLM_API_KEY:-${LLM_API_KEY:-}}"
export SAFETY_LLM_BASE_URL="${SAFETY_LLM_BASE_URL:-${LLM_BASE_URL:-}}"
export SAFETY_LLM_MODEL="${SAFETY_LLM_MODEL:-${LLM_MODEL:-}}"
if [[ "${1:-serve}" == migrate ]]; then
  /app/build/migration-preflight
  /app/build/goose -dir /app/migrations postgres "${PG_DSN:?PG_DSN is required}" up
  /app/build/short-id-backfill
  exec /app/build/influence-backfill
fi
if [[ "${1:-serve}" == cli ]]; then shift; exec /app/build/eigenflux "$@"; fi
if [[ "${1:-serve}" != serve ]]; then echo 'Expected serve, migrate or cli' >&2; exit 2; fi
pids=()
stop() { trap - TERM INT EXIT; if ((${#pids[@]})); then kill "${pids[@]}" 2>/dev/null || true; wait "${pids[@]}" 2>/dev/null || true; fi; }
trap stop TERM INT EXIT
for service in profile item sort feed pm auth notification api ws pipeline cron; do
  "/app/build/$service" &
  pids+=("$!")
done
# Fail the container if any child exits, including an unexpected successful exit.
set +e
wait -n "${pids[@]}"
result=$?
if [[ "$result" == 0 ]]; then result=1; fi
exit "$result"
