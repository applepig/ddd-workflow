#!/usr/bin/env bash
# claude.sh — xreview adapter for Claude CLI
#
# Interface: bash claude.sh <prompt-file> <model> <final-out-file>
#
# The 3rd arg is the final-output file path (ADR-11). Adapter writes the
# reviewer's extracted final text to that file; verbose trace (CLI debug +
# envelope echo) flows via stderr and is captured by the orchestrator's log.
#
# Dual-output mechanics (ADR-11):
#   - stdout of claude CLI is a single JSON object (--output-format json);
#     adapter pipes it through `jq -r '.result'` into $final_out.
#   - --debug-file <tmp> absorbs claude's verbose trace; adapter dumps the
#     tmp file to stderr at the end so the orchestrator log keeps a copy.
#   - stderr of claude CLI flows straight through (no `exec 2>&1`).
#
# Exit code: the CLI's own rc, taken from PIPESTATUS[0]. If jq fails (CLI
# emitted non-JSON), final_out may be empty but we still report the CLI rc
# so upstream `RETURN` vs `FAIL` semantics are preserved.

set -uo pipefail

prompt_file="${1:?Usage: claude.sh <prompt-file> <model> <final-out-file>}"
model="${2:?Usage: claude.sh <prompt-file> <model> <final-out-file>}"
final_out="${3:?Usage: claude.sh <prompt-file> <model> <final-out-file>}"

if [[ ! -f "$prompt_file" ]]; then
  echo "XREVIEW_ERROR: prompt file not found: $prompt_file" >&2
  exit 1
fi

cli_path="$(command -v claude 2>/dev/null)" || true
if [[ -z "$cli_path" ]]; then
  echo "XREVIEW_ERROR: cli not found: claude (install it first)" >&2
  exit 1
fi

# Ensure final_out exists (empty) even on early exit — callers Read it.
: > "$final_out"

# Debug-file sibling path: /tmp/.../xreview-...final.txt -> .debug
debug_file="${final_out%.final.txt}.debug"
# If final_out doesn't end with .final.txt, fall back to a mktemp.
if [[ "$debug_file" == "$final_out" ]]; then
  debug_file="$(mktemp /tmp/xreview-claude-debug-XXXXXX)"
fi
: > "$debug_file"

# Pipefail disabled for this pipeline: we take rc from PIPESTATUS[0] (the CLI),
# and want jq failures to leave final_out empty rather than mask the CLI rc.
set +o pipefail
"$cli_path" -p \
  --agent ddd-reviewer \
  --model "$model" \
  --no-session-persistence \
  --permission-mode plan \
  --output-format json \
  --debug-file "$debug_file" \
  < "$prompt_file" \
  | jq -r '.result // empty' > "$final_out" 2>/dev/null
rc="${PIPESTATUS[0]}"
set -o pipefail

# Dump the debug-file into stderr so the orchestrator log still captures the
# verbose trace, then clean up the sidecar.
if [[ -s "$debug_file" ]]; then
  echo "=== claude --debug-file content ===" >&2
  cat "$debug_file" >&2
fi
rm -f "$debug_file"

if [[ $rc -ne 0 ]]; then
  echo "XREVIEW_ERROR: claude exited with code $rc (model: $model)" >&2
  exit "$rc"
fi
