#!/usr/bin/env bash
# xreview-orchestrator.test.sh — unit + integration tests for xreview-orchestrator.sh
# Uses mock CLIs to test event stream format and dispatch logic.
# Run: bash ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.test.sh
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

# Default existing tests to streaming mode so they're deterministic regardless
# of the host CLI env (CLAUDECODE / OPENCODE etc.). Blocking-mode tests below
# override this explicitly with XREVIEW_MODE=blocking.
export XREVIEW_MODE=streaming

# --- Setup ---

MOCK_DIR=$(mktemp -d)
PROMPT_FILE=$(mktemp /tmp/xreview-test-XXXXXX.md)
echo "test review prompt content" > "$PROMPT_FILE"
trap 'rm -rf "$MOCK_DIR" "$PROMPT_FILE" /tmp/xreview-*-test-* /tmp/xreview-sigterm-test-* /tmp/xreview-sigint-test-* 2>/dev/null || true' EXIT

# Mock claude CLI — ADR-11 dual-output aware.
# stderr: dispatch marker + stdin echo → orchestrator log via `2>&1`.
# stdout: single JSON `{"result":"..."}` → adapter's `jq -r .result` → final.txt.
# This split mirrors the real CLI (structured stdout, verbose stderr) so the
# orchestrator log contains what we want to assert on (dispatch markers), while
# final.txt holds only clean review content.
write_happy_claude_mock() {
  cat > "$MOCK_DIR/claude" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_CLAUDE_CALLED args=$*" >&2
while IFS= read -r line; do
  echo "MOCK_CLAUDE_STDIN: $line" >&2
done
echo "MOCK_CLAUDE_DONE" >&2
printf '{"result":"MOCK_CLAUDE_REVIEW_TEXT"}\n'
exit 0
MOCK_EOF
  chmod +x "$MOCK_DIR/claude"
}
write_happy_claude_mock

# Mock failing claude (used by opt-in tests)
cat > "$MOCK_DIR/claude-fail" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_FAIL_OUTPUT" >&2
exit 7
MOCK_EOF
chmod +x "$MOCK_DIR/claude-fail"

# Mock opencode: dispatch marker on stderr; ndjson text-event on stdout so the
# adapter's `jq` pipeline produces a non-empty final.txt. The orchestrator log
# gets the stderr marker.
cat > "$MOCK_DIR/opencode" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_OPENCODE_CALLED $*" >&2
cat > /dev/null
printf '{"type":"text","timestamp":1,"sessionID":"s","part":{"type":"text","text":"MOCK_OPENCODE_REVIEW_TEXT"}}\n'
exit 0
MOCK_EOF
chmod +x "$MOCK_DIR/opencode"

# Mock gemini: dispatch marker on stderr; JSON with `.response` on stdout.
cat > "$MOCK_DIR/gemini" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_GEMINI_CALLED $*" >&2
cat > /dev/null
printf '{"response":"MOCK_GEMINI_REVIEW_TEXT"}\n'
exit 0
MOCK_EOF
chmod +x "$MOCK_DIR/gemini"

# Mock codex: dispatch marker on stderr; writes final marker to `-o <out>` arg.
cat > "$MOCK_DIR/codex" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_CODEX_CALLED $*" >&2
cat > /dev/null
out_file=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out_file="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[[ -n "$out_file" ]] && printf 'MOCK_CODEX_REVIEW_TEXT' > "$out_file"
exit 0
MOCK_EOF
chmod +x "$MOCK_DIR/codex"

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

# M7.2 event format: RETURN <spec> <log> <final>, FAIL <spec> exit_code=N log=L final=F.
# These helpers abstract the event columns so path extraction doesn't need to
# change again if columns are added later. Callers pass the full captured output.
first_return_log() {
  # RETURN <spec> <log> <final> — log is column 3.
  echo "$1" | awk '/^RETURN / {print $3; exit}'
}

first_return_final() {
  # RETURN <spec> <log> <final> — final is column 4.
  echo "$1" | awk '/^RETURN / {print $4; exit}'
}

first_fail_log() {
  # FAIL <spec> exit_code=N log=L final=F — extract log= value only.
  echo "$1" | grep -E '^FAIL ' | head -1 | grep -oE 'log=/tmp/xreview-[^ ]+\.log' | sed 's/^log=//'
}

first_fail_final() {
  echo "$1" | grep -E '^FAIL ' | head -1 | grep -oE 'final=/tmp/xreview-[^ ]+\.final\.txt' | sed 's/^final=//'
}

# Cleanup helper: remove every reviewer artifact (log/final/status) referenced
# by the given event-stream output. Covers both RETURN and FAIL rows, both
# bare log paths and `log=…` / `final=…` tokens.
cleanup_from_output() {
  local out="$1"
  local path base
  # Extract every /tmp/xreview-... path (both .log and .final.txt).
  for path in $(echo "$out" | grep -oE '/tmp/xreview-[^ ]+\.(log|final\.txt)' | sort -u); do
    if [[ "$path" == *.final.txt ]]; then
      base="${path%.final.txt}"
    else
      base="${path%.log}"
    fi
    rm -f "${base}.log" "${base}.final.txt" "${base}.status"
  done
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
echo "--- Test: no reviewers + no config file ---"
# ============================================================

# Point XDG_CONFIG_HOME to an empty dir so no config exists.
empty_xdg=$(mktemp -d)
output=$(XDG_CONFIG_HOME="$empty_xdg" bash "$ORCH" "$PROMPT_FILE" 2>&1)
rc=$?

assert_exit_code "no reviewers + no config exits 1" "$rc" 1
assert_contains "no reviewers + no config FAIL message" "$output" \
  "FAIL orchestrator no_reviewers_and_no_config:$empty_xdg/ddd-workflow/xreview.json"
rm -rf "$empty_xdg"

# ============================================================
echo "--- Test: single claude reviewer ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" "claude:claude-haiku-4-5-20251001" 2>&1)
rc=$?

assert_exit_code "claude reviewer exits 0" "$rc" 0
assert_contains "claude START emitted" "$output" "START claude:claude-haiku-4-5-20251001"
assert_contains "START emits log path" "$output" "START claude:claude-haiku-4-5-20251001 /tmp/xreview-"
assert_contains "claude DONE emitted" "$output" "RETURN claude:claude-haiku-4-5-20251001 /tmp/xreview-"
assert_contains "ALL_DONE emitted" "$output" "ALL_DONE"
assert_not_contains "no FAIL for happy path" "$output" "FAIL"

# Verify log file has meta header written by parent shell (so main agent can
# Read the log safely immediately after seeing START, without racing setsid).
done_log_path=$(first_return_log "$output")
done_final_path=$(first_return_final "$output")
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
  # Setsid body appends adapter stderr (via 2>&1) after the header. Mock
  # claude's dispatch marker is emitted on stderr per ADR-11 split, so it
  # must still land in the log file.
  if grep -q 'MOCK_CLAUDE_CALLED' "$done_log_path"; then
    ((PASS++)); echo "  PASS: setsid body output appended after meta header"
  else
    ((FAIL++)); echo "  FAIL: setsid body output missing (append failed?)"
  fi
  rm -f "$done_log_path" "$done_final_path"
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
first_done_line=$(echo "$output" | grep -nE "^RETURN " | head -1 | cut -d: -f1)
last_start_line=$(echo "$output" | grep -nE "^START " | tail -1 | cut -d: -f1)
if [[ -n "$first_done_line" && -n "$last_start_line" && \
      "$last_start_line" -lt "$first_done_line" ]]; then
  ((PASS++)); echo "  PASS: STARTs precede DONEs"
