#!/usr/bin/env bash
# gemini.sh — xreview adapter for Gemini CLI

set -uo pipefail
exec 2>&1

prompt_file="${1:?Usage: gemini.sh <prompt-file> <model> <timeout-seconds>}"
model="${2:?Usage: gemini.sh <prompt-file> <model> <timeout-seconds>}"
timeout_sec="${3:-3000}"

if [[ ! -f "$prompt_file" ]]; then
  echo "XREVIEW_ERROR: prompt file not found: $prompt_file"
  exit 1
fi

cli_path="$(command -v gemini 2>/dev/null)" || true
if [[ -z "$cli_path" ]]; then
  echo "XREVIEW_ERROR: cli not found: gemini (install it first)"
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
policy_file="$script_dir/../../../../policies/ddd.xreview.toml"

timeout --foreground "$timeout_sec" "$cli_path" \
  --approval-mode=plan \
  --admin-policy="$policy_file" \
  -m "$model" \
  < "$prompt_file"
rc=$?

if [[ $rc -eq 124 ]]; then
  echo "XREVIEW_ERROR: timed out after ${timeout_sec}s (cli: gemini, model: $model)"
  exit 124
fi

if [[ $rc -ne 0 ]]; then
  echo "XREVIEW_ERROR: gemini exited with code $rc (model: $model)"
  exit "$rc"
fi
