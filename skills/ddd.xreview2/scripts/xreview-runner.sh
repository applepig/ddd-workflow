#!/usr/bin/env bash
# xreview-runner.sh — thin timeout wrapper around external CLI review runners
# Usage: xreview-runner.sh <prompt-file> <cli:model> [timeout-seconds]
#
# Supported CLIs: opencode, gemini, codex
# Backward compatible: <model> without colon is treated as opencode:<model>
#
# This script intentionally avoids content/quality heuristics. It only adds
# a timeout, preserves the CLI's own stdout/stderr output, and preserves the
# CLI's own exit code (no content inspection). Review text discussing errors
# must not be mistaken for a runner failure.

set -uo pipefail

prompt_file="${1:?Usage: xreview-runner.sh <prompt-file> <cli:model> [timeout]}"
cli_spec="${2:?Usage: xreview-runner.sh <prompt-file> <cli:model> [timeout]}"
# Default matches orchestrator's hard-coded 3000s. If orchestrator passes a
# value, that wins; if runner is invoked directly, we still use the same cap.
timeout_sec="${3:-3000}"

if [[ ! -f "$prompt_file" ]]; then
  echo "XREVIEW_ERROR: prompt file not found: $prompt_file" >&2
  exit 1
fi

# Parse cli:model — backward compatible with bare model name
if [[ "$cli_spec" != *:* ]]; then
  cli="opencode"
  model="$cli_spec"
else
  cli="${cli_spec%%:*}"
  model="${cli_spec#*:}"
fi

# Validate CLI name
case "$cli" in
  opencode|gemini|codex) ;;
  *)
    echo "XREVIEW_ERROR: unknown cli: $cli (supported: opencode, gemini, codex)" >&2
    exit 1
    ;;
esac

# Resolve CLI to absolute path — required because `timeout` (a C program) uses
# execvp() which does NOT expand ~ in PATH entries. Bash's `command -v` does.
cli_path="$(command -v "$cli" 2>/dev/null)" || true
if [[ -z "$cli_path" ]]; then
  echo "XREVIEW_ERROR: cli not found: $cli (install it first)" >&2
  exit 1
fi

# Dispatch to the appropriate CLI. stderr merged into stdout so the caller
# captures a single stream; exit code is the CLI's own (no content inspection).
case "$cli" in
  opencode)
    # Merge stderr into stdout to avoid TTY-related hangs when stderr is redirected
    # to a file. OpenCode may behave differently when stderr is not a TTY/pipe,
    # causing timeout to fail to kill the process.
    timeout --foreground "$timeout_sec" "$cli_path" run \
      --print-logs \
      --log-level ERROR \
      --agent ddd.xreviewer \
      --model "$model" \
      < "$prompt_file" \
      2>&1
    ;;
  gemini)
    # --approval-mode=plan enables Plan Mode (read-only, no file writes).
    # -m specifies model (e.g. gemini-2.5-pro, gemini-3.0-flash-preview).
    # Load custom policy to allow git commands in plan mode.
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    policy_file="$script_dir/../../../policies/ddd.xreview.toml"
    timeout --foreground "$timeout_sec" "$cli_path" \
      --approval-mode=plan \
      --admin-policy="$policy_file" \
      -m "$model" \
      < "$prompt_file" \
      2>&1
    ;;
  codex)
    # codex exec is the non-interactive subcommand.
    # - (dash) reads prompt from stdin.
    # --ephemeral avoids saving session files.
    # --sandbox read-only prevents file system modifications.
    timeout --foreground "$timeout_sec" "$cli_path" exec \
      --sandbox read-only \
      --ephemeral \
      --model "$model" \
      - < "$prompt_file" \
      2>&1
    ;;
esac
rc=$?

if [[ $rc -eq 124 ]]; then
  echo "XREVIEW_ERROR: timed out after ${timeout_sec}s (cli: $cli, model: $model)" >&2
  exit 124
elif [[ $rc -ne 0 ]]; then
  echo "XREVIEW_ERROR: $cli exited with code $rc (model: $model)" >&2
  exit "$rc"
fi
