#!/usr/bin/env bash

# statusline.sh — Claude Code custom status line
#
# 從 stdin 讀取 StatusJSON，輸出 ANSI 格式化的三行文字到 stdout。
# 依賴：jq, git, curl（OAuth Usage API）
#
# 三行布局：
#   Line 1: Model: {短名}     | Context: {bar} {pct}%
#   Line 2: Reset: {timer}    | Session: {bar} {pct}%
#   Line 3: Dir: {目錄名}     | branch: {分支名} (+ins, -del)

# ─── 錯誤處理 ────────────────────────────────────────────────────────────────
ERR_LOG="/tmp/statusline-err.log"
trap '_statusline_err $LINENO "$BASH_COMMAND"' ERR
_statusline_err() {
  local line="$1" cmd="$2"
  echo "[statusline ERR] line:${line} cmd: ${cmd}" | tee -a "$ERR_LOG"
  exit 1
}
set -o pipefail

# ─── Parent Process TTY Detection ────────────────────────────────────────────

# 向上走 process tree，找到有 TTY 的祖先，用 stty size 讀取實際寬度
# 回傳: 偵測到的 columns 數，或空字串（偵測失敗）
_detect_term_cols() {
  local pid=$$
  local i
  for i in $(seq 1 10); do
    local ppid tty_dev
    ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ') || break
    tty_dev=$(ps -o tty= -p "$ppid" 2>/dev/null | tr -d ' ') || break
    if [[ "$tty_dev" != "?" && "$tty_dev" != "??" && -n "$tty_dev" ]]; then
      local cols
      cols=$(stty size < "/dev/$tty_dev" 2>/dev/null | awk '{print $2}')
      if [[ -n "$cols" && "$cols" -gt 0 ]] 2>/dev/null; then
        echo "$cols"
        return 0
      fi
    fi
    pid="$ppid"
    [[ "$ppid" == "1" || "$ppid" == "0" || -z "$ppid" ]] && break
  done
  echo ""
}

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

# OAuth Usage API
USAGE_API_URL="https://api.anthropic.com/api/oauth/usage"
CACHE_MAX_AGE=60
CACHE_STALE_MAX_AGE=300  # fallback 到舊快取的最大容忍秒數
# 允許測試覆蓋快取路徑和 credentials 路徑
: "${STATUSLINE_CACHE_FILE:=/tmp/claude/statusline-usage-cache.json}"
: "${STATUSLINE_CREDENTIALS_FILE:=${HOME}/.claude/.credentials.json}"

# ─── OAuth + API Functions ───────────────────────────────────────────────────

