#!/usr/bin/env bash
# test-statusline.sh — Unit tests for statusline.sh OAuth + API + cache functions
#
# 執行方式：bash ddd-workflow/scripts/test-statusline.sh
# 不需要任何外部測試框架，使用簡易 assert 函式

# 不使用 set -euo pipefail，測試需要捕捉各種回傳值

# ─── Test Framework ──────────────────────────────────────────────────────────

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0

# 色彩
_GREEN=$'\x1b[32m'
_RED=$'\x1b[31m'
_RST=$'\x1b[0m'

assert_equals() {
  local test_name="$1"
  local expected="$2"
  local actual="$3"
  TOTAL_COUNT=$(( TOTAL_COUNT + 1 ))
  if [[ "$expected" == "$actual" ]]; then
    echo "  ${_GREEN}PASS${_RST}: $test_name"
    PASS_COUNT=$(( PASS_COUNT + 1 ))
  else
    echo "  ${_RED}FAIL${_RST}: $test_name"
    echo "    expected: $(printf '%q' "$expected")"
    echo "    actual:   $(printf '%q' "$actual")"
    FAIL_COUNT=$(( FAIL_COUNT + 1 ))
  fi
}

assert_file_exists() {
  local test_name="$1"
  local filepath="$2"
  TOTAL_COUNT=$(( TOTAL_COUNT + 1 ))
  if [[ -f "$filepath" ]]; then
    echo "  ${_GREEN}PASS${_RST}: $test_name"
    PASS_COUNT=$(( PASS_COUNT + 1 ))
  else
    echo "  ${_RED}FAIL${_RST}: $test_name"
    echo "    expected file to exist: $filepath"
    FAIL_COUNT=$(( FAIL_COUNT + 1 ))
  fi
}

assert_contains() {
  local test_name="$1"
  local haystack="$2"
  local needle="$3"
  TOTAL_COUNT=$(( TOTAL_COUNT + 1 ))
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "  ${_GREEN}PASS${_RST}: $test_name"
    PASS_COUNT=$(( PASS_COUNT + 1 ))
  else
    echo "  ${_RED}FAIL${_RST}: $test_name"
    echo "    expected to contain: $(printf '%q' "$needle")"
    echo "    actual:              $(printf '%q' "$haystack")"
    FAIL_COUNT=$(( FAIL_COUNT + 1 ))
  fi
}

assert_not_contains() {
  local test_name="$1"
  local haystack="$2"
  local needle="$3"
  TOTAL_COUNT=$(( TOTAL_COUNT + 1 ))
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "  ${_GREEN}PASS${_RST}: $test_name"
    PASS_COUNT=$(( PASS_COUNT + 1 ))
  else
    echo "  ${_RED}FAIL${_RST}: $test_name"
    echo "    expected NOT to contain: $(printf '%q' "$needle")"
    echo "    actual:                  $(printf '%q' "$haystack")"
    FAIL_COUNT=$(( FAIL_COUNT + 1 ))
  fi
}

assert_line_count() {
  local test_name="$1"
  local text="$2"
  local expected_count="$3"
  TOTAL_COUNT=$(( TOTAL_COUNT + 1 ))
  # Count newlines + 1 (last line has no trailing newline from echo -n)
  local actual_count
  if [[ -z "$text" ]]; then
    actual_count=0
  else
    actual_count=$(echo -n "$text" | grep -c '' 2>/dev/null) || actual_count=0
  fi
  if [[ "$actual_count" == "$expected_count" ]]; then
    echo "  ${_GREEN}PASS${_RST}: $test_name"
    PASS_COUNT=$(( PASS_COUNT + 1 ))
  else
    echo "  ${_RED}FAIL${_RST}: $test_name"
    echo "    expected line count: $expected_count"
    echo "    actual line count:   $actual_count"
    FAIL_COUNT=$(( FAIL_COUNT + 1 ))
  fi
}

