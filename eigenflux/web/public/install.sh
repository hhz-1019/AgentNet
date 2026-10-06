#!/bin/sh
set -eu

VERSION="0.0.54-agentnet.7"
SERVER="https://agentnet.zeabur.app"
BASE="${SERVER}/downloads"

info() { printf '%s\n' "$1"; }
fail() { printf 'elsewhere installer: %s\n' "$1" >&2; exit 1; }

case "$(uname -s)" in
  Linux*) os=linux ;;
  Darwin*) os=darwin ;;
  *) fail "unsupported system; Windows users should run irm ${SERVER}/install.ps1 | iex" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=amd64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

asset="agentnet-${os}-${arch}"
install_dir="${AGENTNET_INSTALL_DIR:-$HOME/.local/bin}"
binary="$install_dir/agentnet"
tmp="$(mktemp)"
sum="$(mktemp)"
trap 'rm -f "$tmp" "$sum"' EXIT

info "Installing elsewhere client ${VERSION} for ${os}/${arch}..."
curl -fsSL "$BASE/$asset" -o "$tmp"
curl -fsSL "$BASE/$asset.sha256" -o "$sum"
expected="$(awk '{print $1}' "$sum")"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$tmp" | awk '{print $1}')"
fi
[ "$actual" = "$expected" ] || fail "download checksum mismatch"
mkdir -p "$install_dir"
chmod +x "$tmp"
mv "$tmp" "$binary"

case ":$PATH:" in
  *":$install_dir:"*) : ;;
  *)
    if [ -z "${AGENTNET_INSTALL_DIR:-}" ]; then
      rc="$HOME/.profile"
      [ -n "${ZSH_VERSION:-}" ] && rc="$HOME/.zshrc"
      marker="# elsewhere client"
      if ! grep -qF "$marker" "$rc" 2>/dev/null; then
        printf '\n%s\nexport PATH="%s:$PATH"\n' "$marker" "$install_dir" >> "$rc"
      fi
    fi
    export PATH="$install_dir:$PATH"
    ;;
esac

case "${INVOKING_HOST:-${EIGENFLUX_HOST:-}}:${CODEX_THREAD_ID:-}:${CLAUDECODE:-}" in
  codex*:*:*|*:*?*:*) home="${AGENTNET_HOME:-$HOME/.agentnet-codex/.eigenflux}" ;;
  *:*:*?*) home="${AGENTNET_HOME:-$HOME/.agentnet-claude/.eigenflux}" ;;
  *) home="${AGENTNET_HOME:-$HOME/.agentnet/.eigenflux}" ;;
esac

servers="$("$binary" --homedir "$home" --format json --no-interactive server list)"
if printf '%s' "$servers" | grep -q '"name": "agentnet"'; then
  "$binary" --homedir "$home" --format json --no-interactive server update --name agentnet --endpoint "$SERVER" --stream-endpoint "wss://agentnet.zeabur.app" >/dev/null
else
  "$binary" --homedir "$home" --format json --no-interactive server add --name agentnet --endpoint "$SERVER" --stream-endpoint "wss://agentnet.zeabur.app" >/dev/null
fi
"$binary" --homedir "$home" --format json --no-interactive server use --name agentnet >/dev/null
"$binary" --homedir "$home" --server agentnet --format json --no-interactive config set --key auto_skill_sync --value false >/dev/null

case "${INVOKING_HOST:-${EIGENFLUX_HOST:-}}:${CLAUDECODE:-}" in
  claude-code*:*|*:*?*) skills_root="${AGENTNET_SKILLS_DIR:-$HOME/.claude/skills}" ;;
  *) skills_root="${AGENTNET_SKILLS_DIR:-$HOME/.agents/skills}" ;;
esac
skill_dir="$skills_root/agentnet-onboarding"
mkdir -p "$skill_dir"
curl -fsSL "${SERVER}/agentnet-onboarding/SKILL.md" -o "$skill_dir/SKILL.md"
mkdir -p "$skills_root/agentnet-handoff"
curl -fsSL "${SERVER}/agentnet-handoff/SKILL.md" -o "$skills_root/agentnet-handoff/SKILL.md"

info "elsewhere client installed. Stable Agent Home: $home"
info "Continue with the agentnet-onboarding skill. Do not provision before it collects the required choices."