else
  ((FAIL++)); echo "  FAIL: STARTs and DONEs interleaved"
  echo "     output: $output"
fi

start_count=$(count_lines_matching "$output" "START ")
done_count=$(count_lines_matching "$output" "RETURN ")
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
write_happy_claude_mock

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
log_path=$(first_return_log "$output")
final_path=$(first_return_final "$output")

if [[ -n "$log_path" && -f "$log_path" ]]; then
  ((PASS++)); echo "  PASS: log file exists at $log_path"
  if grep -q "MOCK_CLAUDE_CALLED" "$log_path"; then
    ((PASS++)); echo "  PASS: log file contains mock output"
  else
    ((FAIL++)); echo "  FAIL: log file empty or missing mock marker"
  fi
  rm -f "$log_path" "$final_path"
else
  ((FAIL++)); echo "  FAIL: log file not found at '$log_path'"
fi

# ============================================================
echo "--- Test: opencode dispatch via adapter ---"
# ============================================================

# opencode (and gemini/codex) now go through scripts/adapters/<cli>.sh. The
# mock opencode in $MOCK_DIR just echoes args and exits 0; the adapter preserves
# that exit code and the orchestrator emits DONE.
output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" "opencode:gpt-5-mini" 2>&1)
rc=$?

assert_exit_code "opencode reviewer exits 0" "$rc" 0
assert_contains "opencode START emitted with log path" "$output" \
  "START opencode:gpt-5-mini /tmp/xreview-"
assert_contains "opencode DONE emitted with log path" "$output" \
  "RETURN opencode:gpt-5-mini /tmp/xreview-"
assert_contains "ALL_DONE emitted for opencode run" "$output" "ALL_DONE"
assert_not_contains "no FAIL for opencode happy path" "$output" "FAIL"

# Cleanup opencode log file.
opencode_log=$(echo "$output" | grep -E "^RETURN opencode:" | \
  sed -E 's/.*(\/tmp\/xreview-[^ ]+)$/\1/')
[[ -n "$opencode_log" ]] && rm -f "$opencode_log"

# ============================================================
echo "--- Test: gemini dispatch via adapter ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" "gemini:gemini-3-flash" 2>&1)
rc=$?

assert_exit_code "gemini reviewer exits 0" "$rc" 0
assert_contains "gemini START emitted with log path" "$output" \
  "START gemini:gemini-3-flash /tmp/xreview-"
assert_contains "gemini DONE emitted with log path" "$output" \
  "RETURN gemini:gemini-3-flash /tmp/xreview-"
assert_not_contains "no FAIL for gemini happy path" "$output" "FAIL"

gemini_log=$(echo "$output" | grep -E "^RETURN gemini:" | \
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
  awk '{print $3}')
fail_log=$(first_fail_log "$output")
fail_final=$(first_fail_final "$output")
if [[ -n "$start_log" && "$start_log" == "$fail_log" ]]; then
  ((PASS++)); echo "  PASS: invalid spec START and FAIL share log path"
else
  ((FAIL++)); echo "  FAIL: invalid spec log mismatch — start='$start_log' fail='$fail_log'"
fi

# M7.2: FAIL event must carry final= column (ADR-11 dual-output).
if [[ -n "$fail_final" && "$fail_final" == *".final.txt" ]]; then
  ((PASS++)); echo "  PASS: invalid spec FAIL event carries final= path"
else
  ((FAIL++)); echo "  FAIL: invalid spec FAIL event missing final= column (got '$fail_final')"
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
  rm -f "$fail_log" "$fail_final"
else
  ((FAIL++)); echo "  FAIL: invalid spec log file not found at '$fail_log'"
fi

# Invalid chars in model should also be rejected.
output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" "claude:bad model!" 2>&1)
assert_contains "invalid model FAIL emitted with log path" "$output" \
  "FAIL claude:bad model! exit_code=2 log=/tmp/xreview-"

# Cleanup any invalid-model log file produced above.
invalid_model_log=$(first_fail_log "$output")
invalid_model_final=$(first_fail_final "$output")
[[ -n "$invalid_model_log" ]] && rm -f "$invalid_model_log" "$invalid_model_final"

# Make sure a valid spec alongside an invalid one still runs.
output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" \
  "bad/cli:x" "claude:claude-haiku-4-5-20251001" 2>&1)
assert_contains "valid spec runs despite sibling invalid" "$output" \
  "RETURN claude:claude-haiku-4-5-20251001"
assert_contains "invalid sibling still FAILs" "$output" "FAIL bad/cli:x"

# Cleanup both log files from the mixed run.
for lp in $(echo "$output" | grep -E "^(RETURN|FAIL) " | \
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
write_happy_claude_mock

# ============================================================
echo "--- Test: blocking mode emits summary footer ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" XREVIEW_MODE=blocking bash "$ORCH" "$PROMPT_FILE" \
  "claude:blocking-a" "claude:blocking-b" 2>&1)
rc=$?

assert_exit_code "blocking mode exits 0" "$rc" 0
assert_contains "blocking emits ALL_DONE" "$output" "ALL_DONE"
assert_contains "blocking footer header" "$output" "=== Cross Review Summary (2 reviewers: 2 returned) ==="
assert_contains "blocking footer Read instruction" "$output" "Read these log files"
assert_contains "blocking footer DONE row for a" "$output" "[RETURN]    claude:blocking-a"
assert_contains "blocking footer DONE row for b" "$output" "[RETURN]    claude:blocking-b"
assert_contains "blocking footer Next instruction" "$output" "Next: Read each [FINAL]"

# Footer rows must appear AFTER ALL_DONE, not before (Monitor consumers should
# never see the footer interspersed with events).
all_done_line=$(echo "$output" | grep -nE "^ALL_DONE$" | head -1 | cut -d: -f1)
footer_line=$(echo "$output" | grep -nE "^=== Cross Review Summary" | head -1 | cut -d: -f1)
if [[ -n "$all_done_line" && -n "$footer_line" && "$footer_line" -gt "$all_done_line" ]]; then
  ((PASS++)); echo "  PASS: footer appears after ALL_DONE"
else
  ((FAIL++)); echo "  FAIL: footer ordering wrong (ALL_DONE@$all_done_line, footer@$footer_line)"
fi

# Cleanup logs from blocking-mode test.
for lp in $(echo "$output" | grep -E "^RETURN " | sed -E 's/^RETURN [^ ]+ //'); do
  rm -f "$lp" "${lp%.log}.status"
done

# ============================================================
echo "--- Test: blocking mode footer reports failures ---"
# ============================================================

