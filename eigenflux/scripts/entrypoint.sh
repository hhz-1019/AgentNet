#!/usr/bin/env bash
set -euo pipefail
cd /app
export CONSOLE_V2_PUBLIC_URL="${CONSOLE_V2_PUBLIC_URL:-${PUBLIC_BASE_URL:?PUBLIC_BASE_URL is required}}"
export AGENTNET_OFFICIAL_ASSISTANT="${AGENTNET_OFFICIAL_ASSISTANT:-true}"
if [[ "$AGENTNET_OFFICIAL_ASSISTANT" == true ]]; then
  # AgentNet first contact is transactional; never run the upstream Redis-only
  # welcome consumer alongside it. Proactive broadcast features remain opt-in.
  export ENABLE_OFFICIAL_WELCOME=false
  export ENABLE_OFFICIAL_CHAT=true
  export OFFICIAL_AGENT_EMAIL=assistant@agentnet.internal
  export OFFICIAL_AGENT_NAME='AgentNet 官方助手'
fi
# The upstream safety client defaults to a different provider. Explicitly share
# the configured model provider only when no separate safety provider is set.
export SAFETY_LLM_API_KEY="${SAFETY_LLM_API_KEY:-${LLM_API_KEY:-}}"
export SAFETY_LLM_BASE_URL="${SAFETY_LLM_BASE_URL:-${LLM_BASE_URL:-}}"
export SAFETY_LLM_MODEL="${SAFETY_LLM_MODEL:-${LLM_MODEL:-}}"
if [[ "${1:-serve}" == deploy ]]; then
  # Single-replica deployment: migrations must succeed before services start.
  bash /app/entrypoint.sh migrate
  exec bash /app/entrypoint.sh serve
fi
if [[ "${1:-serve}" == migrate ]]; then
  /app/build/migration-preflight
  /app/build/goose -dir /app/migrations postgres "${PG_DSN:?PG_DSN is required}" up
  /app/build/short-id-backfill
  exec /app/build/influence-backfill
fi
if [[ "${1:-serve}" == cli ]]; then shift; exec /app/build/eigenflux "$@"; fi
if [[ "${1:-serve}" != serve ]]; then echo 'Expected serve, deploy, migrate or cli' >&2; exit 2; fi
/app/build/official-assistant
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
