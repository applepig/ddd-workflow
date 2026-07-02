#!/usr/bin/env bash

# statusline.sh — Claude Code custom status line
#
# 從 stdin 讀取 StatusJSON，輸出 ANSI 格式化的多行文字到 stdout。
# 依賴：jq, git, curl（OAuth Usage API）
#
# 布局（git repo 內 5 行，否則 4 行）：
#   Line 1: Model: {短名} {effort level} | Dir: {目錄名}
#   Line 2: Context {bar} {pct}% | {tokens}
#   Line 3: Session {bar} {pct}% | {5h 倒數}
#   Line 4: Weekly  {bar} {pct}% | {7d 重置時刻}
#   Line 5: Branch: {分支名} (+ins, -del)   （僅在 git repo 內顯示）

# ─── 錯誤處理 ────────────────────────────────────────────────────────────────
ERR_LOG="/tmp/statusline-err.log"
trap '_statusline_err $LINENO "$BASH_COMMAND"' ERR
_statusline_err() {
  local line="$1" cmd="$2"
  echo "[statusline ERR] line:${line} cmd: ${cmd}" | tee -a "$ERR_LOG"
  exit 1
}
set -o pipefail

# ─── 常數 ────────────────────────────────────────────────────────────────────

BAR_WIDTH=25
CONTEXT_CAP=250000
FILL_CHAR=$'\xe2\x96\x88'   # █ (U+2588)
EMPTY_CHAR=$'\xe2\x96\x91'  # ░ (U+2591)
NBSP=$'\xc2\xa0'             # non-breaking space (U+00A0)

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
: "${STATUSLINE_INVOCATION_LOG:=/tmp/claude/statusline-invocations.log}"
if [[ -z "${STATUSLINE_INPUT_LOG+x}" ]]; then
  STATUSLINE_INPUT_LOG="/tmp/claude/statusline-input.jsonl"
fi
STATUSLINE_CACHE_DIR="$(dirname "$STATUSLINE_CACHE_FILE")"
: "${STATUSLINE_REFRESHER_PID_FILE:=${STATUSLINE_CACHE_DIR}/statusline-usage-refresher.pid}"
: "${STATUSLINE_REFRESHER_LOCK_DIR:=${STATUSLINE_CACHE_DIR}/statusline-usage-refresher.lock}"
: "${STATUSLINE_REFRESHER_INTERVAL:=60}"
: "${STATUSLINE_REFRESHER_LOCK_STALE_MAX_AGE:=120}"

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

isUsageResponseValid() {
  local input="$1"

  if [[ -z "$input" ]]; then
    return 1
  fi

  echo "$input" | jq -e '
    def pct_ok: type == "number" and . >= 0 and . <= 100;
    def reset_ok: . == null or type == "string" or type == "number";
    def window_ok: type == "object" and (.utilization | pct_ok) and (.resets_at | reset_ok);
    (.five_hour | window_ok) and
    ((.seven_day == null) or (.seven_day | window_ok)) and
    ((.extra_usage == null) or (.extra_usage | type == "object"))
  ' > /dev/null 2>&1
}

readUsableUsageCache() {
  local max_age="$1"
  local cache_file="$STATUSLINE_CACHE_FILE"

  if [[ ! -f "$cache_file" ]]; then
    return 1
  fi

  local cache_mtime cache_age cache_payload
  cache_mtime=$(stat -c %Y "$cache_file" 2>/dev/null) || cache_mtime=0
  cache_age=$(( $(date +%s) - cache_mtime ))
  if (( cache_age >= max_age )); then
    return 1
  fi

  cache_payload=$(<"$cache_file") || return 1
  if ! isUsageResponseValid "$cache_payload"; then
    return 1
  fi

  echo "$cache_payload"
}

