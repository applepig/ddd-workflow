#!/bin/bash
# 相容性入口——實際邏輯已移至 scripts/cli.js
# 建議改用 npm run deploy
exec node "$(dirname "$0")/scripts/cli.js" deploy "$@"
