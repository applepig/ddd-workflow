#!/usr/bin/env bash
# xreview-orchestrator.test.sh — unit + integration tests for xreview-orchestrator.sh
# Uses mock CLIs to test event stream format and dispatch logic.
# Run: bash ddd-workflow/skills/ddd.xreview2/scripts/xreview-orchestrator.test.sh
#
# NOTE on signal-handling test coverage:
#   - We test SIGTERM and SIGINT cleanup (the orchestrator's trap can run).
#   - We intentionally do NOT test SIGKILL because SIGKILL cannot be trapped;
#     when Monitor's timeout hits, the bash trap never fires. The mitigation
#     for that case is `setsid` process-group isolation at spawn time so the
#     OS can reap descendants via the process group — but we can't assert
#     that behavior from inside a test without simulating Monitor itself.

set -uo pipefail

PASS=0; FAIL=0
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ORCH="$SCRIPT_DIR/xreview-orchestrator.sh"

# --- Setup ---

MOCK_DIR=$(mktemp -d)
PROMPT_FILE=$(mktemp /tmp/xreview-test-XXXXXX.md)
echo "test review prompt content" > "$PROMPT_FILE"
trap 'rm -rf "$MOCK_DIR" "$PROMPT_FILE" /tmp/xreview-*-test-* /tmp/xreview-sigterm-test-* /tmp/xreview-sigint-test-* 2>/dev/null || true' EXIT

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

# Poll the given file until it has at least $expected lines, or up to ~5s.
# Used by signal-handling tests instead of a fixed sleep so they're not
# flaky under high CI load (process spawn + setsid + exec can take >2s).
wait_for_pid_file_lines() {
  local file="$1" expected="$2"
  local i
  for i in $(seq 1 50); do
    if [[ -f "$file" ]] && [[ "$(wc -l < "$file" 2>/dev/null)" -ge "$expected" ]]; then
      return 0
    fi
    sleep 0.1
  done
  return 1
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
assert_contains "START emits log path" "$output" "START claude:claude-haiku-4-5-20251001 /tmp/xreview-"
assert_contains "claude DONE emitted" "$output" "DONE claude:claude-haiku-4-5-20251001 /tmp/xreview-"
assert_contains "ALL_DONE emitted" "$output" "ALL_DONE"
assert_not_contains "no FAIL for happy path" "$output" "FAIL"

# Verify log file has meta header written by parent shell (so main agent can
# Read the log safely immediately after seeing START, without racing setsid).
done_log_path=$(echo "$output" | grep -E "^DONE " | head -1 | sed -E 's/.*(\/tmp\/xreview-[^ ]+)$/\1/')
if [[ -n "$done_log_path" && -f "$done_log_path" ]]; then
  if grep -q '^\[xreview\] START claude:claude-haiku-4-5-20251001 ' "$done_log_path"; then
    ((PASS++)); echo "  PASS: log file starts with meta START header"
  else
    ((FAIL++)); echo "  FAIL: meta START header missing from log"
    head -5 "$done_log_path"
  fi
  if grep -q "^\[xreview\] log=$done_log_path\$" "$done_log_path"; then
    ((PASS++)); echo "  PASS: log file contains self-referential log= line"
  else
    ((FAIL++)); echo "  FAIL: meta log= line missing from log"
  fi
  if grep -q '^\[xreview\] ---$' "$done_log_path"; then
    ((PASS++)); echo "  PASS: log file contains meta separator line"
  else
    ((FAIL++)); echo "  FAIL: meta separator missing from log"
  fi
  # Setsid body appends after the header, so MOCK marker must still be present
  if grep -q 'MOCK_CLAUDE_CALLED' "$done_log_path"; then
    ((PASS++)); echo "  PASS: setsid body output appended after meta header"
  else
    ((FAIL++)); echo "  FAIL: setsid body output missing (append failed?)"
  fi
  rm -f "$done_log_path"
else
  ((FAIL++)); echo "  FAIL: could not locate DONE log path for meta header check"
fi

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
echo "--- Test: opencode dispatch via runner ---"
# ============================================================

# opencode (and gemini/codex) go through xreview-runner.sh. The mock opencode
# in $MOCK_DIR just echoes args and exits 0 — runner preserves that exit code
# and the orchestrator emits DONE.
output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" "opencode:gpt-5-mini" 2>&1)
rc=$?

assert_exit_code "opencode reviewer exits 0" "$rc" 0
assert_contains "opencode START emitted with log path" "$output" \
  "START opencode:gpt-5-mini /tmp/xreview-"
assert_contains "opencode DONE emitted with log path" "$output" \
  "DONE opencode:gpt-5-mini /tmp/xreview-"
assert_contains "ALL_DONE emitted for opencode run" "$output" "ALL_DONE"
assert_not_contains "no FAIL for opencode happy path" "$output" "FAIL"

# Cleanup opencode log file.
opencode_log=$(echo "$output" | grep -E "^DONE opencode:" | \
  sed -E 's/.*(\/tmp\/xreview-[^ ]+)$/\1/')
[[ -n "$opencode_log" ]] && rm -f "$opencode_log"

# ============================================================
echo "--- Test: gemini dispatch via runner ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" "gemini:gemini-3-flash" 2>&1)
rc=$?

