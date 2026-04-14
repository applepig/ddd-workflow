#!/usr/bin/env bash
# opencode.sh — xreview adapter for OpenCode CLI
#
# Interface: bash opencode.sh <prompt-file> <model> [<timeout-seconds>]
# The 3rd arg is accepted but ignored (ADR-6: timeout is enforced by the
# orchestrator).
#
# Sandbox (ADR-9): OpenCode's workspace sandbox blocks paths outside the
# project root. We set OPENCODE_PERMISSION inline to allow reading the prompt
# file under /tmp and the xreview config under $XDG_CONFIG_HOME/ddd-workflow
# (M6.3: respect XDG override; falls back to $HOME/.config). The env var is
# scoped to the child process — no config file is created, no trap cleanup
# needed, and the user's global OpenCode config is unaffected.

set -uo pipefail
exec 2>&1

prompt_file="${1:?Usage: opencode.sh <prompt-file> <model> [<timeout-seconds>]}"
model="${2:?Usage: opencode.sh <prompt-file> <model> [<timeout-seconds>]}"

if [[ ! -f "$prompt_file" ]]; then
  echo "XREVIEW_ERROR: prompt file not found: $prompt_file"
  exit 1
fi

cli_path="$(command -v opencode 2>/dev/null)" || true
if [[ -z "$cli_path" ]]; then
  echo "XREVIEW_ERROR: cli not found: opencode (install it first)"
  exit 1
fi

# Build inline permission JSON via jq so the config glob can interpolate the
# resolved $XDG_CONFIG_HOME (or $HOME/.config fallback) without quoting hazards.
# Last-match-wins in OpenCode's permission resolver, so this only adds to (not
# replaces) the user's global permissions.
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}"
permission_json="$(jq -nc \
  --arg cfg_glob "${config_dir}/ddd-workflow/**" \
  '{external_directory: ({"/tmp/**":"allow"} + {($cfg_glob):"allow"})}')"

OPENCODE_PERMISSION="$permission_json" \
  "$cli_path" run \
  --print-logs \
  --log-level ERROR \
  --agent ddd.xreviewer \
  --model "$model" \
  < "$prompt_file"
rc=$?

if [[ $rc -ne 0 ]]; then
  echo "XREVIEW_ERROR: opencode exited with code $rc (model: $model)"
  exit "$rc"
fi
