#!/usr/bin/env bash
# codex.sh — xreview adapter for Codex CLI
#
# Interface: bash codex.sh <prompt-file> <model> [<timeout-seconds>]
# The 3rd arg is accepted but ignored (ADR-6: timeout is enforced by the
# orchestrator).
#
# Sandbox: codex runs with `--sandbox read-only --ephemeral` already. Empirical
# evidence for whether /tmp and ~/.config need explicit allow-listing is still
# pending (Task 5.4.C.1). Leaving sandbox flags unchanged until an actual
# reviewer run demonstrates a need.

set -uo pipefail
exec 2>&1

prompt_file="${1:?Usage: codex.sh <prompt-file> <model> [<timeout-seconds>]}"
model="${2:?Usage: codex.sh <prompt-file> <model> [<timeout-seconds>]}"

if [[ ! -f "$prompt_file" ]]; then
  echo "XREVIEW_ERROR: prompt file not found: $prompt_file"
  exit 1
fi

cli_path="$(command -v codex 2>/dev/null)" || true
if [[ -z "$cli_path" ]]; then
  echo "XREVIEW_ERROR: cli not found: codex (install it first)"
  exit 1
fi

"$cli_path" exec \
  --sandbox read-only \
  --ephemeral \
  --model "$model" \
  - < "$prompt_file"
rc=$?

if [[ $rc -ne 0 ]]; then
  echo "XREVIEW_ERROR: codex exited with code $rc (model: $model)"
  exit "$rc"
fi