print_summary() {
  echo ""
  echo "─── Summary ───"
  echo "Total: $TOTAL_COUNT  ${_GREEN}Passed: $PASS_COUNT${_RST}  ${_RED}Failed: $FAIL_COUNT${_RST}"
  if (( FAIL_COUNT > 0 )); then
    exit 1
  fi
}

# ─── Setup ───────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATUSLINE_SH="${SCRIPT_DIR}/statusline.sh"

# 測試用的暫存目錄
TEST_TMP_DIR=$(mktemp -d)
TEST_CACHE_DIR="${TEST_TMP_DIR}/claude"
TEST_CACHE_FILE="${TEST_CACHE_DIR}/statusline-usage-cache.json"
TEST_CRED_DIR="${TEST_TMP_DIR}/dot-claude"
TEST_CRED_FILE="${TEST_CRED_DIR}/.credentials.json"

mkdir -p "$TEST_CACHE_DIR"
mkdir -p "$TEST_CRED_DIR"

cleanup() {
  rm -rf "$TEST_TMP_DIR"
}
trap cleanup EXIT

# Source 只有函式定義的部分（不執行主流程）
# 設定 STATUSLINE_TEST_MODE=1 讓 statusline.sh 只定義函式不執行
export STATUSLINE_TEST_MODE=1
# 覆蓋快取路徑
export STATUSLINE_CACHE_FILE="$TEST_CACHE_FILE"
# 覆蓋 credentials 路徑
export STATUSLINE_CREDENTIALS_FILE="$TEST_CRED_FILE"

source "$STATUSLINE_SH"

# source 後關閉 strict mode，測試需要更寬鬆的錯誤處理
set +euo pipefail 2>/dev/null || true

# ─── Mock API Response ───────────────────────────────────────────────────────

MOCK_API_RESPONSE='{"five_hour":{"utilization":42,"resets_at":"2026-04-02T15:30:00Z"},"seven_day":{"utilization":18,"resets_at":"2026-04-05T00:00:00Z"},"extra_usage":{"is_enabled":true,"utilization":25,"used_credits":1250,"monthly_limit":5000}}'

# ─── Test: getOAuthToken ─────────────────────────────────────────────────────

echo ""
echo "=== getOAuthToken ==="

# Test 1: 環境變數優先
echo ""
echo "--- Source: environment variable ---"

export CLAUDE_CODE_OAUTH_TOKEN="env-token-abc123"
echo '{"claudeAiOauth":{"accessToken":"file-token-xyz"}}' > "$TEST_CRED_FILE"
result=$(getOAuthToken)
assert_equals "should return env var token when set" "env-token-abc123" "$result"
unset CLAUDE_CODE_OAUTH_TOKEN

# Test 2: credentials 檔案
echo ""
echo "--- Source: credentials file ---"

unset CLAUDE_CODE_OAUTH_TOKEN 2>/dev/null || true
echo '{"claudeAiOauth":{"accessToken":"file-token-xyz789"}}' > "$TEST_CRED_FILE"
result=$(getOAuthToken)
assert_equals "should return token from credentials file" "file-token-xyz789" "$result"

# Test 3: credentials 檔案不存在
echo ""
echo "--- Source: no credentials available ---"

unset CLAUDE_CODE_OAUTH_TOKEN 2>/dev/null || true
rm -f "$TEST_CRED_FILE"
result=$(getOAuthToken)
assert_equals "should return empty string when no token found" "" "$result"

# Test 4: credentials 檔案存在但格式錯誤
echo ""
echo "--- Source: malformed credentials file ---"

unset CLAUDE_CODE_OAUTH_TOKEN 2>/dev/null || true
echo 'not valid json' > "$TEST_CRED_FILE"
result=$(getOAuthToken)
assert_equals "should return empty string for malformed JSON" "" "$result"

# Test 5: credentials 檔案存在但缺少 accessToken 欄位
echo ""
echo "--- Source: credentials file missing accessToken ---"

