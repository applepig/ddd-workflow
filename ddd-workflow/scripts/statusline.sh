#!/usr/bin/env bash
set -euo pipefail

# statusline.sh — Claude Code custom status line
#
# 從 stdin 讀取 StatusJSON，輸出 ANSI 格式化的三行文字到 stdout。
# 依賴：jq, git
#
# 三行布局：
#   Line 1: Model: {短名}     | Context: {bar} {pct}%
#   Line 2: Reset: {timer}    | Session: {bar} {pct}%
#   Line 3: Dir: {目錄名}     | branch: {分支名} (+ins, -del)

# ─── 常數 ────────────────────────────────────────────────────────────────────

BAR_WIDTH=25
SAFE_CONTEXT=250000
FILL_CHAR=$'\xe2\x96\x88'   # █ (U+2588)
EMPTY_CHAR=$'\xe2\x96\x91'  # ░ (U+2591)
NBSP=$'\xc2\xa0'             # non-breaking space (U+00A0)
LEFT_COL_WIDTH=20

# ANSI 色彩
RST=$'\x1b[0m'
DIM=$'\x1b[2m'
WHITE=$'\x1b[1;37m'
GREEN=$'\x1b[32m'
YELLOW=$'\x1b[33m'
RED=$'\x1b[31m'
CYAN=$'\x1b[36m'

# ─── 讀取 JSON ───────────────────────────────────────────────────────────────

json=$(cat)

