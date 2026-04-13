#!/usr/bin/env bash
# xreview-orchestrator.sh — fan out cross-review reviewers in parallel
#
# Usage:
#   xreview-orchestrator.sh <prompt-file> <cli:model> [<cli:model> ...]
#
# Supported CLIs: claude, opencode, gemini, codex
#
# Stdout event stream (one event per line):
#   START <cli:model> <log-path>
#   DONE <cli:model> <log-path>
#   FAIL <cli:model> exit_code=<n> log=<log-path>
#   ALL_DONE
#
# Each reviewer's full output is written to /tmp/xreview-<runid>-<slug>.log
# The log path is emitted on START so callers can tail it during the review.
#
# Designed to run under Claude Code's Monitor tool (timeout_ms up to 3600000ms)
# to bypass the Bash tool's 10-minute hard cap.
#
# Signal handling:
#   - Each reviewer is spawned under `setsid` so the CLI subprocess tree
#     (including `timeout` and its grandchild) lives in its own process group.
#   - `cleanup()` walks all reviewer PGIDs, SIGTERMs, waits a grace period,
#     then SIGKILLs any stragglers. Works for SIGTERM and SIGINT (trap fires).
#   - INT/TERM triggers cleanup + immediate exit, so ALL_DONE is NOT emitted.
#   - Normal completion emits ALL_DONE then exit 0; EXIT trap's cleanup is a
#     guarded no-op (re-entry guard avoids double-run + spurious 2s sleep).
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

# Per-reviewer hard timeout: 50 minutes. Well within Monitor's 1hr cap but
# long enough for deep-reasoning models (opus, gemini-pro). Hard-coded to
# keep the contract simple; bump this if future models need more.
per_reviewer_timeout=3000

pids=()