unset CLAUDE_CODE_OAUTH_TOKEN 2>/dev/null || true
echo '{"claudeAiOauth":{"refreshToken":"xxx"}}' > "$TEST_CRED_FILE"
result=$(getOAuthToken)
assert_equals "should return empty string when accessToken missing" "" "$result"

# Test 6: 環境變數為空字串時 fallback 到檔案
echo ""
echo "--- Source: empty env var falls back to file ---"

export CLAUDE_CODE_OAUTH_TOKEN=""
echo '{"claudeAiOauth":{"accessToken":"fallback-token"}}' > "$TEST_CRED_FILE"
result=$(getOAuthToken)
assert_equals "should fallback to file when env var is empty" "fallback-token" "$result"
unset CLAUDE_CODE_OAUTH_TOKEN

# ─── Test: fetchUsageAPI ─────────────────────────────────────────────────────

echo ""
echo "=== fetchUsageAPI ==="

# 為了 mock curl，我們使用 wrapper script 而非函式覆蓋
# 因為 fetchUsageAPI 在 command substitution 中呼叫 curl，
# 函式 mock 在子 shell 中不一定可見

MOCK_CURL_SCRIPT="${TEST_TMP_DIR}/mock-curl"

# Test: 快取不存在時呼叫 API
echo ""
echo "--- Cache miss: should call API ---"

rm -f "$TEST_CACHE_FILE"
# 建立 mock curl script
cat > "$MOCK_CURL_SCRIPT" << 'SCRIPT'
#!/usr/bin/env bash
echo '{"five_hour":{"utilization":42,"resets_at":"2026-04-02T15:30:00Z"},"seven_day":{"utilization":18,"resets_at":"2026-04-05T00:00:00Z"},"extra_usage":{"is_enabled":true,"utilization":25,"used_credits":1250,"monthly_limit":5000}}'
exit 0
SCRIPT
chmod +x "$MOCK_CURL_SCRIPT"

# 暫時把 mock curl 放到 PATH 最前面
OLD_PATH="$PATH"
export PATH="${TEST_TMP_DIR}:${PATH}"
ln -sf "$MOCK_CURL_SCRIPT" "${TEST_TMP_DIR}/curl"

result=$(fetchUsageAPI "test-token-123")
result_compact=$(echo "$result" | jq -c . 2>/dev/null)
expected_compact=$(echo "$MOCK_API_RESPONSE" | jq -c . 2>/dev/null)
assert_equals "should return API response on cache miss" "$expected_compact" "$result_compact"

export PATH="$OLD_PATH"

# Test: 快取寫入
echo ""
echo "--- Cache write: should create cache file ---"

rm -f "$TEST_CACHE_FILE"
export PATH="${TEST_TMP_DIR}:${OLD_PATH}"

fetchUsageAPI "test-token-123" > /dev/null
assert_file_exists "should create cache file after API call" "$TEST_CACHE_FILE"

export PATH="$OLD_PATH"

# Test: 快取命中（60 秒內）
echo ""
echo "--- Cache hit: should return cached data without calling API ---"

# 寫入快取並確保 mtime 是現在
echo "$MOCK_API_RESPONSE" > "$TEST_CACHE_FILE"
touch "$TEST_CACHE_FILE"

# Mock curl 回傳不同的資料
cat > "$MOCK_CURL_SCRIPT" << 'SCRIPT'
#!/usr/bin/env bash
echo '{"five_hour":{"utilization":99,"resets_at":"2099-01-01T00:00:00Z"},"seven_day":{"utilization":99,"resets_at":"2099-01-01T00:00:00Z"},"extra_usage":{"is_enabled":false}}'
exit 0
SCRIPT
ln -sf "$MOCK_CURL_SCRIPT" "${TEST_TMP_DIR}/curl"
export PATH="${TEST_TMP_DIR}:${OLD_PATH}"

result=$(fetchUsageAPI "test-token-123")
five_hour_util=$(echo "$result" | jq -r '.five_hour.utilization')
assert_equals "should return cached data (utilization=42, not 99)" "42" "$five_hour_util"