# 用 jq 一次解析所有需要的欄位
eval "$(echo "$json" | jq -r '
  def safe_num: if . == null then 0 else . end;
  def safe_str: if . == null then "" else tostring end;
  {
    model_id: (if .model | type == "object" then (.model.id // "") else (.model // "") end),
    cwd: (.cwd // ""),
    project_dir: (.workspace.project_dir // .cwd // ""),
    ctx_tokens: (
      if .context_window.current_usage != null then
        if .context_window.current_usage | type == "object" then
          ((.context_window.current_usage.input_tokens // 0) +
           (.context_window.current_usage.cache_creation_input_tokens // 0) +
           (.context_window.current_usage.cache_read_input_tokens // 0))
        else
          (.context_window.current_usage // 0)
        end
      else
        ((.context_window.total_input_tokens // 0) + (.context_window.total_output_tokens // 0))
      end
    ),
    used_pct: (.rate_limits.five_hour.used_percentage | safe_num),
    resets_at: (.rate_limits.five_hour.resets_at | safe_num)
  } | to_entries | map("json_\(.key)=\(.value | @sh)") | .[]
' 2>/dev/null)" || {
  # JSON 解析失敗時的 fallback
  json_model_id=""
  json_cwd=""
  json_project_dir=""
  json_ctx_tokens=0
  json_used_pct=0
  json_resets_at=0
}

# ─── Helper Functions ─────────────────────────────────────────────────────────

# 將 model id 轉成短名
# claude-opus-4-6[1m] → Opus 4.6
# claude-sonnet-4-6 → Sonnet 4.6
# claude-haiku-4-5-20251001 → Haiku 4.5
formatModel() {
  local raw="$1"
  # 去掉 [1m] 等後綴
  raw="${raw%%\[*}"

  # 嘗試匹配 claude-<family>-<major>-<minor> 模式
  if [[ "$raw" =~ ^claude-([a-z]+)-([0-9]+)-([0-9]+) ]]; then
    local family="${BASH_REMATCH[1]}"
    local major="${BASH_REMATCH[2]}"
    local minor="${BASH_REMATCH[3]}"
    # 首字母大寫
    family="$(echo "${family:0:1}" | tr '[:lower:]' '[:upper:]')${family:1}"
    echo "${family} ${major}.${minor}"
  else
    # 無法辨識，直接回傳
    echo "$raw"
  fi
}

# 產生 progress bar
# 用法: makeBar <filled_count> <total_width> <fill_color>
makeBar() {
  local filled=$1
  local width=$2
  local color="$3"

  # clamp
  (( filled > width )) && filled=$width
  (( filled < 0 )) && filled=0

  local empty=$(( width - filled ))
  local bar=""

  if (( filled > 0 )); then
    bar+="${color}"
    for (( i=0; i<filled; i++ )); do bar+="${FILL_CHAR}"; done
    bar+="${RST}"
  fi

  if (( empty > 0 )); then
    bar+="${DIM}"
    for (( i=0; i<empty; i++ )); do bar+="${EMPTY_CHAR}"; done
    bar+="${RST}"
  fi

  echo -n "$bar"
}

# 將空格替換為 non-breaking space
nbspify() {
  echo -n "${1// /${NBSP}}"
}

# 格式化 label-value 字串：label 用預設色、value 用亮白，pad 到指定寬度
# 用法: formatLabelValue <label> <value> <width>
formatLabelValue() {
  local label="$1"
  local value="$2"
  local width="$3"
  local plain="${label} ${value}"
  local pad_needed=$(( width - ${#plain} ))
  (( pad_needed < 0 )) && pad_needed=0
  local padding=""
  for (( i=0; i<pad_needed; i++ )); do padding+=" "; done
  local result="${label} ${WHITE}${value}${RST}${padding}"
  nbspify "$result"
}

# ─── Line 1: Model + Context Usage Bar ───────────────────────────────────────

model_short=$(formatModel "$json_model_id")

# Context bar：基於 SAFE_CONTEXT (250k) 計算百分比，25 格 = 100%
ctx_pct=$(( json_ctx_tokens * 100 / SAFE_CONTEXT ))
(( ctx_pct > 100 )) && ctx_pct=100
ctx_filled=$(( ctx_pct / 4 ))
(( ctx_filled > BAR_WIDTH )) && ctx_filled=$BAR_WIDTH

# 色彩規則：0-60% 綠、60-80% 橘、80%+ 紅
if (( ctx_pct >= 80 )); then
  ctx_color="$RED"
elif (( ctx_pct >= 60 )); then
  ctx_color="$YELLOW"
else
  ctx_color="$GREEN"
fi

# 左欄
line1_left=$(formatLabelValue "Model:" "$model_short" "$LEFT_COL_WIDTH")

# 右欄
line1_bar=$(makeBar "$ctx_filled" "$BAR_WIDTH" "$ctx_color")
line1_right_label="$(nbspify "Context:")${NBSP}"
line1_right_suffix="${NBSP}${WHITE}$(nbspify "${ctx_pct}%")${RST}"

# ─── Line 2: Block Reset Timer + Session Usage Bar ───────────────────────────

now=$(date +%s)
if (( json_resets_at > 0 && json_resets_at > now )); then
  remaining=$(( json_resets_at - now ))
  hours=$(( remaining / 3600 ))
  minutes=$(( (remaining % 3600) / 60 ))
  # 用普通空格，nbspify 會在 pad 後統一轉換
  timer_str="${hours}h ${minutes}m"
else
  timer_str="--:--"
fi

# Session bar
session_filled=$(( json_used_pct / 4 ))
(( session_filled > BAR_WIDTH )) && session_filled=$BAR_WIDTH

# Session bar 色彩規則：0-79% 藍、80-89% 橘、90%+ 紅
if (( json_used_pct >= 90 )); then
  session_color="$RED"
elif (( json_used_pct >= 80 )); then
  session_color="$YELLOW"
else
  session_color="$CYAN"
fi

# 左欄
line2_left=$(formatLabelValue "Reset:" "$timer_str" "$LEFT_COL_WIDTH")

# 右欄
line2_bar=$(makeBar "$session_filled" "$BAR_WIDTH" "$session_color")
line2_right_label="$(nbspify "Session:")${NBSP}"
line2_right_suffix="${NBSP}${WHITE}$(nbspify "${json_used_pct}%")${RST}"

# ─── Line 3: Working Dir + Git Branch + Diff Lines ───────────────────────────

cwd="$json_project_dir"
dir_name="${cwd##*/}"
[[ -z "$dir_name" ]] && dir_name="~"

git_branch=""
git_diff_str=""

if [[ -n "$json_project_dir" ]] && [[ -d "$json_project_dir" ]]; then
  git_branch=$(git -C "$json_project_dir" branch --show-current 2>/dev/null || true)

  shortstat=$(git -C "$json_project_dir" diff --shortstat 2>/dev/null || true)
  insertions=0
  deletions=0
  if [[ "$shortstat" =~ ([0-9]+)\ insertion ]]; then
    insertions="${BASH_REMATCH[1]}"
  fi
  if [[ "$shortstat" =~ ([0-9]+)\ deletion ]]; then
    deletions="${BASH_REMATCH[1]}"
  fi

  if (( insertions > 0 || deletions > 0 )); then
    git_diff_str="${NBSP}(${GREEN}+${insertions}${RST},${NBSP}${RED}-${deletions}${RST})"
  fi
fi

# 左欄
line3_left=$(formatLabelValue "Dir:" "$dir_name" "$LEFT_COL_WIDTH")

# 右欄
line3_right=""
if [[ -n "$git_branch" ]]; then
  line3_right="branch:${NBSP}${WHITE}${git_branch}${RST}${git_diff_str}"
fi

# ─── 輸出 ────────────────────────────────────────────────────────────────────

SEP="${NBSP}|${NBSP}"

# 開頭 reset 覆蓋 Claude Code 的 dim
output="${RST}${line1_left}${SEP}${line1_right_label}${line1_bar}${line1_right_suffix}"
output+=$'\n'
output+="${RST}${line2_left}${SEP}${line2_right_label}${line2_bar}${line2_right_suffix}"
output+=$'\n'
output+="${RST}${line3_left}${SEP}${line3_right}"

echo -n "$output"
