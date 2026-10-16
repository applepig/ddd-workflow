#!/usr/bin/env bash
# opencode.sh — OpenCode xreview adapter.
#
# Contract (xreview ADR-11):
#   - Args: <prompt-file> <model> <final-out-file>
#   - stdout: must be empty; orchestrator merges stdout+stderr into log
#   - stderr: raw ndjson via tee for orchestrator log
#   - final-out: extracted text events written via jq -rs
#   - sandbox: read-only via the ddd-reviewer agent's own permission block
#     (agent-level rules outrank config-level ones, so nothing is injected here)
#   - env: XREVIEW_OPENCODE_PRINT_LOGS=1 adds --print-logs + --log-level
#
# stdout contract: must be empty (final flows to $3 via jq -rs). The CLI's
# ndjson is teed to stderr for the orchestrator log; stdout carries nothing.

set -uo pipefail

prompt_file="${1:?Usage: opencode.sh <prompt-file> <model> <final-out-file>}"
model="${2:?Usage: opencode.sh <prompt-file> <model> <final-out-file>}"
final_out="${3:?Usage: opencode.sh <prompt-file> <model> <final-out-file>}"

cli_path="$(command -v opencode 2>/dev/null)" || true
if [[ -z "$cli_path" ]]; then
  echo "XREVIEW_ERROR: cli not found: opencode (install it first)" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "XREVIEW_ERROR: jq not found (required for opencode adapter final extraction)" >&2
  exit 1
fi

if [[ ! -f "$prompt_file" ]]; then
  echo "XREVIEW_ERROR: prompt file not found: $prompt_file" >&2
  exit 1
fi

: > "$final_out"

# OpenCode 2.x changed the run flags: --standalone makes `run` host its own
# server instead of attaching to the background service, and --log-level takes
# lower case where 1.x only accepts upper case. `1.19.1` → 1,
# `opencode v2.0.30` → 2; anything unparseable is treated as 2. stdin is
# closed so a CLI that reads stdin cannot swallow the prompt or hang here.
version_out="$("$cli_path" --version < /dev/null 2>/dev/null)" || true
major=""
if [[ "$version_out" =~ ([0-9]+)\.[0-9]+ ]]; then
  major="${BASH_REMATCH[1]}"
fi

run_flags=()
[[ "$major" != "1" ]] && run_flags+=(--standalone)

# CLI logs are noise in the orchestrator log, so they are off by default.
# Failures still surface: 2.x emits a `type:"error"` event on the JSON stream
# (teed to stderr below), and the non-zero rc gets an XREVIEW_ERROR line.
if [[ "${XREVIEW_OPENCODE_PRINT_LOGS:-}" == "1" ]]; then
  if [[ "$major" == "1" ]]; then
    run_flags+=(--print-logs --log-level ERROR)
  else
    run_flags+=(--print-logs --log-level error)
  fi
fi

# ndjson stdout → tee to stderr (verbose side) → jq to final-out.
# tee -a: /dev/stderr is usually the orchestrator log file, and a plain tee
# reopens it with O_TRUNC, wiping the meta header and the CLI's own stderr.
# jq -rs slurps the whole stream into an array, selects text events, and joins
# their .part.text. PIPESTATUS[0] preserves the CLI's rc regardless of jq.
# OPENCODE_PERMISSION is stripped: 1.x still merges it, so a permissive value
# inherited from the caller would widen the reviewer's read-only sandbox.
set +o pipefail
env -u OPENCODE_PERMISSION \
  "$cli_path" run \
  "${run_flags[@]}" \
  --agent ddd-reviewer \
  --model "$model" \
  --format json \
  < "$prompt_file" \
  | tee -a /dev/stderr \
  | jq -rs 'map(select(.type=="text")) | map(.part.text) | join("")' \
    > "$final_out" 2>/dev/null
rc="${PIPESTATUS[0]}"
set -o pipefail

if [[ $rc -ne 0 ]]; then
  echo "XREVIEW_ERROR: opencode exited with code $rc (model: $model)" >&2
  exit "$rc"
fi

exit 0
