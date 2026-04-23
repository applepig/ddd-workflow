#!/usr/bin/env bash
# opencode.test.sh — opencode adapter unit tests.

set -uo pipefail

: "${ADAPTER_TEST_COMMON_SOURCED:=0}"
if [[ "$ADAPTER_TEST_COMMON_SOURCED" != "1" ]]; then
  _oc_test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ADAPTER_TEST_SCRIPT_DIR="$(cd "$_oc_test_dir/.." && pwd)"
  # shellcheck source=../adapters.test.common.sh
  source "$ADAPTER_TEST_SCRIPT_DIR/adapters.test.common.sh"
  ADAPTER_TEST_COMMON_SOURCED=1
fi

run_opencode_adapter_tests() {
  init_adapter_env

  # ============================================================
  echo "--- Test: opencode adapter dispatch ---"
  # ============================================================
  # M7 / ADR-11: opencode adapter streams the CLI's ndjson on stdout through
  # `tee` (verbose side) into `jq -rs 'map(select(.type=="text"))|...'` which
  # concatenates all text-event `.part.text` fragments into $final_out.

  cat > "$MOCK_DIR/opencode" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_CALLED: $(basename "$0") $*" >&2
stdin_content="$(cat)"
if [[ -n "$stdin_content" ]]; then
  echo "MOCK_STDIN: $stdin_content" >&2
fi
printf '%s\n' \
  '{"type":"text","timestamp":1,"sessionID":"s1","part":{"type":"text","text":"MOCK_OPENCODE_"}}' \
  '{"type":"tool","timestamp":2,"sessionID":"s1","part":{"type":"tool_use","name":"bash"}}' \
  '{"type":"text","timestamp":3,"sessionID":"s1","part":{"type":"text","text":"REVIEW_TEXT"}}'
exit 0
MOCK_EOF
  chmod +x "$MOCK_DIR/opencode"

  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$PATH" bash "$ADAPTER_DIR/opencode.sh" "$PROMPT_FILE" "github-copilot/gpt-5.4" "$FINAL_OUT" 2>&1)
  rc=$?

  assert_exit_code "opencode adapter exits 0" "$rc" 0
  assert_contains "opencode adapter calls cli" "$output" "MOCK_CALLED: opencode run"
  assert_contains "opencode adapter passes reviewer agent" "$output" "--agent ddd.xreviewer"
  assert_contains "opencode adapter passes model" "$output" "--model github-copilot/gpt-5.4"
  assert_contains "opencode adapter forwards stdin" "$output" "MOCK_STDIN: test review prompt content"
  assert_contains "opencode adapter uses --format json" "$output" "--format json"

  final_content="$(cat "$FINAL_OUT")"
  if [[ "$final_content" == "MOCK_OPENCODE_REVIEW_TEXT" ]]; then
    ((PASS++)); echo "  PASS: opencode final-out concatenates text-event fragments"
  else
    ((FAIL++)); echo "  FAIL: opencode final-out expected 'MOCK_OPENCODE_REVIEW_TEXT', got: '$final_content'"
  fi

  if grep -qF '"type"' "$FINAL_OUT"; then
    ((FAIL++)); echo "  FAIL: opencode final-out still contains raw ndjson envelope"
  else
    ((PASS++)); echo "  PASS: opencode final-out has no raw ndjson envelope"
  fi

  if grep -qF 'tool_use' "$FINAL_OUT" || grep -qF 'bash' "$FINAL_OUT"; then
    ((FAIL++)); echo "  FAIL: opencode final-out leaked non-text event content"
  else
    ((PASS++)); echo "  PASS: opencode final-out filters out non-text events"
  fi

  if echo "$output" | grep -qF '"part":{"type":"text","text":"MOCK_OPENCODE_"}'; then
    ((PASS++)); echo "  PASS: opencode verbose side (stderr) preserves raw ndjson"
  else
    ((FAIL++)); echo "  FAIL: opencode verbose side missing raw ndjson for orchestrator log"
  fi

  # ============================================================
  echo "--- Test: opencode adapter passes sandbox permission env (ADR-9) ---"
  # ============================================================
  cat > "$MOCK_DIR/opencode" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_CALLED: opencode $*" >&2
echo "MOCK_OPENCODE_PERMISSION=${OPENCODE_PERMISSION:-<unset>}" >&2
cat > /dev/null
exit 0
MOCK_EOF
  chmod +x "$MOCK_DIR/opencode"

  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$PATH" bash "$ADAPTER_DIR/opencode.sh" "$PROMPT_FILE" "some-model" "$FINAL_OUT" 2>&1)
  rc=$?

  assert_exit_code "opencode sandbox adapter exits 0" "$rc" 0
  assert_contains "opencode adapter sets OPENCODE_PERMISSION env" "$output" "MOCK_OPENCODE_PERMISSION="

  permission_json=$(echo "$output" | grep -E '^MOCK_OPENCODE_PERMISSION=' | \
    head -1 | sed -E 's/^MOCK_OPENCODE_PERMISSION=//')

  if [[ -z "$permission_json" || "$permission_json" == "<unset>" ]]; then
    ((FAIL++)); echo "  FAIL: OPENCODE_PERMISSION was not set or empty"
  elif ! command -v jq >/dev/null 2>&1; then
    ((FAIL++)); echo "  FAIL: jq not available, cannot verify OPENCODE_PERMISSION JSON"
  else
    if echo "$permission_json" | jq -e '.external_directory' >/dev/null 2>&1; then
      ((PASS++)); echo "  PASS: OPENCODE_PERMISSION contains external_directory"
    else
      ((FAIL++)); echo "  FAIL: OPENCODE_PERMISSION missing external_directory key"
      echo "     got: $permission_json"
    fi

    tmp_rule=$(echo "$permission_json" | jq -r '.external_directory["/tmp/**"] // empty')
    if [[ "$tmp_rule" == "allow" ]]; then
      ((PASS++)); echo "  PASS: OPENCODE_PERMISSION allows /tmp/**"
    else
      ((FAIL++)); echo "  FAIL: OPENCODE_PERMISSION does not allow /tmp/** (got: '$tmp_rule')"
    fi

    expected_cfg_glob="${HOME}/.config/ddd-workflow/**"
    config_rule=$(echo "$permission_json" | jq -r --arg k "$expected_cfg_glob" \
      '.external_directory[$k] // empty')
    if [[ "$config_rule" == "allow" ]]; then
      ((PASS++)); echo "  PASS: OPENCODE_PERMISSION allows ${expected_cfg_glob}"
    else
      ((FAIL++)); echo "  FAIL: OPENCODE_PERMISSION does not allow ${expected_cfg_glob} (got: '$config_rule')"
      echo "     full JSON: $permission_json"
    fi
  fi

  # ============================================================
  echo "--- Test: opencode adapter honors XDG_CONFIG_HOME override (M6.3) ---"
  # ============================================================
  cat > "$MOCK_DIR/opencode" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_OPENCODE_PERMISSION=${OPENCODE_PERMISSION:-<unset>}" >&2
cat > /dev/null
exit 0
MOCK_EOF
  chmod +x "$MOCK_DIR/opencode"

  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$PATH" XDG_CONFIG_HOME=/xdg/override \
    bash "$ADAPTER_DIR/opencode.sh" "$PROMPT_FILE" "some-model" "$FINAL_OUT" 2>&1)
  rc=$?

  assert_exit_code "opencode XDG override adapter exits 0" "$rc" 0

  xdg_permission=$(echo "$output" | grep -E '^MOCK_OPENCODE_PERMISSION=' | \
    head -1 | sed -E 's/^MOCK_OPENCODE_PERMISSION=//')

  if command -v jq >/dev/null 2>&1; then
    xdg_rule=$(echo "$xdg_permission" | jq -r \
      '.external_directory["/xdg/override/ddd-workflow/**"] // empty')
    if [[ "$xdg_rule" == "allow" ]]; then
      ((PASS++)); echo "  PASS: OPENCODE_PERMISSION honors XDG_CONFIG_HOME override"
    else
      ((FAIL++)); echo "  FAIL: OPENCODE_PERMISSION does not allow /xdg/override/ddd-workflow/** (got: '$xdg_rule')"
      echo "     full JSON: $xdg_permission"
    fi
  else
    ((FAIL++)); echo "  FAIL: jq not available, cannot verify XDG override"
  fi

  # ============================================================
  echo "--- Test: opencode adapter — jq guard (Finding 1) ---"
  # ============================================================
  # opencode adapter uses jq twice: once eagerly for permission_json
  # construction, then on the ndjson stream. Both will silently fail without
  # the early guard. Adapter must exit 1 with descriptive stderr when jq is
  # missing.
  if grep -qE 'command -v jq' "$ADAPTER_DIR/opencode.sh"; then
    ((PASS++)); echo "  PASS: opencode.sh has 'command -v jq' guard"
  else
    ((FAIL++)); echo "  FAIL: opencode.sh missing 'command -v jq' guard"
  fi

  if grep -qF 'stdout contract: must be empty' "$ADAPTER_DIR/opencode.sh"; then
    ((PASS++)); echo "  PASS: opencode.sh has stdout contract comment"
  else
    ((FAIL++)); echo "  FAIL: opencode.sh missing stdout contract comment"
  fi

  cat > "$MOCK_DIR/opencode" << 'MOCK_EOF'
#!/usr/bin/env bash
cat > /dev/null
printf '{"type":"text","part":{"type":"text","text":"unused"}}\n'
exit 0
MOCK_EOF
  chmod +x "$MOCK_DIR/opencode"

  no_jq_sys=$(make_jq_missing_sysdir)
  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$no_jq_sys" bash "$ADAPTER_DIR/opencode.sh" \
    "$PROMPT_FILE" "github-copilot/gpt-5.4" "$FINAL_OUT" 2>&1)
  rc=$?

  assert_exit_code "opencode jq-missing exits 1" "$rc" 1
  assert_contains "opencode jq-missing stderr message" "$output" \
    "XREVIEW_ERROR: jq not found"

  # Universal contracts (missing prompt, missing CLI, passthrough).
  run_universal_adapter_contracts opencode
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  run_opencode_adapter_tests
  print_adapter_test_results
fi
