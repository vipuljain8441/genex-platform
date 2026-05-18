#!/bin/bash

export GENEX_SESSION_ROOT="${GENEX_SESSION_ROOT:-$(pwd -P)}"
export HOME="$GENEX_SESSION_ROOT"
export PATH="/usr/local/bin:/usr/bin:/bin"
export GENEX_SESSION_ID="${GENEX_SESSION_ID:-$(basename "$GENEX_SESSION_ROOT")}"

readonly GENEX_SESSION_ROOT
readonly GENEX_SESSION_ID

__genex_cmd_start_ts=0
__genex_cmd_buffer=""
__genex_internal=0

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

__genex_now_ms() {
  python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
}

__genex_json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read())[1:-1])'
}

__genex_redact_command() {
  local raw="${1:-}"
  case "$raw" in
    export*=*|set*=*|*PASSWORD*|*TOKEN*|*SECRET*|*KEY=*)
      printf '<redacted>'
      ;;
    *)
      printf '%s' "$raw"
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

__genex_preexec_capture() {
  local raw="${BASH_COMMAND:-}"
  [[ "$__genex_internal" == "1" ]] && return 0
  case "$raw" in
    __genex_*|trap*|PROMPT_COMMAND=*|"")
      return 0
      ;;
  esac
  __genex_internal=1
  __genex_cmd_start_ts="$(__genex_now_ms)"
  __genex_internal=0
  __genex_cmd_buffer="$raw"
}

__genex_postexec_send() {
  local rc=$?
  [[ -n "${GENEX_REPORT_URL:-}" ]] || {
    __genex_cmd_buffer=""
    return 0
  }
  [[ -n "$__genex_cmd_buffer" ]] || return 0
  local end_ts duration raw redacted escaped_command escaped_cwd
  __genex_internal=1
  end_ts="$(__genex_now_ms)"
  duration=$((end_ts - __genex_cmd_start_ts))
  raw="$(__genex_redact_command "$__genex_cmd_buffer")"
  escaped_command="$(printf '%s' "$raw" | __genex_json_escape)"
  escaped_cwd="$(printf '%s' "$PWD" | __genex_json_escape)"
  curl -sS --max-time 1 -X POST "${GENEX_REPORT_URL%/}/api/monitor/events" \
    -H 'Content-Type: application/json' \
    --data-binary @- >/dev/null 2>&1 <<JSON &
{"session_id":"$GENEX_SESSION_ID","kind":"terminal_command","payload":{"command":"$escaped_command","cwd":"$escaped_cwd","exit_code":$rc,"duration_ms":$duration}}
JSON
  __genex_internal=0
  __genex_cmd_buffer=""
}

trap '__genex_preexec_guard || false; __genex_preexec_capture' DEBUG
PROMPT_COMMAND='__genex_enforce_pwd; __genex_postexec_send'

PS1='genex:\w\$ '

echo "GenEx terminal locked to: $GENEX_SESSION_ROOT"
