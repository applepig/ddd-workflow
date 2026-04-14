#!/usr/bin/env bash
# claude.sh — xreview adapter for Claude CLI
#
# Interface: bash claude.sh <prompt-file> <model> [<timeout-seconds>]
# The 3rd arg is accepted but ignored (ADR-6: timeout is enforced by the
# orchestrator's outer `timeout --foreground`, not here). Kept in the signature
# so orchestrator can keep passing it — future defense-in-depth or per-CLI
# quirks may re-use it without breaking callers.

set -uo pipefail
exec 2>&1

prompt_file="${1:?Usage: claude.sh <prompt-file> <model> [<timeout-seconds>]}"
model="${2:?Usage: claude.sh <prompt-file> <model> [<timeout-seconds>]}"
# 3rd arg intentionally unused — see header note.

if [[ ! -f "$prompt_file" ]]; then
  echo "XREVIEW_ERROR: prompt file not found: $prompt_file"
  exit 1
fi

cli_path="$(command -v claude 2>/dev/null)" || true
if [[ -z "$cli_path" ]]; then
  echo "XREVIEW_ERROR: cli not found: claude (install it first)"
  exit 1
fi

"$cli_path" -p \
  --agent ddd-reviewer \
  --model "$model" \
  --no-session-persistence \
  --permission-mode plan \
  --output-format text \
  < "$prompt_file"
rc=$?

if [[ $rc -ne 0 ]]; then
  echo "XREVIEW_ERROR: claude exited with code $rc (model: $model)"
  exit "$rc"
fi