# 依優先序讀取 OAuth token：
#   1. 環境變數 $CLAUDE_CODE_OAUTH_TOKEN
#   2. ~/.claude/.credentials.json → .claudeAiOauth.accessToken
# 找不到時回傳空字串
getOAuthToken() {
  # 1. 環境變數
  if [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
    echo "$CLAUDE_CODE_OAUTH_TOKEN"
    return 0
  fi

  # 2. Credentials 檔案
  if [[ -f "$STATUSLINE_CREDENTIALS_FILE" ]]; then
    local token
    token=$(jq -r '.claudeAiOauth.accessToken // empty' "$STATUSLINE_CREDENTIALS_FILE" 2>/dev/null) || true
    if [[ -n "$token" ]]; then
      echo "$token"
      return 0
    fi
  fi

  # 找不到 token
  echo ""
}

# 呼叫 Usage API，帶快取 + throttle 防止多 session 同時打 API
# 用 throttle 檔的 mtime 記錄上次 API 請求時間，CACHE_MAX_AGE 內不重複請求
# 用法: fetchUsageAPI <oauth_token>
# 回傳: JSON response 或空字串
fetchUsageAPI() {
  local token="$1"

  # 無 token 時不呼叫 API
  if [[ -z "$token" ]]; then
    echo ""
    return 0
  fi

  local cache_file="$STATUSLINE_CACHE_FILE"
  local cache_dir throttle_file
  cache_dir="$(dirname "$cache_file")"
  throttle_file="${cache_dir}/statusline-usage.throttle"

  # 快取命中：cache 檔 mtime 在 CACHE_MAX_AGE 內
  if [[ -f "$cache_file" ]]; then
    local file_mtime now age
    file_mtime=$(stat -c %Y "$cache_file" 2>/dev/null) || file_mtime=0
    now=$(date +%s)
    age=$(( now - file_mtime ))
    if (( age < CACHE_MAX_AGE )); then
      cat "$cache_file"
      return 0
    fi
  fi

  # 快取過期——檢查 throttle：若其他 session 近期已請求過，用舊快取
  mkdir -p "$cache_dir"
  if [[ -f "$throttle_file" ]]; then
    local throttle_mtime now throttle_age
    throttle_mtime=$(stat -c %Y "$throttle_file" 2>/dev/null) || throttle_mtime=0
    now=$(date +%s)
    throttle_age=$(( now - throttle_mtime ))
    if (( throttle_age < CACHE_MAX_AGE )); then
      # 有人最近打過了但 cache 沒更新（API 可能失敗），用舊快取
      if [[ -f "$cache_file" ]]; then
        cat "$cache_file"
        return 0
      fi
      echo ""
      return 0
    fi
  fi

  # 標記：我要打 API 了
  touch "$throttle_file"

  # 呼叫 API
  local response curl_exit
  response=$(curl --silent --max-time 5 \
    -H "Authorization: Bearer ${token}" \
    -H "anthropic-beta: oauth-2025-04-20" \
    "$USAGE_API_URL" 2>/dev/null) && curl_exit=0 || curl_exit=$?

  if [[ $curl_exit -eq 0 ]] && [[ -n "$response" ]]; then
    if echo "$response" | jq -e '.five_hour' > /dev/null 2>&1; then
      echo "$response" > "$cache_file"
      echo "$response"
      return 0
    fi
  fi

  # API 失敗：fallback 到舊快取（不超過 CACHE_STALE_MAX_AGE）
  if [[ -f "$cache_file" ]]; then
    local stale_mtime stale_age
    stale_mtime=$(stat -c %Y "$cache_file" 2>/dev/null) || stale_mtime=0
    stale_age=$(( $(date +%s) - stale_mtime ))
    if (( stale_age < CACHE_STALE_MAX_AGE )); then
      cat "$cache_file"
      return 0
    fi
  fi

  # 完全沒有資料
  echo ""
}

# 解析 Usage API response 為 shell 變數（用 eval 接收）
# 用法: eval "$(parseUsageResponse "$json")"
# 產出變數: api_five_hour_util, api_five_hour_resets_at, api_seven_day_util,
#           api_seven_day_resets_at, api_extra_enabled, api_extra_util,
#           api_extra_used_credits, api_extra_monthly_limit
parseUsageResponse() {
  local input="$1"

  if [[ -z "$input" ]]; then
    cat <<'DEFAULTS'
api_five_hour_util=0
api_five_hour_resets_at=""
api_seven_day_util=0
api_seven_day_resets_at=""
api_extra_enabled=false
api_extra_util=0
api_extra_used_credits=0
api_extra_monthly_limit=0
DEFAULTS
    return 0
  fi

  echo "$input" | jq -r '
    def safe_num: if . == null then 0 else . end;
    def safe_str: if . == null then "" else tostring end;
    def safe_bool: if . == true then "true" else "false" end;
    [
      "api_five_hour_util=\(.five_hour.utilization | safe_num)",
      "api_five_hour_resets_at=\(.five_hour.resets_at | safe_str)",
      "api_seven_day_util=\(.seven_day.utilization | safe_num)",
      "api_seven_day_resets_at=\(.seven_day.resets_at | safe_str)",
      "api_extra_enabled=\(.extra_usage.is_enabled | safe_bool)",
      "api_extra_util=\(.extra_usage.utilization | safe_num)",
      "api_extra_used_credits=\(.extra_usage.used_credits | safe_num)",
      "api_extra_monthly_limit=\(.extra_usage.monthly_limit | safe_num)"
    ] | .[]
  ' 2>/dev/null || {
    # jq 解析失敗時的 fallback
    cat <<'DEFAULTS'
api_five_hour_util=0
api_five_hour_resets_at=""
api_seven_day_util=0
api_seven_day_resets_at=""
api_extra_enabled=false
api_extra_util=0
api_extra_used_credits=0
api_extra_monthly_limit=0
DEFAULTS
  }
}

