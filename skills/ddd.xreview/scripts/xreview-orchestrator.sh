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
#   RETURN <cli:model> <log-path> <final-path>
#   FAIL <cli:model> exit_code=<n> log=<log-path> final=<final-path>
#   ALL_DONE
#
# Event semantics (ADR-7 + ADR-11):
#   RETURN = transport layer success (CLI exit 0). Carries <log> (verbose
#            trace) and <final> (clean agent final message). Does NOT guarantee
#            the final contains a real review — the agent may have emitted
#            "FAIL:" or "XREVIEW_ERROR:" content while exiting normally.
#            Coordinator MUST Read <final> before treating the reviewer as
#            valid (SKILL.md step 7.1: empty .final.txt = content-layer fail).
#   FAIL   = transport layer failure (CLI exit non-zero, timeout 124, etc).
#            Same <log>/<final> paths — <final> may be empty on failure.
#   ALL_DONE = fan-out complete (reached end of reviewer loop).
#
# Each reviewer writes two files:
#   /tmp/xreview-<runid>-<slug>.log        — verbose trace (stderr + noise)
#   /tmp/xreview-<runid>-<slug>.final.txt  — agent's final message only (ADR-11)
# Both are emitted in events so callers can tail the log during review and
# Read the final after RETURN/FAIL.
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
#   - streaming (default when CLAUDECODE=1): pure event stream — START / RETURN /
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

