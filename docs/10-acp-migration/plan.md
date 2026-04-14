# Plan — xreview Orchestrator 遷移到 ACP

> **狀態：deferred**。本 plan 作為未來 sprint 的種子，記錄 2026-04-14 調研結果與觸發條件。真要開工時用 `/ddd.plan` 展開為 spec.md。

## 背景

Sprint 09（xreview adapters + aliases）尾聲發現 4 家 reviewer CLI 的 stdout 格式各不相同且 verbose：codex 會 echo 整段 prompt + 每個 bash tool call 的 stdout + reasoning + final findings（還重複兩次），單一 reviewer log 可達 5000+ 行、350KB，違反 `SKILL.md` 步驟 7.1 的 peek / Read 協議。

Sprint 09 M7 走**中間路線 JSON schema + 雙檔**（verbose `.log` + final `.final.txt`）先把使用者體驗救回來，但每家 CLI 的 event schema 不統一，adapter 內要各自寫 jq filter、每次新增 CLI 要重研究一次 schema。

**ACP（Agent Client Protocol）是治本方案**——Zed 主導的 JSON-RPC over stdio 協定，事件分類到位：`agent_message_chunk`（final text）/ `tool_call` / `tool_call_update` / `agent_thought_chunk`（reasoning）各自獨立 notification type，不用 regex 或 schema-specific jq filter。

## 觸發條件

下列任一達成即可開 sprint（以 `/ddd.plan` 展開此文件為 spec）：

- **Codex 推出 ACP server 模式**（目前只有 `mcp-server` + `app-server`，都不是 ACP）；或社群寫出 `codex-agent-acp` bridge 像 `claude-agent-acp` 那樣包 codex CLI
- 使用者主動決定「即使 codex 要繼續用 `-o` bash fallback，也要把另外 3 家（claude / opencode / gemini）改走 ACP」——屆時本 sprint 範疇縮小為 3 家 ACP + codex bash 的混合 orchestrator

## 技術現況（2026-04-14 調研結果）

### 4 家 CLI 的 ACP 支援矩陣

| CLI | Native ACP | 啟動指令 | 備註 |
|-----|-----------|---------|------|
| **opencode** | ✅ | `opencode acp` | 本機 `opencode --help` 直接確認 |
| **gemini** | ✅ | `gemini --acp`（`--experimental-acp` 已 deprecated） | 本機 `gemini --help` 直接確認 |
| **claude** | 🌉 bridge | `npx -y @agentclientprotocol/claude-agent-acp` | 第三方 adapter，直呼 Anthropic SDK（不包 `claude` CLI subprocess，但認證時會用） |
| **codex** | ❌ | — | 只有 `mcp-server`（MCP）和 `app-server`（自家 IDE 協定），兩者都不是 ACP |

### ACP 協定本體

- 版本：`protocolVersion = 1`，stdio 傳輸（JSON-RPC 2.0 + newline-delimited JSON）
- Session 流程：`initialize` → `authenticate`（可選）→ `session/new` → `session/prompt` → 收一系列 `session/update` notification → response 帶 `stopReason`
- 事件分類（`session/update` 的 `sessionUpdate` 欄位區分 subtype）：
  - `agent_message_chunk` — assistant final text（可能多 chunk，拼接即 final）
  - `tool_call` / `tool_call_update` — tool 呼叫與結果
  - `agent_thought_chunk` — reasoning（獨立事件，不和 message 混）
  - `plan` — task plan
  - `session/request_permission` — tool 執行前詢問授權（client → agent）
- **沒有**協定層的 agent/persona 宣告——仍需在 prompt content 裡注入 reviewer 指令

### Client library 生態

| 套件 | 語言 | 狀態 | 備註 |
|------|------|------|------|
| `@zed-industries/agent-client-protocol` | TypeScript / Node | npm 0.4.5 | 官方、活躍 |
| `agent-client-protocol` | Rust crate | 官方 | |
| Python / Go | — | 無官方、也無活躍社群 | |
| CLI-friendly wrapper (`acp-curl`-style) | — | 不存在 | 要自己寫 ~30 行 Node script |

## 架構草圖（真要開工時展開）

**取代 sprint 09 的 bash orchestrator**：

```
ddd-workflow/skills/ddd.xreview/
  orchestrator.mjs          # 取代 xreview-orchestrator.sh（Node script）
  drivers/
    opencode.mjs            # 取代 adapters/opencode.sh
    gemini.mjs              # 取代 adapters/gemini.sh
    claude.mjs              # 取代 adapters/claude.sh（啟動 claude-agent-acp）
    codex.mjs               # 包 codex exec -o（bash fallback，直到 codex 原生 ACP）
  drivers.test.mjs          # 取代 adapters.test.sh
  orchestrator.test.mjs     # 取代 xreview-orchestrator.test.sh
```

**每個 driver** 約 30-50 行：spawn subprocess、走 `@zed-industries/agent-client-protocol` 的 `ClientSideConnection`，把 `agent_message_chunk` 拼接到 `.final.txt`、其他事件 dump 到 `.log`。

**orchestrator.mjs** 負責：fan-out drivers、event 廣播（`START` / `RETURN` / `FAIL` / `ALL_DONE`）、timeout、alias resolve、cleanup trap——邏輯等同現有 bash orchestrator 但少一層 verbose parsing。

**保留**：
- `config/xreview.json` schema + aliases 機制（Node 讀 JSON 更直接）
- `SKILL.md` 步驟 7.1 peek 協議（driver 產出的 `.final.txt` 本來就乾淨）

**放棄**：
- bash trap / PGID cleanup / `timeout --foreground` 機制（Node 有 child_process API + AbortSignal）
- `OPENCODE_PERMISSION` / `--include-directories` sandbox 放行（ACP 層面不走 workspace sandbox）
- M6.1 的 pgid sweep（Node subprocess 管理更乾淨）

## 估算

- 工程量：~2-3 個 milestone，主要是 drivers 實作 + test 遷移
- 風險：
  - `@agentclientprotocol/claude-agent-acp` 認證機制可能跟既有 `claude login` 不互通，需驗證
  - ACP `protocolVersion=1` 仍 alpha（0.4.5），schema 可能小改動
  - codex bash fallback 要維持跟 ACP drivers 的介面一致（event 發射點對齊）

## 交叉參照

- sprint 09（`docs/09-xreview-adapters-aliases/`）— JSON schema 雙檔方案的實作基礎
- ACP spec：https://agentclientprotocol.com
- npm：https://www.npmjs.com/package/@zed-industries/agent-client-protocol
- claude bridge：https://github.com/agentclientprotocol/claude-agent-acp
