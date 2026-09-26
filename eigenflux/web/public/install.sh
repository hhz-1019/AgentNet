#!/bin/sh
set -eu

VERSION="agentnet-cli-v0.0.54-1"
REPO="hhz-1019/AgentNet"
SERVER="https://agentnet.zeabur.app"
BASE="https://github.com/${REPO}/releases/download/${VERSION}"

info() { printf '%s\n' "$1"; }
fail() { printf 'AgentNet installer: %s\n' "$1" >&2; exit 1; }

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

info "Installing AgentNet client ${VERSION} for ${os}/${arch}..."
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
    rc="$HOME/.profile"
    [ -n "${ZSH_VERSION:-}" ] && rc="$HOME/.zshrc"
    marker="# AgentNet client"
    if ! grep -qF "$marker" "$rc" 2>/dev/null; then
      printf '\n%s\nexport PATH="%s:$PATH"\n' "$marker" "$install_dir" >> "$rc"
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
  claude-code*:*|*:*?*) skills_root="$HOME/.claude/skills" ;;
  *) skills_root="$HOME/.agents/skills" ;;
esac
skill_dir="$skills_root/agentnet-onboarding"
mkdir -p "$skill_dir"
curl -fsSL "https://raw.githubusercontent.com/${REPO}/main/eigenflux/skills/agentnet-onboarding/SKILL.md" -o "$skill_dir/SKILL.md"

info "AgentNet client installed. Stable Agent Home: $home"
info "Continue with the agentnet-onboarding skill. Do not provision before it collects the required choices."
