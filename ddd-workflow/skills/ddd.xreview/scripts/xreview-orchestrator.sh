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
#
# Output modes:
#   - streaming (default when CLAUDECODE=1): pure event stream — START / DONE /
#     FAIL / ALL_DONE only. Designed for Claude Code's Monitor tool which
#     turns each line into a notification.
#   - blocking (default for everything else): same event stream, but after
#     ALL_DONE appends a human-readable footer listing each reviewer's
#     status + log path. Designed for callers (opencode, gemini-cli, plain
#     bash) that capture all stdout at once and need a quick summary
#     pointing at the log files to Read.
#   - Override: set XREVIEW_MODE=streaming or XREVIEW_MODE=blocking explicitly.
#     Useful when env detection misfires (e.g. nested CLI invocations where
#     CLAUDECODE leaks into a child opencode session).

set -uo pipefail

prompt_file="${1:?Usage: xreview-orchestrator.sh <prompt-file> [<cli:model>...]}"
shift
specs=("$@")

# Validate prompt file early — fail fast before touching config or env.
if [[ ! -f "$prompt_file" ]]; then
  echo "FAIL orchestrator prompt_file_not_found:$prompt_file"
  echo "ALL_DONE"
  exit 1
fi

# Mode detection — explicit override wins, else CLAUDECODE → streaming, else
# blocking. Blocking is the safe default: a streaming consumer reading a
# blocking-mode stream still gets all events; the footer is just extra trailing
# text after ALL_DONE that Monitor will ignore (Monitor stops at process exit).
mode="${XREVIEW_MODE:-}"
if [[ -z "$mode" ]]; then
  if [[ -n "${CLAUDECODE:-}" ]]; then
    mode="streaming"
  else
    mode="blocking"
  fi
fi
case "$mode" in
  streaming|blocking) ;;
  *)
    echo "FAIL orchestrator invalid_mode:$mode (expected streaming|blocking)"
    echo "ALL_DONE"
    exit 1
    ;;
esac