assert_exit_code "gemini reviewer exits 0" "$rc" 0
assert_contains "gemini START emitted with log path" "$output" \
  "START gemini:gemini-3-flash /tmp/xreview-"
assert_contains "gemini DONE emitted with log path" "$output" \
  "DONE gemini:gemini-3-flash /tmp/xreview-"
assert_not_contains "no FAIL for gemini happy path" "$output" "FAIL"

gemini_log=$(echo "$output" | grep -E "^DONE gemini:" | \
  sed -E 's/.*(\/tmp\/xreview-[^ ]+)$/\1/')
[[ -n "$gemini_log" ]] && rm -f "$gemini_log"

# ============================================================
echo "--- Test: invalid spec format rejected ---"
# ============================================================

# Non-alphanumeric chars in cli should be rejected without invoking the CLI.
output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" "bad/cli:some-model" 2>&1)
rc=$?

assert_exit_code "invalid cli format still exits 0" "$rc" 0
assert_contains "invalid cli START emitted with log path" "$output" \
  "START bad/cli:some-model /tmp/xreview-"
assert_contains "invalid cli FAIL emitted with log path" "$output" \
  "FAIL bad/cli:some-model exit_code=2 log=/tmp/xreview-"
assert_contains "ALL_DONE still emitted after invalid spec" "$output" "ALL_DONE"

# START log path must equal FAIL log path (same file, so main agent can Read it).
start_log=$(echo "$output" | grep -E "^START bad/cli:some-model " | \
  sed -E 's/^START [^ ]+ //')
fail_log=$(echo "$output" | grep -E "^FAIL bad/cli:some-model " | \
  sed -E 's/.*log=//')
if [[ -n "$start_log" && "$start_log" == "$fail_log" ]]; then
  ((PASS++)); echo "  PASS: invalid spec START and FAIL share log path"
else
  ((FAIL++)); echo "  FAIL: invalid spec log mismatch — start='$start_log' fail='$fail_log'"
fi

# Log file must exist and contain the XREVIEW_ERROR message (not a placeholder).
if [[ -n "$fail_log" && -f "$fail_log" ]]; then
  ((PASS++)); echo "  PASS: invalid spec log file exists"
  if grep -q 'XREVIEW_ERROR: invalid spec format' "$fail_log"; then
    ((PASS++)); echo "  PASS: invalid spec log contains error message"
  else
    ((FAIL++)); echo "  FAIL: invalid spec log missing XREVIEW_ERROR message"
    cat "$fail_log"
  fi
  rm -f "$fail_log"
else
  ((FAIL++)); echo "  FAIL: invalid spec log file not found at '$fail_log'"
fi

# Invalid chars in model should also be rejected.
output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" "claude:bad model!" 2>&1)
assert_contains "invalid model FAIL emitted with log path" "$output" \
  "FAIL claude:bad model! exit_code=2 log=/tmp/xreview-"

# Cleanup any invalid-model log file produced above.
invalid_model_log=$(echo "$output" | grep -E "^FAIL claude:bad model! " | \
  sed -E 's/.*log=//')
[[ -n "$invalid_model_log" ]] && rm -f "$invalid_model_log"

# Make sure a valid spec alongside an invalid one still runs.
output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" \
  "bad/cli:x" "claude:claude-haiku-4-5-20251001" 2>&1)
assert_contains "valid spec runs despite sibling invalid" "$output" \
  "DONE claude:claude-haiku-4-5-20251001"
assert_contains "invalid sibling still FAILs" "$output" "FAIL bad/cli:x"

# Cleanup both log files from the mixed run.
for lp in $(echo "$output" | grep -E "^(DONE|FAIL) " | \
  sed -E 's/.*(\/tmp\/xreview-[^ ]+)/\1/' | grep '^/tmp/xreview-'); do
  rm -f "$lp"
done

# ============================================================
echo "--- Test: SIGTERM cleanup kills reviewer descendants ---"
# ============================================================

# Mock claude that sleeps long enough we can interrupt it.
cat > "$MOCK_DIR/claude" << 'MOCK_EOF'
#!/usr/bin/env bash
# Write our PID to a marker so the test can locate us.
echo "$$" >> /tmp/xreview-sigterm-test-pids
# Consume stdin so the orchestrator's redirection doesn't block.
cat > /dev/null
sleep 60
MOCK_EOF
chmod +x "$MOCK_DIR/claude"

rm -f /tmp/xreview-sigterm-test-pids

PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" \
  "claude:sigterm-a" "claude:sigterm-b" > /tmp/xreview-sigterm-test-out 2>&1 &
orch_pid=$!

