#!/usr/bin/env bash
# xreview-runner.test.sh — unit tests for xreview-runner.sh
# Uses mock CLIs to test argument parsing and dispatch logic.
# Run: bash ddd-workflow/skills/ddd.xreview/scripts/xreview-runner.test.sh

set -uo pipefail

PASS=0; FAIL=0
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER="$SCRIPT_DIR/xreview-runner.sh"

# --- Setup ---

MOCK_DIR=$(mktemp -d)
PROMPT_FILE=$(mktemp /tmp/xreview-test-XXXXXX.md)
echo "test review prompt content" > "$PROMPT_FILE"
trap 'rm -rf "$MOCK_DIR" "$PROMPT_FILE"' EXIT

# Create mock CLIs that echo received arguments
for cli in opencode gemini codex; do
  cat > "$MOCK_DIR/$cli" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_CALLED: $(basename "$0") $*"
exit 0
MOCK_EOF
  chmod +x "$MOCK_DIR/$cli"
done

# Also mock timeout to pass through (system timeout works fine with mocks,
# but we need it available)
# Note: we rely on the real `timeout` command from the system.

# --- Helpers ---

assert_contains() {
  local test_name="$1" output="$2" expected="$3"
  if echo "$output" | grep -qF -- "$expected"; then
    ((PASS++)); echo "  PASS: $test_name"
  else
    ((FAIL++)); echo "  FAIL: $test_name — expected '$expected' in output"
    echo "     got: $(echo "$output" | head -5)"
  fi
}

assert_not_contains() {
  local test_name="$1" output="$2" unexpected="$3"
  if echo "$output" | grep -qF -- "$unexpected"; then
    ((FAIL++)); echo "  FAIL: $test_name — unexpected '$unexpected' found in output"
    echo "     got: $(echo "$output" | head -5)"
  else
    ((PASS++)); echo "  PASS: $test_name"
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

# ============================================================
echo "--- Test: opencode CLI dispatch ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" bash "$RUNNER" "$PROMPT_FILE" "opencode:some-model" 2>&1)
rc=$?

assert_exit_code "opencode exits 0" "$rc" 0
assert_contains "opencode mock called" "$output" "MOCK_CALLED: opencode"
assert_contains "opencode receives --model" "$output" "--model some-model"
assert_contains "opencode receives --agent" "$output" "--agent ddd.xreviewer"

# ============================================================
echo "--- Test: gemini CLI dispatch ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" bash "$RUNNER" "$PROMPT_FILE" "gemini:gemini-2.5-pro" 2>&1)
rc=$?

assert_exit_code "gemini exits 0" "$rc" 0
assert_contains "gemini mock called" "$output" "MOCK_CALLED: gemini"
assert_contains "gemini receives --approval-mode" "$output" "--approval-mode=plan"

# ============================================================
echo "--- Test: codex CLI dispatch ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" bash "$RUNNER" "$PROMPT_FILE" "codex:o3" 2>&1)
rc=$?

assert_exit_code "codex exits 0" "$rc" 0
assert_contains "codex mock called" "$output" "MOCK_CALLED: codex"
assert_contains "codex receives exec" "$output" "exec"
assert_contains "codex receives --sandbox read-only" "$output" "--sandbox read-only"
assert_contains "codex receives --model" "$output" "--model o3"

# ============================================================
echo "--- Test: backward compatibility (no colon) ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" bash "$RUNNER" "$PROMPT_FILE" "some-model" 2>&1)
rc=$?

assert_exit_code "backward compat exits 0" "$rc" 0
assert_contains "backward compat calls opencode" "$output" "MOCK_CALLED: opencode"
assert_contains "backward compat passes model" "$output" "--model some-model"

# ============================================================
echo "--- Test: unknown CLI ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" bash "$RUNNER" "$PROMPT_FILE" "unknown:model" 2>&1)
rc=$?

assert_exit_code "unknown cli exits non-zero" "$rc" 1
assert_contains "unknown cli error message" "$output" "XREVIEW_ERROR: unknown cli: unknown"

# ============================================================
echo "--- Test: CLI not installed ---"
# ============================================================

# Create a mock dir WITHOUT the target CLI (gemini not present)
NO_CLI_DIR=$(mktemp -d)
trap 'rm -rf "$MOCK_DIR" "$PROMPT_FILE" "$NO_CLI_DIR"' EXIT

# Only put non-target CLIs in the dir (runner needs command -v to fail)
# Use a PATH that excludes real gemini but includes system essentials
output=$(PATH="$NO_CLI_DIR:/usr/bin:/bin" bash "$RUNNER" "$PROMPT_FILE" "gemini:some-model" 2>&1)
rc=$?

assert_exit_code "cli not found exits non-zero" "$rc" 1
assert_contains "cli not found error message" "$output" "XREVIEW_ERROR: cli not found"

# ============================================================
echo "--- Test: prompt file not found ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" bash "$RUNNER" "/nonexistent/path/to/prompt.md" "opencode:model" 2>&1)
rc=$?

assert_exit_code "missing prompt exits non-zero" "$rc" 1
assert_contains "missing prompt error message" "$output" "XREVIEW_ERROR: prompt file not found"

# ============================================================
echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