# Use failing claude mock alongside happy one to verify mixed footer.
cp "$MOCK_DIR/claude-fail" "$MOCK_DIR/claude-broken"
cat > "$MOCK_DIR/claude" << 'MOCK_EOF'
#!/usr/bin/env bash
echo "MOCK_CLAUDE_OK"
cat
exit 0
MOCK_EOF
chmod +x "$MOCK_DIR/claude"

# Override the binary that gets resolved as "claude" with the failing variant.
cp "$MOCK_DIR/claude-fail" "$MOCK_DIR/claude"
output=$(PATH="$MOCK_DIR:$PATH" XREVIEW_MODE=blocking bash "$ORCH" "$PROMPT_FILE" \
  "claude:fail-test" 2>&1)
assert_contains "blocking footer FAIL row" "$output" "[FAIL=7]  claude:fail-test"
assert_contains "blocking footer counts failure" "$output" "1 reviewers: 0 returned, 1 failed"

# Restore happy claude mock for any future tests.
write_happy_claude_mock

# Cleanup logs.
for lp in $(echo "$output" | grep -E "^(RETURN|FAIL) " | \
  sed -E 's/.*(\/tmp\/xreview-[^ ]+)/\1/' | grep '^/tmp/xreview-'); do
  rm -f "$lp" "${lp%.log}.status"
done

# ============================================================
echo "--- Test: streaming mode omits footer ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" XREVIEW_MODE=streaming bash "$ORCH" "$PROMPT_FILE" \
  "claude:streaming-test" 2>&1)
assert_contains "streaming still emits ALL_DONE" "$output" "ALL_DONE"
assert_not_contains "streaming has no summary header" "$output" "Cross Review Summary"
assert_not_contains "streaming has no Next instruction" "$output" "Next: Read each"

# Cleanup.
for lp in $(echo "$output" | grep -E "^RETURN " | sed -E 's/^RETURN [^ ]+ //'); do
  rm -f "$lp" "${lp%.log}.status"
done

# ============================================================
echo "--- Test: invalid XREVIEW_MODE rejected ---"
# ============================================================

output=$(PATH="$MOCK_DIR:$PATH" XREVIEW_MODE=bogus bash "$ORCH" "$PROMPT_FILE" \
  "claude:test" 2>&1)
rc=$?
assert_exit_code "invalid mode exits 1" "$rc" 1
assert_contains "invalid mode FAIL message" "$output" "FAIL orchestrator invalid_mode:bogus"

# ============================================================
echo "--- Test: env-based mode detection (CLAUDECODE → streaming) ---"
# ============================================================

# Unset XREVIEW_MODE for this case so env detection takes over.
output=$(PATH="$MOCK_DIR:$PATH" env -u XREVIEW_MODE CLAUDECODE=1 \
  bash "$ORCH" "$PROMPT_FILE" "claude:env-cc-test" 2>&1)
assert_not_contains "CLAUDECODE → no footer" "$output" "Cross Review Summary"

# And without CLAUDECODE → blocking default → footer appears.
output=$(PATH="$MOCK_DIR:$PATH" env -u XREVIEW_MODE -u CLAUDECODE \
  bash "$ORCH" "$PROMPT_FILE" "claude:env-no-cc-test" 2>&1)
assert_contains "no CLAUDECODE → footer appears" "$output" "Cross Review Summary"

# Cleanup any logs from the two env tests.
for lp in $(echo "$output" | grep -E "^RETURN " | sed -E 's/^RETURN [^ ]+ //'); do
  rm -f "$lp" "${lp%.log}.status"
done

# Also clean the other env-test log directly by glob pattern (covers the
# CLAUDECODE=1 case whose output we've already discarded).
rm -f /tmp/xreview-*-claude_env-*.log /tmp/xreview-*-claude_env-*.status

# ============================================================
echo "--- Test: config file resolved when CLI args empty ---"
# ============================================================

cfg_xdg=$(mktemp -d)
mkdir -p "$cfg_xdg/ddd-workflow"
cat > "$cfg_xdg/ddd-workflow/xreview.json" << 'CFG_EOF'
{
  "reviewers": [
    "claude:cfg-model-a",
    "claude:cfg-model-b"
  ]
}
CFG_EOF

output=$(PATH="$MOCK_DIR:$PATH" XDG_CONFIG_HOME="$cfg_xdg" \
  bash "$ORCH" "$PROMPT_FILE" 2>&1)
rc=$?

assert_exit_code "config-resolved run exits 0" "$rc" 0
assert_contains "config spec a was dispatched" "$output" "RETURN claude:cfg-model-a"
assert_contains "config spec b was dispatched" "$output" "RETURN claude:cfg-model-b"
assert_contains "config-resolved ALL_DONE" "$output" "ALL_DONE"

# Cleanup logs from this run.
for lp in $(echo "$output" | grep -E "^RETURN " | sed -E 's/^RETURN [^ ]+ //'); do
  rm -f "$lp" "${lp%.log}.status"
done
rm -rf "$cfg_xdg"

# ============================================================
echo "--- Test: alias hit resolves before validation ---"
# ============================================================

cfg_xdg=$(mktemp -d)
mkdir -p "$cfg_xdg/ddd-workflow"
cat > "$cfg_xdg/ddd-workflow/xreview.json" << 'CFG_EOF'
{
  "reviewers": ["opus", "5.4", "flash"],
  "aliases": {
    "opus": "claude:opus",
    "5.4": "opencode:github-copilot/gpt-5.4",
    "flash": "gemini:flash"
  }
}
CFG_EOF

output=$(PATH="$MOCK_DIR:$PATH" XDG_CONFIG_HOME="$cfg_xdg" XREVIEW_MODE=blocking \
  bash "$ORCH" "$PROMPT_FILE" 2>&1)
rc=$?

assert_exit_code "alias-hit config run exits 0" "$rc" 0
assert_contains "alias-hit claude START uses resolved spec" "$output" "START claude:opus /tmp/xreview-"
assert_contains "alias-hit opencode DONE uses resolved spec" "$output" "RETURN opencode:github-copilot/gpt-5.4 /tmp/xreview-"
assert_contains "alias-hit gemini DONE uses resolved spec" "$output" "RETURN gemini:flash /tmp/xreview-"
assert_contains "alias-hit footer uses resolved spec" "$output" "[RETURN]    claude:opus"
assert_not_contains "alias-hit raw reviewer name hidden from events" "$output" "START opus"
assert_not_contains "alias-hit raw reviewer name hidden from footer" "$output" "[RETURN]    opus"

alias_log=$(echo "$output" | grep -E "^RETURN claude:opus " | awk '{print $3}')
if [[ -n "$alias_log" && "$alias_log" == *"claude_opus.log" ]]; then
  ((PASS++)); echo "  PASS: alias-hit log filename uses resolved spec slug"
else
  ((FAIL++)); echo "  FAIL: alias-hit log filename did not use resolved spec slug ($alias_log)"
fi

alias_status="${alias_log%.log}.status"
if [[ -f "$alias_status" ]]; then
  ((PASS++)); echo "  PASS: alias-hit status sidecar uses resolved spec slug"
else
  ((FAIL++)); echo "  FAIL: alias-hit status sidecar missing ($alias_status)"
fi

