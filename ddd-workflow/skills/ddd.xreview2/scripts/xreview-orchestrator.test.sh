#!/usr/bin/env bash
# xreview-orchestrator.test.sh — unit tests for xreview-orchestrator.sh
# Uses mock CLIs to test event stream format and dispatch logic.
# Run: bash ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.test.sh

set -uo pipefail

PASS=0; FAIL=0
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ORCH="$SCRIPT_DIR/xreview-orchestrator.sh"

# --- Setup ---

MOCK_DIR=$(mktemp -d)
PROMPT_FILE=$(mktemp /tmp/xreview-test-XXXXXX.md)
echo "test review prompt content" > "$PROMPT_FILE"
trap 'rm -rf "$MOCK_DIR" "$PROMPT_FILE" /tmp/xreview-*-test-* 2>/dev/null || true' EXIT

# Mock claude CLI — echoes args and a marker, exit 0
cat > "$MOCK_DIR/claude" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_CLAUDE_CALLED args=$*"
cat
echo "MOCK_CLAUDE_DONE"
exit 0
MOCK_EOF
chmod +x "$MOCK_DIR/claude"

# Mock failing claude (used by opt-in tests)
cat > "$MOCK_DIR/claude-fail" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_FAIL_OUTPUT" >&2
exit 7
MOCK_EOF
chmod +x "$MOCK_DIR/claude-fail"

# Mock opencode/gemini/codex for runner delegation
for cli in opencode gemini codex; do
  cat > "$MOCK_DIR/$cli" << MOCK_EOF
#!/usr/bin/env bash
echo "MOCK_${cli^^}_CALLED \$*"
exit 0
MOCK_EOF
  chmod +x "$MOCK_DIR/$cli"
done

# --- Helpers ---

assert_contains() {
  local test_name="$1" output="$2" expected="$3"
  if echo "$output" | grep -qF -- "$expected"; then
    ((PASS++)); echo "  PASS: $test_name"
  else
    ((FAIL++)); echo "  FAIL: $test_name — expected '$expected' in output"
    echo "     got: $(echo "$output" | head -10)"
  fi
}

assert_not_contains() {
  local test_name="$1" output="$2" unexpected="$3"
  if echo "$output" | grep -qF -- "$unexpected"; then
    ((FAIL++)); echo "  FAIL: $test_name — unexpected '$unexpected' found"
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

count_lines_matching() {
  echo "$1" | grep -cE "^$2" || true
}

# ============================================================
echo "--- Test: missing prompt file ---"
# ============================================================

output=$(bash "$ORCH" "/nonexistent/path.md" "claude:test-model" 2>&1)
rc=$?

assert_exit_code "missing prompt exits 1" "$rc" 1
assert_contains "missing prompt FAIL message" "$output" "FAIL orchestrator prompt_file_not_found"
assert_contains "missing prompt still emits ALL_DONE" "$output" "ALL_DONE"

# ============================================================
echo "--- Test: no reviewers specified ---"
# ============================================================

output=$(bash "$ORCH" "$PROMPT_FILE" 2>&1)
rc=$?

assert_exit_code "no reviewers exits 1" "$rc" 1
assert_contains "no reviewers FAIL message" "$output" "FAIL orchestrator no_reviewers_specified"

# ============================================================
echo "--- Test: single claude reviewer ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" "claude:claude-haiku-4-5-20251001" 2>&1)
rc=$?

assert_exit_code "claude reviewer exits 0" "$rc" 0
assert_contains "claude START emitted" "$output" "START claude:claude-haiku-4-5-20251001"
assert_contains "claude DONE emitted" "$output" "DONE claude:claude-haiku-4-5-20251001 /tmp/xreview-"
assert_contains "ALL_DONE emitted" "$output" "ALL_DONE"
assert_not_contains "no FAIL for happy path" "$output" "FAIL"

