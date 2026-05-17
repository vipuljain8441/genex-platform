#!/bin/bash

export GENEX_SESSION_ROOT="${GENEX_SESSION_ROOT:-$(pwd -P)}"
export HOME="$GENEX_SESSION_ROOT"
export PATH="/usr/local/bin:/usr/bin:/bin"

readonly GENEX_SESSION_ROOT

__genex_is_within_root() {
  local candidate="${1:-}"
  [[ -n "$candidate" ]] || return 1
  case "$candidate" in
    "$GENEX_SESSION_ROOT"|"$GENEX_SESSION_ROOT"/*) return 0 ;;
    *) return 1 ;;
  esac
}

__genex_resolve_path() {
  python3 - "$GENEX_SESSION_ROOT" "$PWD" "${1:-$GENEX_SESSION_ROOT}" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
cwd = Path(sys.argv[2]).resolve()
target = sys.argv[3]
candidate = (cwd / target).resolve() if not target.startswith("/") else Path(target).resolve()
print(candidate)
PY
}

__genex_enforce_pwd() {
  local current
  current="$(pwd -P)"
  if ! __genex_is_within_root "$current"; then
    builtin cd "$GENEX_SESSION_ROOT"
    echo "Reset to assessment workspace: leaving the session directory is not allowed." >&2
  fi
}

__genex_block_nested_shell() {
  local cmd="$1"
  case "$cmd" in
    bash|/bin/bash|sh|/bin/sh|zsh|/bin/zsh|sudo|su)
      echo "That command is disabled in the assessment terminal." >&2
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

bash() {
  __genex_block_nested_shell "bash"
}

sh() {
  __genex_block_nested_shell "sh"
}

zsh() {
  __genex_block_nested_shell "zsh"
}

sudo() {
  __genex_block_nested_shell "sudo"
}

su() {
  __genex_block_nested_shell "su"
}

cd() {
  local target="${1:-$GENEX_SESSION_ROOT}"
  local resolved
  resolved="$(__genex_resolve_path "$target")" || {
    echo "Unable to resolve path: $target" >&2
    return 1
  }
  if ! __genex_is_within_root "$resolved"; then
    echo "You can only work inside this assessment session." >&2
    return 1
  fi
  builtin cd "$resolved"
}

pushd() {
  if [[ $# -eq 0 ]]; then
    echo "Directory stack shortcuts are disabled in the assessment terminal." >&2
    return 1
  fi
  cd "$1"
}

popd() {
  echo "Directory stack shortcuts are disabled in the assessment terminal." >&2
  return 1
}

__genex_preexec_guard() {
  local raw="${BASH_COMMAND:-}"
  local cmd="${raw%% *}"
  case "$cmd" in
    cd|pushd|popd|"")
      return 0
      ;;
  esac
  __genex_block_nested_shell "$cmd" || return 1
}

trap '__genex_preexec_guard || false' DEBUG
PROMPT_COMMAND='__genex_enforce_pwd'

PS1='genex:\w\$ '

echo "GenEx terminal locked to: $GENEX_SESSION_ROOT"