export PATH="$OLD_PATH"

# Test: 快取過期時重新呼叫 API
echo ""
echo "--- Cache expired: should call API again ---"

echo "$MOCK_API_RESPONSE" > "$TEST_CACHE_FILE"
touch -d "120 seconds ago" "$TEST_CACHE_FILE"

cat > "$MOCK_CURL_SCRIPT" << 'SCRIPT'
#!/usr/bin/env bash
echo '{"five_hour":{"utilization":77,"resets_at":"2026-04-02T20:00:00Z"},"seven_day":{"utilization":33,"resets_at":"2026-04-06T00:00:00Z"},"extra_usage":{"is_enabled":false}}'
exit 0
SCRIPT
ln -sf "$MOCK_CURL_SCRIPT" "${TEST_TMP_DIR}/curl"
export PATH="${TEST_TMP_DIR}:${OLD_PATH}"

result=$(fetchUsageAPI "test-token-123")
five_hour_util=$(echo "$result" | jq -r '.five_hour.utilization')
assert_equals "should return fresh API data after cache expired" "77" "$five_hour_util"

export PATH="$OLD_PATH"

# Test: API 失敗時 fallback 到舊快取
echo ""
echo "--- API failure: should fallback to stale cache ---"

echo "$MOCK_API_RESPONSE" > "$TEST_CACHE_FILE"
touch -d "120 seconds ago" "$TEST_CACHE_FILE"

cat > "$MOCK_CURL_SCRIPT" << 'SCRIPT'
#!/usr/bin/env bash
exit 1
SCRIPT
ln -sf "$MOCK_CURL_SCRIPT" "${TEST_TMP_DIR}/curl"
export PATH="${TEST_TMP_DIR}:${OLD_PATH}"

result=$(fetchUsageAPI "test-token-123")
five_hour_util=$(echo "$result" | jq -r '.five_hour.utilization')
assert_equals "should fallback to stale cache when API fails" "42" "$five_hour_util"

export PATH="$OLD_PATH"

# Test: 無 token 時不呼叫 API，回傳空字串
echo ""
echo "--- No token: should not call API ---"

rm -f "$TEST_CACHE_FILE"
cat > "$MOCK_CURL_SCRIPT" << 'SCRIPT'
#!/usr/bin/env bash
echo "ERROR: curl should not be called" >&2
exit 1
SCRIPT
ln -sf "$MOCK_CURL_SCRIPT" "${TEST_TMP_DIR}/curl"
export PATH="${TEST_TMP_DIR}:${OLD_PATH}"

result=$(fetchUsageAPI "")
assert_equals "should return empty string when no token" "" "$result"

export PATH="$OLD_PATH"

# Test: API 失敗且無舊快取時回傳空字串
echo ""
echo "--- API failure + no cache: should return empty ---"

rm -f "$TEST_CACHE_FILE"
cat > "$MOCK_CURL_SCRIPT" << 'SCRIPT'
#!/usr/bin/env bash
exit 1
SCRIPT
ln -sf "$MOCK_CURL_SCRIPT" "${TEST_TMP_DIR}/curl"
export PATH="${TEST_TMP_DIR}:${OLD_PATH}"

result=$(fetchUsageAPI "test-token-123")
assert_equals "should return empty string when API fails and no cache" "" "$result"

export PATH="$OLD_PATH"

# Test: API 回傳非 JSON 時 fallback 到舊快取
echo ""
echo "--- API returns non-JSON: should fallback to stale cache ---"

echo "$MOCK_API_RESPONSE" > "$TEST_CACHE_FILE"
touch -d "120 seconds ago" "$TEST_CACHE_FILE"

cat > "$MOCK_CURL_SCRIPT" << 'SCRIPT'
#!/usr/bin/env bash
echo "<html>502 Bad Gateway</html>"
exit 0
SCRIPT
ln -sf "$MOCK_CURL_SCRIPT" "${TEST_TMP_DIR}/curl"
export PATH="${TEST_TMP_DIR}:${OLD_PATH}"