# ============================================================
echo "--- Test: multiple reviewers (all START first) ---"
# ============================================================

# Use multiple claude mocks to test fan-out
output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" \
  "claude:model-a" "claude:model-b" "claude:model-c" 2>&1)
rc=$?

assert_exit_code "multi reviewers exits 0" "$rc" 0

# All STARTs should appear before any DONE (deterministic since main shell
# emits all STARTs synchronously before the parallel section runs)
first_done_line=$(echo "$output" | grep -nE "^DONE " | head -1 | cut -d: -f1)
last_start_line=$(echo "$output" | grep -nE "^START " | tail -1 | cut -d: -f1)
if [[ -n "$first_done_line" && -n "$last_start_line" && \
      "$last_start_line" -lt "$first_done_line" ]]; then
  ((PASS++)); echo "  PASS: STARTs precede DONEs"
else
  ((FAIL++)); echo "  FAIL: STARTs and DONEs interleaved"
  echo "     output: $output"
fi

start_count=$(count_lines_matching "$output" "START ")
done_count=$(count_lines_matching "$output" "DONE ")
all_done_count=$(count_lines_matching "$output" "ALL_DONE")

[[ "$start_count" -eq 3 ]] && { ((PASS++)); echo "  PASS: 3 START events"; } || \
  { ((FAIL++)); echo "  FAIL: expected 3 START got $start_count"; }
[[ "$done_count" -eq 3 ]] && { ((PASS++)); echo "  PASS: 3 DONE events"; } || \
  { ((FAIL++)); echo "  FAIL: expected 3 DONE got $done_count"; }
[[ "$all_done_count" -eq 1 ]] && { ((PASS++)); echo "  PASS: exactly 1 ALL_DONE"; } || \
  { ((FAIL++)); echo "  FAIL: expected 1 ALL_DONE got $all_done_count"; }

# ============================================================
echo "--- Test: failing reviewer reports FAIL ---"
# ============================================================

# Override claude with the failing mock
cp "$MOCK_DIR/claude-fail" "$MOCK_DIR/claude"
output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" "claude:test" 2>&1)
rc=$?

assert_exit_code "orchestrator still exits 0 even with FAIL" "$rc" 0
assert_contains "FAIL emitted with exit_code" "$output" "FAIL claude:test exit_code=7"
assert_contains "FAIL emitted with log path" "$output" "log=/tmp/xreview-"
assert_contains "ALL_DONE still emitted after FAIL" "$output" "ALL_DONE"

# Restore happy claude mock for downstream tests
cat > "$MOCK_DIR/claude" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_CLAUDE_CALLED args=$*"
cat
echo "MOCK_CLAUDE_DONE"
exit 0
MOCK_EOF
chmod +x "$MOCK_DIR/claude"

# ============================================================
echo "--- Test: unknown CLI reports FAIL ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" "unknowncli:model" 2>&1)
rc=$?

assert_exit_code "unknown cli still exits 0" "$rc" 0
assert_contains "unknown cli START emitted" "$output" "START unknowncli:model"
assert_contains "unknown cli FAIL emitted" "$output" "FAIL unknowncli:model exit_code=1"

# ============================================================
echo "--- Test: log file actually written ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" "claude:log-test-model" 2>&1)
log_path=$(echo "$output" | grep -E "^DONE " | sed -E 's/.*log=//; s/^DONE [^ ]+ //')

if [[ -n "$log_path" && -f "$log_path" ]]; then
  ((PASS++)); echo "  PASS: log file exists at $log_path"
  if grep -q "MOCK_CLAUDE_CALLED" "$log_path"; then
    ((PASS++)); echo "  PASS: log file contains mock output"
  else
    ((FAIL++)); echo "  FAIL: log file empty or missing mock marker"
  fi
  rm -f "$log_path"
else
  ((FAIL++)); echo "  FAIL: log file not found at '$log_path'"
fi

# ============================================================
echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