# M6.4: stdin mode. When invoked with no positional prompt file (or "-" sentinel),
# slurp stdin into a managed tmpfile. This lets coordinator issue a single
# Monitor call with the prompt piped in (heredoc / echo), no pre/post Bash tool
# calls for mktemp + rm. The early trap guarantees cleanup even if validation
# below exits before the main cleanup() function is registered.
_tmp_prompt_file=""
if [[ $# -eq 0 || "${1:-}" == "-" ]]; then
  _tmp_prompt_file="$(mktemp /tmp/xreview-prompt-XXXXXX.md)" || {
    echo "FAIL orchestrator mktemp_failed"
    echo "ALL_DONE"
    exit 1
  }
  trap '[[ -n "$_tmp_prompt_file" && -f "$_tmp_prompt_file" ]] && rm -f "$_tmp_prompt_file"' EXIT
  cat > "$_tmp_prompt_file"
  prompt_file="$_tmp_prompt_file"
  # Drop the "-" sentinel if present so remaining args are all specs.
  [[ "${1:-}" == "-" ]] && shift
else
  prompt_file="$1"
  shift
fi
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
# long enough for deep-reasoning models (opus, gemini-pro). Overridable via
# XREVIEW_TIMEOUT_SEC for tests; production always uses the default.
# ADR-6: timeout is enforced here (orchestrator layer) via `timeout --foreground`,
# NOT inside adapters. Adapters stay pure passthroughs.
per_reviewer_timeout="${XREVIEW_TIMEOUT_SEC:-3000}"

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

# Dedupe: two specs that resolve to the same canonical form (e.g. alias "opus"
# + full "claude:claude-opus-4-6") share the same slug → same .log / .final.txt
# paths → race-overwrite. Keep first occurrence, warn on stderr for each
# subsequent duplicate. stderr (not stdout) because stdout is the event stream
# consumed by Monitor; mixing in non-event lines breaks deterministic parsing.
deduped_specs=()
# Requires bash 4.0+ (associative arrays). macOS's stock bash 3.2 would error
# at parse time here; this file is intentionally bash 4+ throughout.
declare -A _seen_specs=()
for spec in "${specs[@]}"; do
  if [[ -n "${_seen_specs[$spec]:-}" ]]; then
    echo "XREVIEW_WARN: deduped duplicate spec: $spec" >&2
    continue
  fi
  _seen_specs[$spec]=1
  deduped_specs+=("$spec")
done
specs=("${deduped_specs[@]}")
unset _seen_specs

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

  # M6.4: remove the stdin-mode tmpfile if we created one. Runs on every exit
  # path (normal, INT, TERM) via the traps below; supersedes the early trap
  # registered before cleanup() was defined.
  [[ -n "$_tmp_prompt_file" && -f "$_tmp_prompt_file" ]] && rm -f "$_tmp_prompt_file"
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
# RETURN/FAIL event. START is emitted up-front from the main shell so the
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
  final="/tmp/xreview-${runid}-${slug}.final.txt"

  cli="${spec%%:*}"
  model="${spec#*:}"
  if [[ ! "$cli" =~ ^[a-z0-9_-]+$ ]] || [[ ! "$model" =~ ^[A-Za-z0-9._/:-]+$ ]]; then
    # Pre-create log file so FAIL log=$log is Readable for invalid specs too.
    cat > "$log" << EOF
[xreview] XREVIEW_ERROR: invalid spec format: $spec
[xreview] cli must match ^[a-z0-9_-]+\$
[xreview] model must match ^[A-Za-z0-9._/:-]+\$
EOF
    # Empty final.txt so coordinator's Read protocol (step 7.1) sees the
    # content-layer-failure signal (empty → fail).
    : > "$final"
    # Sidecar matches subshell convention so blocking-mode footer can read it.
    echo "2" > "${log%.log}.status"
    echo "START $spec $log"
    echo "FAIL $spec exit_code=2 log=$log final=$final"
    continue
  fi

  # Valid spec: write meta header; setsid body will APPEND its output after.
  printf '[xreview] START %s at %s\n[xreview] log=%s\n[xreview] ---\n' \
    "$spec" "$(date -Iseconds)" "$log" > "$log"
  # Pre-create final.txt (empty) so coordinator can Read it unconditionally
  # after RETURN/FAIL, even if the adapter never writes (e.g. early CLI crash).
  : > "$final"
  echo "START $spec $log"
  valid_specs+=("$spec")
done

# Dispatch only valid specs. If all specs were invalid, valid_specs is empty
# and this loop is a no-op — main flow falls through to ALL_DONE / exit 0.
for spec in "${valid_specs[@]:-}"; do
  [[ -z "$spec" ]] && continue  # guard against the :- empty-string placeholder
  slug="$(slug_of "$spec")"
  log="/tmp/xreview-${runid}-${slug}.log"
  # Recompute $final per spec (mirror validation loop line 293). Without this,
  # $final retains the last validation iteration's value and every dispatched
  # reviewer races to overwrite a single final.txt. Regression test: M7.4 in
  # xreview-orchestrator.test.sh.
  final="/tmp/xreview-${runid}-${slug}.final.txt"
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
    final="$6"

    cli="${spec%%:*}"
    model="${spec#*:}"

    adapter="$adapter_dir/$cli.sh"

    if [[ ! -f "$adapter" ]]; then
      echo "XREVIEW_ERROR: unknown cli: $cli (supported: claude, opencode, gemini, codex)" \
        >> "$log"
      rc=1
    else
      # Delegate per-CLI quirks (command lookup / stdin piping / flags) to the
      # thin adapter. Timeout is enforced here (ADR-6) via `timeout --foreground`
      # so new adapters automatically inherit the safety net. `--foreground`
      # keeps the child in our process group so setsid-based cleanup still works.
      # Append (>>) to preserve the parent-written meta header.
      # ADR-11 (M7): 3rd adapter arg is <final-out-file>. Adapter writes clean
      # final text there; verbose trace flows via stderr into this log.
      timeout --foreground "$timeout_val" \
        bash "$adapter" "$prompt_file" "$model" "$final" >> "$log" 2>&1
      rc=$?

      # M6.1 (F1): timeout(1) only SIGTERMs its direct child (bash adapter).
      # The CLI grandchild becomes an orphan that keeps burning quota. Sweep
      # our pgid (we are the setsid leader, pgid == BASHPID) to kill any
      # remaining process. Exclude self so we can finish writing status/event.
      # M6.2 (F2, tightened by M6 cross review F4): append the timeout marker
      # AFTER the sweep finishes, not before. Otherwise CLI orphans still alive
      # during the 1-second TERM grace period can flush buffered output into
      # the same log fd, pushing the marker out of the step 7.1 tail -n 10
      # peek window and letting a timed-out log pass as valid review.
      if [[ $rc -eq 124 ]]; then
        sweep_pgid="$BASHPID"
        for orphan in $(pgrep -g "$sweep_pgid" 2>/dev/null); do
          [[ "$orphan" -eq "$sweep_pgid" ]] && continue
          kill -TERM "$orphan" 2>/dev/null || true
        done
        sleep 1
        for orphan in $(pgrep -g "$sweep_pgid" 2>/dev/null); do
          [[ "$orphan" -eq "$sweep_pgid" ]] && continue
          kill -KILL "$orphan" 2>/dev/null || true
        done
        # All orphans are dead; nothing else can write to $log now. Append
        # the marker last so it always lands in the final tail -n 10 window.
        echo "XREVIEW_ERROR: orchestrator timeout after ${timeout_val}s" >> "$log"
      fi
    fi

    # Sidecar status file lets the parent shell render a blocking-mode footer
    # without re-parsing its own stdout (events go straight to the parent
    # shell fd 1, not back through any capturable channel here).
    echo "$rc" > "${log%.log}.status"

    # RETURN = transport OK (CLI exit 0). Content validity (did the agent
    # actually produce a review?) is the coordinator responsibility — see
    # SKILL.md step 7 for the log-tail peek protocol.
    if [[ $rc -eq 0 ]]; then
      echo "RETURN $spec $log $final"
    else
      echo "FAIL $spec exit_code=$rc log=$log final=$final"
    fi
  ' _ "$spec" "$prompt_file" "$adapter_dir" "$per_reviewer_timeout" "$log" "$final" &
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
    final="/tmp/xreview-${runid}-${slug}.final.txt"
    status_file="${log%.log}.status"

    if [[ -f "$status_file" ]]; then
      rc="$(cat "$status_file" 2>/dev/null || echo "?")"
      if [[ "$rc" == "0" ]]; then
        rows+=("[RETURN]    $spec  ->  [LOG] $log  [FINAL] $final")
        ((done_count++))
      else
        rows+=("[FAIL=$rc]  $spec  ->  [LOG] $log  [FINAL] $final")
        ((fail_count++))
      fi
    else
      # No status file means the subshell never reached its write — likely
      # SIGKILLed mid-flight. The log file may still have partial output.
      rows+=("[UNKNOWN]   $spec  ->  [LOG] $log  [FINAL] $final")
      ((unknown_count++))
    fi
  done

  total=${#specs[@]}
  # ADR-7: "returned" mirrors the RETURN event — transport OK, content
  # validity still to be confirmed by coordinator. Avoids "done" which could
  # be misread as "review content is complete".
  status_summary="$done_count returned"
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
  echo "Next: Read each [FINAL] for the review text (or [LOG] for verbose trace),"
  echo "then cross-compare findings per ddd.xreview SKILL.md step 6."
fi

exit 0