for lp in $(echo "$output" | grep -E "^(RETURN|FAIL) " | \
  sed -E 's/.*(\/tmp\/xreview-[^ ]+)/\1/' | grep '^/tmp/xreview-'); do
  rm -f "$lp" "${lp%.log}.status"
done
rm -rf "$cfg_xdg"

# ============================================================
echo "--- Test: alias miss stays raw ---"
# ============================================================

cfg_xdg=$(mktemp -d)
mkdir -p "$cfg_xdg/ddd-workflow"
cat > "$cfg_xdg/ddd-workflow/xreview.json" << 'CFG_EOF'
{
  "reviewers": ["claude:unused"],
  "aliases": {
    "opus": "claude:opus"
  }
}
CFG_EOF

output=$(PATH="$MOCK_DIR:$PATH" XDG_CONFIG_HOME="$cfg_xdg" \
  bash "$ORCH" "$PROMPT_FILE" "unknown-short" 2>&1)

assert_contains "alias-miss START keeps raw spec" "$output" "START unknown-short /tmp/xreview-"
assert_contains "alias-miss FAIL keeps raw spec" "$output" "FAIL unknown-short exit_code=1 log=/tmp/xreview-"

miss_log=$(first_fail_log "$output")
if [[ -n "$miss_log" && "$miss_log" == *"unknown-short.log" ]]; then
  ((PASS++)); echo "  PASS: alias-miss log filename keeps raw spec slug"
else
  ((FAIL++)); echo "  FAIL: alias-miss log filename did not keep raw spec slug ($miss_log)"
fi

for lp in $(echo "$output" | grep -E "^(RETURN|FAIL) " | \
  sed -E 's/.*(\/tmp\/xreview-[^ ]+)/\1/' | grep '^/tmp/xreview-'); do
  rm -f "$lp" "${lp%.log}.status"
done
rm -rf "$cfg_xdg"

# ============================================================
echo "--- Test: config without aliases keeps specs raw ---"
# ============================================================

cfg_xdg=$(mktemp -d)
mkdir -p "$cfg_xdg/ddd-workflow"
cat > "$cfg_xdg/ddd-workflow/xreview.json" << 'CFG_EOF'
{
  "reviewers": ["claude:no-alias-a", "unknown-short"]
}
CFG_EOF

output=$(PATH="$MOCK_DIR:$PATH" XDG_CONFIG_HOME="$cfg_xdg" \
  bash "$ORCH" "$PROMPT_FILE" 2>&1)
rc=$?

assert_exit_code "no-aliases config run exits 0" "$rc" 0
assert_contains "no-aliases full spec stays raw" "$output" "RETURN claude:no-alias-a"
assert_contains "no-aliases short spec stays raw" "$output" "START unknown-short /tmp/xreview-"
assert_contains "no-aliases short spec fails as raw unknown cli" "$output" "FAIL unknown-short exit_code=1 log=/tmp/xreview-"

for lp in $(echo "$output" | grep -E "^(RETURN|FAIL) " | \
  sed -E 's/.*(\/tmp\/xreview-[^ ]+)/\1/' | grep '^/tmp/xreview-'); do
  rm -f "$lp" "${lp%.log}.status"
done
rm -rf "$cfg_xdg"

# ============================================================
echo "--- Test: CLI alias args override config reviewers ---"
# ============================================================

cfg_xdg=$(mktemp -d)
mkdir -p "$cfg_xdg/ddd-workflow"
cat > "$cfg_xdg/ddd-workflow/xreview.json" << 'CFG_EOF'
{
  "reviewers": ["pro"],
  "aliases": {
    "5.4": "opencode:github-copilot/gpt-5.4",
    "pro": "gemini:pro"
  }
}
CFG_EOF

output=$(PATH="$MOCK_DIR:$PATH" XDG_CONFIG_HOME="$cfg_xdg" \
  bash "$ORCH" "$PROMPT_FILE" "5.4" 2>&1)

assert_contains "CLI alias resolved to full spec" "$output" "RETURN opencode:github-copilot/gpt-5.4"
assert_not_contains "config reviewer ignored when CLI alias present" "$output" "gemini:pro"
assert_not_contains "raw CLI alias not shown in events" "$output" "RETURN 5.4"

for lp in $(echo "$output" | grep -E "^(RETURN|FAIL) " | \
  sed -E 's/.*(\/tmp\/xreview-[^ ]+)/\1/' | grep '^/tmp/xreview-'); do
  rm -f "$lp" "${lp%.log}.status"
done
rm -rf "$cfg_xdg"

# ============================================================
echo "--- Test: default short reviewers resolve and dispatch ---"
# ============================================================

cfg_xdg=$(mktemp -d)
mkdir -p "$cfg_xdg/ddd-workflow"
cat > "$cfg_xdg/ddd-workflow/xreview.json" << 'CFG_EOF'
{
  "reviewers": ["opus", "5.4", "pro"],
  "aliases": {
    "5.4": "opencode:github-copilot/gpt-5.4",
    "5-mini": "opencode:github-copilot/gpt-5-mini",
    "haiku": "claude:haiku",
    "sonnet": "claude:sonnet",
    "opus": "claude:opus",
    "pro": "gemini:pro",
    "flash": "gemini:flash"
  }
}
CFG_EOF

output=$(PATH="$MOCK_DIR:$PATH" XDG_CONFIG_HOME="$cfg_xdg" XREVIEW_MODE=blocking \
  bash "$ORCH" "$PROMPT_FILE" 2>&1)
rc=$?

assert_exit_code "default short reviewers run exits 0" "$rc" 0
assert_contains "default short reviewer claude resolved" "$output" "START claude:opus /tmp/xreview-"
assert_contains "default short reviewer opencode resolved" "$output" "RETURN opencode:github-copilot/gpt-5.4 /tmp/xreview-"
assert_contains "default short reviewer gemini resolved" "$output" "RETURN gemini:pro /tmp/xreview-"
assert_contains "default short reviewer footer uses resolved spec" "$output" "[RETURN]    gemini:pro"

default_log=$(echo "$output" | grep -E "^RETURN gemini:pro " | awk '{print $3}')
default_status="${default_log%.log}.status"
if [[ -f "$default_status" ]]; then
  ((PASS++)); echo "  PASS: default short reviewer status sidecar uses resolved spec slug"
else
  ((FAIL++)); echo "  FAIL: default short reviewer status sidecar missing ($default_status)"
fi

for lp in $(echo "$output" | grep -E "^(RETURN|FAIL) " | \
  sed -E 's/.*(\/tmp\/xreview-[^ ]+)/\1/' | grep '^/tmp/xreview-'); do
  rm -f "$lp" "${lp%.log}.status"
done
rm -rf "$cfg_xdg"

# ============================================================
echo "--- Test: CLI args override config ---"
# ============================================================

cfg_xdg=$(mktemp -d)
mkdir -p "$cfg_xdg/ddd-workflow"
cat > "$cfg_xdg/ddd-workflow/xreview.json" << 'CFG_EOF'
{ "reviewers": ["claude:should-not-run"] }
CFG_EOF

