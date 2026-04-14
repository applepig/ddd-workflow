#!/usr/bin/env bash
# gemini.sh — xreview adapter for Gemini CLI
#
# Interface: bash gemini.sh <prompt-file> <model> <final-out-file>
#
# The 3rd arg is the final-output file (ADR-11). Adapter pipes the CLI's
# JSON stdout through `jq -r '.response'` into $final_out. stderr flows
# naturally as verbose trace (no `exec 2>&1` merge).
#
# Sandbox (ADR-9): Gemini's workspace sandbox blocks paths outside the
# project root. `--include-directories` takes a comma-separated list of
# absolute paths to allow. We open /tmp (prompt file) and the resolved
# $XDG_CONFIG_HOME (or $HOME/.config fallback) for xreview.json — enough
# for the reviewer agent to read both inputs without leaking write access.
# (M6.3: respect XDG override.)
#
# stdout contract: must be empty (final flows to $3 via jq -r '.response').

set -uo pipefail

prompt_file="${1:?Usage: gemini.sh <prompt-file> <model> <final-out-file>}"
model="${2:?Usage: gemini.sh <prompt-file> <model> <final-out-file>}"
final_out="${3:?Usage: gemini.sh <prompt-file> <model> <final-out-file>}"

if [[ ! -f "$prompt_file" ]]; then
  echo "XREVIEW_ERROR: prompt file not found: $prompt_file" >&2
  exit 1
fi

cli_path="$(command -v gemini 2>/dev/null)" || true
if [[ -z "$cli_path" ]]; then
  echo "XREVIEW_ERROR: cli not found: gemini (install it first)" >&2
  exit 1
fi

# jq required for final extraction; missing jq would silently empty final_out.
if ! command -v jq >/dev/null 2>&1; then
  echo "XREVIEW_ERROR: jq not found (required for gemini adapter final extraction)" >&2
  exit 1
fi

: > "$final_out"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
policy_file="$script_dir/../../../../policies/ddd.xreview.toml"

config_dir="${XDG_CONFIG_HOME:-$HOME/.config}"

set +o pipefail
"$cli_path" \
  --approval-mode=plan \
  --admin-policy="$policy_file" \
  --include-directories "/tmp,$config_dir" \
  --output-format json \
  -m "$model" \
  < "$prompt_file" \
  | jq -r '.response // empty' > "$final_out" 2>/dev/null
rc="${PIPESTATUS[0]}"
set -o pipefail

if [[ $rc -ne 0 ]]; then
  echo "XREVIEW_ERROR: gemini exited with code $rc (model: $model)" >&2
  exit "$rc"
fi
