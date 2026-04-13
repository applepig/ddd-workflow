#!/usr/bin/env bash
# xreview-orchestrator.sh — fan out cross-review reviewers in parallel
#
# Usage:
#   xreview-orchestrator.sh <prompt-file> <cli:model> [<cli:model> ...]
#
# Supported CLIs: claude, opencode, gemini, codex
#
# Stdout event stream (one event per line):
#   START <cli:model>
#   DONE <cli:model> <log-path>
#   FAIL <cli:model> exit_code=<n> log=<log-path>
#   ALL_DONE
#
# Each reviewer's full output is written to /tmp/xreview-<runid>-<slug>.log
#
# Designed to run under Claude Code's Monitor tool (timeout_ms up to 3600000ms)
# to bypass the Bash tool's 10-minute hard cap.

set -uo pipefail

prompt_file="${1:?Usage: xreview-orchestrator.sh <prompt-file> <cli:model>...}"
shift
specs=("$@")

if [[ ${#specs[@]} -eq 0 ]]; then
  echo "FAIL orchestrator no_reviewers_specified"
  echo "ALL_DONE"
  exit 1
fi

if [[ ! -f "$prompt_file" ]]; then
  echo "FAIL orchestrator prompt_file_not_found:$prompt_file"
  echo "ALL_DONE"
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
runner="$script_dir/xreview-runner.sh"
runid="$$-$(date +%s)"

# Per-reviewer hard timeout (seconds). Monitor caps the orchestrator at
# timeout_ms; this is a safety net in case a single CLI hangs.
per_reviewer_timeout="${XREVIEW_PER_TIMEOUT:-1500}"

pids=()

cleanup() {
  for pid in "${pids[@]}"; do
    # Kill the subshell and any descendants in its process group.
    kill -TERM "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

slug_of() {
  echo "$1" | tr ':/' '__'
}

# Fan out: each reviewer runs in a background subshell that emits its own
# DONE/FAIL event. START is emitted up-front from the main shell so the
# event stream's leading section is deterministic.
for spec in "${specs[@]}"; do
  echo "START $spec"
done

for spec in "${specs[@]}"; do
  (
    cli="${spec%%:*}"
    model="${spec#*:}"
    slug="$(slug_of "$spec")"
    log="/tmp/xreview-${runid}-${slug}.log"

    case "$cli" in
      claude)
        # Use --agent ddd-reviewer to load the deployed agent's system prompt
        # and tool restrictions. --permission-mode plan enforces read-only.
        timeout "$per_reviewer_timeout" claude -p \
          --agent ddd-reviewer \
          --model "$model" \
          --no-session-persistence \
          --permission-mode plan \
          --output-format text \
          < "$prompt_file" \
          > "$log" 2>&1
        rc=$?
        ;;
      opencode|gemini|codex)
        # Delegate to the existing thin runner (handles per-CLI invocation
        # quirks and stdin-piping). The runner has its own internal timeout
        # too; we wrap with per_reviewer_timeout as a safety net.
        timeout "$per_reviewer_timeout" bash "$runner" "$prompt_file" "$spec" \
          > "$log" 2>&1
        rc=$?
        ;;
      *)
        echo "XREVIEW_ERROR: unknown cli: $cli (supported: claude, opencode, gemini, codex)" \
          > "$log"
        rc=1
        ;;
    esac

    if [[ $rc -eq 0 ]]; then
      echo "DONE $spec $log"
    else
      echo "FAIL $spec exit_code=$rc log=$log"
    fi
  ) &
  pids+=($!)
done

# Wait for every reviewer. We don't propagate individual failures — they're
# already reported via the event stream. Orchestrator itself exits 0 unless
# the Monitor kills us.
for pid in "${pids[@]}"; do
  wait "$pid" || true
done

echo "ALL_DONE"
exit 0