result=$(fetchUsageAPI "test-token-123")
five_hour_util=$(echo "$result" | jq -r '.five_hour.utilization')
assert_equals "should fallback to stale cache when API returns non-JSON" "42" "$five_hour_util"

export PATH="$OLD_PATH"

# ─── Test: parseUsageResponse ────────────────────────────────────────────────

echo ""
echo "=== parseUsageResponse ==="

# Test: 正確解析 API response 到 shell 變數
echo ""
echo "--- Parse full response ---"

eval "$(parseUsageResponse "$MOCK_API_RESPONSE")"
assert_equals "five_hour utilization" "42" "$api_five_hour_util"
assert_equals "five_hour resets_at" "2026-04-02T15:30:00Z" "$api_five_hour_resets_at"
assert_equals "seven_day utilization" "18" "$api_seven_day_util"
assert_equals "seven_day resets_at" "2026-04-05T00:00:00Z" "$api_seven_day_resets_at"
assert_equals "extra_usage is_enabled" "true" "$api_extra_enabled"
assert_equals "extra_usage utilization" "25" "$api_extra_util"
assert_equals "extra_usage used_credits" "1250" "$api_extra_used_credits"
assert_equals "extra_usage monthly_limit" "5000" "$api_extra_monthly_limit"

# Test: 空字串輸入時所有變數為空或 0
echo ""
echo "--- Parse empty input ---"

eval "$(parseUsageResponse "")"
assert_equals "five_hour utilization defaults to 0" "0" "$api_five_hour_util"
assert_equals "five_hour resets_at defaults to empty" "" "$api_five_hour_resets_at"
assert_equals "seven_day utilization defaults to 0" "0" "$api_seven_day_util"
assert_equals "extra_usage is_enabled defaults to false" "false" "$api_extra_enabled"
assert_equals "extra_usage used_credits defaults to 0" "0" "$api_extra_used_credits"
assert_equals "extra_usage monthly_limit defaults to 0" "0" "$api_extra_monthly_limit"

# Test: extra_usage disabled
echo ""
echo "--- Parse response with extra_usage disabled ---"

local_response='{"five_hour":{"utilization":10,"resets_at":"2026-04-02T10:00:00Z"},"seven_day":{"utilization":5,"resets_at":"2026-04-03T00:00:00Z"},"extra_usage":{"is_enabled":false}}'
eval "$(parseUsageResponse "$local_response")"
assert_equals "extra_usage is_enabled" "false" "$api_extra_enabled"
assert_equals "extra_usage utilization defaults to 0" "0" "$api_extra_util"

# ─── Test: M2 — API 資料覆蓋 StatusJSON ─────────────────────────────────────

echo ""
echo "=== M2: API Data Override ==="

# 這些測試需要執行完整的 statusline.sh 主流程（不用 TEST_MODE），
# 透過 mock API cache + mock StatusJSON stdin 來驗證輸出。
# 我們直接用 sub-shell 執行 statusline.sh 並檢查輸出。

# 基本的 mock StatusJSON（used_pct=75, resets_at 為未來時間）
MOCK_STATUS_JSON='{"model":"claude-opus-4-6[1m]","cwd":"/tmp","workspace":{"project_dir":"/tmp"},"context_window":{"current_usage":50000},"rate_limits":{"five_hour":{"used_percentage":75,"resets_at":0}}}'

# Test: API 有資料時，json_used_pct 被覆蓋為 API 值
echo ""
echo "--- API available: used_pct should use API value ---"

# 準備 API cache（模擬 M1 已從 API 取得 utilization=42）
api_cache_for_test='{"five_hour":{"utilization":42,"resets_at":"2099-04-02T15:30:00Z"},"seven_day":{"utilization":18,"resets_at":"2099-04-05T00:00:00Z"},"extra_usage":{"is_enabled":false}}'

