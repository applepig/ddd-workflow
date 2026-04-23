#!/usr/bin/env bash
# opencode.sh — xreview adapter for OpenCode CLI
#
# Interface: bash opencode.sh <prompt-file> <model> <final-out-file>
#
# The 3rd arg is the final-output file (ADR-11). OpenCode emits an ndjson
# event stream on stdout (--format json); adapter tees the raw ndjson to
# stderr (for the orchestrator log) while piping it through jq to extract
# just the text-event `.part.text` fragments into $final_out.
#
# Sandbox (ADR-9): OpenCode's workspace sandbox blocks paths outside the
# project root. We set OPENCODE_PERMISSION inline to allow reading the prompt
# file under /tmp and the xreview config under $XDG_CONFIG_HOME/ddd-workflow
# (M6.3: respect XDG override; falls back to $HOME/.config). The env var is
# scoped to the child process — no config file is created, no trap cleanup
# needed, and the user's global OpenCode config is unaffected.
#
# stdout contract: must be empty. Final flows to $3 via jq -rs over the ndjson
# stream; the raw ndjson is teed to stderr (verbose side) so the orchestrator
# log keeps the full event log without polluting final_out.

set -uo pipefail

prompt_file="${1:?Usage: opencode.sh <prompt-file> <model> <final-out-file>}"
model="${2:?Usage: opencode.sh <prompt-file> <model> <final-out-file>}"
final_out="${3:?Usage: opencode.sh <prompt-file> <model> <final-out-file>}"

if [[ ! -f "$prompt_file" ]]; then
  echo "XREVIEW_ERROR: prompt file not found: $prompt_file" >&2
  exit 1
fi

cli_path="$(command -v opencode 2>/dev/null)" || true
if [[ -z "$cli_path" ]]; then
  echo "XREVIEW_ERROR: cli not found: opencode (install it first)" >&2
  exit 1
fi

# jq is doubly critical here: builds permission_json AND extracts ndjson final.
# Missing jq makes the permission env malformed (or empty) and the final empty.
if ! command -v jq >/dev/null 2>&1; then
  echo "XREVIEW_ERROR: jq not found (required for opencode adapter permission JSON build and final extraction)" >&2
  exit 1
fi

: > "$final_out"

# Build inline permission JSON via jq so the config glob can interpolate the
# resolved $XDG_CONFIG_HOME (or $HOME/.config fallback) without quoting hazards.
# Last-match-wins in OpenCode's permission resolver, so this only adds to (not
# replaces) the user's global permissions.
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}"
permission_json="$(jq -nc \
  --arg cfg_glob "${config_dir}/ddd-workflow/**" \
  '{external_directory: ({"/tmp/**":"allow"} + {($cfg_glob):"allow"})}')"

# ndjson stdout → tee to stderr (verbose side) → jq to final-out.
# jq -rs slurps the whole stream into an array, selects text events, and joins
# their .part.text. PIPESTATUS[0] preserves the CLI's rc regardless of jq.
set +o pipefail
OPENCODE_PERMISSION="$permission_json" \
  "$cli_path" run \
  --print-logs \
  --log-level ERROR \
  --agent ddd.xreviewer \
  --model "$model" \
  --format json \
  < "$prompt_file" \
  | tee /dev/stderr \
  | jq -rs 'map(select(.type=="text")) | map(.part.text) | join("")' \
    > "$final_out" 2>/dev/null
rc="${PIPESTATUS[0]}"
set -o pipefail

if [[ $rc -ne 0 ]]; then
  echo "XREVIEW_ERROR: opencode exited with code $rc (model: $model)" >&2
  exit "$rc"
fi
