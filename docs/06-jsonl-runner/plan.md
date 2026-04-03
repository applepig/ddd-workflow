# Plan: JSONL Progress Runner

## 背景

目前 `xreview-runner.sh` 用 stdin pipe 呼叫外部 CLI（OpenCode、Gemini、Codex），CLI 跑到結束才回傳結果，main agent 無法追蹤中間進度。

調研發現主流 AI coding CLI 都已支援 JSONL streaming output：

| CLI | 指令 | 串流格式 |
|-----|------|---------|
| Copilot CLI | `copilot -p "..." --output-format json` | JSONL（session events → turn events → result） |
| OpenCode | `opencode run --format json` | JSONL（tool_use/text/reasoning/step events） |
| Gemini CLI | `gemini -p "..." --output-format stream-json` | JSONL（init/message/tool_use/result events） |
| Codex CLI | `codex exec --json` | JSONL（TurnStarted/ItemStarted/ItemCompleted events） |

## 目標

建一個 Node.js（TypeScript + tsx）script，能：

1. Spawn 外部 CLI process 並接收 JSONL streaming output
2. Parse 各 CLI 的事件格式，統一成內部進度事件
3. 將進度即時寫入 state file，讓 Claude Code main agent 可以 polling
4. 作為 **general purpose agent runner**，不限於 reviewer——任何 prompt 都能送

## 方向

- **方案 A（選定）**：JSONL Progress Runner（Node.js script + state file polling）
- 方案 B（未來）：MCP Server wrapper（在 A 的基礎上加 transport layer）
- 方案 C（排除）：Copilot Plugin 格式（綁定特定生態，不適合跨 CLI）

選 A 的理由：
1. 解決核心問題（中間進度追蹤），scope 可控
2. Standalone script，可獨立測試
3. 未來升級 MCP 只是加 transport，core 全部可復用

## 初始 Scope

- **Primary**：Copilot CLI（已安裝 v1.0.17、gpt-5-mini 0x 免費測試）
- **Secondary**：OpenCode（Copilot provider gpt-5-mini 也 0x，headless one-shot 不觸發 compaction）
- **Later**：Gemini CLI、Codex CLI（已有 xreview-runner.sh 支援，遷移可漸進）

## 技術棧

- TypeScript + tsx（直接執行 .ts，不需 build step）
- Node.js child_process spawn（JSONL streaming）
- 檔案系統 state（JSON state file for polling）

## 非目標

- 不做 MCP server（留給未來）
- 不取代 xreview-runner.sh（共存，新功能用新 runner）
- 不做 UI dashboard
