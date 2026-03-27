#!/bin/sh
set -eu

APP_NAME="${APP_NAME:-save-my-claude-token}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
HOOK_LAST="${HOOK_LAST:-1h}"
HOOK_MAX_CACHE_READ="${HOOK_MAX_CACHE_READ:-1000000}"
HOOK_MAX_EVENTS="${HOOK_MAX_EVENTS:-1000}"

remove_hook() {
  settings_path="$CLAUDE_DIR/settings.json"
  [ -f "$settings_path" ] || return 0

  HOOK_COMMAND="$APP_NAME hook claude-guard --last $HOOK_LAST --max-cache-read $HOOK_MAX_CACHE_READ --max-events $HOOK_MAX_EVENTS" \
  SETTINGS_PATH="$settings_path" \
  python3 <<'PY'
import json
import os
from pathlib import Path

settings_path = Path(os.environ["SETTINGS_PATH"])
hook_command = os.environ["HOOK_COMMAND"]

with settings_path.open() as f:
    data = json.load(f)

hooks = data.get("hooks", {})
ups = hooks.get("UserPromptSubmit", [])
new_groups = []
for group in ups:
    filtered = [
        hook for hook in group.get("hooks", [])
        if not (hook.get("type") == "command" and hook.get("command") == hook_command)
    ]
    if filtered:
        group = dict(group)
        group["hooks"] = filtered
        new_groups.append(group)

if new_groups:
    hooks["UserPromptSubmit"] = new_groups
else:
    hooks.pop("UserPromptSubmit", None)

if not hooks:
    data.pop("hooks", None)

with settings_path.open("w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY

  echo "Removed Claude hook from $settings_path"
}

main() {
  target="$INSTALL_DIR/$APP_NAME"
  alt_target="$INSTALL_DIR/$APP_NAME.exe"

  removed=0
  if [ -f "$target" ]; then
    rm -f "$target"
    echo "Removed $target"
    removed=1
  fi
  if [ -f "$alt_target" ]; then
    rm -f "$alt_target"
    echo "Removed $alt_target"
    removed=1
  fi
  if [ "$removed" -eq 0 ]; then
    echo "Nothing to remove in $INSTALL_DIR"
  fi

  remove_hook
}

main "$@"