# 呼叫 Usage API，live-first；只有打不到 API 或 throttle 併發保護時才 fallback cache
# 用 throttle 檔的 mtime 記錄上次 API 請求時間，CACHE_MAX_AGE 內避免多 session 重複請求
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

  # 檢查 throttle：若其他 session 近期已請求過，用可用快取，避免併發打爆 API。
  mkdir -p "$cache_dir"
  if [[ -f "$throttle_file" ]]; then
    local throttle_mtime now throttle_age
    throttle_mtime=$(stat -c %Y "$throttle_file" 2>/dev/null) || throttle_mtime=0
    now=$(date +%s)
    throttle_age=$(( now - throttle_mtime ))
    if (( throttle_age < CACHE_MAX_AGE )); then
      local throttled_cache
      if throttled_cache=$(readUsableUsageCache "$CACHE_STALE_MAX_AGE"); then
        echo "$throttled_cache"
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
    if isUsageResponseValid "$response"; then
      echo "$response" > "$cache_file"
      echo "$response"
      return 0
    fi
  fi

  # API 失敗：fallback 到時間與數字都合理的舊快取。
  local fallback_cache
  if fallback_cache=$(readUsableUsageCache "$CACHE_STALE_MAX_AGE"); then
    echo "$fallback_cache"
    return 0
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
      "api_five_hour_resets_at=\(.five_hour.resets_at | safe_str | @sh)",
      "api_seven_day_util=\(.seven_day.utilization | safe_num)",
      "api_seven_day_resets_at=\(.seven_day.resets_at | safe_str | @sh)",
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

# quota bar 色彩判斷（session / weekly 共用）：0-79% 藍、80-89% 橘、90%+ 紅
# 用法: quotaColor <percentage>
quotaColor() {
  local pct=$1
  if (( pct >= 90 )); then
    echo "$RED"
  elif (( pct >= 80 )); then
    echo "$YELLOW"
  else
    echo "$CYAN"
  fi
}

# 將 token 數縮寫：>=1000 顯示為 {n}k，否則原樣。
# 用法: formatTokens <tokens>
formatTokens() {
  local t=$1
  if (( t >= 1000 )); then
    echo "$(( t / 1000 ))k"
  else
    echo "$t"
  fi
}

# 將百分比正規化成 0-100 的整數，避免 API decimal 破壞 Bash arithmetic。
normalizePct() {
  local pct="$1"
  local normalized
  normalized=$(jq -n --arg pct "$pct" '($pct | tonumber? // 0 | round) | if . < 0 then 0 elif . > 100 then 100 else . end' 2>/dev/null) || normalized=0
  echo "$normalized"
}

# 依 bar 寬度等比例換算填滿格數，使用 round 而非 floor。
pctToFilled() {
  local pct="$1"
  local width="$2"
  echo $(( (pct * width + 50) / 100 ))
}

# 記錄 statusline 主流程被呼叫的頻率。
# 設 STATUSLINE_INVOCATION_LOG=0 或空字串可停用。
logStatuslineInvocation() {
  local mode="$1"
  local cols="$2"

  if [[ -z "${STATUSLINE_INVOCATION_LOG:-}" || "${STATUSLINE_INVOCATION_LOG:-}" == "0" ]]; then
    return 0
  fi

  local log_dir model project
  log_dir="$(dirname "$STATUSLINE_INVOCATION_LOG")"
  mkdir -p "$log_dir" 2>/dev/null || return 0

  model="${json_model_id//$'\t'/ }"
  model="${model//$'\n'/ }"
  project="${json_project_dir//$'\t'/ }"
  project="${project//$'\n'/ }"

  printf '%s\tpid=%s\tppid=%s\tmode=%s\tcols=%s\tmodel=%s\tproject=%s\tusage=%s\treset_at=%s\n' \
    "$(date -Is 2>/dev/null || date)" \
    "$$" \
    "${PPID:-}" \
    "$mode" \
    "$cols" \
    "$model" \
    "$project" \
    "${json_used_pct:-}" \
    "${json_resets_at:-}" >> "$STATUSLINE_INVOCATION_LOG" 2>/dev/null || true
}

logStatuslineInput() {
  local input="$1"

  if [[ -z "${STATUSLINE_INPUT_LOG:-}" || "${STATUSLINE_INPUT_LOG:-}" == "0" ]]; then
    return 0
  fi

  local log_dir
  log_dir="$(dirname "$STATUSLINE_INPUT_LOG")"
  mkdir -p "$log_dir" 2>/dev/null || return 0

  jq -nc --arg ts "$(date -Is 2>/dev/null || date)" --argjson payload "$input" \
    '{ts: $ts, payload: $payload}' >> "$STATUSLINE_INPUT_LOG" 2>/dev/null || true
}

