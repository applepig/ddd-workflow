#!/usr/bin/env bash
# claude.sh — xreview adapter for Claude CLI
#
# Interface: bash claude.sh <prompt-file> <model> <final-out-file>
#
# The 3rd arg is the final-output file path (ADR-11). Adapter writes the
# reviewer's extracted final text to that file; verbose trace (CLI debug +
# envelope echo) flows via stderr and is captured by the orchestrator's log.
#
# Read scope: the adapter derives the invoking repo root from the orchestrator
# cwd, chdirs into it, and grants read access via `--add-dir <repo> --add-dir
# /tmp [--add-dir <config>]`. Without this the CLI confines the reviewer to the
# inherited cwd + ambient settings additionalDirectories and it cannot Read the
# spec/oracle under review (regression 2026-07-23).
#
# Dual-output mechanics (ADR-11):
#   - stdout of claude CLI with `--output-format json` is a JSON array of
#     event envelopes; the final agent message sits in the last element with
#     `type=="result"`. Some older CLI builds emit a single object instead.
#     adapter's jq filter handles both: if array → pick last type=="result"
#     element's .result; if object → .result. Empty on miss.
#   - --debug-file <tmp> absorbs claude's verbose trace; adapter dumps the
#     tmp file to stderr at the end so the orchestrator log keeps a copy.
#   - stderr of claude CLI flows straight through (no `exec 2>&1`).
#
# Exit code: the CLI's own rc, taken from PIPESTATUS[0]. If jq fails (CLI
# emitted non-JSON), final_out may be empty but we still report the CLI rc
# so upstream `RETURN` vs `FAIL` semantics are preserved.
#
# stdout contract: must be empty (final flows to $3 via jq). If anything ever
# prints to stdout here, the orchestrator's `>> $log 2>&1` will append it to
# the log and the final_out copy will be the only sanctioned record.

set -uo pipefail

prompt_file="${1:?Usage: claude.sh <prompt-file> <model> <final-out-file>}"
model="${2:?Usage: claude.sh <prompt-file> <model> <final-out-file>}"
final_out="${3:?Usage: claude.sh <prompt-file> <model> <final-out-file>}"

if [[ ! -f "$prompt_file" ]]; then
  echo "XREVIEW_ERROR: prompt file not found: $prompt_file" >&2
  exit 1
fi

# Resolve the file-path args to absolute NOW, before we chdir into the repo
# below. After `cd "$repo_dir"` a relative stdin / --debug-file / final-out path
# would resolve against the wrong directory (the orchestrator already passes
# absolute paths in production; this keeps direct/CLI callers correct too).
_abs_path() {
  local p="$1" dir base
  dir="$(cd "$(dirname "$p")" 2>/dev/null && pwd -P)" || dir="$(dirname "$p")"
  base="$(basename "$p")"
  printf '%s/%s\n' "$dir" "$base"
}
prompt_file="$(_abs_path "$prompt_file")"
final_out="$(_abs_path "$final_out")"

cli_path="$(command -v claude 2>/dev/null)" || true
if [[ -z "$cli_path" ]]; then
  echo "XREVIEW_ERROR: cli not found: claude (install it first)" >&2
  exit 1
fi

# jq is required for final extraction. Without it the pipeline silently yields
# an empty final_out while the CLI rc may still be 0, fooling upstream
# orchestration into treating a transport failure as a content-layer failure.
if ! command -v jq >/dev/null 2>&1; then
  echo "XREVIEW_ERROR: jq not found (required for claude adapter final extraction)" >&2
  exit 1
fi

# Ensure final_out exists (empty) even on early exit — callers Read it.
: > "$final_out"

# Debug-file sibling path: /tmp/.../xreview-...final.txt -> .debug
debug_file="${final_out%.final.txt}.debug"
# If final_out doesn't end with .final.txt, fall back to a mktemp.
if [[ "$debug_file" == "$final_out" ]]; then
  debug_file="$(mktemp /tmp/xreview-claude-debug-XXXXXX)"
fi
: > "$debug_file"

# --- read scope: grant the reviewer the invoking repo (+ /tmp, config) --------
# Every other xreview adapter explicitly hands its CLI the target directory
# (agy --add-dir/--chdir, gemini --include-directories, opencode
# OPENCODE_PERMISSION). claude.sh historically passed neither, so the reviewer
# inherited only the orchestrator cwd plus whatever additionalDirectories the
# ambient settings resolved to. In a multi-root session that set excluded the
# repo under review, and both Claude reviewers FAILed a Docs-Lens xreview unable
# to Read the spec/oracle files (regression: 2026-07-23). Derive the repo root
# from the orchestrator cwd and grant it read access explicitly.
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}"
repo_dir="$(git -C "$(pwd -P)" rev-parse --show-toplevel 2>/dev/null)" || repo_dir="$(pwd -P)"

# Refuse to hand the reviewer an overly-broad root (/, $HOME): a mis-derived
# repo_dir there would grant far more than the sprint under review.
home_real=""
[[ -n "${HOME:-}" && -d "${HOME:-}" ]] && home_real="$(cd "$HOME" && pwd -P)"
if [[ "$repo_dir" == "/" || ( -n "$home_real" && "$repo_dir" == "$home_real" ) ]]; then
  echo "XREVIEW_ERROR: claude repo_dir refuses overly-broad path: $repo_dir" >&2
  exit 1