# Poll up to ~5s for both mock children to register their PIDs. A real failure
# here (not just CI flake) means the orchestrator never spawned, so we must
# treat it as a hard FAIL — previously `|| true` silently masked that.
if ! wait_for_pid_file_lines /tmp/xreview-sigterm-test-pids 2; then
  ((FAIL++)); echo "  FAIL: SIGTERM test setup — timeout waiting for 2 mock pids"
  kill -KILL "$orch_pid" 2>/dev/null || true
  wait "$orch_pid" 2>/dev/null || true
else
  # Collect the mock claude PIDs (one per reviewer).
  mock_pids=()
  if [[ -f /tmp/xreview-sigterm-test-pids ]]; then
    while read -r mp; do
      [[ -n "$mp" ]] && mock_pids+=("$mp")
    done < /tmp/xreview-sigterm-test-pids
  fi

  if [[ "${#mock_pids[@]}" -ne 2 ]]; then
    ((FAIL++)); echo "  FAIL: SIGTERM test setup — expected 2 mocks, got ${#mock_pids[@]}"
    kill -KILL "$orch_pid" 2>/dev/null || true
    wait "$orch_pid" 2>/dev/null || true
  else
    ((PASS++)); echo "  PASS: SIGTERM test setup — ${#mock_pids[@]} mock children spawned"

    # Send SIGTERM to orchestrator; its trap should propagate to reviewer PGIDs.
    kill -TERM "$orch_pid" 2>/dev/null || true

    # Wait longer than the 2s grace period so SIGKILL has a chance to land.
    sleep 4

    wait "$orch_pid" 2>/dev/null || true

    # Verify every mock claude child is gone.
    still_alive=()
    for mp in "${mock_pids[@]}"; do
      if kill -0 "$mp" 2>/dev/null; then
        still_alive+=("$mp")
      fi
    done

    if [[ ${#still_alive[@]} -eq 0 ]]; then
      ((PASS++)); echo "  PASS: SIGTERM killed all reviewer descendants"
    else
      ((FAIL++)); echo "  FAIL: SIGTERM left ${#still_alive[@]} descendants alive: ${still_alive[*]}"
      # Force cleanup so we don't leak between test runs.
      for mp in "${still_alive[@]}"; do kill -KILL "$mp" 2>/dev/null || true; done
    fi
  fi
fi

rm -f /tmp/xreview-sigterm-test-pids /tmp/xreview-sigterm-test-out

# ============================================================
echo "--- Test: SIGINT cleanup kills reviewer descendants ---"
# ============================================================

# Reuse the long-sleeping mock from above (still installed).
rm -f /tmp/xreview-sigint-test-pids

cat > "$MOCK_DIR/claude" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "$$" >> /tmp/xreview-sigint-test-pids
cat > /dev/null
sleep 60
MOCK_EOF
chmod +x "$MOCK_DIR/claude"

PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" \
  "claude:sigint-a" "claude:sigint-b" > /tmp/xreview-sigint-test-out 2>&1 &
orch_pid=$!

# Poll up to ~5s for both mock children to register their PIDs. Real failure
# must not be masked — treat it as hard FAIL.
if ! wait_for_pid_file_lines /tmp/xreview-sigint-test-pids 2; then
  ((FAIL++)); echo "  FAIL: SIGINT test setup — timeout waiting for 2 mock pids"
  kill -KILL "$orch_pid" 2>/dev/null || true
  wait "$orch_pid" 2>/dev/null || true
else
  mock_pids=()
  if [[ -f /tmp/xreview-sigint-test-pids ]]; then
    while read -r mp; do
      [[ -n "$mp" ]] && mock_pids+=("$mp")
    done < /tmp/xreview-sigint-test-pids
  fi

  if [[ "${#mock_pids[@]}" -ne 2 ]]; then
    ((FAIL++)); echo "  FAIL: SIGINT test setup — expected 2 mocks, got ${#mock_pids[@]}"
    kill -KILL "$orch_pid" 2>/dev/null || true
    wait "$orch_pid" 2>/dev/null || true
  else
    ((PASS++)); echo "  PASS: SIGINT test setup — ${#mock_pids[@]} mock children spawned"

    kill -INT "$orch_pid" 2>/dev/null || true
    sleep 4
    wait "$orch_pid" 2>/dev/null || true

    still_alive=()
    for mp in "${mock_pids[@]}"; do
      if kill -0 "$mp" 2>/dev/null; then
        still_alive+=("$mp")
      fi
    done

    if [[ ${#still_alive[@]} -eq 0 ]]; then
      ((PASS++)); echo "  PASS: SIGINT killed all reviewer descendants"
    else
      ((FAIL++)); echo "  FAIL: SIGINT left ${#still_alive[@]} descendants alive: ${still_alive[*]}"
      for mp in "${still_alive[@]}"; do kill -KILL "$mp" 2>/dev/null || true; done
    fi
  fi
fi

rm -f /tmp/xreview-sigint-test-pids /tmp/xreview-sigint-test-out

# Restore happy claude mock (in case future tests are added below).
cat > "$MOCK_DIR/claude" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_CLAUDE_CALLED args=$*"
cat
echo "MOCK_CLAUDE_DONE"
exit 0
MOCK_EOF
chmod +x "$MOCK_DIR/claude"

# ============================================================
echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
