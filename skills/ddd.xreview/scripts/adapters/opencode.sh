#!/usr/bin/env bash
# opencode.sh — unified OpenCode runner; mode selected by symlink invocation name.
#
# Modes:
#   - opencode.sh                  → reviewer (xreview adapter, ADR-11 contract)
#   - opencode-worker.sh (symlink) → worker (ddd.work via Monitor)
#
# Sharing one file lets ddd.work and ddd.xreview keep a single opencode entry
# point. The reviewer mode preserves the historical adapter contract verbatim;
# the worker mode adds flag-based arg parsing, optional worktree isolation,
# and Monitor-friendly lifecycle events.
#
# Reviewer mode contract (xreview ADR-11):
#   - Args: <prompt-file> <model> <final-out-file>  (3 positional)
#   - stdout contract: must be empty (orchestrator merges stdout+stderr into
#     log; spurious stdout would duplicate final into the log).
#   - stderr: raw ndjson via `tee /dev/stderr` for orchestrator log
#   - final-out: extracted text events written via jq -rs
#   - Sandbox: read-only via OPENCODE_PERMISSION env (no --dir, no skip-perms)
#
# Worker mode contract (Monitor-driven):
#   - Args: --description / --subagent-type / --prompt(-file) / --model /
#           --isolation worktree / --branch / --cwd
#   - stdout: sparse lifecycle events ([opencode-worker] ...) + ERROR ...
#   - log file: timestamped filtered events; path emitted as LOG_FILE <path>
#   - result file: extracted text events; path emitted as RESULT_FILE <path>
#   - Sandbox: --dangerously-skip-permissions (write-capable for TDD)

set -uo pipefail

# -------- Mode detection from invocation name --------
self_name="$(basename "${BASH_SOURCE[0]}")"
case "$self_name" in
  opencode.sh|opencode-reviewer.sh) MODE=reviewer ;;
  opencode-worker.sh)               MODE=worker ;;
  *) echo "FAIL: cannot infer mode from invocation name: $self_name" >&2; exit 2 ;;
esac

# -------- Common prerequisite checks --------
cli_path="$(command -v opencode 2>/dev/null)" || true
if [[ -z "$cli_path" ]]; then
  echo "XREVIEW_ERROR: cli not found: opencode (install it first)" >&2
  exit 1
fi

# jq is critical for both modes (text extraction; reviewer also builds permission JSON).
if ! command -v jq >/dev/null 2>&1; then
  echo "XREVIEW_ERROR: jq not found (required for opencode adapter permission JSON build and final extraction)" >&2
  exit 1
fi

# ════════════════════════════════════════════════════════════════════════════
# Reviewer mode (xreview adapter)
# ════════════════════════════════════════════════════════════════════════════
if [[ "$MODE" == "reviewer" ]]; then
  prompt_file="${1:?Usage: opencode.sh <prompt-file> <model> <final-out-file>}"
  model="${2:?Usage: opencode.sh <prompt-file> <model> <final-out-file>}"
  final_out="${3:?Usage: opencode.sh <prompt-file> <model> <final-out-file>}"

  if [[ ! -f "$prompt_file" ]]; then
    echo "XREVIEW_ERROR: prompt file not found: $prompt_file" >&2
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
    --agent ddd-reviewer \
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

  exit 0
fi

# ════════════════════════════════════════════════════════════════════════════
# Worker mode (ddd.work via Monitor)
# ════════════════════════════════════════════════════════════════════════════

# -------- Defaults --------
DESCRIPTION=""
SUBAGENT_TYPE="ddd-developer"
PROMPT=""
PROMPT_FILE=""
MODEL="openai/gpt-5.5"
ISOLATION=""
BRANCH=""
CWD="$(pwd)"

usage() {
  cat <<EOF
Usage: opencode-worker.sh [options]

Mirrors Claude Code Agent tool parameters:
  --description <text>      Short label, mirrors Agent.description
  --subagent-type <name>    OpenCode agent name (deployed under
                            ~/.config/opencode/agents/<name>.md, must be
                            mode: primary or mode: all). Default: ddd-developer
  --prompt <text>           User prompt; can also pipe via stdin
  --prompt-file <path>      Read user prompt from a file
  --model <name>            OpenCode model in provider/model form
                            (default: openai/gpt-5.5)
  --isolation worktree      Create or reuse a git worktree before running
  --branch <name>           Branch for the worktree (auto-derived from
                            description if omitted; only used with isolation)
  --cwd <path>              Project root (default: current directory)
  -h, --help                Show this help
EOF
}