output=$(PATH="$MOCK_DIR:$PATH" XDG_CONFIG_HOME="$cfg_xdg" \
  bash "$ORCH" "$PROMPT_FILE" "claude:cli-wins" 2>&1)

assert_contains "CLI-arg spec dispatched" "$output" "RETURN claude:cli-wins"
assert_not_contains "config spec ignored when CLI args present" "$output" "should-not-run"

for lp in $(echo "$output" | grep -E "^RETURN " | sed -E 's/^RETURN [^ ]+ //'); do
  rm -f "$lp" "${lp%.log}.status"
done
rm -rf "$cfg_xdg"

# ============================================================
echo "--- Test: empty/invalid config rejected ---"
# ============================================================

cfg_xdg=$(mktemp -d)
mkdir -p "$cfg_xdg/ddd-workflow"

# Empty reviewers array.
echo '{"reviewers": []}' > "$cfg_xdg/ddd-workflow/xreview.json"
output=$(PATH="$MOCK_DIR:$PATH" XDG_CONFIG_HOME="$cfg_xdg" \
  bash "$ORCH" "$PROMPT_FILE" 2>&1)
rc=$?
assert_exit_code "empty reviewers array exits 1" "$rc" 1
assert_contains "empty array FAIL message" "$output" \
  "FAIL orchestrator config_empty_or_invalid"

# Malformed JSON.
echo 'this is not json' > "$cfg_xdg/ddd-workflow/xreview.json"
output=$(PATH="$MOCK_DIR:$PATH" XDG_CONFIG_HOME="$cfg_xdg" \
  bash "$ORCH" "$PROMPT_FILE" 2>&1)
rc=$?
assert_exit_code "malformed JSON exits 1" "$rc" 1
assert_contains "malformed JSON FAIL message" "$output" \
  "FAIL orchestrator config_empty_or_invalid"

rm -rf "$cfg_xdg"

# ============================================================
echo "--- Test: orchestrator enforces outer timeout (ADR-6, M6.1, M6.2) ---"
# ============================================================
# After M5.1, timeout lives at the orchestrator layer, not in adapters.
# Mock a claude that sleeps longer than the injected timeout. Orchestrator
# should SIGTERM it via `timeout --foreground` and report exit_code=124 via FAIL.
#
# M6.1 (F1): timeout(1) only SIGTERMs its direct child (bash adapter), so
# the CLI grandchild becomes an orphan that keeps burning quota. The
# orchestrator must sweep its own pgid on rc==124 to kill stragglers.
# M6.2 (F2): log must contain XREVIEW_ERROR marker so the step 7.1 peek
# protocol classifies a timed-out reviewer as content-layer failure rather
# than a half-finished review.

# Sentinel file lets us check whether the mock CLI process survives the
# orchestrator's timeout sweep.
mock_pid_file=$(mktemp /tmp/xreview-mock-claude-pid-XXXXXX)
rm -f "$mock_pid_file"  # mock writes it; we just want a unique path

# M6 cross-review F4: mock noisily prints >10 lines after registering its PID,
# so if the orchestrator appended the timeout marker BEFORE sweeping, the
# marker would be pushed out of `tail -n 10`. We assert the marker still lands
# within the tail window, which only holds if marker is appended AFTER sweep.
cat > "$MOCK_DIR/claude" << MOCK_EOF
#!/usr/bin/env bash
cat > /dev/null
echo \$\$ > "$mock_pid_file"
# Flood the log so a pre-sweep marker would be pushed out of tail -n 10.
for i in \$(seq 1 30); do
  echo "MOCK_NOISE_LINE_\$i"
done
sleep 20
MOCK_EOF
chmod +x "$MOCK_DIR/claude"

output=$(PATH="$MOCK_DIR:$PATH" XREVIEW_TIMEOUT_SEC=1 \
  bash "$ORCH" "$PROMPT_FILE" "claude:slow-model" 2>&1)
rc=$?

assert_exit_code "orchestrator exits 0 even on reviewer timeout" "$rc" 0
assert_contains "orchestrator emits FAIL with exit_code=124" "$output" \
  "FAIL claude:slow-model exit_code=124"
assert_contains "orchestrator still emits ALL_DONE after timeout" "$output" "ALL_DONE"

# F1: mock CLI process must NOT survive the orchestrator's pgid sweep.
mock_pid=""
[[ -f "$mock_pid_file" ]] && mock_pid=$(cat "$mock_pid_file" 2>/dev/null | tr -d ' \n')
if [[ -z "$mock_pid" ]]; then
  ((FAIL++)); echo "  FAIL: mock claude never wrote PID sentinel — test setup broken"
elif kill -0 "$mock_pid" 2>/dev/null; then
  ((FAIL++)); echo "  FAIL: F1 — mock claude PID $mock_pid still alive after orchestrator timeout (orphan)"
  kill -KILL "$mock_pid" 2>/dev/null || true
else
  ((PASS++)); echo "  PASS: F1 — mock claude killed by orchestrator pgid sweep"
fi
rm -f "$mock_pid_file"

# F2 / F4: log must contain the timeout marker within the final `tail -n 10`
# window — that's the exact window step 7.1's peek protocol inspects. Strong
# assertion guards against the marker being pushed out by orphan buffered
# writes during the TERM→KILL grace period.
timeout_log=$(echo "$output" | grep -oE '/tmp/xreview-[^ ]+\.log' | head -1)
if [[ -n "$timeout_log" ]] && [[ -f "$timeout_log" ]]; then
  if grep -q "XREVIEW_ERROR: orchestrator timeout" "$timeout_log"; then
    ((PASS++)); echo "  PASS: F2 — log contains 'XREVIEW_ERROR: orchestrator timeout' marker"
  else
    ((FAIL++)); echo "  FAIL: F2 — log $timeout_log missing 'XREVIEW_ERROR: orchestrator timeout' marker"
  fi

  if tail -n 10 "$timeout_log" | grep -q "XREVIEW_ERROR: orchestrator timeout"; then
    ((PASS++)); echo "  PASS: F4 — marker lands within step 7.1 peek window (tail -n 10)"
  else
    ((FAIL++)); echo "  FAIL: F4 — marker exists but outside tail -n 10 (pushed out by orphan noise)"
    echo "     tail -n 10 of $timeout_log:"
    tail -n 10 "$timeout_log" | sed 's/^/       /'
  fi
else
  ((FAIL++)); echo "  FAIL: F2 — could not locate timeout reviewer's log file from output"
fi

# Cleanup the timed-out reviewer's log artifacts.
for lp in $(echo "$output" | grep -E "^(START|FAIL) " | \
  sed -E 's/.*(\/tmp\/xreview-[^ ]+)/\1/' | grep '^/tmp/xreview-'); do
  rm -f "$lp" "${lp%.log}.status"
done

# Restore happy claude mock.
write_happy_claude_mock

# ============================================================
echo "--- Test: stdin mode — prompt read from stdin, no positional file arg (M6.4) ---"
# ============================================================
# Coordinator should only need a single Monitor call — no pre/post Bash for
# mktemp/rm. When orchestrator is invoked with no positional prompt file
# (or with "-" sentinel), it slurps stdin into its own tmpfile and rms on exit.

