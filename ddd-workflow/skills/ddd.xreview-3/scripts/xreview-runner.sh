#!/usr/bin/env bash
# xreview-runner.sh — thin timeout wrapper around opencode run
# Usage: xreview-runner.sh <prompt-file> <model> [timeout-seconds]
#
# This script intentionally avoids content/quality heuristics.
# It only adds a timeout, preserves OpenCode's own stdout/stderr output,
# and upgrades explicit OpenCode stderr errors into a non-zero exit.

set -uo pipefail

prompt_file="${1:?Usage: xreview-runner.sh <prompt-file> <model> [timeout]}"
model="${2:?Usage: xreview-runner.sh <prompt-file> <model> [timeout]}"
timeout_sec="${3:-600}"

if [[ ! -f "$prompt_file" ]]; then
  echo "XREVIEW_ERROR: prompt file not found: $prompt_file" >&2
  exit 1
fi

output_file=$(mktemp /tmp/xreview-output-XXXXXX.log)
trap 'rm -f "$output_file"' EXIT

# Merge stderr into stdout to avoid TTY-related hangs when stderr is redirected
# to a file. OpenCode may behave differently when stderr is not a TTY/pipe,
# causing timeout to fail to kill the process.
timeout --foreground "$timeout_sec" opencode run \
  --print-logs \
  --log-level ERROR \
  --agent ddd.xreviewer \
  --model "$model" \
  < "$prompt_file" \
  2>&1 | tee "$output_file"
rc=${PIPESTATUS[0]}

if [[ $rc -eq 124 ]]; then
  echo "XREVIEW_ERROR: timed out after ${timeout_sec}s (model: $model)" >&2
  exit 124
elif [[ $rc -ne 0 ]]; then
  echo "XREVIEW_ERROR: opencode exited with code $rc (model: $model)" >&2
  exit "$rc"
fi

# Check merged output for OpenCode error markers
if grep -Eq '^(ERROR |[[:space:]]*Error:|[[:alnum:]_]+Error:)' "$output_file"; then
  echo "XREVIEW_ERROR: opencode reported an error (model: $model)" >&2
  exit 1
fi