# -------- Parse args --------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --description) DESCRIPTION="$2"; shift 2 ;;
    --subagent-type) SUBAGENT_TYPE="$2"; shift 2 ;;
    --prompt) PROMPT="$2"; shift 2 ;;
    --prompt-file) PROMPT_FILE="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --isolation) ISOLATION="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --cwd) CWD="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "FAIL: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

emit() { printf '[opencode-worker] %s\n' "$*"; }

# -------- Resolve prompt --------
if [[ -n "$PROMPT_FILE" ]]; then
  if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "FAIL: prompt file not found: $PROMPT_FILE" >&2
    exit 2
  fi
  PROMPT="$(cat "$PROMPT_FILE")"
elif [[ -z "$PROMPT" ]]; then
  if [[ ! -t 0 ]]; then
    PROMPT="$(cat)"
  else
    echo "FAIL: no prompt supplied (use --prompt, --prompt-file, or stdin)" >&2
    exit 2
  fi
fi

# -------- Worktree handling --------
cd "$CWD" || { echo "FAIL: cwd not accessible: $CWD" >&2; exit 2; }

work_dir="$CWD"
if [[ "$ISOLATION" == "worktree" ]]; then
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "FAIL: --isolation worktree requires a git repository" >&2
    exit 2
  fi
  project_root="$(git rev-parse --show-toplevel)"

  if [[ -z "$BRANCH" ]]; then
    slug="$(printf '%s' "$DESCRIPTION" \
      | tr '[:upper:] _' '[:lower:]--' \
      | tr -cd 'a-z0-9-' \
      | cut -c1-40)"
    [[ -z "$slug" ]] && slug="$(date +%s)"
    BRANCH="opencode/$slug"
  fi

  work_dir="$project_root/.worktree/$BRANCH"

  if existing="$(git -C "$project_root" worktree list --porcelain \
                  | awk -v p="$work_dir" '$1=="worktree" && $2==p {print $2; exit}')" \
     && [[ -n "$existing" ]]; then
    emit "WORKTREE_REUSED $work_dir"
  else
    if git -C "$project_root" rev-parse --verify "refs/heads/$BRANCH" >/dev/null 2>&1; then
      git -C "$project_root" worktree add "$work_dir" "$BRANCH" >/dev/null
    else
      git -C "$project_root" worktree add -b "$BRANCH" "$work_dir" >/dev/null
    fi
    # Verify the worktree was actually registered before proceeding; a silent
    # add failure would otherwise leave us running opencode (with skip-perms)
    # against a non-existent --dir, potentially writing into the main repo.
    registered="$(git -C "$project_root" worktree list --porcelain \
                  | awk -v p="$work_dir" '$1=="worktree" && $2==p {print $2; exit}')"
    if [[ -z "$registered" ]]; then
      echo "FAIL: worktree add did not register $work_dir" >&2
      exit 2
    fi
    emit "WORKTREE_CREATED $work_dir (branch: $BRANCH)"
  fi
fi

# -------- Setup tmp files --------
prompt_tmp="$(mktemp -t opencode-worker-prompt-XXXXXX.md)"
result_file="$(mktemp -t opencode-worker-result-XXXXXX.md)"
log_file="$(mktemp -t opencode-worker-log-XXXXXX.log)"
ndjson_raw="$(mktemp -t opencode-worker-raw-XXXXXX.jsonl)"
# downstream_failed: set to 1 if any post-opencode pipeline stage (tee/jq/while)
# returns non-zero. When set, we keep ndjson_raw on disk for post-mortem and
# emit NDJSON_RAW <path> so the caller can locate it.
downstream_failed=0
trap 'rm -f "$prompt_tmp"; [[ $downstream_failed -eq 0 ]] && rm -f "$ndjson_raw"' EXIT