# 建立 mock 環境
test_m2_cache_dir="${TEST_TMP_DIR}/m2-cache"
test_m2_cache_file="${test_m2_cache_dir}/statusline-usage-cache.json"
mkdir -p "$test_m2_cache_dir"
echo "$api_cache_for_test" > "$test_m2_cache_file"
touch "$test_m2_cache_file"  # 確保 mtime 是現在（cache hit）

# 建立 mock credentials（提供 token 讓 fetchUsageAPI 走 cache 路徑）
test_m2_cred_dir="${TEST_TMP_DIR}/m2-cred"
test_m2_cred_file="${test_m2_cred_dir}/.credentials.json"
mkdir -p "$test_m2_cred_dir"
echo '{"claudeAiOauth":{"accessToken":"test-token"}}' > "$test_m2_cred_file"

# 執行 statusline.sh（不設 TEST_MODE），用 mock 環境
result=$(echo "$MOCK_STATUS_JSON" | \
  STATUSLINE_TEST_MODE="" \
  STATUSLINE_CACHE_FILE="$test_m2_cache_file" \
  STATUSLINE_CREDENTIALS_FILE="$test_m2_cred_file" \
  STATUSLINE_TERM_COLS=80 \
  bash "$STATUSLINE_SH" 2>/dev/null)

# 輸出應包含 42%（API 值）而非 75%（StatusJSON 值）
assert_contains "should show API utilization (42%) in Session bar" "$result" "42%"
assert_not_contains "should NOT show StatusJSON used_pct (75%)" "$result" "75%"

# Test: API 有資料時，resets_at 被轉為 epoch（顯示為倒數計時器）
echo ""
echo "--- API available: resets_at should convert ISO to countdown ---"

# 輸出不應包含 --:-- （因為 API 的 resets_at 是未來時間 2099 年）
assert_not_contains "should show countdown timer (not --:--)" "$result" "--:--"

# Test: API 無資料時，json_used_pct 維持 StatusJSON 值
echo ""
echo "--- API unavailable: should fallback to StatusJSON ---"

# 不提供 token，fetchUsageAPI 回傳空字串 → parseUsageResponse 得到 defaults
rm -f "$test_m2_cache_file"

result_no_api=$(echo "$MOCK_STATUS_JSON" | \
  STATUSLINE_TEST_MODE="" \
  STATUSLINE_CACHE_FILE="$test_m2_cache_file" \
  STATUSLINE_CREDENTIALS_FILE="/nonexistent/path" \
  CLAUDE_CODE_OAUTH_TOKEN="" \
  STATUSLINE_TERM_COLS=80 \
  bash "$STATUSLINE_SH" 2>/dev/null)

# 輸出應包含 75%（StatusJSON 值）
assert_contains "should show StatusJSON used_pct (75%)" "$result_no_api" "75%"
# 輸出應包含 --:--（因為 StatusJSON 的 resets_at=0）
assert_contains "should show --:-- when resets_at is 0" "$result_no_api" "--:--"

# ─── Test: M3 — Compact 模式 ────────────────────────────────────────────────

echo ""
echo "=== M3: Compact Mode ==="

# Mock StatusJSON for compact tests（ctx_tokens=55000 → 22%, used_pct=84）
COMPACT_STATUS_JSON='{"model":"claude-opus-4-6[1m]","cwd":"/tmp","workspace":{"project_dir":"/tmp"},"context_window":{"current_usage":55000},"rate_limits":{"five_hour":{"used_percentage":84,"resets_at":0}}}'

# Test: terminal 寬度 <60 時輸出是單行
echo ""
echo "--- Compact mode: should output single line when cols < 60 ---"

result_compact=$(echo "$COMPACT_STATUS_JSON" | \
  STATUSLINE_TEST_MODE="" \
  STATUSLINE_CACHE_FILE="/nonexistent/cache" \
  STATUSLINE_CREDENTIALS_FILE="/nonexistent/path" \
  CLAUDE_CODE_OAUTH_TOKEN="" \
  STATUSLINE_TERM_COLS=50 \
  bash "$STATUSLINE_SH" 2>/dev/null)

