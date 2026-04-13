#!/usr/bin/env bash
# run-orchestrator.sh — thin wrapper around xreview-orchestrator.sh
#
# Why this exists: Monitor's `command` field is a single string. Embedding
# the orchestrator invocation directly forces double-quote escaping inside
# the JSON ("\"$prompt_file\""), which is easy to miscopy. This wrapper
# accepts the same args and exec's orchestrator, so Monitor only needs:
#   bash <skill-dir>/scripts/run-orchestrator.sh <prompt-file> <spec> [<spec>...]
#
# Usage: run-orchestrator.sh <prompt-file> <cli:model> [<cli:model> ...]

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$script_dir/xreview-orchestrator.sh" "$@"