# Config fallback: if no specs given on CLI, resolve from
# $XDG_CONFIG_HOME/ddd-workflow/xreview.json (deployed by `npm run deploy`).
# CLI args always win — config is the default for the common case where the
# skill invokes us with just the prompt file.
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}"
config_file="$config_dir/ddd-workflow/xreview.json"
if [[ ${#specs[@]} -eq 0 ]]; then
  if [[ ! -f "$config_file" ]]; then
    echo "FAIL orchestrator no_reviewers_and_no_config:$config_file"
    echo "ALL_DONE"
    exit 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "FAIL orchestrator jq_required_for_config_parse"
    echo "ALL_DONE"
    exit 1
  fi
  while IFS= read -r line; do
    [[ -n "$line" ]] && specs+=("$line")
  done < <(jq -r '.reviewers[]?' "$config_file" 2>/dev/null)
  if [[ ${#specs[@]} -eq 0 ]]; then
    echo "FAIL orchestrator config_empty_or_invalid:$config_file"
    echo "ALL_DONE"
    exit 1
  fi
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
adapter_dir="$script_dir/adapters"
# runid: PID + epoch seconds + $RANDOM. RANDOM defends against the unlikely
# case of two orchestrators sharing the same PID in the same second (e.g.
# after a reboot cycle with low PID reuse).
runid="$$-$(date +%s)-${RANDOM}"

# Per-reviewer hard timeout: 50 minutes. Well within Monitor's 1hr cap but
# long enough for deep-reasoning models (opus, gemini-pro). Hard-coded to
# keep the contract simple; bump this if future models need more.
per_reviewer_timeout=3000

resolve_spec() {
  local spec="$1"
  local aliases_json="$2"
  local resolved=""

  if [[ "$spec" == *:* ]]; then
    echo "$spec"
    return
  fi

  if [[ -n "$aliases_json" ]]; then
    resolved="$(jq -r --arg alias "$spec" '.[$alias] // empty' <<< "$aliases_json" 2>/dev/null)"
  fi

  if [[ -n "$resolved" ]]; then
    echo "$resolved"
    return
  fi

  echo "$spec"
}

config_needs_parse=false
aliases_json='{}'
if [[ -f "$config_file" ]]; then
  if [[ ${#specs[@]} -eq 0 ]]; then
    config_needs_parse=true
  else
    for spec in "${specs[@]}"; do
      if [[ "$spec" != *:* ]]; then
        config_needs_parse=true
        break
      fi
    done
  fi
fi

if $config_needs_parse; then
  if ! command -v jq >/dev/null 2>&1; then
    echo "FAIL orchestrator jq_required_for_config_parse"
    echo "ALL_DONE"
    exit 1
  fi

  aliases_json="$(jq -c '.aliases // {}' "$config_file" 2>/dev/null)" || aliases_json=""
  if [[ -z "$aliases_json" ]]; then
    echo "FAIL orchestrator config_empty_or_invalid:$config_file"
    echo "ALL_DONE"
    exit 1
  fi
fi

resolved_specs=()
for spec in "${specs[@]}"; do
  resolved_specs+=("$(resolve_spec "$spec" "$aliases_json")")
done
specs=("${resolved_specs[@]}")

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
    # Sidecar matches subshell convention so blocking-mode footer can read it.
    echo "2" > "${log%.log}.status"
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
    adapter_dir="$3"
    timeout_val="$4"
    log="$5"

    cli="${spec%%:*}"
    model="${spec#*:}"

    adapter="$adapter_dir/$cli.sh"

    if [[ ! -f "$adapter" ]]; then
      echo "XREVIEW_ERROR: unknown cli: $cli (supported: claude, opencode, gemini, codex)" \
        >> "$log"
      rc=1
    else
      # Delegate all per-CLI quirks (command lookup / timeout / stdin piping /
      # flags) to the thin adapter. Append (>>) to preserve the parent-written
      # meta header.
      bash "$adapter" "$prompt_file" "$model" "$timeout_val" >> "$log" 2>&1
      rc=$?
    fi

    # Sidecar status file lets the parent shell render a blocking-mode footer
    # without re-parsing its own stdout (events go straight to the parent
    # shell fd 1, not back through any capturable channel here).
    echo "$rc" > "${log%.log}.status"

    if [[ $rc -eq 0 ]]; then
      echo "DONE $spec $log"
    else
      echo "FAIL $spec exit_code=$rc log=$log"
    fi
  ' _ "$spec" "$prompt_file" "$adapter_dir" "$per_reviewer_timeout" "$log" &
  pids+=($!)
done

# Wait for every reviewer. We don't propagate individual failures — they're
# already reported via the event stream. Orchestrator itself exits 0 unless
# the Monitor kills us.
for pid in "${pids[@]}"; do
  wait "$pid" || true
done

echo "ALL_DONE"

# Blocking-mode footer: emit a human-readable summary pointing to log files.
# Streaming consumers (Monitor) will have already reacted to per-reviewer
# events and don't need this; emitting it would just be noise after the
# stream-end notification.
if [[ "$mode" == "blocking" ]]; then
  done_count=0
  fail_count=0
  unknown_count=0
  rows=()

  for spec in "${specs[@]}"; do
    slug="$(slug_of "$spec")"
    log="/tmp/xreview-${runid}-${slug}.log"
    status_file="${log%.log}.status"

    if [[ -f "$status_file" ]]; then
      rc="$(cat "$status_file" 2>/dev/null || echo "?")"
      if [[ "$rc" == "0" ]]; then
        rows+=("[DONE]      $spec  ->  $log")
        ((done_count++))
      else
        rows+=("[FAIL=$rc]  $spec  ->  $log")
        ((fail_count++))
      fi
    else
      # No status file means the subshell never reached its write — likely
      # SIGKILLed mid-flight. The log file may still have partial output.
      rows+=("[UNKNOWN]   $spec  ->  $log")
      ((unknown_count++))
    fi
  done

  total=${#specs[@]}
  status_summary="$done_count done"
  [[ $fail_count -gt 0 ]] && status_summary="$status_summary, $fail_count failed"
  [[ $unknown_count -gt 0 ]] && status_summary="$status_summary, $unknown_count unknown"

  echo ""
  echo "=== Cross Review Summary ($total reviewers: $status_summary) ==="
  echo ""
  echo "Read these log files to synthesize the cross-comparison report:"
  for row in "${rows[@]}"; do
    echo "  $row"
  done
  echo ""
  echo "Next: Read each log above, then cross-compare findings per ddd.xreview SKILL.md step 6."
fi

exit 0
