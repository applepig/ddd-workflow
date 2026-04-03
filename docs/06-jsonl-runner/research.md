# Research: 外部 CLI 作為 Claude Code Subagent

調研日期：2026-04-03

## 一、各 CLI 的 JSONL Streaming 格式

### Copilot CLI（v1.0.17，primary target）

指令：`copilot -p "PROMPT" --output-format json --allow-all-tools --no-ask-user -s`

實測 JSONL 事件（gpt-5-mini，`copilot -p "say hello" --output-format json --allow-all-tools -s`）：

```
session.mcp_server_status_changed  ← MCP server 連線（ephemeral）
session.mcp_servers_loaded         ← MCP servers 載入完成（ephemeral）
session.tools_updated              ← tools 就緒，含 model 名稱（ephemeral）
user.message                       ← user prompt 送出
assistant.turn_start               ← turn 開始（含 turnId、interactionId）
assistant.message_delta            ← streaming text chunk（ephemeral）
assistant.message                  ← 完整 assistant message（含 toolRequests）
assistant.reasoning                ← reasoning 內容（ephemeral）
assistant.turn_end                 ← turn 結束
result                             ← 最終結果（exitCode、usage、codeChanges）
```

每個事件的共同欄位：`type`、`data`、`id`（UUID）、`timestamp`（ISO 8601）、`parentId`、`ephemeral`（boolean）。

`result` 事件的 `usage` 欄位：
```json
{
  "premiumRequests": 0,
  "totalApiDurationMs": 23811,
  "sessionDurationMs": 32008,
  "codeChanges": { "linesAdded": 0, "linesRemoved": 0, "filesModified": [] }
}
```

Tool call 事件（推測，尚未實測）：
- `assistant.tool_call`：agent 呼叫工具
- `assistant.tool_result`：工具回傳結果

### OpenCode

指令：`opencode run --format json --model copilot.gpt-5-mini < prompt.md`

JSONL 事件類型：
```
tool_use       ← tool call 完成（含 tool input/output/metadata）
text           ← LLM 文字回覆
reasoning      ← 推理/思考內容
step_start     ← agentic 迴圈步驟開始
step_finish    ← 步驟結束（含 reason）
error          ← 錯誤
```

每行格式：`{"type":"...","timestamp":...,"sessionID":"...","part":{...}}`

### Gemini CLI

指令：`gemini -p "PROMPT" --output-format stream-json`

JSONL 事件類型：
```
init           ← session metadata（session_id、model）
message        ← user/assistant 訊息（delta: true 表示 streaming chunk）
tool_use       ← 工具呼叫請求
tool_result    ← 工具執行結果
error          ← 非致命錯誤
result         ← 最終結果 + 統計
```

Exit codes：`0` 成功、`1` 一般錯誤、`42` 輸入錯誤、`53` turn limit 超過。

### Codex CLI

指令：`codex exec --json "PROMPT"`

JSONL 事件類型：
```
TurnStarted    ← turn 開始
ItemStarted    ← item 開始（commandExecution、fileChange、mcpToolCall 等）
ItemCompleted  ← item 完成
TurnCompleted  ← turn 完成
```

另有 `codex app-server`（JSON-RPC over stdio），提供更細粒度的雙向通訊。

---

## 二、Copilot CLI 擴充機制

### Custom Agents

- 格式：`.agent.md`（YAML frontmatter + Markdown body as system prompt）
- 位置：`~/.copilot/agents/`（user）、`.github/agents/`（project）
- Frontmatter 欄位：`name`、`description`、`tools`（白名單）、`model`、`agents`（可呼叫的子 agent）
- Read-only 模擬：`tools: ['read', 'search', 'codebase']`（排除 write、shell）

### Custom Skills

- 格式：`SKILL.md`（YAML frontmatter + Markdown）
- 位置：`~/.copilot/skills/<name>/SKILL.md`
- Frontmatter：`name`、`description`、`allowed-tools`
- 觸發：自動（比對 description）或手動（`/<skill-name>`）

### Headless/Non-interactive Flags

| Flag | 說明 |
|------|------|
| `-p "prompt"` | Non-interactive，完成即退出 |
| `-s` / `--silent` | 只輸出 agent response |
| `--output-format json` | JSONL 格式 |
| `--allow-all-tools` | 所有工具自動執行 |
| `--no-ask-user` | Agent 不會暫停發問 |
| `--model <model>` | 指定模型 |
| `--agent <agent>` | 指定 custom agent |
| `--deny-tool='write'` | 禁止寫入工具 |
| `--deny-tool='shell'` | 禁止 shell 工具 |
| `--max-autopilot-continues <N>` | 限制 autopilot 續接次數 |
| `--effort <level>` | Reasoning effort（low/medium/high/xhigh） |

**不存在**：timeout flag、turn/step limit、原生 sandbox mode。

### Read-only Reviewer 配置

```bash
copilot \
  --agent xreviewer \
  --model gpt-5-mini \
  --deny-tool='write' \
  --deny-tool='shell' \
  --no-ask-user \
  --allow-all-tools \
  --output-format json \
  -p "$(cat prompt.md)" \
  -s
```

