# Memory

## Claude Code 設定

- 停用 cloud connector MCP（Gmail、Calendar 等）：在 `~/.claude/settings.json` 加 `"env": { "ENABLE_CLAUDEAI_MCP_SERVERS": "false" }`

## Feedback

- [E2E subagent 品質問題](feedback_e2e_subagent_problems.md) — E2E 測試不適合 subagent 自主執行，需要使用者決策點