# Reuse the happy claude mock (stderr echoes dispatch marker + each stdin line
# as MOCK_CLAUDE_STDIN: …). The orchestrator captures adapter stderr into the
# log via `>> "$log" 2>&1`, so asserting against the log works.
write_happy_claude_mock

stdin_output=$(PATH="$MOCK_DIR:$PATH" \
  bash "$ORCH" "-" "claude:stdin-test" <<< "HELLO-FROM-STDIN" 2>&1)
rc=$?

assert_exit_code "stdin mode exits 0" "$rc" 0
assert_contains "stdin mode emits START" "$stdin_output" "START claude:stdin-test"
assert_contains "stdin mode emits RETURN" "$stdin_output" "RETURN claude:stdin-test"

# The mock CLI wrote the stdin content into the log (via stderr → 2>&1 → log).
stdin_log=$(first_return_log "$stdin_output")
stdin_final=$(first_return_final "$stdin_output")
if [[ -n "$stdin_log" && -f "$stdin_log" ]]; then
  if grep -q "MOCK_CLAUDE_STDIN: HELLO-FROM-STDIN" "$stdin_log"; then
    ((PASS++)); echo "  PASS: stdin content reached CLI via internal tmpfile"
  else
    ((FAIL++)); echo "  FAIL: stdin content missing from reviewer log"
    head -10 "$stdin_log"
  fi
  rm -f "$stdin_log" "$stdin_final" "${stdin_log%.log}.status"
else
  ((FAIL++)); echo "  FAIL: could not locate log path from RETURN event"
fi

# Verify no xreview-prompt-* tmpfile leaked after exit (orchestrator trap should rm it).
leaked=$(find /tmp -maxdepth 1 -name 'xreview-prompt-*' -newer "$MOCK_DIR" 2>/dev/null)
if [[ -z "$leaked" ]]; then
  ((PASS++)); echo "  PASS: stdin mode cleaned up internal tmpfile"
else
  ((FAIL++)); echo "  FAIL: stdin mode leaked tmpfile(s): $leaked"
  rm -f $leaked
fi

# ============================================================
echo "--- Test: stdin mode with no positional args at all (uses config reviewers) ---"
# ============================================================
# `bash orch < prompt.txt` with nothing else should also work — stdin for
# prompt, config for reviewers.

cfg_dir_stdin=$(mktemp -d)
mkdir -p "$cfg_dir_stdin/ddd-workflow"
cat > "$cfg_dir_stdin/ddd-workflow/xreview.json" << 'CFG_EOF'
{
  "reviewers": ["claude:cfg-stdin-model"]
}
CFG_EOF

noargs_output=$(PATH="$MOCK_DIR:$PATH" XDG_CONFIG_HOME="$cfg_dir_stdin" \
  bash "$ORCH" <<< "NOARGS-STDIN-CONTENT" 2>&1)
rc=$?

assert_exit_code "no-args stdin mode exits 0" "$rc" 0
assert_contains "no-args stdin uses config reviewer" "$noargs_output" \
  "RETURN claude:cfg-stdin-model"

# Cleanup logs from this run
for lp in $(echo "$noargs_output" | grep -E "^(START|RETURN|FAIL) " | \
  sed -E 's/.*(\/tmp\/xreview-[^ ]+)/\1/' | grep '^/tmp/xreview-' | sort -u); do
  rm -f "$lp" "${lp%.log}.status"
done
rm -rf "$cfg_dir_stdin"

# ============================================================
echo "--- Test: stdin mode — early EXIT trap cleans tmpfile on validation failure (M6.4, codex F2) ---"
# ============================================================
# stdin mode mktemps and registers an early EXIT trap BEFORE cleanup() is
# defined. If validation (config missing / empty / invalid mode) exits between
# the early trap and the main cleanup() registration, the early trap is the
# only thing keeping the tmpfile from leaking. Previously untested — codex
# (gpt-5.4) pointed this out during M6 cross review.

# Snapshot current xreview-prompt-* files so we can diff before/after.
before_prompts=$(find /tmp -maxdepth 1 -name 'xreview-prompt-*.md' 2>/dev/null | wc -l)

# Empty config forces early-exit at the "config_empty_or_invalid" branch.
cfg_empty_dir=$(mktemp -d)
mkdir -p "$cfg_empty_dir/ddd-workflow"
cat > "$cfg_empty_dir/ddd-workflow/xreview.json" << 'CFG_EOF'
{
  "reviewers": []
}
CFG_EOF

# Run stdin mode with no CLI reviewer specs and the empty config. This
# mktemps the prompt tmpfile (registering the early trap), then exits 1 at
# the config validation step — well before cleanup() gets the chance to run.
early_output=$(XDG_CONFIG_HOME="$cfg_empty_dir" \
  bash "$ORCH" <<< "EARLY-TRAP-PROMPT" 2>&1)
early_rc=$?

assert_exit_code "empty config exits 1 (validation path)" "$early_rc" 1
assert_contains "empty config emits FAIL reason" "$early_output" \
  "FAIL orchestrator config_empty_or_invalid"

after_prompts=$(find /tmp -maxdepth 1 -name 'xreview-prompt-*.md' 2>/dev/null | wc -l)
if [[ "$after_prompts" -eq "$before_prompts" ]]; then
  ((PASS++)); echo "  PASS: early EXIT trap rm'd the stdin-mode tmpfile (no leak on validation fail)"
else
  leaked=$(find /tmp -maxdepth 1 -name 'xreview-prompt-*.md' 2>/dev/null)
  ((FAIL++)); echo "  FAIL: stdin tmpfile leaked on validation fail (before=$before_prompts after=$after_prompts)"
  echo "     leaked paths: $leaked"
  # Clean up to avoid contaminating other tests.
  find /tmp -maxdepth 1 -name 'xreview-prompt-*.md' -newer "$MOCK_DIR" -delete 2>/dev/null || true
fi

rm -rf "$cfg_empty_dir"

# ============================================================
echo "--- Test: backward compat — positional prompt file still works (M6.4) ---"
# ============================================================
# Restore happy mock for safety, then verify old calling convention.
write_happy_claude_mock

bc_output=$(PATH="$MOCK_DIR:$PATH" \
  bash "$ORCH" "$PROMPT_FILE" "claude:backcompat-model" 2>&1)
rc=$?

assert_exit_code "backward compat exits 0" "$rc" 0
assert_contains "backward compat RETURN emitted" "$bc_output" \
  "RETURN claude:backcompat-model"

# Cleanup
cleanup_from_output "$bc_output"

# ============================================================
echo "--- Test: M7.2 — RETURN event carries final path as 4th column ---"
# ============================================================
# ADR-11: each reviewer produces both <log> (verbose) and <final> (clean
# review text). The orchestrator event stream must surface both so callers
# know where to Read the clean content.

write_happy_claude_mock
m72_output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" "claude:m72-ret" 2>&1)
m72_rc=$?

assert_exit_code "M7.2 RETURN happy path exits 0" "$m72_rc" 0