printf '%s\n' "$PROMPT" > "$prompt_tmp"

emit "DESCRIPTION ${DESCRIPTION:-(unset)}"
emit "SUBAGENT_TYPE $SUBAGENT_TYPE"
emit "MODEL $MODEL"
emit "CWD $work_dir"
emit "LOG_FILE $log_file"
emit "RESULT_FILE $result_file"

# -------- Run opencode --------
# Pipeline: opencode (ndjson) → tee (raw archive) → jq (filter to one-line
# events) → while read (timestamp+log; ERROR-only to stdout for Monitor).
#
# Per-tool subprocess exit codes are opencode's internal exploration telemetry,
# not worker-level failure signals — they go to log only.
set +o pipefail
"$cli_path" run \
  --dir "$work_dir" \
  --print-logs \
  --log-level ERROR \
  --agent "$SUBAGENT_TYPE" \
  --model "$MODEL" \
  --format json \
  --dangerously-skip-permissions \
  < "$prompt_tmp" \
| tee "$ndjson_raw" \
| jq -rc --unbuffered '
    def trunc(n): tostring | gsub("[\r\n]+"; " ") | .[0:n];
    if   .type == "step_start"  then empty
    elif .type == "step_finish" then
      "STEP_DONE reason=\(.part.reason // "?") tokens=\(.part.tokens.total // 0) cost=\(.part.cost // 0)"
    elif .type == "tool_use" then
      ( .part.tool as $t |
        if $t == "bash" then
          "EXEC \((.part.state.input.command // "?") | trunc(240)) exit=\(.part.state.metadata.exit // "?")"
        else
          "TOOL \($t // "?") \((.part.title // "") | trunc(160))"
        end )
    elif .type == "text" then
      "MESSAGE \((.part.text // "") | trunc(240))"
    elif .type == "error" then
      "ERROR \((.message // tostring) | trunc(240))"
    else "EVENT \(.type // "?")"
    end
  ' \
| while IFS= read -r line; do
    printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$line" >> "$log_file"
    if [[ "$line" =~ ^ERROR\  ]]; then
      printf '%s\n' "$line"
    fi
  done
# Snapshot the whole PIPESTATUS array in one statement; any subsequent
# assignment (even a simple one) resets PIPESTATUS to its own single-element
# exit status, so reading [1..3] piecewise would crash under `set -u`.
pipestatus_snapshot=("${PIPESTATUS[@]}")
opencode_exit="${pipestatus_snapshot[0]:-0}"
tee_exit="${pipestatus_snapshot[1]:-0}"
jq_exit="${pipestatus_snapshot[2]:-0}"
while_exit="${pipestatus_snapshot[3]:-0}"
set -o pipefail

# Downstream pipeline health check. opencode_exit alone is misleading: if the
# CLI succeeds but jq fails (e.g. ndjson schema drift) or the while loop dies,
# result_file ends up empty while we'd otherwise exit 0. Surface these so the
# caller can distinguish "no output" from "output silently dropped".
if [[ "$tee_exit" -ne 0 ]]; then
  emit "WARN downstream_pipeline_failed stage=tee rc=$tee_exit"
  downstream_failed=1
fi
if [[ "$jq_exit" -ne 0 ]]; then
  emit "WARN downstream_pipeline_failed stage=jq rc=$jq_exit"
  downstream_failed=1
fi
if [[ "$while_exit" -ne 0 ]]; then
  emit "WARN downstream_pipeline_failed stage=while rc=$while_exit"
  downstream_failed=1
fi
if [[ "$downstream_failed" -eq 1 ]]; then
  emit "NDJSON_RAW $ndjson_raw"
fi

# -------- Extract final assistant text --------
if [[ -s "$ndjson_raw" ]]; then
  jq -rs 'map(select(.type=="text")) | map(.part.text) | join("\n\n")' \
    "$ndjson_raw" > "$result_file" 2>/dev/null || true
fi

# -------- Done --------
[[ ! -s "$result_file" ]] && emit "RESULT_FILE_EMPTY (opencode produced no text events)"
emit "DONE exit=$opencode_exit"
exit "$opencode_exit"