isProcessAlive() {
  local pid="$1"

  if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  local process_state
  process_state=$(getProcessState "$pid") || process_state=""
  if [[ "$process_state" == "Z" ]]; then
    return 1
  fi

  kill -0 "$pid" 2>/dev/null
}

getProcessState() {
  local pid="$1"
  local stat_file="${STATUSLINE_PROC_DIR:-/proc}/${pid}/stat"

  if [[ ! -r "$stat_file" ]]; then
    echo ""
    return 0
  fi

  local stat_content state_part
  stat_content=$(<"$stat_file") || {
    echo ""
    return 0
  }
  state_part="${stat_content##*) }"
  echo "${state_part%% *}"
}

shouldStartUsageRefresher() {
  local pid=""

  if [[ -f "$STATUSLINE_REFRESHER_PID_FILE" ]]; then
    pid=$(<"$STATUSLINE_REFRESHER_PID_FILE") || pid=""
    if isProcessAlive "$pid"; then
      return 1
    fi
    rm -f "$STATUSLINE_REFRESHER_PID_FILE" 2>/dev/null || true
  fi

  return 0
}

isUsageRefresherLockStale() {
  if [[ ! -d "$STATUSLINE_REFRESHER_LOCK_DIR" ]]; then
    return 1
  fi

  local lock_mtime now lock_age
  lock_mtime=$(stat -c %Y "$STATUSLINE_REFRESHER_LOCK_DIR" 2>/dev/null) || lock_mtime=0
  now=$(date +%s)
  lock_age=$(( now - lock_mtime ))

  (( lock_age >= STATUSLINE_REFRESHER_LOCK_STALE_MAX_AGE ))
}

acquireUsageRefresherLock() {
  local lock_parent
  lock_parent="$(dirname "$STATUSLINE_REFRESHER_LOCK_DIR")"
  mkdir -p "$lock_parent" 2>/dev/null || return 1

  if mkdir "$STATUSLINE_REFRESHER_LOCK_DIR" 2>/dev/null; then
    return 0
  fi

  if isUsageRefresherLockStale; then
    rm -rf "$STATUSLINE_REFRESHER_LOCK_DIR" 2>/dev/null || true
    mkdir "$STATUSLINE_REFRESHER_LOCK_DIR" 2>/dev/null
    return $?
  fi

  return 1
}

releaseUsageRefresherLock() {
  rm -rf "$STATUSLINE_REFRESHER_LOCK_DIR" 2>/dev/null || true
}

cleanupUsageRefresherPid() {
  local pid=""

  if [[ -f "$STATUSLINE_REFRESHER_PID_FILE" ]]; then
    pid=$(<"$STATUSLINE_REFRESHER_PID_FILE") || pid=""
    if [[ "$pid" == "${BASHPID:-$$}" ]]; then
      rm -f "$STATUSLINE_REFRESHER_PID_FILE" 2>/dev/null || true
    fi
  fi
}

runUsageRefresherLoop() {
  trap cleanupUsageRefresherPid EXIT
  trap 'cleanupUsageRefresherPid; exit 0' TERM INT

  while true; do
    local oauth_token
    oauth_token=$(getOAuthToken)
    fetchUsageAPI "$oauth_token" > /dev/null
    sleep "$STATUSLINE_REFRESHER_INTERVAL"
  done
}

startUsageRefresher() {
  shouldStartUsageRefresher || return 0
  acquireUsageRefresherLock || return 0

  if ! shouldStartUsageRefresher; then
    releaseUsageRefresherLock
    return 0
  fi

  local pid_parent bg_pid
  pid_parent="$(dirname "$STATUSLINE_REFRESHER_PID_FILE")"
  mkdir -p "$pid_parent" 2>/dev/null || {
    releaseUsageRefresherLock
    return 0
  }

  (
    runUsageRefresherLoop
  ) > /dev/null 2>&1 &
  bg_pid=$!
  if ! printf '%s\n' "$bg_pid" > "$STATUSLINE_REFRESHER_PID_FILE" 2>/dev/null; then
    kill "$bg_pid" 2>/dev/null || true
  fi
  releaseUsageRefresherLock
}

