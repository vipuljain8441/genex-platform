#!/bin/bash

export GENEX_SESSION_ROOT="${GENEX_SESSION_ROOT:-$(pwd -P)}"
export HOME="$GENEX_SESSION_ROOT"
export PATH="/usr/local/bin:/usr/bin:/bin"
export GENEX_SESSION_ID="${GENEX_SESSION_ID:-$(basename "$GENEX_SESSION_ROOT")}"
export GENEX_TERMINAL_DIR="${GENEX_TERMINAL_DIR:-$GENEX_SESSION_ROOT/.genex-terminal}"
export GENEX_TERMINAL_LOG="${GENEX_TERMINAL_LOG:-$GENEX_TERMINAL_DIR/terminal.log}"
export GENEX_TERMINAL_EVENTS="${GENEX_TERMINAL_EVENTS:-$GENEX_TERMINAL_DIR/events.jsonl}"
export GENEX_TERMINAL_OUTPUT_CAP="${GENEX_TERMINAL_OUTPUT_CAP:-20000}"

readonly GENEX_SESSION_ROOT
readonly GENEX_SESSION_ID

mkdir -p "$GENEX_TERMINAL_DIR"

__genex_cmd_start_ts=0
__genex_cmd_start_offset=0
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

__genex_file_size() {
  python3 - "$1" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
print(path.stat().st_size if path.exists() else 0)
PY
}

__genex_read_log_slice() {
  python3 - "$GENEX_TERMINAL_LOG" "$1" "$2" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
start = int(sys.argv[2])
end = int(sys.argv[3])
if not path.exists() or end <= start:
    print("")
    raise SystemExit

with path.open("rb") as fh:
    fh.seek(start)
    data = fh.read(max(0, end - start))

text = data.decode("utf-8", errors="replace")
text = text.replace("\r", "")
text = re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", text)
print(text, end="")
PY
}

__genex_trim_output() {
  python3 - "$GENEX_TERMINAL_OUTPUT_CAP" <<'PY'
import json
import sys

cap = int(sys.argv[1])
text = sys.stdin.read()
truncated = len(text) > cap
if truncated:
    text = text[:cap] + "\n...[truncated]"
print(json.dumps({
    "text": text,
    "chars": len(text),
    "truncated": truncated,
}))
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
  __genex_cmd_start_offset="$(__genex_file_size "$GENEX_TERMINAL_LOG")"
  __genex_internal=0
  __genex_cmd_buffer="$raw"
}

__genex_postexec_send() {
  local rc=$?
  [[ -n "$__genex_cmd_buffer" ]] || return 0
  local end_ts duration raw redacted escaped_command escaped_cwd end_offset transcript_json transcript_text transcript_chars transcript_truncated
  __genex_internal=1
  end_ts="$(__genex_now_ms)"
  duration=$((end_ts - __genex_cmd_start_ts))
  end_offset="$(__genex_file_size "$GENEX_TERMINAL_LOG")"
  raw="$(__genex_redact_command "$__genex_cmd_buffer")"
  escaped_command="$(printf '%s' "$raw" | __genex_json_escape)"
  escaped_cwd="$(printf '%s' "$PWD" | __genex_json_escape)"
  transcript_json="$(__genex_read_log_slice "$__genex_cmd_start_offset" "$end_offset" | __genex_trim_output)"
  transcript_text="$(printf '%s' "$transcript_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["text"], end="")')"
  transcript_chars="$(printf '%s' "$transcript_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["chars"])')"
  transcript_truncated="$(printf '%s' "$transcript_json" | python3 -c 'import json,sys; print("true" if json.load(sys.stdin)["truncated"] else "false")')"
  local escaped_output
  escaped_output="$(printf '%s' "$transcript_text" | __genex_json_escape)"
  {
    printf '{"command":"%s","cwd":"%s","exit_code":%s,"duration_ms":%s,"output_preview":"%s"}\n' \
      "$escaped_command" "$escaped_cwd" "$rc" "$duration" "$escaped_output"
  } >> "$GENEX_TERMINAL_EVENTS" 2>/dev/null || true
  [[ -n "${GENEX_REPORT_URL:-}" ]] || {
    __genex_internal=0
    __genex_cmd_buffer=""
    return 0
  }
  curl -sS --max-time 1 -X POST "${GENEX_REPORT_URL%/}/api/monitor/events" \
    -H 'Content-Type: application/json' \
    --data-binary @- >/dev/null 2>&1 <<JSON &
{"session_id":"$GENEX_SESSION_ID","kind":"terminal_command","payload":{"command":"$escaped_command","cwd":"$escaped_cwd","exit_code":$rc,"duration_ms":$duration,"output_preview":"$escaped_output","output_chars":$transcript_chars,"output_truncated":$transcript_truncated}}
JSON
  __genex_internal=0
  __genex_cmd_buffer=""
}

trap '__genex_preexec_guard || false; __genex_preexec_capture' DEBUG
PROMPT_COMMAND='__genex_enforce_pwd; __genex_postexec_send'

PS1='genex:\w\$ '

echo "GenEx terminal locked to: $GENEX_SESSION_ROOT"
