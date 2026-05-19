#!/usr/bin/env bash
# codex.sh — xreview adapter for Codex CLI
#
# Interface: bash codex.sh <prompt-file> <model> <final-out-file>
#
# The 3rd arg is the final-output file (ADR-11). Codex writes final text
# directly to `-o <final-out>`; stderr flows naturally as verbose trace
# (no `exec 2>&1` merge).
#
# ADR-12 (ddd-reviewer role): codex CLI has no top-level `--agent` flag.
# `~/.codex/agents/ddd-reviewer.toml` auto-discovery only fires for
# `spawn_agent` tool calls, not for top-level `codex exec`. To make
# `codex exec` review in the ddd-reviewer role, we read that toml's
# `developer_instructions` field via python3+tomllib and prepend it to the
# prompt. Toml lookup order:
#   1. ${XDG_CONFIG_HOME:-$HOME/.config}/codex/agents/ddd-reviewer.toml
#   2. $HOME/.codex/agents/ddd-reviewer.toml
# If neither is readable or python3/tomllib is unavailable, adapter degrades
# gracefully (warning on stderr, prompt forwarded as-is) and does NOT block
# the review.
#
# Sandbox: codex runs `--sandbox read-only --ephemeral` already. /tmp and
# ~/.config don't need explicit allow-listing (verified empirically; see
# works.md M5/M6).
#
# stdout contract: must be empty (final flows to $3 via codex `-o`). codex's
# own progress lines go to stderr; this adapter does not print to stdout.

set -uo pipefail

prompt_file="${1:?Usage: codex.sh <prompt-file> <model> <final-out-file>}"
model="${2:?Usage: codex.sh <prompt-file> <model> <final-out-file>}"
final_out="${3:?Usage: codex.sh <prompt-file> <model> <final-out-file>}"

if [[ ! -f "$prompt_file" ]]; then
  echo "XREVIEW_ERROR: prompt file not found: $prompt_file" >&2
  exit 1
fi

cli_path="$(command -v codex 2>/dev/null)" || true
if [[ -z "$cli_path" ]]; then
  echo "XREVIEW_ERROR: cli not found: codex (install it first)" >&2
  exit 1
fi

: > "$final_out"

# Locate ddd-reviewer agent toml. XDG path takes precedence (ADR-12).
xdg_cfg="${XDG_CONFIG_HOME:-$HOME/.config}"
toml_candidates=(
  "$xdg_cfg/codex/agents/ddd-reviewer.toml"
  "$HOME/.codex/agents/ddd-reviewer.toml"
)
agent_toml=""
for candidate in "${toml_candidates[@]}"; do
  if [[ -r "$candidate" ]]; then
    agent_toml="$candidate"
    break
  fi
done

# Extract developer_instructions. Primary: python3 + tomllib (Python 3.11+,
# per ADR-12). Fallbacks (for 3.10 or no-python envs):
#   1. python3 + tomli pip package
#   2. awk triple-quoted-string extractor (only handles the exact key
#      `developer_instructions = """...""" ` — sufficient for ddd-reviewer.toml)
# Any failure degrades to empty string → adapter forwards prompt unchanged
# with a warning on stderr, never blocks the review.
developer_instructions=""
toml_warn=""
toml_extract_path=""  # which extractor succeeded: python_tomllib|python_tomli|awk_fallback
PY_ERR_FILE=""

# Cleanup any captured python stderr scratch on exit.
_codex_cleanup_py_err() {
  [[ -n "$PY_ERR_FILE" && -f "$PY_ERR_FILE" ]] && rm -f "$PY_ERR_FILE"
}
trap _codex_cleanup_py_err EXIT

extract_via_python() {
  # Returns developer_instructions on stdout; rc 0 OK / 2 parse / 3 no-module.
  # Stderr is captured to $PY_ERR_FILE (caller-provided) so the warning line
  # can surface the real error instead of silently swallowing it (Finding 2).
  # The python script also prints `EXTRACTOR=tomllib` or `EXTRACTOR=tomli` to
  # stderr on success so the adapter can log which path was taken.
  python3 -c '
import sys
extractor = None
try:
    import tomllib
    extractor = "tomllib"
except ModuleNotFoundError:
    try:
        import tomli as tomllib
        extractor = "tomli"
    except ModuleNotFoundError:
        sys.exit(3)
try:
    with open(sys.argv[1], "rb") as f:
        data = tomllib.load(f)
    di = data.get("developer_instructions", "")
    if not isinstance(di, str):
        di = ""
    sys.stderr.write("EXTRACTOR=" + extractor + "\n")
    sys.stdout.write(di)
except Exception as e:
    sys.stderr.write("PARSE_EXC: " + type(e).__name__ + ": " + str(e) + "\n")
    sys.exit(2)
' "$1" 2>"$PY_ERR_FILE"
}

# Returns 0 if python3 reports a version >= 3.11 (i.e. has stdlib tomllib).
# Returns non-zero otherwise. We do this before invoking extract_via_python so
# that environments with old python but tomli installed still go through python
# (instead of jumping straight to awk), while environments without tomllib AND
# without tomli short-circuit to awk faster (Finding 2 — explicit path log).
python_has_tomllib() {
  python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)' 2>/dev/null
}