assert_line_count "should output exactly 1 line in compact mode" "$result_compact" 1

# Test: compact 格式包含所有欄位
echo ""
echo "--- Compact mode: should contain all fields ---"

assert_contains "should contain model name" "$result_compact" "Opus 4.6"
assert_contains "should contain CTX label" "$result_compact" "CTX"
assert_contains "should contain USG label" "$result_compact" "USG"
assert_contains "should contain RES label" "$result_compact" "RES"
assert_contains "should contain separator" "$result_compact" " | "

# Test: compact 的 CTX 百分比正確（55000/250000 = 22%）
assert_contains "should show CTX percentage" "$result_compact" "22%"

# Test: compact 的 USG 百分比正確（84%）
assert_contains "should show USG percentage" "$result_compact" "84%"

# Test: terminal 寬度 ≥60 時輸出是三行
echo ""
echo "--- Full mode: should output 3 lines when cols >= 60 ---"

result_full=$(echo "$COMPACT_STATUS_JSON" | \
  STATUSLINE_TEST_MODE="" \
  STATUSLINE_CACHE_FILE="/nonexistent/cache" \
  STATUSLINE_CREDENTIALS_FILE="/nonexistent/path" \
  CLAUDE_CODE_OAUTH_TOKEN="" \
  STATUSLINE_TERM_COLS=80 \
  bash "$STATUSLINE_SH" 2>/dev/null)

assert_line_count "should output exactly 3 lines in full mode" "$result_full" 3

# Test: 邊界值 — 剛好 60 cols 走完整模式
echo ""
echo "--- Boundary: cols=60 should use full mode ---"

result_boundary=$(echo "$COMPACT_STATUS_JSON" | \
  STATUSLINE_TEST_MODE="" \
  STATUSLINE_CACHE_FILE="/nonexistent/cache" \
  STATUSLINE_CREDENTIALS_FILE="/nonexistent/path" \
  CLAUDE_CODE_OAUTH_TOKEN="" \
  STATUSLINE_TERM_COLS=60 \
  bash "$STATUSLINE_SH" 2>/dev/null)

assert_line_count "should output 3 lines when cols=60 (boundary)" "$result_boundary" 3

# Test: 邊界值 — 59 cols 走 compact 模式
echo ""
echo "--- Boundary: cols=59 should use compact mode ---"

result_boundary59=$(echo "$COMPACT_STATUS_JSON" | \
  STATUSLINE_TEST_MODE="" \
  STATUSLINE_CACHE_FILE="/nonexistent/cache" \
  STATUSLINE_CREDENTIALS_FILE="/nonexistent/path" \
  CLAUDE_CODE_OAUTH_TOKEN="" \
  STATUSLINE_TERM_COLS=59 \
  bash "$STATUSLINE_SH" 2>/dev/null)

assert_line_count "should output 1 line when cols=59 (boundary)" "$result_boundary59" 1

# Test: compact 模式色彩規則 — CTX 低百分比（綠色）
echo ""
echo "--- Compact color: CTX low pct should be green ---"

# 22% → 應該是綠色 (\x1b[32m)
_test_green=$'\x1b[32m'
assert_contains "CTX 22% should use green color" "$result_compact" "${_test_green}22%"

# Test: compact 模式色彩規則 — USG 高百分比（80-89% 橘 → compact 用不同規則: 80%+ 紅）
echo ""
echo "--- Compact color: USG high pct should use correct color ---"

# USG 84% → compact 用 0-60 綠 / 60-80 橘 / 80+ 紅
_test_red=$'\x1b[31m'
assert_contains "USG 84% should use red color in compact mode" "$result_compact" "${_test_red}84%"

# Test: compact 模式色彩規則 — USG 中百分比（60-80% 橘）
echo ""
echo "--- Compact color: USG mid pct should be yellow ---"

