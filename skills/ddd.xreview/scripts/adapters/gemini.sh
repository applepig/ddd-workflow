#!/usr/bin/env bash
# gemini.sh — xreview adapter for Gemini CLI
#
# Interface: bash gemini.sh <prompt-file> <model> [<timeout-seconds>]
# The 3rd arg is accepted but ignored (ADR-6: timeout is enforced by the
# orchestrator).
#
# Sandbox (ADR-9): Gemini's workspace sandbox blocks paths outside the
# project root. `--include-directories` takes a comma-separated list of
# absolute paths to allow. We open /tmp (prompt file) and the resolved
# $XDG_CONFIG_HOME (or $HOME/.config fallback) for xreview.json — enough
# for the reviewer agent to read both inputs without leaking write access.
# (M6.3: respect XDG override.)

set -uo pipefail
exec 2>&1

prompt_file="${1:?Usage: gemini.sh <prompt-file> <model> [<timeout-seconds>]}"
model="${2:?Usage: gemini.sh <prompt-file> <model> [<timeout-seconds>]}"

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

config_dir="${XDG_CONFIG_HOME:-$HOME/.config}"

"$cli_path" \
  --approval-mode=plan \
  --admin-policy="$policy_file" \
  --include-directories "/tmp,$config_dir" \
  -m "$model" \
  < "$prompt_file"
rc=$?

if [[ $rc -ne 0 ]]; then
  echo "XREVIEW_ERROR: gemini exited with code $rc (model: $model)"
  exit "$rc"
fi
