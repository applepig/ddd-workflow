#!/usr/bin/env bash
# agy.sh — xreview adapter for Antigravity CLI (agy), V3.
#
# Interface: bash agy.sh <prompt-file> <model> <final-out-file>
#
# The 3rd arg is the final-output file. agy writes its final review text to
# stdout under `--print`; this adapter redirects that stdout to $final_out.
# agy's progress/trace goes to stderr and flows naturally to the orchestrator
# log. Exit code is the passthrough of agy's rc.
#
# Write boundary = bwrap OS-level confinement (ADR-6/ADR-7/ADR-8). agy runs with
# the REAL repo as cwd + workspace, but `bwrap --ro-bind / /` makes the entire
# FS (including the repo and its .git) physically read-only. The only writable
# spot is a per-invocation throwaway isolated HOME (+ private /dev, /dev/shm,
# tmpfs). agy can thus read the full repo + git history (native `git diff
# <range>` / `git log`) yet cannot write the repo or anywhere else on the FS.
# There is NO staging dir / worktree / stash / archive / dirty-check canary
# (removed in V3 — bwrap ro-bind subsumes them).
#
# Permission allow-list in the isolated HOME settings.json is NOT a security
# boundary (permission mode demonstrably leaks writes); it only suppresses the
# headless trust-prompt / tool-approval hang. The boundary is bwrap.
#
# stdout contract: must be empty (final flows to $3 via agy --print redirected
# to $final_out). agy's own progress lines go to stderr; this adapter does not
# print to stdout.

set -uo pipefail

prompt_file="${1:?Usage: agy.sh <prompt-file> <model> <final-out-file>}"
model="${2:?Usage: agy.sh <prompt-file> <model> <final-out-file>}"
final_out="${3:?Usage: agy.sh <prompt-file> <model> <final-out-file>}"

# --- model / effort split (agy 1.1+) -----------------------------------------
# agy 1.1 split reasoning effort out of the model id: `--model` now takes the
# base id only and refuses the old combined form (`gemini-3.1-pro-high` →
# "no longer available"; `gemini-3.1-pro` alone → "requires --effort"). `agy
# models` still prints the stale combined names, so both source (base) and old
# deployed (`-high`) configs reach here. Strip a trailing effort suffix if
# present and always run high-effort review — xreview wants the strongest pass.
review_effort="high"
case "$model" in
  *-low|*-medium|*-high) model="${model%-*}" ;;
esac

if [[ ! -f "$prompt_file" ]]; then
  echo "XREVIEW_ERROR: prompt file not found: $prompt_file" >&2
  exit 1
fi

cli_path="$(command -v agy 2>/dev/null)" || true
if [[ -z "$cli_path" ]]; then
  echo "XREVIEW_ERROR: cli not found: agy (install it first)" >&2
  exit 1
fi

# bwrap is the ONLY write boundary. Fail-closed if absent: NEVER fall back to
# running agy unconfined (AC12).
if ! command -v bwrap >/dev/null 2>&1; then
  echo "XREVIEW_ERROR: agy requires bwrap (bubblewrap) for write confinement; not found" >&2
  exit 1
fi

: > "$final_out"

# --- REPO_DIR derivation (no staging dir) ------------------------------------
# Inherit orchestrator cwd. Try the repo root, fall back to cwd. Both cwd and
# --add-dir point here; bwrap ro-bind makes it physically read-only.
REPO_DIR="$(git -C "$(pwd -P)" rev-parse --show-toplevel 2>/dev/null)" || REPO_DIR="$(pwd -P)"

# Fail-fast on overly broad paths: `/` and $HOME would hand far too much to agy
# as workspace + trust grant (AC8).
home_real=""
[[ -n "${HOME:-}" && -d "${HOME:-}" ]] && home_real="$(cd "$HOME" && pwd -P)"
if [[ "$REPO_DIR" == "/" || ( -n "$home_real" && "$REPO_DIR" == "$home_real" ) ]]; then
  echo "XREVIEW_ERROR: agy REPO_DIR refuses overly-broad path: $REPO_DIR" >&2
  exit 1
fi

# --- per-invocation isolated HOME (always built — finding #2) ----------------
# The isolated HOME is the ONLY writable HOME. When ~/.gemini exists we symlink
# auth/config in and rewrite settings.json (trust grant + allow-list); when it
# does not we build an empty isolated HOME. We NEVER rw-bind the real $HOME.
ISO_HOME=""
EFFECTIVE_PROMPT_FILE=""

BWRAP_STATUS_FILE=""