COMPACT_MID_JSON='{"model":"claude-opus-4-6[1m]","cwd":"/tmp","workspace":{"project_dir":"/tmp"},"context_window":{"current_usage":55000},"rate_limits":{"five_hour":{"used_percentage":65,"resets_at":0}}}'

result_mid=$(echo "$COMPACT_MID_JSON" | \
  STATUSLINE_TEST_MODE="" \
  STATUSLINE_CACHE_FILE="/nonexistent/cache" \
  STATUSLINE_CREDENTIALS_FILE="/nonexistent/path" \
  CLAUDE_CODE_OAUTH_TOKEN="" \
  STATUSLINE_TERM_COLS=50 \
  bash "$STATUSLINE_SH" 2>/dev/null)

_test_yellow=$'\x1b[33m'
assert_contains "USG 65% should use yellow color" "$result_mid" "${_test_yellow}65%"

# Test: compact 模式色彩規則 — RES 不上色
echo ""
echo "--- Compact color: RES should not be colored ---"

# RES 欄位不應有色彩碼在 "RES" 和數值之間
# 當 resets_at=0 時顯示 --:--
assert_contains "RES should show --:-- without color" "$result_compact" "RES --:--"

# Test: compact 模式 — RES 有倒數計時值
echo ""
echo "--- Compact mode: RES with countdown ---"

# 使用未來時間的 resets_at（透過 API cache 提供）
api_cache_compact='{"five_hour":{"utilization":42,"resets_at":"2099-04-02T15:30:00Z"},"seven_day":{"utilization":18,"resets_at":"2099-04-05T00:00:00Z"},"extra_usage":{"is_enabled":false}}'
test_m3_cache_dir="${TEST_TMP_DIR}/m3-cache"
test_m3_cache_file="${test_m3_cache_dir}/statusline-usage-cache.json"
mkdir -p "$test_m3_cache_dir"
echo "$api_cache_compact" > "$test_m3_cache_file"
touch "$test_m3_cache_file"

test_m3_cred_dir="${TEST_TMP_DIR}/m3-cred"
test_m3_cred_file="${test_m3_cred_dir}/.credentials.json"
mkdir -p "$test_m3_cred_dir"
echo '{"claudeAiOauth":{"accessToken":"test-token"}}' > "$test_m3_cred_file"

result_compact_timer=$(echo "$COMPACT_STATUS_JSON" | \
  STATUSLINE_TEST_MODE="" \
  STATUSLINE_CACHE_FILE="$test_m3_cache_file" \
  STATUSLINE_CREDENTIALS_FILE="$test_m3_cred_file" \
  STATUSLINE_TERM_COLS=50 \
  bash "$STATUSLINE_SH" 2>/dev/null)

# RES 應顯示倒數（不是 --:--），且不上色
assert_not_contains "RES should show countdown, not --:--" "$result_compact_timer" "--:--"
# 應包含 "RES "（後面跟著某個時間值）
assert_contains "should contain RES label with time" "$result_compact_timer" "RES "

# ─── Test: colorByPct function ───────────────────────────────────────────────

echo ""
echo "=== colorByPct ==="

# Test: 低百分比 → 綠色
echo ""
echo "--- colorByPct thresholds ---"

_expected_green=$'\x1b[32m'
_expected_yellow=$'\x1b[33m'
_expected_red=$'\x1b[31m'

result_color=$(colorByPct 0)
assert_equals "0% should return green" "$_expected_green" "$result_color"

result_color=$(colorByPct 59)
assert_equals "59% should return green" "$_expected_green" "$result_color"

result_color=$(colorByPct 60)
assert_equals "60% should return yellow" "$_expected_yellow" "$result_color"

result_color=$(colorByPct 79)
assert_equals "79% should return yellow" "$_expected_yellow" "$result_color"

result_color=$(colorByPct 80)
assert_equals "80% should return red" "$_expected_red" "$result_color"

result_color=$(colorByPct 100)
assert_equals "100% should return red" "$_expected_red" "$result_color"

# ─── Summary ─────────────────────────────────────────────────────────────────

print_summary