extract_via_awk() {
  # Minimal extractor for `developer_instructions = ...`. Handles two forms:
  #   (1) Triple-quoted multi-line: developer_instructions = """...\n...\n"""
  #   (2) Basic single-line string: developer_instructions = "..."
  # Limitations: does not handle escape sequences, literal strings ('...'),
  # or key expansion. Good enough for the ddd-reviewer.toml schema.
  awk '
    BEGIN { in_block = 0 }
    in_block && /"""[[:space:]]*$/ {
      sub(/"""[[:space:]]*$/, "")
      if ($0 != "") print
      in_block = 0
      exit
    }
    in_block { print; next }
    /^[[:space:]]*developer_instructions[[:space:]]*=[[:space:]]*"""/ {
      sub(/^[^"]*"""/, "")
      if ($0 ~ /"""[[:space:]]*$/) {
        sub(/"""[[:space:]]*$/, "")
        print
        exit
      }
      in_block = 1
      if ($0 != "") print
      next
    }
    /^[[:space:]]*developer_instructions[[:space:]]*=[[:space:]]*"/ {
      # Basic single-line string: strip up to first " and trailing "
      line = $0
      sub(/^[^"]*"/, "", line)
      sub(/"[[:space:]]*(#.*)?$/, "", line)
      print line
      exit
    }
  ' "$1"
}

if [[ -n "$agent_toml" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    PY_ERR_FILE=$(mktemp /tmp/xreview-codex-py-err-XXXXXX)
    developer_instructions="$(extract_via_python "$agent_toml")"
    py_rc=$?
    # Capture which extractor module the python script picked (printed to its
    # stderr alongside any error noise) so we can log the path taken.
    py_extractor="$(grep -oE '^EXTRACTOR=[a-z]+' "$PY_ERR_FILE" 2>/dev/null | head -1 | cut -d= -f2)"
    if [[ $py_rc -eq 3 ]]; then
      # No tomllib/tomli module — fall back to awk.
      developer_instructions="$(extract_via_awk "$agent_toml" 2>/dev/null)"
      if [[ -n "$developer_instructions" ]]; then
        toml_extract_path="awk_fallback"
      else
        toml_warn="awk_fallback_empty:$agent_toml (no developer_instructions key or unparseable)"
      fi
    elif [[ $py_rc -ne 0 ]]; then
      developer_instructions=""
      # Surface a snippet of python stderr (capped) so users can debug toml
      # syntax / module errors without re-running manually (Finding 2).
      py_err_snippet="$(head -c 300 "$PY_ERR_FILE" 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]\+$//')"
      toml_warn="parse_failed:$agent_toml | python stderr: ${py_err_snippet:-<empty>}"
    else
      toml_extract_path="python_${py_extractor:-unknown}"
    fi
  else
    developer_instructions="$(extract_via_awk "$agent_toml" 2>/dev/null)"
    if [[ -n "$developer_instructions" ]]; then
      toml_extract_path="awk_fallback"
    else
      toml_warn="python3_unavailable_and_awk_empty:$agent_toml"
    fi
  fi
else
  toml_warn="toml_not_found (searched: ${toml_candidates[*]})"
fi

if [[ -n "$toml_extract_path" ]]; then
  echo "XREVIEW_INFO: codex toml extracted via $toml_extract_path ($agent_toml)" >&2
fi
if [[ -n "$toml_warn" ]]; then
  echo "XREVIEW_WARN: codex ddd-reviewer.toml degradation ($toml_warn) — review proceeds with original prompt" >&2
fi

# Build the final prompt. If we have developer_instructions, prepend them with
# a separator. Otherwise, forward prompt_file as-is.
EFFECTIVE_PROMPT_FILE=""
_codex_full_cleanup() {
  _codex_cleanup_py_err
  [[ -n "$EFFECTIVE_PROMPT_FILE" && -f "$EFFECTIVE_PROMPT_FILE" ]] && \
    rm -f "$EFFECTIVE_PROMPT_FILE"
}
trap _codex_full_cleanup EXIT

if [[ -n "$developer_instructions" ]]; then
  EFFECTIVE_PROMPT_FILE="$(mktemp /tmp/xreview-codex-prompt-XXXXXX.md)"
  effective_prompt_file="$EFFECTIVE_PROMPT_FILE"
  {
    printf '%s\n\n---\n\n' "$developer_instructions"
    cat "$prompt_file"
  } > "$effective_prompt_file"
else
  effective_prompt_file="$prompt_file"
fi

"$cli_path" exec \
  --sandbox read-only \
  --ephemeral \
  --model "$model" \
  -o "$final_out" \
  - < "$effective_prompt_file"
rc=$?

if [[ $rc -ne 0 ]]; then
  echo "XREVIEW_ERROR: codex exited with code $rc (model: $model)" >&2
  exit "$rc"
fi
