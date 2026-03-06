#!/bin/bash
set -euo pipefail

# AGENTS - Cross-agent CLI installer
# Symlinks AGENTS.md and skills to Claude Code, Gemini CLI, and Codex CLI

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_MD="${SCRIPT_DIR}/AGENTS.md"
SOURCE_SKILLS="${SCRIPT_DIR}/skills"

# Target configurations: directory, instructions filename, skills directory
declare -A TARGETS=(
  [claude]="${HOME}/.claude|CLAUDE.md|skills"
  [gemini]="${HOME}/.gemini|GEMINI.md|skills"
  [codex]="${HOME}/.codex|AGENTS.md|skills"
)

log() { echo "[AGENTS] $1"; }
warn() { echo "[AGENTS] WARN: $1" >&2; }

link_file() {
  local source="$1"
  local target="$2"

  if [[ -L "$target" ]]; then
    local current
    current="$(readlink -f "$target")"
    if [[ "$current" == "$(readlink -f "$source")" ]]; then
      log "  已連結: $target"
      return 0
    fi
    log "  更新連結: $target"
    ln -sf "$source" "$target"
  elif [[ -e "$target" ]]; then
    local backup="${target}.backup.$(date +%Y%m%d%H%M%S)"
    warn "備份現有檔案: $target → $backup"
    mv "$target" "$backup"
    ln -s "$source" "$target"
  else
    ln -s "$source" "$target"
  fi
  log "  連結完成: $target → $source"
}

# Preflight check
if [[ ! -f "$SOURCE_MD" ]]; then
  echo "ERROR: 找不到 ${SOURCE_MD}" >&2
  exit 1
fi

if [[ ! -d "$SOURCE_SKILLS" ]]; then
  echo "ERROR: 找不到 ${SOURCE_SKILLS}" >&2
  exit 1
fi

log "來源: ${SCRIPT_DIR}"
echo ""

for agent in claude gemini codex; do
  IFS='|' read -r dir md_name skills_dir <<< "${TARGETS[$agent]}"

  log "=== ${agent} ==="

  # Create config directory if needed
  if [[ ! -d "$dir" ]]; then
    mkdir -p "$dir"
    log "  建立目錄: $dir"
  fi

  # Link instructions file
  link_file "$SOURCE_MD" "${dir}/${md_name}"

  # Link skills directory
  link_file "$SOURCE_SKILLS" "${dir}/${skills_dir}"

  echo ""
done

log "安裝完成。請重啟各 agent CLI 以載入新設定。"
