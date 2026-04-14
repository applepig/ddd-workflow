#!/usr/bin/env bash
# gemini.test.sh — gemini adapter unit tests.

set -uo pipefail

: "${ADAPTER_TEST_COMMON_SOURCED:=0}"
if [[ "$ADAPTER_TEST_COMMON_SOURCED" != "1" ]]; then
  _gm_test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ADAPTER_TEST_SCRIPT_DIR="$(cd "$_gm_test_dir/.." && pwd)"
  # shellcheck source=../adapters.test.common.sh
  source "$ADAPTER_TEST_SCRIPT_DIR/adapters.test.common.sh"
  ADAPTER_TEST_COMMON_SOURCED=1
fi

run_gemini_adapter_tests() {
  init_adapter_env

  # ============================================================
  echo "--- Test: gemini adapter dispatch ---"
  # ============================================================
  # M7 / ADR-11: gemini adapter emits the CLI's JSON on stdout, extracts
  # `.response` via jq into $final_out, stderr flows naturally as verbose.

  cat > "$MOCK_DIR/gemini" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_CALLED: $(basename "$0") $*" >&2
stdin_content="$(cat)"
if [[ -n "$stdin_content" ]]; then
  echo "MOCK_STDIN: $stdin_content" >&2
fi
printf '{"session_id":"mock-session","response":"MOCK_GEMINI_REVIEW_TEXT"}\n'
exit 0
MOCK_EOF
  chmod +x "$MOCK_DIR/gemini"

  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$PATH" bash "$ADAPTER_DIR/gemini.sh" "$PROMPT_FILE" "gemini-3-pro-preview" "$FINAL_OUT" 2>&1)
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
  assert_contains "gemini adapter uses --output-format json" "$output" "--output-format json"

  final_content="$(cat "$FINAL_OUT")"
  if [[ "$final_content" == "MOCK_GEMINI_REVIEW_TEXT" ]]; then
    ((PASS++)); echo "  PASS: gemini final-out contains only .response text"
  else
    ((FAIL++)); echo "  FAIL: gemini final-out expected 'MOCK_GEMINI_REVIEW_TEXT', got: '$final_content'"
  fi
  if grep -qF '"session_id"' "$FINAL_OUT"; then
    ((FAIL++)); echo "  FAIL: gemini final-out still contains raw JSON envelope"
  else
    ((PASS++)); echo "  PASS: gemini final-out has no raw JSON envelope"
  fi
  if grep -qF 'MOCK_CALLED' "$FINAL_OUT" || grep -qF 'MOCK_STDIN' "$FINAL_OUT"; then
    ((FAIL++)); echo "  FAIL: gemini final-out leaked stderr verbose markers"
  else
    ((PASS++)); echo "  PASS: gemini final-out free of stderr verbose markers"
  fi

  # ============================================================
  echo "--- Test: gemini adapter passes sandbox include-directories flag (ADR-9) ---"
  # ============================================================
  cat > "$MOCK_DIR/gemini" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_CALLED: $(basename "$0") $*" >&2
cat > /dev/null
printf '{"response":"mock"}\n'
exit 0
MOCK_EOF
  chmod +x "$MOCK_DIR/gemini"

  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$PATH" bash "$ADAPTER_DIR/gemini.sh" "$PROMPT_FILE" "gemini-test" "$FINAL_OUT" 2>&1)
  rc=$?

  assert_exit_code "gemini sandbox adapter exits 0" "$rc" 0
  assert_contains "gemini adapter passes --include-directories flag" "$output" "--include-directories"
  assert_contains "gemini --include-directories includes /tmp" "$output" "/tmp,"
  assert_contains "gemini --include-directories includes \$HOME/.config" "$output" "$HOME/.config"

  # ============================================================
  echo "--- Test: gemini adapter honors XDG_CONFIG_HOME override (M6.3) ---"
  # ============================================================
  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$PATH" XDG_CONFIG_HOME=/xdg/override \
    bash "$ADAPTER_DIR/gemini.sh" "$PROMPT_FILE" "gemini-test" "$FINAL_OUT" 2>&1)
  rc=$?

  assert_exit_code "gemini XDG override adapter exits 0" "$rc" 0
  assert_contains "gemini --include-directories honors XDG_CONFIG_HOME" \
    "$output" "/tmp,/xdg/override"

  # Universal contracts.
  run_universal_adapter_contracts gemini
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  run_gemini_adapter_tests
  print_adapter_test_results
fi
