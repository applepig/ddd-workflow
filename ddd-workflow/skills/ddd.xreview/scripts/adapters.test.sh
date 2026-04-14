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

# Mock that exits with a specific code and emits a marker on stdout/stderr.
# Used to assert adapter passes rc through unchanged (no more 124 re-write).
write_rc_mock() {
  local cli="$1" rc="$2"
  cat > "$MOCK_DIR/$cli" << MOCK_EOF
#!/usr/bin/env bash
cat > /dev/null
echo "MOCK_${cli^^}_RC_${rc}"
exit ${rc}
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
echo "--- Test: adapter is pure passthrough (no internal timeout) ---"
# ============================================================
# After M5.1 (ADR-6), timeout is enforced only at the orchestrator layer.
# Adapters must not run `timeout --foreground` themselves — they pass the CLI
# exit code through unchanged, including 124 if upstream happens to emit it.

for cli in claude opencode gemini codex; do
  # Mock sleeps 3s, adapter's 3rd arg is 1s. Old behavior: adapter kills at 1s
  # with rc=124 and "XREVIEW_ERROR: timed out". New behavior: adapter ignores
  # the timeout arg, waits for the mock to finish (rc=0), emits no error.
  write_timeout_mock "$cli"
  output=$(PATH="$MOCK_DIR:$PATH" timeout 8 bash "$ADAPTER_DIR/$cli.sh" "$PROMPT_FILE" "test-model" 1 2>&1)
  rc=$?

  assert_exit_code "$cli adapter does not enforce timeout (rc passthrough)" "$rc" 0
  if echo "$output" | grep -qF "XREVIEW_ERROR: timed out"; then
    ((FAIL++)); echo "  FAIL: $cli adapter still emits 'timed out' message (must be removed)"
  else
    ((PASS++)); echo "  PASS: $cli adapter emits no timed-out message"
  fi

  # Arbitrary non-zero code must pass through unchanged (no rewriting at all).
  write_rc_mock "$cli" 7
  output=$(PATH="$MOCK_DIR:$PATH" bash "$ADAPTER_DIR/$cli.sh" "$PROMPT_FILE" "test-model" 1 2>&1)
  rc=$?
  assert_exit_code "$cli adapter passes through rc=7" "$rc" 7
done

# ============================================================
echo "--- Test: opencode adapter passes sandbox permission env (ADR-9) ---"
# ============================================================
# OpenCode workspace sandbox blocks /tmp and ~/.config by default. The adapter
# must set OPENCODE_PERMISSION to an inline JSON that allow-lists both paths,
# so the reviewer agent can read the prompt file and xreview.json config.

# Mock opencode that prints the OPENCODE_PERMISSION env var it received.
cat > "$MOCK_DIR/opencode" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_CALLED: opencode $*"
echo "MOCK_OPENCODE_PERMISSION=${OPENCODE_PERMISSION:-<unset>}"
cat > /dev/null
exit 0
MOCK_EOF
chmod +x "$MOCK_DIR/opencode"

output=$(PATH="$MOCK_DIR:$PATH" bash "$ADAPTER_DIR/opencode.sh" "$PROMPT_FILE" "some-model" 5 2>&1)
rc=$?

assert_exit_code "opencode sandbox adapter exits 0" "$rc" 0
assert_contains "opencode adapter sets OPENCODE_PERMISSION env" "$output" "MOCK_OPENCODE_PERMISSION="

# Extract the permission JSON and verify its contents with jq.
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

  # M6.3: config glob must be absolute (XDG-resolved), not literal "~/.config".
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

# Restore happy opencode mock for any downstream tests.
write_happy_mock opencode

# ============================================================
echo "--- Test: opencode adapter honors XDG_CONFIG_HOME override (M6.3) ---"
# ============================================================
# When XDG_CONFIG_HOME is set (e.g. NixOS / custom setups), the permission
# JSON must point at that directory, not the default $HOME/.config.

write_happy_mock opencode
cat > "$MOCK_DIR/opencode" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_OPENCODE_PERMISSION=${OPENCODE_PERMISSION:-<unset>}"
cat > /dev/null
exit 0
MOCK_EOF
chmod +x "$MOCK_DIR/opencode"

output=$(PATH="$MOCK_DIR:$PATH" XDG_CONFIG_HOME=/xdg/override \
  bash "$ADAPTER_DIR/opencode.sh" "$PROMPT_FILE" "some-model" 5 2>&1)
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

write_happy_mock opencode

# ============================================================
echo "--- Test: gemini adapter passes sandbox include-directories flag (ADR-9) ---"
# ============================================================
# Gemini's workspace sandbox blocks paths outside the project root.
# The adapter must pass `--include-directories /tmp,<config_dir>` so the
# reviewer can read the prompt file and xreview.json config.

# Reinstall happy gemini mock (previous passthrough test left rc=7 mock in place).
write_happy_mock gemini

output=$(PATH="$MOCK_DIR:$PATH" bash "$ADAPTER_DIR/gemini.sh" "$PROMPT_FILE" "gemini-test" 5 2>&1)
rc=$?

assert_exit_code "gemini sandbox adapter exits 0" "$rc" 0
assert_contains "gemini adapter passes --include-directories flag" "$output" "--include-directories"
assert_contains "gemini --include-directories includes /tmp" "$output" "/tmp,"
assert_contains "gemini --include-directories includes \$HOME/.config" "$output" "$HOME/.config"

# ============================================================
echo "--- Test: gemini adapter honors XDG_CONFIG_HOME override (M6.3) ---"
# ============================================================
write_happy_mock gemini

output=$(PATH="$MOCK_DIR:$PATH" XDG_CONFIG_HOME=/xdg/override \
  bash "$ADAPTER_DIR/gemini.sh" "$PROMPT_FILE" "gemini-test" 5 2>&1)
rc=$?

assert_exit_code "gemini XDG override adapter exits 0" "$rc" 0
assert_contains "gemini --include-directories honors XDG_CONFIG_HOME" \
  "$output" "/tmp,/xdg/override"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