# Strict format: RETURN <spec> <log> <final> — no trailing tokens, no log=/final= noise.
m72_return_line=$(echo "$m72_output" | grep -E "^RETURN claude:m72-ret " | head -1)
if echo "$m72_return_line" | grep -qE '^RETURN claude:m72-ret /tmp/xreview-[^ ]+\.log /tmp/xreview-[^ ]+\.final\.txt$'; then
  ((PASS++)); echo "  PASS: M7.2 RETURN event has 4-column shape (spec log final)"
else
  ((FAIL++)); echo "  FAIL: M7.2 RETURN event shape wrong: '$m72_return_line'"
fi

# Both referenced files must actually exist on disk so coordinator can Read them.
m72_log=$(first_return_log "$m72_output")
m72_final=$(first_return_final "$m72_output")
if [[ -f "$m72_log" && -f "$m72_final" ]]; then
  ((PASS++)); echo "  PASS: M7.2 both log and final files exist on disk"
else
  ((FAIL++)); echo "  FAIL: M7.2 missing file(s) — log=$m72_log final=$m72_final"
fi

# final.txt must contain the jq-extracted review text (not raw JSON envelope).
if [[ -f "$m72_final" ]] && grep -qF 'MOCK_CLAUDE_REVIEW_TEXT' "$m72_final" \
  && ! grep -qF '"result"' "$m72_final"; then
  ((PASS++)); echo "  PASS: M7.2 final.txt contains clean review text (jq extracted)"
else
  ((FAIL++)); echo "  FAIL: M7.2 final.txt missing clean review text or leaked JSON envelope"
  cat "$m72_final" 2>/dev/null | head -3
fi

cleanup_from_output "$m72_output"

# ============================================================
echo "--- Test: M7.2 — FAIL event carries final= path alongside log= ---"
# ============================================================
# A non-zero CLI rc surfaces as FAIL. The event must still point to both the
# log (for debugging) and the (possibly empty) final.txt (for content-layer
# inspection per SKILL.md step 7.1).

cp "$MOCK_DIR/claude-fail" "$MOCK_DIR/claude"
m72f_output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" "claude:m72-fail" 2>&1)
m72f_rc=$?

assert_exit_code "M7.2 FAIL orchestrator still exits 0" "$m72f_rc" 0

m72f_line=$(echo "$m72f_output" | grep -E "^FAIL claude:m72-fail " | head -1)
if echo "$m72f_line" | grep -qE '^FAIL claude:m72-fail exit_code=7 log=/tmp/xreview-[^ ]+\.log final=/tmp/xreview-[^ ]+\.final\.txt$'; then
  ((PASS++)); echo "  PASS: M7.2 FAIL event has log= and final= columns"
else
  ((FAIL++)); echo "  FAIL: M7.2 FAIL event shape wrong: '$m72f_line'"
fi

m72f_final=$(first_fail_final "$m72f_output")
if [[ -n "$m72f_final" && -f "$m72f_final" ]]; then
  ((PASS++)); echo "  PASS: M7.2 FAIL final.txt path points to real file"
else
  ((FAIL++)); echo "  FAIL: M7.2 FAIL final.txt path missing or file absent ($m72f_final)"
fi

write_happy_claude_mock
cleanup_from_output "$m72f_output"

# ============================================================
echo "--- Test: M7.2 — final.txt survives orchestrator cleanup ---"
# ============================================================
# Cleanup trap kills reviewer PGIDs but must NOT delete final.txt (it's the
# coordinator's Read target after RETURN/FAIL).

m72c_output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" "claude:m72-cleanup" 2>&1)
m72c_final=$(first_return_final "$m72c_output")
m72c_log=$(first_return_log "$m72c_output")

if [[ -n "$m72c_final" && -f "$m72c_final" ]]; then
  ((PASS++)); echo "  PASS: M7.2 final.txt still exists after orchestrator exit"
else
  ((FAIL++)); echo "  FAIL: M7.2 final.txt removed by cleanup ($m72c_final)"
fi

if [[ -n "$m72c_log" && -f "$m72c_log" ]]; then
  ((PASS++)); echo "  PASS: M7.2 log file also preserved (coordinator may tail it)"
else
  ((FAIL++)); echo "  FAIL: M7.2 log file removed by cleanup ($m72c_log)"
fi

cleanup_from_output "$m72c_output"

# ============================================================
echo "--- Test: M7.2 — blocking-mode footer includes [FINAL] column ---"
# ============================================================
# Footer consumers need both log (verbose) and final (clean) paths to do the
# step 7.1 dual-peek protocol. Blocking-mode rows must expose both.

m72b_output=$(PATH="$MOCK_DIR:$PATH" XREVIEW_MODE=blocking bash "$ORCH" "$PROMPT_FILE" \
  "claude:m72-footer" 2>&1)
m72b_rc=$?

assert_exit_code "M7.2 blocking-mode run exits 0" "$m72b_rc" 0
assert_contains "M7.2 footer row has [LOG] column" "$m72b_output" "[LOG] /tmp/xreview-"
assert_contains "M7.2 footer row has [FINAL] column" "$m72b_output" "[FINAL] /tmp/xreview-"
assert_contains "M7.2 footer row has [FINAL] …final.txt" "$m72b_output" ".final.txt"
assert_contains "M7.2 footer Next instruction points at [FINAL]" "$m72b_output" \
  "Next: Read each [FINAL]"

# The [FINAL] path printed in the footer must exist on disk.
m72b_final=$(echo "$m72b_output" | grep -oE '\[FINAL\] /tmp/xreview-[^ ]+\.final\.txt' | \
  head -1 | sed 's/^\[FINAL\] //')
if [[ -n "$m72b_final" && -f "$m72b_final" ]]; then
  ((PASS++)); echo "  PASS: M7.2 footer [FINAL] path resolves to real file"
else
  ((FAIL++)); echo "  FAIL: M7.2 footer [FINAL] path missing or absent ($m72b_final)"
fi

cleanup_from_output "$m72b_output"

# ============================================================
echo "--- Test: M7.4 — per-reviewer final path slug matches spec slug (multi-reviewer) ---"
# ============================================================
# Regression (M7.4 e2e): dispatch loop recomputes $log per spec but used to
# forget $final, so every reviewer's RETURN event reported the LAST spec's
# final.txt. With N reviewers racing in parallel all writes landed in one file
# (last-writer wins). This assertion pins final-path-per-spec correctness.
#
# Design: two claude specs so one mock suffices; slugs differ on model suffix.
# For each RETURN line assert `slug_of($2) == slug_of($4 minus prefix/suffix)`.

write_happy_claude_mock
m74_output=$(PATH="$MOCK_DIR:$PATH" bash "$ORCH" "$PROMPT_FILE" \
  "claude:m74-alpha" "claude:m74-beta" 2>&1)
m74_rc=$?

assert_exit_code "M7.4 multi-reviewer run exits 0" "$m74_rc" 0

m74_return_count=$(count_lines_matching "$m74_output" "RETURN ")
[[ "$m74_return_count" -eq 2 ]] \
  && { ((PASS++)); echo "  PASS: M7.4 got 2 RETURN events"; } \
  || { ((FAIL++)); echo "  FAIL: expected 2 RETURN got $m74_return_count"; }

