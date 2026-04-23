#!/usr/bin/env bash
# adapters.test.common.sh — source-only library for per-CLI adapter tests.
#
# This file declares shared state and helpers used by:
#   - adapters/claude.test.sh
#   - adapters/codex.test.sh
#   - adapters/gemini.test.sh
#   - adapters/opencode.test.sh
#   - adapters.test.sh (the runner that sources all four)
#
# The file MUST NOT execute any tests. Per-CLI files call `init_adapter_env`
# before their first assertion, and the runner accumulates PASS/FAIL by sourcing
# each per-CLI file in sequence within a single shell (shared counter).
#
# Isolation contract:
#   - PASS/FAIL are globals (declared here if unset).
#   - $MOCK_DIR, $PROMPT_FILE, $FINAL_OUT are re-created per init call so a
#     per-CLI file can be re-run idempotently inside the runner.
#   - Per-CLI files register their own cleanup via `register_cleanup`; the
#     common trap fires on EXIT once, removing every registered path.

# Resolve paths relative to the scripts/ directory (parent of this file or
# parent of adapters/ when sourced from a per-CLI test file).
if [[ -z "${ADAPTER_TEST_SCRIPT_DIR:-}" ]]; then
  # This file lives at scripts/adapters.test.common.sh.
  ADAPTER_TEST_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
ADAPTER_DIR="$ADAPTER_TEST_SCRIPT_DIR/adapters"

# Global counters. Guarded so the runner can accumulate across per-CLI sources.
: "${PASS:=0}"
: "${FAIL:=0}"

# Registry of tmp paths to clean on EXIT. Per-CLI files can append via
# register_cleanup; the trap expands the array at cleanup time.
ADAPTER_TEST_CLEANUP_PATHS=()

register_cleanup() {
  local p
  for p in "$@"; do
    ADAPTER_TEST_CLEANUP_PATHS+=("$p")
  done
}

_adapter_test_cleanup() {
  local p
  for p in "${ADAPTER_TEST_CLEANUP_PATHS[@]:-}"; do
    [[ -n "$p" ]] && rm -rf "$p" 2>/dev/null || true
  done
}
trap _adapter_test_cleanup EXIT

# init_adapter_env — (re)initialise $MOCK_DIR, $PROMPT_FILE, $FINAL_OUT.
# Idempotent: subsequent calls create fresh tmpdirs without leaking the old ones
# (they're registered for EXIT cleanup anyway).
init_adapter_env() {
  MOCK_DIR=$(mktemp -d)
  PROMPT_FILE=$(mktemp /tmp/xreview-adapter-test-XXXXXX.md)
  echo "test review prompt content" > "$PROMPT_FILE"
  FINAL_OUT=$(mktemp /tmp/xreview-adapter-final-XXXXXX.txt)
  register_cleanup "$MOCK_DIR" "$PROMPT_FILE" "$FINAL_OUT"
}

# --- Assertion helpers -------------------------------------------------------

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

# --- jq-missing PATH helper --------------------------------------------------
# Builds a PATH that contains the mock CLI dir + a curated system dir holding
# symlinks to common utilities (cat, mktemp, awk, python3, etc.) but
# deliberately omits `jq`. Used by Finding 1 tests (jq guard) so adapters that
# require jq see `command -v jq` return empty and exit early.
#
# Returns the curated system dir path on stdout; caller is responsible for
# composing PATH (typically `PATH="$MOCK_DIR:<returned>"`). The returned dir is
# auto-registered for cleanup.
make_jq_missing_sysdir() {
  local sysdir cmd src
  sysdir=$(mktemp -d)
  register_cleanup "$sysdir"
  for cmd in cat mktemp basename grep sed awk dirname tr head tail rm cut \
             python3 echo printf bash sh ls find chmod cp mv tee sleep \
             timeout date wc sort uniq xargs which env tomli; do
    src=$(command -v "$cmd" 2>/dev/null) || continue
    [[ -n "$src" ]] && ln -sf "$src" "$sysdir/$cmd" 2>/dev/null || true
  done
  printf '%s' "$sysdir"
}

# --- Mock CLI writers --------------------------------------------------------
# These are the legacy mocks used by the cross-cutting tests (missing prompt,
# missing CLI, passthrough). Per-CLI adapter-specific mocks (dual-output JSON,
# ndjson, -o flag) are inlined inside each per-CLI test file because their
# shape is tied to that adapter's stdout contract.

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

# Cross-CLI test helper: runs the three universal contracts (missing prompt,
# CLI not installed, passthrough) for a single adapter. Called from each
# per-CLI test file so coverage stays at 1×(universal tests)×(N CLIs).
run_universal_adapter_contracts() {
  local cli="$1"

  echo "--- Test: $cli adapter — prompt file missing ---"
  output=$(PATH="$MOCK_DIR:$PATH" bash "$ADAPTER_DIR/$cli.sh" "/nonexistent/prompt.md" "test-model" "$FINAL_OUT" 2>&1)
  rc=$?
  assert_exit_code "$cli missing prompt exits 1" "$rc" 1
  assert_contains "$cli missing prompt message" "$output" "XREVIEW_ERROR: prompt file not found"

  echo "--- Test: $cli adapter — CLI not installed ---"
  local no_cli_dir
  no_cli_dir=$(mktemp -d)
  register_cleanup "$no_cli_dir"
  output=$(PATH="$no_cli_dir:/usr/bin:/bin" bash "$ADAPTER_DIR/$cli.sh" "$PROMPT_FILE" "test-model" "$FINAL_OUT" 2>&1)
  rc=$?
  assert_exit_code "$cli missing binary exits 1" "$rc" 1
  assert_contains "$cli missing binary message" "$output" "XREVIEW_ERROR: cli not found: $cli"

  echo "--- Test: $cli adapter — pure passthrough (no internal timeout) ---"
  # ADR-6: timeout lives at the orchestrator layer, not in adapters.
  write_timeout_mock "$cli"
  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$PATH" timeout 8 bash "$ADAPTER_DIR/$cli.sh" "$PROMPT_FILE" "test-model" "$FINAL_OUT" 2>&1)
  rc=$?
  assert_exit_code "$cli adapter does not enforce timeout (rc passthrough)" "$rc" 0
  if echo "$output" | grep -qF "XREVIEW_ERROR: timed out"; then
    ((FAIL++)); echo "  FAIL: $cli adapter still emits 'timed out' message (must be removed)"
  else
    ((PASS++)); echo "  PASS: $cli adapter emits no timed-out message"
  fi

  # Arbitrary non-zero code must pass through unchanged (no rewriting at all).
  write_rc_mock "$cli" 7
  : > "$FINAL_OUT"
  output=$(PATH="$MOCK_DIR:$PATH" bash "$ADAPTER_DIR/$cli.sh" "$PROMPT_FILE" "test-model" "$FINAL_OUT" 2>&1)
  rc=$?
  assert_exit_code "$cli adapter passes through rc=7" "$rc" 7
}

# Called by per-CLI files when they're invoked standalone (not via runner).
# Prints the final tally and returns non-zero if any test failed.
print_adapter_test_results() {
  echo ""
  echo "Results: $PASS passed, $FAIL failed"
  [[ $FAIL -eq 0 ]]
}