# ─── 共用 Helper Functions（測試模式也需要） ─────────────────────────────────

# 色彩判斷：0-60% 綠、60-80% 橘、80%+ 紅
# 用法: colorByPct <percentage>
# 回傳: ANSI 色彩碼
colorByPct() {
  local pct=$1
  if (( pct >= 80 )); then
    echo "$RED"
  elif (( pct >= 60 )); then
    echo "$YELLOW"
  else
    echo "$GREEN"
  fi
}

# ─── 測試模式：只載入函式，不執行主流程 ─────────────────────────────────────
if [[ "${STATUSLINE_TEST_MODE:-}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

# ─── OAuth Usage API 呼叫 ────────────────────────────────────────────────────

oauth_token=$(getOAuthToken)
usage_response=$(fetchUsageAPI "$oauth_token")
eval "$(parseUsageResponse "$usage_response")"

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
    used_pct: (.rate_limits.five_hour.used_percentage | safe_num | round),
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

# ─── API 資料覆蓋 StatusJSON ──────────────────────────────────────────────────
# 若 API 有資料，用 API 的 five_hour 資料覆蓋 StatusJSON 的 rate_limits
if [[ -n "$api_five_hour_resets_at" ]]; then
  # API utilization 覆蓋 StatusJSON used_percentage
  json_used_pct="$api_five_hour_util"
  # ISO 8601 → Unix timestamp
  json_resets_at=$(date -d "$api_five_hour_resets_at" +%s 2>/dev/null) || json_resets_at=0
fi

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
ctx_color=$(colorByPct "$ctx_pct")

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
  line3_right="Branch:${NBSP}${WHITE}${git_branch}${RST}${git_diff_str}"
fi

# ─── 輸出 ────────────────────────────────────────────────────────────────────

SEP="${NBSP}|${NBSP}"

# Fallback chain: Parent TTY detection → $STATUSLINE_TERM_COLS → tput cols → 80
term_cols=$(_detect_term_cols)
: "${term_cols:=${STATUSLINE_TERM_COLS:-}}"
: "${term_cols:=$(tput cols 2>/dev/null)}"
: "${term_cols:=80}"

if (( term_cols < 100 )); then
  # ─── Compact 模式：單行輸出 ──────────────────────────────────────────────
  # 格式: Opus 4.6 | Context 8% | Usage 84% | Reset 10m
  compact_sep=" | "

  # CTX 色彩：0-60% 綠、60-80% 橘、80%+ 紅
  compact_ctx_color=$(colorByPct "$ctx_pct")

  # USG 色彩：對齊完整版 Session bar（0-79% 藍、80-89% 橘、90%+ 紅）
  if (( json_used_pct >= 90 )); then
    compact_usg_color="$RED"
  elif (( json_used_pct >= 80 )); then
    compact_usg_color="$YELLOW"
  else
    compact_usg_color="$CYAN"
  fi

  # RES：只顯示最精簡的倒數（不上色）
  if (( json_resets_at > 0 && json_resets_at > now )); then
    compact_remaining=$(( json_resets_at - now ))
    compact_hours=$(( compact_remaining / 3600 ))
    compact_minutes=$(( (compact_remaining % 3600) / 60 ))
    if (( compact_hours > 0 )); then
      compact_res="${compact_hours}h${compact_minutes}m"
    else
      compact_res="${compact_minutes}m"
    fi
  else
    compact_res="--:--"
  fi

  output="${RST}${model_short}"
  output+="${compact_sep}Context ${compact_ctx_color}${ctx_pct}%${RST}"
  output+="${compact_sep}Usage ${compact_usg_color}${json_used_pct}%${RST}"
  output+="${compact_sep}Reset ${compact_res}"

  echo -n "$output"
else
  # ─── 完整模式：三行輸出 ──────────────────────────────────────────────────
  # 開頭 reset 覆蓋 Claude Code 的 dim
  output="${RST}${line1_left}${SEP}${line1_right_label}${line1_bar}${line1_right_suffix}"
  output+=$'\n'
  output+="${RST}${line2_left}${SEP}${line2_right_label}${line2_bar}${line2_right_suffix}"
  output+=$'\n'
  output+="${RST}${line3_left}${SEP}${line3_right}"

  echo -n "$output"
fi
