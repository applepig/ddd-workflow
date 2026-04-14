#!/usr/bin/env bash
# codex.sh — xreview adapter for Codex CLI

set -uo pipefail
exec 2>&1

prompt_file="${1:?Usage: codex.sh <prompt-file> <model> <timeout-seconds>}"
model="${2:?Usage: codex.sh <prompt-file> <model> <timeout-seconds>}"
timeout_sec="${3:-3000}"

if [[ ! -f "$prompt_file" ]]; then
  echo "XREVIEW_ERROR: prompt file not found: $prompt_file"
  exit 1
fi

cli_path="$(command -v codex 2>/dev/null)" || true
if [[ -z "$cli_path" ]]; then
  echo "XREVIEW_ERROR: cli not found: codex (install it first)"
  exit 1
fi

timeout --foreground "$timeout_sec" "$cli_path" exec \
  --sandbox read-only \
  --ephemeral \
  --model "$model" \
  - < "$prompt_file"
rc=$?

if [[ $rc -eq 124 ]]; then
  echo "XREVIEW_ERROR: timed out after ${timeout_sec}s (cli: codex, model: $model)"
  exit 124
fi

if [[ $rc -ne 0 ]]; then
  echo "XREVIEW_ERROR: codex exited with code $rc (model: $model)"
  exit "$rc"
fi
