#!/usr/bin/env bash
# adapters.test.sh — runner that sources every per-CLI adapter test file and
# prints the accumulated pass/fail total.
#
# Per-CLI files live at scripts/adapters/<cli>.test.sh and can each be run
# standalone (`bash adapters/claude.test.sh`). This runner is just a
# convenience for running all four in one go with a single PASS/FAIL total.
#
# Run: bash ddd-workflow/skills/ddd.xreview/scripts/adapters.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADAPTER_TEST_SCRIPT_DIR="$SCRIPT_DIR"

# shellcheck source=adapters.test.common.sh
source "$SCRIPT_DIR/adapters.test.common.sh"
ADAPTER_TEST_COMMON_SOURCED=1

echo "=== adapters.test.sh runner: sourcing per-CLI test files ==="

# shellcheck source=adapters/claude.test.sh
source "$SCRIPT_DIR/adapters/claude.test.sh"
run_claude_adapter_tests

# shellcheck source=adapters/opencode.test.sh
source "$SCRIPT_DIR/adapters/opencode.test.sh"
run_opencode_adapter_tests

# shellcheck source=adapters/gemini.test.sh
source "$SCRIPT_DIR/adapters/gemini.test.sh"
run_gemini_adapter_tests

# shellcheck source=adapters/codex.test.sh
source "$SCRIPT_DIR/adapters/codex.test.sh"
run_codex_adapter_tests

# ============================================================
echo ""
echo "--- Test: cli-adapters.md documents stdout/stderr contract (Finding 3) ---"
# ============================================================
# ADR-11 implicitly assumed adapter stdout is empty (final flows via $3). M7
# cross review (sprint 09) flagged this as undocumented. Doc must explicitly
# spell out the contract so future adapter authors don't accidentally print
# final to stdout (which would be appended into log via orchestrator's
# `>> $log 2>&1`).
DOC_FILE="$SCRIPT_DIR/../references/cli-adapters.md"
if grep -qF 'Adapter stdout/stderr contract' "$DOC_FILE"; then
  ((PASS++)); echo "  PASS: cli-adapters.md has 'Adapter stdout/stderr contract' section"
else
  ((FAIL++)); echo "  FAIL: cli-adapters.md missing 'Adapter stdout/stderr contract' section"
fi
if grep -qE 'stdout.*must be empty|must be empty.*stdout' "$DOC_FILE"; then
  ((PASS++)); echo "  PASS: cli-adapters.md states stdout must be empty"
else
  ((FAIL++)); echo "  FAIL: cli-adapters.md does not state stdout must be empty"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