# Kill each reviewer's entire process group (created via setsid) so timeout
# and its CLI grandchild get cleaned up too. SIGTERM first, grace period,
# then SIGKILL for any stragglers. Falls back to killing the bare PID if the
# PGID lookup fails (shouldn't normally happen, but defensive).
#
# Re-entry guard: INT/TERM handler runs cleanup then `exit`, which fires the
# EXIT trap — without the guard cleanup() would run twice and the unconditional
# 2s sleep would also run on the happy path (after children have already been
# reaped, pgids would be empty but we'd still sleep). The guard makes cleanup
# a no-op on the EXIT pass when INT/TERM already handled it.
_cleanup_ran=false
cleanup() {
  $_cleanup_ran && return
  _cleanup_ran=true

  local pid pgid
  local pgids=()

  for pid in "${pids[@]:-}"; do
    [[ -z "$pid" ]] && continue
    pgid="$(ps -o pgid= "$pid" 2>/dev/null | tr -d ' ')"
    if [[ -n "$pgid" ]]; then
      pgids+=("$pgid")
      kill -TERM -- "-$pgid" 2>/dev/null || true
    else
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done

  # Only sleep when we actually have process groups to clean up — avoids the
  # gratuitous 2s wait on the normal completion path where children have
  # already exited and been reaped by `wait`.
  if [[ ${#pgids[@]} -gt 0 ]]; then
    sleep 2
    for pgid in "${pgids[@]}"; do
      kill -KILL -- "-$pgid" 2>/dev/null || true
    done
  fi

  wait 2>/dev/null || true
}

# INT/TERM: run cleanup and exit with conventional signal exit codes (128+N).
# These exit immediately, so the main flow's `echo ALL_DONE` is NOT reached
# when interrupted — preserving the semantic that ALL_DONE means "all
# reviewers were given a chance to finish".
# EXIT: re-entry-guarded cleanup (no-op if INT/TERM path already ran).
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM
trap cleanup EXIT

slug_of() {
  echo "$1" | tr ':/' '__'
}

# Fan out: each reviewer runs in a background subshell that emits its own
# DONE/FAIL event. START is emitted up-front from the main shell so the
# event stream's leading section is deterministic, and includes the log path
# so the caller can tail/peek the reviewer's output while it runs.
#
# The parent shell owns the log file's lifecycle:
#   1. Validate spec format here (not in setsid body). Invalid specs get a
#      materialized log file containing the error message so `log=<path>`
#      in the FAIL event points somewhere the main agent can actually Read.
#   2. For valid specs, write a meta header ([xreview] START / log= / ---)
#      into the log BEFORE emitting START, so the main agent can peek the
#      log immediately after seeing START without racing the setsid body's
#      first redirection.
#   3. The setsid body opens the log with `>> ... 2>&1` (append) and
#      therefore preserves the meta header.
valid_specs=()
for spec in "${specs[@]}"; do
  slug="$(slug_of "$spec")"
  log="/tmp/xreview-${runid}-${slug}.log"

  cli="${spec%%:*}"
  model="${spec#*:}"
  if [[ ! "$cli" =~ ^[a-z0-9_-]+$ ]] || [[ ! "$model" =~ ^[A-Za-z0-9._/:-]+$ ]]; then
    # Pre-create log file so FAIL log=$log is Readable for invalid specs too.
    cat > "$log" << EOF
[xreview] XREVIEW_ERROR: invalid spec format: $spec
[xreview] cli must match ^[a-z0-9_-]+\$
[xreview] model must match ^[A-Za-z0-9._/:-]+\$
EOF
    echo "START $spec $log"
    echo "FAIL $spec exit_code=2 log=$log"
    continue
  fi

  # Valid spec: write meta header; setsid body will APPEND its output after.
  printf '[xreview] START %s at %s\n[xreview] log=%s\n[xreview] ---\n' \
    "$spec" "$(date -Iseconds)" "$log" > "$log"
  echo "START $spec $log"
  valid_specs+=("$spec")
done

# Dispatch only valid specs. If all specs were invalid, valid_specs is empty
# and this loop is a no-op — main flow falls through to ALL_DONE / exit 0.
for spec in "${valid_specs[@]:-}"; do
  [[ -z "$spec" ]] && continue  # guard against the :- empty-string placeholder
  slug="$(slug_of "$spec")"
  log="/tmp/xreview-${runid}-${slug}.log"
  # `setsid bash -c '...' _ arg1 arg2 ...` spawns the child in a new session
  # and process group (the child PID becomes the PGID leader). We pass args
  # positionally to avoid quoting/escaping issues with the outer script's
  # variables. Single-quote the inline body so nothing expands prematurely.
  setsid bash -c '
    spec="$1"
    prompt_file="$2"
    runner="$3"
    timeout_val="$4"
    log="$5"

    cli="${spec%%:*}"
    model="${spec#*:}"

    case "$cli" in
      claude)
        # Use --agent ddd-reviewer to load the deployed agent system prompt
        # and tool restrictions. --permission-mode plan enforces read-only.
        # `timeout --foreground` keeps the child in our (setsid-created)
        # process group; without it, timeout puts the child in a NEW pgrp,
        # which would defeat the orchestrators cleanup() PGID kill path.
        # Append (>>) to preserve the parent-written meta header.
        timeout --foreground "$timeout_val" claude -p \
          --agent ddd-reviewer \
          --model "$model" \
          --no-session-persistence \
          --permission-mode plan \
          --output-format text \
          < "$prompt_file" \
          >> "$log" 2>&1
        rc=$?
        ;;
      opencode|gemini|codex)
        # Delegate to the thin runner (per-CLI quirks + stdin piping). Both
        # orchestrator and runner share the same 3000s cap; the nested
        # `timeout --foreground` here is defense-in-depth, not overlap —
        # it keeps the setsid process group intact if runner misbehaves.
        timeout --foreground "$timeout_val" bash "$runner" \
          "$prompt_file" "$spec" "$timeout_val" \
          >> "$log" 2>&1
        rc=$?
        ;;
      *)
        echo "XREVIEW_ERROR: unknown cli: $cli (supported: claude, opencode, gemini, codex)" \
          >> "$log"
        rc=1
        ;;
    esac

    if [[ $rc -eq 0 ]]; then
      echo "DONE $spec $log"
    else
      echo "FAIL $spec exit_code=$rc log=$log"
    fi
  ' _ "$spec" "$prompt_file" "$runner" "$per_reviewer_timeout" "$log" &
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
