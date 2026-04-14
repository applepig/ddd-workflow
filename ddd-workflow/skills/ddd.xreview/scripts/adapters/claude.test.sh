#!/usr/bin/env bash
# claude.test.sh — claude adapter unit tests.
# Source (from adapters.test.sh runner) or run standalone.

set -uo pipefail

# Resolve sibling common library: this file lives at scripts/adapters/, common
# at scripts/ one level up. Overrideable so the runner doesn't re-source.
: "${ADAPTER_TEST_COMMON_SOURCED:=0}"
if [[ "$ADAPTER_TEST_COMMON_SOURCED" != "1" ]]; then
  _claude_test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ADAPTER_TEST_SCRIPT_DIR="$(cd "$_claude_test_dir/.." && pwd)"
  # shellcheck source=../adapters.test.common.sh
  source "$ADAPTER_TEST_SCRIPT_DIR/adapters.test.common.sh"
  ADAPTER_TEST_COMMON_SOURCED=1
fi

run_claude_adapter_tests() {
  init_adapter_env

  # ============================================================
  echo "--- Test: claude adapter dispatch ---"
  # ============================================================
  # M7 / ADR-11: claude adapter emits the CLI's JSON on stdout, pipes it through
  # jq -r '.result' to $final_out, and lets stderr flow naturally as verbose.
  # Mock prints a minimal `{"result": "..."}` on stdout and noisy markers on
  # stderr so (a) existing flag assertions work under `2>&1`, and (b) we can
  # check <final-out> only contains the extracted .result text.

  cat > "$MOCK_DIR/claude" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_CALLED: $(basename "$0") $*" >&2
stdin_content="$(cat)"
if [[ -n "$stdin_content" ]]; then
  echo "MOCK_STDIN: $stdin_content" >&2
fi
printf '{"result": "MOCK_CLAUDE_REVIEW_TEXT"}\n'
exit 0
MOCK_EOF
  chmod +x "$MOCK_DIR/claude"

  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$PATH" bash "$ADAPTER_DIR/claude.sh" "$PROMPT_FILE" "claude-opus-4-6" "$FINAL_OUT" 2>&1)
  rc=$?

  assert_exit_code "claude adapter exits 0" "$rc" 0
  assert_contains "claude adapter calls cli" "$output" "MOCK_CALLED: claude -p"
  assert_contains "claude adapter passes reviewer agent" "$output" "--agent ddd-reviewer"
  assert_contains "claude adapter passes model" "$output" "--model claude-opus-4-6"
  assert_contains "claude adapter forwards stdin" "$output" "MOCK_STDIN: test review prompt content"
  assert_contains "claude adapter uses --output-format json" "$output" "--output-format json"
  assert_contains "claude adapter passes --debug-file" "$output" "--debug-file"

  # Dual-output: <final-out> should contain ONLY the extracted .result text.
  final_content="$(cat "$FINAL_OUT")"
  if [[ "$final_content" == "MOCK_CLAUDE_REVIEW_TEXT" ]]; then
    ((PASS++)); echo "  PASS: claude final-out contains only .result text"
  else
    ((FAIL++)); echo "  FAIL: claude final-out expected 'MOCK_CLAUDE_REVIEW_TEXT', got: '$final_content'"
  fi

  if grep -qF '"result"' "$FINAL_OUT"; then
    ((FAIL++)); echo "  FAIL: claude final-out still contains raw JSON envelope"
  else
    ((PASS++)); echo "  PASS: claude final-out has no raw JSON envelope"
  fi

  if grep -qF 'MOCK_CALLED' "$FINAL_OUT" || grep -qF 'MOCK_STDIN' "$FINAL_OUT"; then
    ((FAIL++)); echo "  FAIL: claude final-out leaked stderr verbose markers"
  else
    ((PASS++)); echo "  PASS: claude final-out free of stderr verbose markers"
  fi

  # ============================================================
  echo "--- Test: claude adapter — jq guard (Finding 1) ---"
  # ============================================================
  # ADR-11: claude adapter pipes CLI stdout through `jq -r '.result'`. If jq is
  # missing the pipeline silently produces an empty final, masking the root
  # cause as a content-layer failure. Adapter must guard early with rc=1.

  # Static check: header has the guard line.
  if grep -qE 'command -v jq' "$ADAPTER_DIR/claude.sh"; then
    ((PASS++)); echo "  PASS: claude.sh has 'command -v jq' guard"
  else
    ((FAIL++)); echo "  FAIL: claude.sh missing 'command -v jq' guard"
  fi

  # Static check: stdout contract comment.
  if grep -qF 'stdout contract: must be empty' "$ADAPTER_DIR/claude.sh"; then
    ((PASS++)); echo "  PASS: claude.sh has stdout contract comment"
  else
    ((FAIL++)); echo "  FAIL: claude.sh missing stdout contract comment"
  fi

  # Behavioral check: PATH without jq → adapter exits 1 with descriptive stderr.
  cat > "$MOCK_DIR/claude" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_CALLED: claude $*" >&2
cat > /dev/null
printf '{"result":"unused"}\n'
exit 0
MOCK_EOF
  chmod +x "$MOCK_DIR/claude"

  no_jq_sys=$(make_jq_missing_sysdir)
  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$no_jq_sys" bash "$ADAPTER_DIR/claude.sh" \
    "$PROMPT_FILE" "claude-opus-4-6" "$FINAL_OUT" 2>&1)
  rc=$?

  assert_exit_code "claude jq-missing exits 1" "$rc" 1
  assert_contains "claude jq-missing stderr message" "$output" \
    "XREVIEW_ERROR: jq not found"

  # Universal contracts (missing prompt, missing CLI, passthrough).
  run_universal_adapter_contracts claude
}

# Standalone execution: if invoked directly (not source'd by the runner), run
# the tests and print results.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  run_claude_adapter_tests
  print_adapter_test_results
fi
