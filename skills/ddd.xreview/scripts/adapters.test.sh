#!/usr/bin/env bash
# adapters.test.sh — unit tests for per-CLI xreview adapters
# Run: bash ddd-workflow/skills/ddd.xreview/scripts/adapters.test.sh

set -uo pipefail

PASS=0; FAIL=0
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADAPTER_DIR="$SCRIPT_DIR/adapters"

MOCK_DIR=$(mktemp -d)
PROMPT_FILE=$(mktemp /tmp/xreview-adapter-test-XXXXXX.md)
echo "test review prompt content" > "$PROMPT_FILE"
trap 'rm -rf "$MOCK_DIR" "$PROMPT_FILE"' EXIT

assert_contains() {
  local test_name="$1" output="$2" expected="$3"
  if echo "$output" | grep -qF -- "$expected"; then
    ((PASS++)); echo "  PASS: $test_name"
  else
    ((FAIL++)); echo "  FAIL: $test_name — expected '$expected' in output"
    echo "     got: $(printf '%s' "$output" | head -5)"
  fi
}

assert_exit_code() {
  local test_name="$1" actual="$2" expected="$3"
  if [[ "$actual" -eq "$expected" ]]; then
    ((PASS++)); echo "  PASS: $test_name"
  else
    ((FAIL++)); echo "  FAIL: $test_name — expected exit $expected, got $actual"
  fi
}

write_happy_mock() {
  local cli="$1"
  cat > "$MOCK_DIR/$cli" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_CALLED: $(basename "$0") $*"
stdin_content="$(cat)"
if [[ -n "$stdin_content" ]]; then
  echo "MOCK_STDIN: $stdin_content"
fi
exit 0
MOCK_EOF
  chmod +x "$MOCK_DIR/$cli"
}

write_timeout_mock() {
  local cli="$1"
  cat > "$MOCK_DIR/$cli" << 'MOCK_EOF'
#!/usr/bin/env bash
cat > /dev/null
sleep 3
MOCK_EOF
  chmod +x "$MOCK_DIR/$cli"
}

for cli in claude opencode gemini codex; do
  write_happy_mock "$cli"
done

# ============================================================
echo "--- Test: claude adapter dispatch ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" bash "$ADAPTER_DIR/claude.sh" "$PROMPT_FILE" "claude-opus-4-6" 5 2>&1)
rc=$?

assert_exit_code "claude adapter exits 0" "$rc" 0
assert_contains "claude adapter calls cli" "$output" "MOCK_CALLED: claude -p"
assert_contains "claude adapter passes reviewer agent" "$output" "--agent ddd-reviewer"
assert_contains "claude adapter passes model" "$output" "--model claude-opus-4-6"
assert_contains "claude adapter forwards stdin" "$output" "MOCK_STDIN: test review prompt content"

# ============================================================
echo "--- Test: opencode adapter dispatch ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" bash "$ADAPTER_DIR/opencode.sh" "$PROMPT_FILE" "github-copilot/gpt-5.4" 5 2>&1)
rc=$?

assert_exit_code "opencode adapter exits 0" "$rc" 0
assert_contains "opencode adapter calls cli" "$output" "MOCK_CALLED: opencode run"
assert_contains "opencode adapter passes reviewer agent" "$output" "--agent ddd.xreviewer"
assert_contains "opencode adapter passes model" "$output" "--model github-copilot/gpt-5.4"
assert_contains "opencode adapter forwards stdin" "$output" "MOCK_STDIN: test review prompt content"

# ============================================================
echo "--- Test: gemini adapter dispatch ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" bash "$ADAPTER_DIR/gemini.sh" "$PROMPT_FILE" "gemini-3-pro-preview" 5 2>&1)
rc=$?

assert_exit_code "gemini adapter exits 0" "$rc" 0
assert_contains "gemini adapter calls cli" "$output" "MOCK_CALLED: gemini --approval-mode=plan"
assert_contains "gemini adapter passes admin policy" "$output" "--admin-policy="
if echo "$output" | grep -qE -- '--admin-policy=/[^ ]+'; then
  ((PASS++)); echo "  PASS: gemini adapter passes absolute admin policy path"
else
  ((FAIL++)); echo "  FAIL: gemini adapter did not pass absolute admin policy path"
  echo "     got: $(printf '%s' "$output" | head -5)"
fi
assert_contains "gemini adapter passes model" "$output" "-m gemini-3-pro-preview"
assert_contains "gemini adapter forwards stdin" "$output" "MOCK_STDIN: test review prompt content"

# ============================================================
echo "--- Test: codex adapter dispatch ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" bash "$ADAPTER_DIR/codex.sh" "$PROMPT_FILE" "o3" 5 2>&1)
rc=$?

assert_exit_code "codex adapter exits 0" "$rc" 0
assert_contains "codex adapter calls cli" "$output" "MOCK_CALLED: codex exec"
assert_contains "codex adapter passes sandbox" "$output" "--sandbox read-only"
assert_contains "codex adapter passes model" "$output" "--model o3"
assert_contains "codex adapter forwards stdin" "$output" "MOCK_STDIN: test review prompt content"

# ============================================================
echo "--- Test: prompt file missing ---"
# ============================================================

for cli in claude opencode gemini codex; do
  output=$(PATH="$MOCK_DIR:$PATH" bash "$ADAPTER_DIR/$cli.sh" "/nonexistent/prompt.md" "test-model" 5 2>&1)
  rc=$?
  assert_exit_code "$cli missing prompt exits 1" "$rc" 1
  assert_contains "$cli missing prompt message" "$output" "XREVIEW_ERROR: prompt file not found"
done

# ============================================================
echo "--- Test: CLI not installed ---"
# ============================================================

NO_CLI_DIR=$(mktemp -d)
trap 'rm -rf "$MOCK_DIR" "$PROMPT_FILE" "$NO_CLI_DIR"' EXIT

for cli in claude opencode gemini codex; do
  output=$(PATH="$NO_CLI_DIR:/usr/bin:/bin" bash "$ADAPTER_DIR/$cli.sh" "$PROMPT_FILE" "test-model" 5 2>&1)
  rc=$?
  assert_exit_code "$cli missing binary exits 1" "$rc" 1
  assert_contains "$cli missing binary message" "$output" "XREVIEW_ERROR: cli not found: $cli"
done

# ============================================================
echo "--- Test: timeout preserved as 124 ---"
# ============================================================

for cli in claude opencode gemini codex; do
  write_timeout_mock "$cli"
  output=$(PATH="$MOCK_DIR:$PATH" bash "$ADAPTER_DIR/$cli.sh" "$PROMPT_FILE" "test-model" 1 2>&1)
  rc=$?
  assert_exit_code "$cli timeout exits 124" "$rc" 124
  assert_contains "$cli timeout message" "$output" "XREVIEW_ERROR: timed out after 1s"
done

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