fi

add_dirs=(--add-dir "$repo_dir" --add-dir /tmp)
[[ -d "$config_dir" && "$config_dir" != /tmp ]] && add_dirs+=(--add-dir "$config_dir")

# Reviewer Bash allowlist — repo-controlled floor, comma-separated for
# --allowedTools (rules contain spaces, so space-separation would split them).
#
# Why this exists: --permission-mode default resolves Bash against the UNION of
# the user's settings allowlist and --allowedTools (verified: passing an
# unrelated --allowedTools rule does not suppress a settings-granted command).
# Relying on ambient settings alone made reviewer capability machine-dependent —
# a host without `glab` rules produced an empty review instead of a failure.
# This list guarantees a floor on every machine; user settings may widen it.
# Full isolation would need --setting-sources to drop user settings, but that
# also unloads ~/.claude/agents, so `--agent ddd-reviewer` stops resolving.
#
# Read-only by construction (底線第 5 條 reviewer 只讀不改): forge CLIs expose
# only their query verbs — no create/merge, and no `api` (it writes with -X).
reviewer_allowed_tools="Bash(git --no-pager:*),Bash(git log:*),Bash(git diff:*),Bash(git show:*)"
reviewer_allowed_tools+=",Bash(git status:*),Bash(git branch:*),Bash(git rev-parse:*)"
reviewer_allowed_tools+=",Bash(git merge-base:*),Bash(git ls-files:*),Bash(git blame:*)"
reviewer_allowed_tools+=",Bash(git shortlog:*),Bash(git for-each-ref:*),Bash(git describe:*)"
reviewer_allowed_tools+=",Bash(git fetch:*)"
reviewer_allowed_tools+=",Bash(cat:*),Bash(head:*),Bash(tail:*),Bash(wc:*)"
reviewer_allowed_tools+=",Bash(sort:*),Bash(uniq:*),Bash(cut:*)"
reviewer_allowed_tools+=",Bash(rg:*),Bash(fd:*),Bash(jq:*),Bash(command -v:*)"
reviewer_allowed_tools+=",Bash(glab mr view:*),Bash(glab mr list:*),Bash(glab mr diff:*)"
reviewer_allowed_tools+=",Bash(glab issue view:*),Bash(glab issue list:*)"
reviewer_allowed_tools+=",Bash(glab repo view:*),Bash(glab ci list:*),Bash(glab ci view:*)"
reviewer_allowed_tools+=",Bash(gh pr view:*),Bash(gh pr list:*),Bash(gh pr diff:*)"
reviewer_allowed_tools+=",Bash(gh pr checks:*),Bash(gh issue view:*),Bash(gh issue list:*)"
reviewer_allowed_tools+=",Bash(gh repo view:*),Bash(gh run list:*),Bash(gh run view:*)"
reviewer_allowed_tools+=",Bash(npm test:*),Bash(npm run test:*),Bash(pnpm test:*)"
reviewer_allowed_tools+=",Bash(pnpm run test:*),Bash(vitest:*)"

# chdir into the repo root so ddd-reviewer's Bash `git --no-pager diff` targets
# the repo under review rather than a nested submodule the orchestrator cwd may
# have landed in. File-path args were made absolute above, so the redirects hold.
cd "$repo_dir" || {
  echo "XREVIEW_ERROR: claude cannot chdir to repo_dir: $repo_dir" >&2
  exit 1
}

# Pipefail disabled for this pipeline: we take rc from PIPESTATUS[0] (the CLI),
# and want jq failures to leave final_out empty rather than mask the CLI rc.
set +o pipefail
# --permission-mode default (not plan): plan mode denies Bash unconditionally
# (Issue #13067, Issue #2058 — no per-mode allowlist) and ddd-reviewer needs
# Bash for `git --no-pager diff`. --allowedTools pins the reviewer's floor so
# capability no longer varies with the host's settings (see list above).
"$cli_path" -p \
  --agent ddd-reviewer \
  --model "$model" \
  --no-session-persistence \
  --permission-mode default \
  --allowedTools "$reviewer_allowed_tools" \
  --output-format json \
  --debug-file "$debug_file" \
  "${add_dirs[@]}" \
  < "$prompt_file" \
  | jq -r 'if type=="array" then (map(select(.type=="result")) | last // .[-1]).result else .result end // empty' > "$final_out" 2>/dev/null
rc="${PIPESTATUS[0]}"
set -o pipefail

# Dump the debug-file into stderr so the orchestrator log still captures the
# verbose trace, then clean up the sidecar.
if [[ -s "$debug_file" ]]; then
  echo "=== claude --debug-file content ===" >&2
  cat "$debug_file" >&2
fi
rm -f "$debug_file"

if [[ $rc -ne 0 ]]; then
  echo "XREVIEW_ERROR: claude exited with code $rc (model: $model)" >&2
  exit "$rc"
fi