`--deny-tool` 優先於所有 allow，即使 `--allow-all-tools` 也無法覆蓋。

---

## 三、Premium Request 計費

### Multiplier 費率（付費方案）

| 模型 | Multiplier | 備註 |
|------|-----------|------|
| GPT-5 mini | **0x（免費）** | 測試首選 |
| GPT-4.1 | **0x（免費）** | 測試備選 |
| GPT-5.4 mini | 0.33x | |
| Claude Haiku 4.5 | 0.33x | |
| Gemini 3 Flash | 0.33x | |
| GPT-5.1 | 1x | |
| GPT-5.2 | 1x | |
| GPT-5.3-Codex | 1x | |
| GPT-5.4 | 1x | |
| Claude Sonnet 4 / 4.5 / 4.6 | 1x | |
| Gemini 2.5 Pro / 3 Pro | 1x | |
| Claude Opus 4.5 / 4.6 | 3x | |

### 方案額度

| 方案 | 月額度 | 月費 |
|------|--------|------|
| Free | 50 | $0 |
| Pro | 300 | $10 |
| Pro+ | 1,500 | $39 |

超額：$0.04 USD/request。

### Compaction 計費問題

| CLI | 是否有 auto-compaction | 計費影響 | 狀態 |
|-----|----------------------|---------|------|
| Copilot CLI | 有（context ~95% limit 時觸發） | Bug：消耗 1 premium request（[#2068](https://github.com/github/copilot-cli/issues/2068)） | Triage |
| OpenCode | 有（context ~75-80% limit 時觸發） | 已修正：標為 agent-initiated，不消耗 | Fixed |

**對我們的影響**：headless one-shot（一個 prompt → 回覆 → 退出）幾乎不可能觸發 compaction，因為 token 數達不到閾值。安全起見可加 `OPENCODE_DISABLE_AUTOCOMPACT=1`。

---

## 四、現有的包裝專案

### ai-cli-mcp（最接近需求）

- GitHub：[mkXultra/ai-cli-mcp](https://github.com/mkXultra/ai-cli-mcp)
- MCP server，spawn CLI 並回傳 PID
- `run` → `get_result`（polling stdout）→ `list_processes` → `kill_process`
- 限制：不是即時 JSONL parsing，只是讀 stdout log file

### PAL MCP Server

- GitHub：[BeehiveInnovations/pal-mcp-server](https://github.com/BeehiveInnovations/pal-mcp-server)
- CLI-to-CLI bridging、multi-model consensus
- 限制：subagent 只回傳最終結果

### Overstory（最完整但最重）

- GitHub：[jayminwest/overstory](https://github.com/jayminwest/overstory)
- 支援 11 種 runtime，SQLite mail system + tmux 隔離
- 限制：架構重

### codex-plugin-cc（參考架構）

- GitHub：[openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc)
- Claude Code plugin，透過 Codex app-server JSON-RPC 雙向通訊
- 有完整的 job lifecycle（status/result/cancel）
- 進度追蹤：JSON-RPC notification → state file → slash command 查詢
- **最值得參考的架構**，但它綁定 Codex 且走 JSON-RPC 而非 JSONL

---

## 五、ACP（Agent Client Protocol）支援狀況

ACP 是 Zed + Google 共同推動的 editor ↔ agent 整合協定，類似 LSP。

| CLI | ACP 支援 | 啟動方式 |
|-----|---------|---------|
| Gemini CLI | 原生 | `gemini --acp` |
| OpenCode | 原生 | `opencode acp` |
| Copilot CLI | 原生 | `copilot --acp` |
| Goose | 原生 | 內建 |
| Codex CLI | 社群 adapter | `codex proto` + bridge |
| Claude Code | 社群 adapter | `@zed-industries/claude-agent-acp` |

**結論**：ACP 是 editor 整合協定，不是 CLI-to-CLI subagent 協定。對我們的場景，直接 parse JSONL 比走 ACP 簡單。

---

## 六、codex-plugin-cc 架構分析（作為參考）

codex-plugin-cc 的通訊架構比 xreview-runner.sh 精密很多：

```
Claude Code
  └─ Bash("node codex-companion.mjs review ...")
       └─ CodexAppServerClient.connect(cwd)
            ├─ BrokerCodexAppServerClient（Unix socket → 共用 broker）
            └─ SpawnedCodexAppServerClient（spawn "codex app-server"）
                 └─ JSON-RPC 雙向 JSONL 通訊
                       request: thread/start → review/start → turn/start
                       notification（即時推送）:
                         turn/started → item/started → item/completed → turn/completed
```

三層進度追蹤：
1. **JSON-RPC Notification**：即時 item/tool call 事件
2. **Job State File**：持久化 job 狀態（status、phase、threadId）
3. **Slash Command**：`/codex:status`、`/codex:result`、`/codex:cancel`

我們的 JSONL Runner 採用類似的 state file 機制，但用 JSONL streaming 取代 JSON-RPC notification。