# Per-line check: spec slug must equal the slug embedded in the final path.
# final path shape: /tmp/xreview-<runid>-<slug>.final.txt. runid contains
# digits, '-', and may look like "PID-EPOCH-RANDOM". slug is produced by
# `slug_of` which replaces ':' and '/' with '_' — in these specs it's
# "claude_m74-alpha" / "claude_m74-beta". We extract slug by stripping the
# `.final.txt` suffix and the longest `/tmp/xreview-<digits>-<digits>-<digits>-`
# prefix (runid = $$-$(date +%s)-$RANDOM, three numeric segments).
mismatch=0
while IFS= read -r line; do
  spec="$(echo "$line" | awk '{print $2}')"
  final_path="$(echo "$line" | awk '{print $4}')"
  # Inline equivalent of orchestrator's slug_of(): tr ':/' '__'.
  expected_slug="$(echo "$spec" | tr ':/' '__')"
  # Strip prefix up to and including the runid (3 numeric segments separated
  # by '-'), then strip .final.txt to get the embedded slug.
  actual_slug="$(echo "$final_path" \
    | sed -E 's#^/tmp/xreview-[0-9]+-[0-9]+-[0-9]+-##; s#\.final\.txt$##')"
  if [[ "$expected_slug" != "$actual_slug" ]]; then
    mismatch=1
    echo "     MISMATCH: spec=$spec expected_slug=$expected_slug actual_slug=$actual_slug final=$final_path"
  fi
done < <(echo "$m74_output" | grep -E "^RETURN ")

if [[ $mismatch -eq 0 ]]; then
  ((PASS++)); echo "  PASS: M7.4 every RETURN final path slug matches its spec slug"
else
  ((FAIL++)); echo "  FAIL: M7.4 at least one RETURN final path slug does not match spec slug (race-overwrite bug)"
fi

# Defence in depth: the two final.txt paths must be distinct files on disk.
# If the bug is present both RETURN lines point to the SAME final.txt
# (last-spec's), so the set of unique final paths collapses to 1.
unique_finals=$(echo "$m74_output" | awk '/^RETURN / {print $4}' | sort -u | wc -l)
if [[ "$unique_finals" -eq 2 ]]; then
  ((PASS++)); echo "  PASS: M7.4 each reviewer has its own final.txt path (2 unique)"
else
  ((FAIL++)); echo "  FAIL: M7.4 reviewers share final.txt path (got $unique_finals unique, expected 2) — race-overwrite bug"
fi

cleanup_from_output "$m74_output"

# ============================================================
echo "--- Test: M8 dedupe — duplicate resolved specs collapse to one reviewer ---"
# ============================================================
# Hotfix (2026-04-14): if config / CLI args contain two specs that resolve to
# the same canonical spec (e.g. alias "opus" + full "claude:claude-opus-4-6"
# both map to "claude:claude-opus-4-6"), the orchestrator used to dispatch
# both — they shared the same slug, hence the same .log / .final.txt path,
# and raced to overwrite each other. The event stream still emitted 2 RETURN
# events lying about distinct work having happened.
#
# Required behavior:
#   1. Only ONE START + ONE RETURN (or FAIL) event for the deduped spec.
#   2. A `XREVIEW_WARN: deduped duplicate spec: <spec>` line on stderr (NOT
#      stdout — stdout is the event stream).
#   3. Only one .log + one .final.txt on disk for that spec.
#
# Test design: feed alias "opus" + full "claude:claude-opus-4-6" via config-
# aliases. Both resolve to "claude:claude-opus-4-6". Use the happy mock so
# the surviving reviewer succeeds → exactly 1 RETURN expected.

write_happy_claude_mock
m8_xdg=$(mktemp -d)
mkdir -p "$m8_xdg/ddd-workflow"
cat > "$m8_xdg/ddd-workflow/xreview.json" << 'CFG_EOF'
{
  "aliases": {
    "opus": "claude:claude-opus-4-6"
  }
}
CFG_EOF

m8_stdout_file=$(mktemp)
m8_stderr_file=$(mktemp)
PATH="$MOCK_DIR:$PATH" XDG_CONFIG_HOME="$m8_xdg" \
  bash "$ORCH" "$PROMPT_FILE" "opus" "claude:claude-opus-4-6" \
  > "$m8_stdout_file" 2> "$m8_stderr_file"
m8_rc=$?
m8_stdout=$(cat "$m8_stdout_file")
m8_stderr=$(cat "$m8_stderr_file")

assert_exit_code "M8 dedupe run exits 0" "$m8_rc" 0

m8_start_count=$(count_lines_matching "$m8_stdout" "START claude:claude-opus-4-6 ")
if [[ "$m8_start_count" -eq 1 ]]; then
  ((PASS++)); echo "  PASS: M8 exactly 1 START event for deduped spec (got $m8_start_count)"
else
  ((FAIL++)); echo "  FAIL: M8 expected 1 START, got $m8_start_count"
fi

m8_terminal_count=$(echo "$m8_stdout" | grep -cE "^(RETURN|FAIL) claude:claude-opus-4-6 " || true)
if [[ "$m8_terminal_count" -eq 1 ]]; then
  ((PASS++)); echo "  PASS: M8 exactly 1 terminal (RETURN/FAIL) event for deduped spec"
else
  ((FAIL++)); echo "  FAIL: M8 expected 1 RETURN/FAIL, got $m8_terminal_count"
fi

if echo "$m8_stderr" | grep -qF "XREVIEW_WARN: deduped duplicate spec: claude:claude-opus-4-6"; then
  ((PASS++)); echo "  PASS: M8 warning emitted on stderr for deduped spec"
else
  ((FAIL++)); echo "  FAIL: M8 missing 'XREVIEW_WARN: deduped duplicate spec' on stderr"
  echo "     stderr was: $(echo "$m8_stderr" | head -5)"
fi

# Warning must NOT pollute stdout (which is the event stream consumed by Monitor).
if echo "$m8_stdout" | grep -qF "XREVIEW_WARN"; then
  ((FAIL++)); echo "  FAIL: M8 dedupe warning leaked into stdout (event stream)"
else
  ((PASS++)); echo "  PASS: M8 dedupe warning kept off stdout"
fi

# Disk: exactly one .log and one .final.txt for this spec slug.
m8_logs=$(echo "$m8_stdout" | grep -oE '/tmp/xreview-[^ ]+claude_claude-opus-4-6\.log' | sort -u | wc -l)
m8_finals=$(echo "$m8_stdout" | grep -oE '/tmp/xreview-[^ ]+claude_claude-opus-4-6\.final\.txt' | sort -u | wc -l)
if [[ "$m8_logs" -eq 1 && "$m8_finals" -eq 1 ]]; then
  ((PASS++)); echo "  PASS: M8 exactly one log + one final.txt path for deduped spec"
else
  ((FAIL++)); echo "  FAIL: M8 expected 1 log + 1 final, got logs=$m8_logs finals=$m8_finals"
fi

cleanup_from_output "$m8_stdout"
rm -f "$m8_stdout_file" "$m8_stderr_file"
rm -rf "$m8_xdg"

# ============================================================
echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
