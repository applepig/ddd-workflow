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
#   - stdout of claude CLI with `--output-format json` is a JSON array of
#     event envelopes; the final agent message sits in the last element with
#     `type=="result"`. Some older CLI builds emit a single object instead.
#     adapter's jq filter handles both: if array → pick last type=="result"
#     element's .result; if object → .result. Empty on miss.
#   - --debug-file <tmp> absorbs claude's verbose trace; adapter dumps the
#     tmp file to stderr at the end so the orchestrator log keeps a copy.
#   - stderr of claude CLI flows straight through (no `exec 2>&1`).
#
# Exit code: the CLI's own rc, taken from PIPESTATUS[0]. If jq fails (CLI
# emitted non-JSON), final_out may be empty but we still report the CLI rc
# so upstream `RETURN` vs `FAIL` semantics are preserved.
#
# stdout contract: must be empty (final flows to $3 via jq). If anything ever
# prints to stdout here, the orchestrator's `>> $log 2>&1` will append it to
# the log and the final_out copy will be the only sanctioned record.

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

# jq is required for final extraction. Without it the pipeline silently yields
# an empty final_out while the CLI rc may still be 0, fooling upstream
# orchestration into treating a transport failure as a content-layer failure.
if ! command -v jq >/dev/null 2>&1; then
  echo "XREVIEW_ERROR: jq not found (required for claude adapter final extraction)" >&2
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
# --permission-mode default (not plan): plan mode denies Bash unconditionally
# (Issue #13067, Issue #2058 — no per-mode allowlist) and ddd-reviewer needs
# Bash for `git --no-pager diff`. Safety relies on user/local settings
# allowlist; CI environments must supply --allowedTools explicitly.
"$cli_path" -p \
  --agent ddd-reviewer \
  --model "$model" \
  --no-session-persistence \
  --permission-mode default \
  --output-format json \
  --debug-file "$debug_file" \
  < "$prompt_file" \
  | jq -r 'if type=="array" then (map(select(.type=="result")) | last // .[-1]).result else .result end // empty' > "$final_out" 2>/dev/null
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
