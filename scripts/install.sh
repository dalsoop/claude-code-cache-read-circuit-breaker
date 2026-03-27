#!/bin/sh
set -eu

REPO="${REPO:-dalsoop/save-my-claude-token}"
APP_NAME="${APP_NAME:-save-my-claude-token}"
VERSION="${VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
HOOK_LAST="${HOOK_LAST:-1h}"
HOOK_MAX_CACHE_READ="${HOOK_MAX_CACHE_READ:-1000000}"
HOOK_MAX_EVENTS="${HOOK_MAX_EVENTS:-1000}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

detect_os() {
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$os" in
    linux*) echo "linux" ;;
    darwin*) echo "darwin" ;;
    msys*|mingw*|cygwin*) echo "windows" ;;
    *)
      echo "unsupported operating system: $os" >&2
      exit 1
      ;;
  esac
}

detect_arch() {
  arch="$(uname -m | tr '[:upper:]' '[:lower:]')"
  case "$arch" in
    x86_64|amd64) echo "x86_64" ;;
    arm64|aarch64) echo "aarch64" ;;
    *)
      echo "unsupported architecture: $arch" >&2
      exit 1
      ;;
  esac
}

download_url() {
  os="$1"
  arch="$2"
  base="https://github.com/$REPO/releases"
  asset="${APP_NAME}_${os}_${arch}.tar.gz"
  if [ "$os" = "windows" ]; then
    asset="${APP_NAME}_${os}_${arch}.zip"
  fi
  if [ "$VERSION" = "latest" ]; then
    echo "$base/latest/download/$asset"
  else
    echo "$base/download/$VERSION/$asset"
  fi
}

register_hook() {
  settings_path="$CLAUDE_DIR/settings.json"
  mkdir -p "$CLAUDE_DIR"
  if [ -f "$settings_path" ]; then
    cp "$settings_path" "$settings_path.bak-save-my-claude-token"
  fi

  HOOK_COMMAND="$APP_NAME hook claude-guard --last $HOOK_LAST --max-cache-read $HOOK_MAX_CACHE_READ --max-events $HOOK_MAX_EVENTS" \
  SETTINGS_PATH="$settings_path" \
  python3 <<'PY'
import json
import os
from pathlib import Path

settings_path = Path(os.environ["SETTINGS_PATH"])
hook_command = os.environ["HOOK_COMMAND"]

data = {}
if settings_path.exists():
    with settings_path.open() as f:
        data = json.load(f)

hooks = data.setdefault("hooks", {})
ups = hooks.setdefault("UserPromptSubmit", [])

for group in ups:
    for hook in group.get("hooks", []):
        if hook.get("type") == "command" and hook.get("command") == hook_command:
            with settings_path.open("w") as f:
                json.dump(data, f, indent=2)
                f.write("\n")
            raise SystemExit(0)

ups.append({
    "hooks": [
        {
            "type": "command",
            "command": hook_command,
            "timeout": 10
        }
    ]
})

with settings_path.open("w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY

  echo "Registered Claude hook in $settings_path"
}

main() {
  need_cmd curl
  need_cmd tar
  need_cmd mktemp
  need_cmd uname
  need_cmd python3

  os="$(detect_os)"
  arch="$(detect_arch)"
  url="$(download_url "$os" "$arch")"
  tmpdir="$(mktemp -d)"
  archive="$tmpdir/archive"

  trap 'rm -rf "$tmpdir"' EXIT INT TERM

  mkdir -p "$INSTALL_DIR"
  echo "Downloading $url"
  curl -fsSL "$url" -o "$archive"

  case "$url" in
    *.tar.gz)
      tar -xzf "$archive" -C "$tmpdir"
      ;;
    *.zip)
      need_cmd unzip
      unzip -q "$archive" -d "$tmpdir"
      ;;
    *)
      echo "unsupported archive format: $url" >&2
      exit 1
      ;;
  esac

  bin_path="$tmpdir/$APP_NAME"
  if [ "$os" = "windows" ]; then
    bin_path="$tmpdir/$APP_NAME.exe"
  fi
  if [ ! -f "$bin_path" ]; then
    echo "archive did not contain $APP_NAME" >&2
    exit 1
  fi

  target="$INSTALL_DIR/$APP_NAME"
  if [ "$os" = "windows" ]; then
    target="$INSTALL_DIR/$APP_NAME.exe"
  fi
  install -m 0755 "$bin_path" "$target"

  echo "Installed $APP_NAME to $target"
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
      echo "Add $INSTALL_DIR to PATH if it is not already there."
      ;;
  esac

  register_hook
}

main "$@"