# ─── 測試模式：只載入函式，不執行主流程 ─────────────────────────────────────
if [[ "${STATUSLINE_TEST_MODE:-}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

# ─── OAuth Usage API 呼叫 ────────────────────────────────────────────────────

oauth_token=$(getOAuthToken)
usage_response=$(fetchUsageAPI "$oauth_token")
eval "$(parseUsageResponse "$usage_response")"
startUsageRefresher

# ─── 讀取 JSON ───────────────────────────────────────────────────────────────

json=$(cat)
logStatuslineInput "$json"

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
    ctx_window_size: (.context_window.context_window_size | safe_num),
    used_pct: (.rate_limits.five_hour.used_percentage | safe_num | round),
    resets_at: (.rate_limits.five_hour.resets_at | safe_num),
    effort_level: (.effort.level // "")
  } | to_entries | map("json_\(.key)=\(.value | @sh)") | .[]
' 2>/dev/null)" || {
  # JSON 解析失敗時的 fallback
  json_model_id=""
  json_cwd=""
  json_project_dir=""
  json_ctx_tokens=0
  json_ctx_window_size=0
  json_used_pct=0
  json_resets_at=0
  json_effort_level=""
}

# ─── API 資料覆蓋 StatusJSON ──────────────────────────────────────────────────
# 若 API 有資料，用 API 的 five_hour 資料覆蓋 StatusJSON 的 rate_limits
if [[ -n "$api_five_hour_resets_at" ]]; then
  status_json_used_pct=$(normalizePct "$json_used_pct")
  api_used_pct=$(normalizePct "$api_five_hour_util")
  # ISO 8601 → Unix timestamp
  api_resets_at=$(date -d "$api_five_hour_resets_at" +%s 2>/dev/null) || api_resets_at=0

  # 同一個 reset window 內，較低的 API/cache 值通常是 stale cache；不要讓用量倒退。
  if (( json_resets_at > 0 && api_resets_at > 0 )); then
    reset_diff=$(( api_resets_at - json_resets_at ))
    (( reset_diff < 0 )) && reset_diff=$(( -reset_diff ))
    if (( reset_diff <= 60 && api_used_pct < status_json_used_pct )); then
      json_used_pct="$status_json_used_pct"
    else
      json_used_pct="$api_used_pct"
    fi
  else
    json_used_pct="$api_used_pct"
  fi
  json_resets_at=$api_resets_at
fi

json_used_pct=$(normalizePct "$json_used_pct")

# ─── Helper Functions ─────────────────────────────────────────────────────────

# 將 model id 轉成短名
# claude-opus-4-8[1m] → Opus 4.8[1M]
# claude-sonnet-4-6 → Sonnet 4.6
# claude-haiku-4-5-20251001 → Haiku 4.5
# claude-fable-5 → Fable 5
formatModel() {
  local raw="$1"
  local suffix=""

  # 偵測 [1m] 後綴
  if [[ "$raw" =~ \[1[mM]\] ]]; then
    suffix="[1M]"
  fi
  # 去掉 [...] 後綴
  raw="${raw%%\[*}"

  # 嘗試匹配 claude-<family>-<major>-<minor> 模式
  if [[ "$raw" =~ ^claude-([a-z]+)-([0-9]+)-([0-9]+) ]]; then
    local family="${BASH_REMATCH[1]}"
    local major="${BASH_REMATCH[2]}"
    local minor="${BASH_REMATCH[3]}"
    # 首字母大寫
    family="$(echo "${family:0:1}" | tr '[:lower:]' '[:upper:]')${family:1}"
    echo "${family} ${major}.${minor}${suffix}"
  # 嘗試匹配 claude-<family>-<major> 模式（如 claude-fable-5）
  elif [[ "$raw" =~ ^claude-([a-z]+)-([0-9]+)$ ]]; then
    local family="${BASH_REMATCH[1]}"
    local major="${BASH_REMATCH[2]}"
    family="$(echo "${family:0:1}" | tr '[:lower:]' '[:upper:]')${family:1}"
    echo "${family} ${major}${suffix}"
  else
    # 無法辨識，直接回傳
    echo "$raw${suffix}"
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

# 渲染一行 bar 列：{label 補齊 7}{NBSP}{bar}{NBSP}{pct 補齊 3}{NBSP}|{NBSP}{extra}
# 用法: makeBarRow <label> <bar> <pct> <extra>
makeBarRow() {
  local label="$1" bar="$2" pct="$3" extra="$4"
  local label_padded pct_padded
  printf -v label_padded '%-7s' "$label"
  printf -v pct_padded '%-3s' "${pct}%"
  local row="${label_padded}${NBSP}${bar}${NBSP}${WHITE}${pct_padded}${RST}${NBSP}|${NBSP}${extra}"
  nbspify "$row"
}

# ─── 資料計算 ────────────────────────────────────────────────────────────────

model_short=$(formatModel "$json_model_id")

# 附加 thinking effort level（如 high / medium），依使用者偏好直接顯示、不轉大寫
if [[ -n "$json_effort_level" ]]; then
  model_short="${model_short} ${json_effort_level}"
fi

# Context：min(CONTEXT_CAP, context_window_size) 為分母
if (( json_ctx_window_size > 0 && json_ctx_window_size < CONTEXT_CAP )); then
  ctx_max=$json_ctx_window_size
else
  ctx_max=$CONTEXT_CAP
fi
ctx_pct=$(( json_ctx_tokens * 100 / ctx_max ))
ctx_pct=$(normalizePct "$ctx_pct")
ctx_filled=$(pctToFilled "$ctx_pct" "$BAR_WIDTH")
ctx_color=$(colorByPct "$ctx_pct")         # 0-60% 綠、60-80% 橘、80%+ 紅
ctx_tokens_str=$(formatTokens "$json_ctx_tokens")

# Session（5h block）：倒數計時 + 用量 bar
now=$(date +%s)
if (( json_resets_at > 0 && json_resets_at > now )); then
  remaining=$(( json_resets_at - now ))
  hours=$(( remaining / 3600 ))
  minutes=$(( (remaining % 3600) / 60 ))
  timer_str="${hours}h ${minutes}m"
else
  timer_str="--:--"
fi
session_filled=$(pctToFilled "$json_used_pct" "$BAR_WIDTH")
session_color=$(quotaColor "$json_used_pct")

# Weekly（7d quota）：用量 bar + 絕對重置時刻（週重置在數天後，顯示時刻比倒數實用）
weekly_pct=$(normalizePct "$api_seven_day_util")
weekly_filled=$(pctToFilled "$weekly_pct" "$BAR_WIDTH")
weekly_color=$(quotaColor "$weekly_pct")
if [[ -n "$api_seven_day_resets_at" ]]; then
  weekly_reset=$(date -d "$api_seven_day_resets_at" "+%a %H:%M" 2>/dev/null) || weekly_reset="--"
else
  weekly_reset="--"
fi

# Dir + Git branch + diff（diff 永遠顯示，含 0）
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

  if [[ -n "$git_branch" ]]; then
    git_diff_str="${NBSP}(${GREEN}+${insertions}${RST},${NBSP}${RED}-${deletions}${RST})"
  fi
fi

logStatuslineInvocation "full" ""

# ─── 輸出：四行 ──────────────────────────────────────────────────────────────

SEP="${NBSP}|${NBSP}"

# Line 1: header — Model {effort level} | Dir
line1="$(nbspify "Model:")${NBSP}${WHITE}$(nbspify "$model_short")${RST}"
line1+="${SEP}$(nbspify "Dir:")${NBSP}${WHITE}$(nbspify "$dir_name")${RST}"

ctx_bar=$(makeBar "$ctx_filled" "$BAR_WIDTH" "$ctx_color")
session_bar=$(makeBar "$session_filled" "$BAR_WIDTH" "$session_color")
weekly_bar=$(makeBar "$weekly_filled" "$BAR_WIDTH" "$weekly_color")

# 開頭 reset 覆蓋 Claude Code 的 dim
output="${RST}${line1}"
output+=$'\n'
output+="${RST}$(makeBarRow "Context" "$ctx_bar" "$ctx_pct" "$ctx_tokens_str")"
output+=$'\n'
output+="${RST}$(makeBarRow "Session" "$session_bar" "$json_used_pct" "$timer_str")"
output+=$'\n'
output+="${RST}$(makeBarRow "Weekly" "$weekly_bar" "$weekly_pct" "$weekly_reset")"

# Line 5: git 狀態（Branch + diff），僅在 git repo 內顯示
if [[ -n "$git_branch" ]]; then
  line5="$(nbspify "Branch:")${NBSP}${WHITE}$(nbspify "$git_branch")${RST}${git_diff_str}"
  output+=$'\n'
  output+="${RST}${line5}"
fi

echo -n "$output"