_agy_cleanup() {
  cd / 2>/dev/null || true
  [[ -n "$ISO_HOME" && -d "$ISO_HOME" ]] && rm -rf -- "$ISO_HOME"
  [[ -n "$EFFECTIVE_PROMPT_FILE" && -f "$EFFECTIVE_PROMPT_FILE" ]] && rm -f -- "$EFFECTIVE_PROMPT_FILE"
  [[ -n "$BWRAP_STATUS_FILE" && -f "$BWRAP_STATUS_FILE" ]] && rm -f -- "$BWRAP_STATUS_FILE"
}
trap _agy_cleanup EXIT INT TERM

ISO_HOME="$(mktemp -d "${TMPDIR:-/tmp}/xreview-agy-home-XXXXXX")"

real_gemini="$HOME/.gemini"
if [[ -d "$real_gemini" ]]; then
  # jq is required to rewrite settings.json; missing jq is fail-fast (AC16b).
  if ! command -v jq >/dev/null 2>&1; then
    echo "XREVIEW_ERROR: agy needs jq to rewrite isolated HOME settings.json; not found" >&2
    exit 1
  fi

  mkdir -p "$ISO_HOME/.gemini/antigravity-cli"

  # Symlink every top-level entry of the real ~/.gemini into the isolated HOME
  # except antigravity-cli (handled specially below). dotfiles included.
  for entry in "$real_gemini"/* "$real_gemini"/.[!.]*; do
    [[ -e "$entry" ]] || continue
    base="$(basename "$entry")"
    [[ "$base" == "antigravity-cli" ]] && continue
    ln -s "$entry" "$ISO_HOME/.gemini/$base" 2>/dev/null || true
  done

  real_ac="$real_gemini/antigravity-cli"
  if [[ -d "$real_ac" ]]; then
    # Under bwrap ro-bind, a symlink that points back into the read-only real
    # HOME would make agy's runtime writes fail. So: files -> symlink (read
    # only), real directories -> fresh writable empty dirs (agy runtime area).
    for entry in "$real_ac"/* "$real_ac"/.[!.]*; do
      [[ -e "$entry" ]] || continue
      base="$(basename "$entry")"
      [[ "$base" == "settings.json" ]] && continue
      if [[ -d "$entry" && ! -L "$entry" ]]; then
        mkdir -p "$ISO_HOME/.gemini/antigravity-cli/$base"
      else
        ln -s "$entry" "$ISO_HOME/.gemini/antigravity-cli/$base" 2>/dev/null || true
      fi
    done
  fi

  # Rewrite settings.json (NOT a symlink): keep real content, append $REPO_DIR
  # to trustedWorkspaces, set permissions to a pure allow-list. The allow-list
  # NEVER contains unsandboxed(*) (finding #6) and has no deny. Permission is
  # not a boundary — bwrap is; this only kills the headless approval hang.
  iso_settings="$ISO_HOME/.gemini/antigravity-cli/settings.json"
  real_settings="$real_ac/settings.json"
  allow_list='["read_file(*)","write_file(*)","command(*)","mcp(*)"]'
  if [[ -r "$real_settings" ]]; then
    jq --arg wt "$REPO_DIR" --argjson allow "$allow_list" \
      '.trustedWorkspaces = ((.trustedWorkspaces // []) + [$wt] | unique)
       | .permissions = {allow: $allow}' \
      "$real_settings" > "$iso_settings" 2>/dev/null \
      || jq -n --arg wt "$REPO_DIR" --argjson allow "$allow_list" \
        '{trustedWorkspaces: [$wt], permissions: {allow: $allow}}' > "$iso_settings"
  else
    jq -n --arg wt "$REPO_DIR" --argjson allow "$allow_list" \
      '{trustedWorkspaces: [$wt], permissions: {allow: $allow}}' > "$iso_settings"
  fi
fi

run_home="$ISO_HOME"

# --- ddd-reviewer role prepend (frontmatter stripped) ------------------------
# agy reads its agent file as plain markdown and does NOT treat it as a
# subagent, so we prepend the role body to the prompt. Lookup order mirrors the
# gemini config layout. Use awk to strip the YAML frontmatter (do NOT reuse
# codex's toml extractor). Missing/empty file degrades: warn + forward prompt
# as-is, exit code still passthrough (AC18).
#
xdg_cfg="${XDG_CONFIG_HOME:-$HOME/.config}"
agent_candidates=(
  "$xdg_cfg/gemini/agents/ddd-reviewer.md"
  "$HOME/.gemini/agents/ddd-reviewer.md"
)
agent_md=""
for candidate in "${agent_candidates[@]}"; do
  if [[ -r "$candidate" ]]; then
    agent_md="$candidate"
    break
  fi
done

strip_frontmatter() {
  # Drop a leading YAML frontmatter block delimited by `---` lines, print body.
  awk '
    BEGIN { in_fm = 0; seen = 0 }
    NR == 1 && $0 == "---" { in_fm = 1; next }
    in_fm && $0 == "---" { in_fm = 0; seen = 1; next }
    in_fm { next }
    { print }
  ' "$1"
}

role_body=""
if [[ -n "$agent_md" ]]; then
  role_body="$(strip_frontmatter "$agent_md")"
fi

effective_prompt=""
if [[ -n "$role_body" ]]; then
  effective_prompt="$(printf '%s\n\n---\n\n%s' "$role_body" "$(cat "$prompt_file")")"
else
  echo "XREVIEW_WARN: agy ddd-reviewer.md not found or empty (searched: ${agent_candidates[*]}) — review proceeds with original prompt" >&2
  effective_prompt="$(cat "$prompt_file")"
fi

# --- run agy under bwrap, cwd = REAL repo (read-only via --ro-bind / /) ------
# bwrap args verbatim per spec §3. No agy --sandbox, no
# --dangerously-skip-permissions. stdin from /dev/null gives the command-tool
# an immediate EOF (avoids hang).
#
# --print-timeout 60m: agy's --print mode defaults to a 5m wait timeout and
# kills an in-progress review with "Error: timeout waiting for response" (exit
# 1) — a deep DDD review routinely exceeds 5m. We set it ABOVE the orchestrator's
# per-reviewer hard timeout (XREVIEW_TIMEOUT_SEC, default 3000s = 50m) so agy
# never fires first and the orchestrator's `timeout --foreground` stays the
# single effective ceiling (ADR-6: timeout is enforced at the orchestrator
# layer, not inside adapters).
#
# --json-status-fd (finding #8): bwrap writes an `{"exit-code": N}` line ONLY
# when it successfully created the namespace and the child (agy) ran. If bwrap
# fails to set up the sandbox it never exec's agy and that line is absent. This
# lets us tell a wrapper failure apart from an agy review failure even though
# both surface as a non-zero rc.
BWRAP_STATUS_FILE="$(mktemp "${TMPDIR:-/tmp}/xreview-agy-status-XXXXXX")"
bwrap \
  --ro-bind / / \
  --dev /dev \
  --tmpfs /dev/shm \
  --proc /proc \
  --unshare-pid \
  --new-session \
  --die-with-parent \
  --bind "$run_home" "$run_home" \
  --clearenv \
  --setenv PATH "$PATH" \
  --setenv HOME "$run_home" \
  --setenv TMPDIR "$run_home" \
  --setenv TERM "${TERM:-xterm}" \
  --chdir "$REPO_DIR" \
  --json-status-fd 3 \
  "$cli_path" \
    --add-dir "$REPO_DIR" \
    --model "$model" \
    --effort "$review_effort" \
    --print-timeout 60m \
    --print "$effective_prompt" \
  < /dev/null \
  > "$final_out" \
  3> "$BWRAP_STATUS_FILE"
rc=$?

if [[ $rc -ne 0 ]]; then
  # Always echo the raw bwrap status line: a shape none of the branches below
  # recognise stays diagnosable from the log instead of being guessed at.
  bwrap_status_raw="$(tr -d '\n' < "$BWRAP_STATUS_FILE" 2>/dev/null)"
  echo "XREVIEW_INFO: agy bwrap json-status raw: ${bwrap_status_raw:-<empty>}" >&2

  if grep -q '"exit-code"' "$BWRAP_STATUS_FILE" 2>/dev/null; then
    # bwrap created the sandbox and agy ran: rc is agy's review failure.
    echo "XREVIEW_ERROR: agy exited with code $rc (model: $model)" >&2
  elif (( rc > 128 )); then
    # Signal death (orchestrator timeout, user interrupt, OOM kill) reaches
    # bwrap before it can write the exit-code line. The line is missing for the
    # same reason as a setup failure, so rc>128 must be disambiguated FIRST —
    # otherwise every external kill is misreported as a sandbox failure.
    sig=$((rc - 128))
    sig_name="$(kill -l "$sig" 2>/dev/null)" || sig_name=""
    echo "XREVIEW_ERROR: agy terminated by signal $sig${sig_name:+ (SIG$sig_name)} before bwrap reported status; external kill or timeout, not a sandbox setup failure and not an agy review failure (model: $model)" >&2
  else
    # bwrap never exec'd agy: the sandbox setup itself failed.
    echo "XREVIEW_ERROR: agy bwrap sandbox setup failed (rc=$rc); this is a wrapper failure, not an agy review failure (model: $model)" >&2
  fi
fi

exit "$rc"
