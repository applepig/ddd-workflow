#!/bin/bash
set -euo pipefail

# AGENTS - Cross-agent CLI installer
# Symlinks AGENTS.md and skills to Claude Code, Gemini CLI, and Codex CLI

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_MD="${SCRIPT_DIR}/AGENTS.md"
SOURCE_SKILLS="${SCRIPT_DIR}/src/skills"

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
    # rm 再 ln，避免 ln -sf 對目錄 symlink 會建在目標裡面的坑
    rm "$target"
    ln -s "$source" "$target"
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

# 清理目標 skills 目錄中的舊 ddd* 項目，再重新建立個別 symlink
link_skills() {
  local source_dir="$1"
  local target_dir="$2"

  # 確保目標 skills 目錄存在（實體目錄，非 symlink）
  if [[ -L "$target_dir" ]]; then
    log "  移除舊 skills symlink: $target_dir"
    rm "$target_dir"
  fi
  mkdir -p "$target_dir"

  # 清理目標中所有舊的 ddd* 項目（不論 ddd- 或 ddd.）
  for old in "$target_dir"/ddd*; do
    [[ -e "$old" || -L "$old" ]] || continue
    log "  移除: $(basename "$old")"
    rm -rf "$old"
  done

  # 為每個 skill 建立 symlink
  for skill_dir in "$source_dir"/*/; do
    [[ -d "$skill_dir" ]] || continue
    skill_name="$(basename "$skill_dir")"
    ln -s "$skill_dir" "$target_dir/$skill_name"
    log "  連結 skill: $skill_name"
  done
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

  # Link skills（個別 symlink，先清理舊的 ddd*）
  link_skills "$SOURCE_SKILLS" "${dir}/${skills_dir}"

  echo ""
done

log "安裝完成。請重啟各 agent CLI 以載入新設定。"
