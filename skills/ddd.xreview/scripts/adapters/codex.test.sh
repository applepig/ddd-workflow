#!/usr/bin/env bash
# codex.test.sh — codex adapter unit tests.

set -uo pipefail

: "${ADAPTER_TEST_COMMON_SOURCED:=0}"
if [[ "$ADAPTER_TEST_COMMON_SOURCED" != "1" ]]; then
  _cx_test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ADAPTER_TEST_SCRIPT_DIR="$(cd "$_cx_test_dir/.." && pwd)"
  # shellcheck source=../adapters.test.common.sh
  source "$ADAPTER_TEST_SCRIPT_DIR/adapters.test.common.sh"
  ADAPTER_TEST_COMMON_SOURCED=1
fi

run_codex_adapter_tests() {
  init_adapter_env

  # Isolated HOME + XDG sandbox so we control which toml codex.sh finds.
  CODEX_HOME_DIR=$(mktemp -d)
  CODEX_XDG_DIR=$(mktemp -d)
  register_cleanup "$CODEX_HOME_DIR" "$CODEX_XDG_DIR"

  # ============================================================
  echo "--- Test: codex adapter dispatch ---"
  # ============================================================
  # M7 / ADR-11 + ADR-12: codex adapter calls `codex exec -o <final-out>` so
  # the CLI writes final text directly to the file; stderr flows naturally.
  # ADR-12: adapter reads `~/.codex/agents/ddd-reviewer.toml` and prepends
  # `developer_instructions` to the prompt.

  cat > "$MOCK_DIR/codex" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_CALLED: $(basename "$0") $*" >&2
stdin_content="$(cat)"
if [[ -n "$stdin_content" ]]; then
  while IFS= read -r line; do
    echo "MOCK_STDIN: $line" >&2
  done <<< "$stdin_content"
fi
out_file=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out_file="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [[ -n "$out_file" ]]; then
  printf 'MOCK_CODEX_FINAL_TEXT' > "$out_file"
fi
exit 0
MOCK_EOF
  chmod +x "$MOCK_DIR/codex"

  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$PATH" HOME="$CODEX_HOME_DIR" XDG_CONFIG_HOME="$CODEX_XDG_DIR" \
    bash "$ADAPTER_DIR/codex.sh" "$PROMPT_FILE" "o3" "$FINAL_OUT" 2>&1)
  rc=$?

  assert_exit_code "codex adapter exits 0" "$rc" 0
  assert_contains "codex adapter calls cli" "$output" "MOCK_CALLED: codex exec"
  assert_contains "codex adapter passes sandbox" "$output" "--sandbox read-only"
  assert_contains "codex adapter passes model" "$output" "--model o3"
  assert_contains "codex adapter forwards stdin" "$output" "MOCK_STDIN: test review prompt content"
  assert_contains "codex adapter passes -o final-out" "$output" "-o $FINAL_OUT"

  final_content="$(cat "$FINAL_OUT")"
  if [[ "$final_content" == "MOCK_CODEX_FINAL_TEXT" ]]; then
    ((PASS++)); echo "  PASS: codex final-out written by CLI via -o flag"
  else
    ((FAIL++)); echo "  FAIL: codex final-out expected 'MOCK_CODEX_FINAL_TEXT', got: '$final_content'"
  fi
  if grep -qF 'MOCK_CALLED' "$FINAL_OUT" || grep -qF 'MOCK_STDIN' "$FINAL_OUT"; then
    ((FAIL++)); echo "  FAIL: codex final-out leaked stderr verbose markers"
  else
    ((PASS++)); echo "  PASS: codex final-out free of stderr verbose markers"
  fi

  # ============================================================
  echo "--- Test: codex adapter prepends developer_instructions (ADR-12) ---"
  # ============================================================
  mkdir -p "$CODEX_XDG_DIR/codex/agents"
  cat > "$CODEX_XDG_DIR/codex/agents/ddd-reviewer.toml" << 'TOML_EOF'
name = "ddd-reviewer"
developer_instructions = """
MOCK_DDD_REVIEWER_SYSTEM_PROMPT_MARKER
Read the diff carefully.
"""
TOML_EOF

  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$PATH" HOME="$CODEX_HOME_DIR" XDG_CONFIG_HOME="$CODEX_XDG_DIR" \
    bash "$ADAPTER_DIR/codex.sh" "$PROMPT_FILE" "o3" "$FINAL_OUT" 2>&1)
  rc=$?

  assert_exit_code "codex prepend dispatch exits 0" "$rc" 0
  if echo "$output" | grep -qF 'MOCK_STDIN: MOCK_DDD_REVIEWER_SYSTEM_PROMPT_MARKER'; then
    ((PASS++)); echo "  PASS: codex prepends developer_instructions from XDG toml"
  else
    ((FAIL++)); echo "  FAIL: codex did not prepend developer_instructions"
    echo "     got: $(printf '%s' "$output" | head -10)"
  fi
  assert_contains "codex keeps original prompt after prepend" "$output" "MOCK_STDIN: test review prompt content"

  marker_line=$(echo "$output" | grep -nF 'MOCK_STDIN: MOCK_DDD_REVIEWER_SYSTEM_PROMPT_MARKER' | head -1 | cut -d: -f1)
  original_line=$(echo "$output" | grep -nF 'MOCK_STDIN: test review prompt content' | head -1 | cut -d: -f1)
  if [[ -n "$marker_line" && -n "$original_line" && "$marker_line" -lt "$original_line" ]]; then
    ((PASS++)); echo "  PASS: developer_instructions appears BEFORE original prompt"
  else
    ((FAIL++)); echo "  FAIL: ordering wrong (marker@${marker_line:-?}, original@${original_line:-?})"
  fi

  # ============================================================
  echo "--- Test: codex adapter falls back to \$HOME/.codex when XDG has no toml ---"
  # ============================================================
  rm -rf "$CODEX_XDG_DIR/codex"
  mkdir -p "$CODEX_HOME_DIR/.codex/agents"
  cat > "$CODEX_HOME_DIR/.codex/agents/ddd-reviewer.toml" << 'TOML_EOF'
name = "ddd-reviewer"
developer_instructions = "HOME_CODEX_FALLBACK_MARKER"
TOML_EOF

  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$PATH" HOME="$CODEX_HOME_DIR" XDG_CONFIG_HOME="$CODEX_XDG_DIR" \
    bash "$ADAPTER_DIR/codex.sh" "$PROMPT_FILE" "o3" "$FINAL_OUT" 2>&1)
  rc=$?

  assert_exit_code "codex HOME fallback dispatch exits 0" "$rc" 0
  if echo "$output" | grep -qF 'HOME_CODEX_FALLBACK_MARKER'; then
    ((PASS++)); echo "  PASS: codex falls back to \$HOME/.codex/agents toml"
  else
    ((FAIL++)); echo "  FAIL: codex fallback to \$HOME/.codex not working"
  fi

  # ============================================================
  echo "--- Test: codex adapter graceful degradation when toml missing ---"
  # ============================================================
  rm -rf "$CODEX_HOME_DIR/.codex" "$CODEX_XDG_DIR/codex"

  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$PATH" HOME="$CODEX_HOME_DIR" XDG_CONFIG_HOME="$CODEX_XDG_DIR" \
    bash "$ADAPTER_DIR/codex.sh" "$PROMPT_FILE" "o3" "$FINAL_OUT" 2>&1)
  rc=$?

  assert_exit_code "codex degradation exits 0" "$rc" 0
  assert_contains "codex degradation still forwards original prompt" "$output" \
    "MOCK_STDIN: test review prompt content"
  assert_contains "codex degradation emits warning on stderr" "$output" \
    "XREVIEW_WARN: codex ddd-reviewer.toml"

  final_content="$(cat "$FINAL_OUT")"
  if [[ "$final_content" == "MOCK_CODEX_FINAL_TEXT" ]]; then
    ((PASS++)); echo "  PASS: codex degradation still produces final-out"
  else
    ((FAIL++)); echo "  FAIL: codex degradation final-out unexpected: '$final_content'"
  fi

  if echo "$output" | grep -qF 'MOCK_DDD_REVIEWER_SYSTEM_PROMPT_MARKER'; then
    ((FAIL++)); echo "  FAIL: codex degradation still prepended something"
  else
    ((PASS++)); echo "  PASS: codex degradation sends only original prompt"
  fi

  # ============================================================
  echo "--- Test: codex adapter — stdout contract comment (Finding 3) ---"
  # ============================================================
  # codex doesn't use jq (writes via -o), so no jq guard expected. But the
  # stdout contract comment still applies (CLI may print progress to stdout
  # depending on flags; -o keeps final off stdout).
  if grep -qF 'stdout contract: must be empty' "$ADAPTER_DIR/codex.sh"; then
    ((PASS++)); echo "  PASS: codex.sh has stdout contract comment"
  else
    ((FAIL++)); echo "  FAIL: codex.sh missing stdout contract comment"
  fi

  # ============================================================
  echo "--- Test: codex adapter — python stderr surfaced on parse failure (Finding 2) ---"
  # ============================================================
  # When python tomllib parsing fails, the original `2>/dev/null` swallowed the
  # real error. Adapter must capture python stderr and embed a snippet in the
  # XREVIEW_WARN line so users can debug without re-running manually.

  # Place a malformed toml in XDG so codex.sh tries python parse and fails.
  mkdir -p "$CODEX_XDG_DIR/codex/agents"
  cat > "$CODEX_XDG_DIR/codex/agents/ddd-reviewer.toml" << 'TOML_EOF'
this is not = valid """ toml at all
TOML_EOF

  # Mock python3 in MOCK_DIR that always emits a recognisable error to stderr
  # and exits 2 (parse-failure code per the adapter convention).
  cat > "$MOCK_DIR/python3" << 'PY_EOF'
#!/usr/bin/env bash
# Mock python3: emit identifiable stderr line, exit 2 (parse failure).
echo "MOCK_PYTHON_TOMLLIB_PARSE_ERROR_LINE_42" >&2
exit 2
PY_EOF
  chmod +x "$MOCK_DIR/python3"

  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$PATH" HOME="$CODEX_HOME_DIR" XDG_CONFIG_HOME="$CODEX_XDG_DIR" \
    bash "$ADAPTER_DIR/codex.sh" "$PROMPT_FILE" "o3" "$FINAL_OUT" 2>&1)
  rc=$?

  assert_exit_code "codex python-stderr-surface dispatch exits 0" "$rc" 0
  assert_contains "codex emits XREVIEW_WARN on python parse failure" "$output" \
    "XREVIEW_WARN: codex ddd-reviewer.toml"
  if echo "$output" | grep -qF 'python stderr:'; then
    ((PASS++)); echo "  PASS: codex XREVIEW_WARN includes 'python stderr:' label"
  else
    ((FAIL++)); echo "  FAIL: codex XREVIEW_WARN missing 'python stderr:' label"
    echo "     got: $(printf '%s' "$output" | grep -E 'XREVIEW_WARN' | head -3)"
  fi
  if echo "$output" | grep -qF 'MOCK_PYTHON_TOMLLIB_PARSE_ERROR_LINE_42'; then
    ((PASS++)); echo "  PASS: codex surfaces actual python stderr text in warning"
  else
    ((FAIL++)); echo "  FAIL: codex did not surface python stderr text in warning"
    echo "     got: $(printf '%s' "$output" | grep -E 'XREVIEW_WARN' | head -3)"
  fi

  # Remove mock python3 to restore default behaviour for subsequent tests.
  rm -f "$MOCK_DIR/python3"

  # ============================================================
  echo "--- Test: codex adapter — extraction-path log entry (Finding 2) ---"
  # ============================================================
  # Adapter should log which extraction path it took (python_tomllib /
  # python_tomli / awk_fallback) so debugging python-version issues is easier.
  # We re-use the XDG toml from the prepend test (valid toml, real python).
  rm -f "$CODEX_XDG_DIR/codex/agents/ddd-reviewer.toml"
  cat > "$CODEX_XDG_DIR/codex/agents/ddd-reviewer.toml" << 'TOML_EOF'
name = "ddd-reviewer"
developer_instructions = "PATH_LOG_TEST_MARKER"
TOML_EOF

  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$PATH" HOME="$CODEX_HOME_DIR" XDG_CONFIG_HOME="$CODEX_XDG_DIR" \
    bash "$ADAPTER_DIR/codex.sh" "$PROMPT_FILE" "o3" "$FINAL_OUT" 2>&1)
  rc=$?

  assert_exit_code "codex extraction-path log dispatch exits 0" "$rc" 0
  if echo "$output" | grep -qE 'XREVIEW_INFO: codex toml extracted via (python_tomllib|python_tomli|awk_fallback)'; then
    ((PASS++)); echo "  PASS: codex logs which toml extraction path was used"
  else
    ((FAIL++)); echo "  FAIL: codex did not log the toml extraction path"
    echo "     got: $(printf '%s' "$output" | grep -E 'XREVIEW' | head -3)"
  fi

  # Universal contracts.
  run_universal_adapter_contracts codex
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  run_codex_adapter_tests
  print_adapter_test_results
fi
