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
#
# Signal handling:
#   - Each reviewer is spawned under `setsid` so the CLI subprocess tree
#     (including `timeout` and its grandchild) lives in its own process group.
#   - `cleanup()` walks all reviewer PGIDs, SIGTERMs, waits a grace period,
#     then SIGKILLs any stragglers. Works for SIGTERM and SIGINT (trap fires).
#   - SIGKILL (e.g. Monitor's hard kill) cannot be trapped — in that case the
#     OS reclaims the orchestrator but reviewer PGIDs may linger briefly until
#     their own `timeout` safety net fires or they finish naturally.

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
# runid: PID + epoch seconds + $RANDOM. RANDOM defends against the unlikely
# case of two orchestrators sharing the same PID in the same second (e.g.
# after a reboot cycle with low PID reuse).
runid="$$-$(date +%s)-${RANDOM}"

# Per-reviewer hard timeout (seconds). Monitor caps the orchestrator at
# timeout_ms; this is a safety net in case a single CLI hangs.
per_reviewer_timeout="${XREVIEW_PER_TIMEOUT:-1500}"

pids=()

# Kill each reviewer's entire process group (created via setsid) so timeout
# and its CLI grandchild get cleaned up too. SIGTERM first, grace period,
# then SIGKILL for any stragglers. Falls back to killing the bare PID if the
# PGID lookup fails (shouldn't normally happen, but defensive).
cleanup() {
  local pid pgid
  local pgids=()

  for pid in "${pids[@]:-}"; do
    pgid="$(ps -o pgid= "$pid" 2>/dev/null | tr -d ' ')"
    if [[ -n "$pgid" ]]; then
      pgids+=("$pgid")
      kill -TERM -- "-$pgid" 2>/dev/null || true
    else
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done

  # Grace period for graceful shutdown.
  sleep 2

  for pgid in "${pgids[@]:-}"; do
    kill -KILL -- "-$pgid" 2>/dev/null || true
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
  # `setsid bash -c '...' _ arg1 arg2 ...` spawns the child in a new session
  # and process group (the child PID becomes the PGID leader). We pass args
  # positionally to avoid quoting/escaping issues with the outer script's
  # variables. Single-quote the inline body so nothing expands prematurely.
  setsid bash -c '
    spec="$1"
    prompt_file="$2"
    runner="$3"
    runid="$4"
    timeout_val="$5"

    cli="${spec%%:*}"
    model="${spec#*:}"

    # Defensive input validation. Our internal callers only pass
    # well-formed specs from AGENTS.md, but an invalid spec should not
    # reach any external CLI (avoids odd PATH lookups or argv injection).
    if [[ ! "$cli" =~ ^[a-z0-9_-]+$ ]] || [[ ! "$model" =~ ^[A-Za-z0-9._/:-]+$ ]]; then
      echo "FAIL $spec exit_code=2 log=invalid_spec_format"
      exit 0
    fi

    slug=$(echo "$spec" | tr ":/" "__")
    log="/tmp/xreview-${runid}-${slug}.log"

    case "$cli" in
      claude)
        # Use --agent ddd-reviewer to load the deployed agent system prompt
        # and tool restrictions. --permission-mode plan enforces read-only.
        # `timeout --foreground` keeps the child in our (setsid-created)
        # process group; without it, timeout puts the child in a NEW pgrp,
        # which would defeat the orchestrators cleanup() PGID kill path.
        timeout --foreground "$timeout_val" claude -p \
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
        # Delegate to the thin runner (per-CLI quirks + stdin piping). The
        # runner has its own internal `timeout --foreground`; we still wrap
        # with timeout --foreground here as a belt-and-braces safety net
        # while preserving our process-group invariant.
        timeout --foreground "$timeout_val" bash "$runner" "$prompt_file" "$spec" \
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
  ' _ "$spec" "$prompt_file" "$runner" "$runid" "$per_reviewer_timeout" &
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
