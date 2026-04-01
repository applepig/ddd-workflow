# Codex Plugin for Claude Code — Review 機制調研

調研日期：2026-03-31
來源：`reference/codex-plugin-cc/`

## 專案概述

codex-plugin-cc 是一個 **Claude Code plugin**，讓使用者在 Claude Code 中呼叫 Codex CLI 做 code review 和任務委派。

## 架構

```
plugins/codex/
├── .claude-plugin/plugin.json    # Plugin manifest
├── commands/                     # 7 個 slash commands
├── agents/                       # 1 個 subagent（codex-rescue）
├── hooks/                        # SessionStart / SessionEnd / Stop hooks
├── prompts/                      # Review prompt 模板
├── schemas/                      # JSON schema 驗證結構化輸出
├── scripts/
│   ├── codex-companion.mjs       # 主要 CLI 介面（1000+ 行）
│   ├── app-server-broker.mjs     # Codex app-server 訊息 broker
│   └── lib/                      # 15+ 個 library 模組
└── skills/                       # 3 個內部 skill
```

## Codex CLI 呼叫機制——兩層架構

### 層次一：Command → codex-companion.mjs

Commands（如 `/codex:review`）透過 Bash 呼叫 Node.js script：

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" review "$ARGUMENTS"
```

### 層次二：codex-companion.mjs → Codex app-server（JSON-RPC）

不是直接用 `codex review` CLI，而是透過 **JSON-RPC over stdio/Unix socket** 與 Codex 的 `app-server` 模式通訊：

```
codex-companion.mjs
  └→ CodexAppServerClient.connect(cwd)
       ├→ 優先：BrokerCodexAppServerClient（Unix socket 連既有 broker）
       └→ 降級：SpawnedCodexAppServerClient（spawn "codex app-server"）
            └→ JSON-RPC 雙向通訊（JSONL over stdio）
```

### App-server vs MCP

概念接近但不同：

| | MCP Server | Codex app-server |
|---|---|---|
| 生命週期 | 隨 session 啟動，常駐 | 按需啟動，或透過 broker 共用 |
| Context 佔用 | 註冊 tools → 佔用 system prompt | 零佔用——plugin script 自己呼叫 |
| 通訊發起者 | Claude 主動呼叫 tool | Plugin script 主動發 RPC request |
| 串流 | 不支援 | 支援 notifications |

更像是「plugin 自己管理的 private MCP」——Claude Code 完全不知道 app-server 的存在。

## 兩種 Review 模式

| | Native Review | Adversarial Review |
|---|---|---|
| RPC method | `review/start` | `turn/start` |
| 輸入 | `{ threadId, target }` | prompt（含 git diff + adversarial prompt） |
| sandbox | 自動 read-only | 明確 `"read-only"` |
| 輸出 | `reviewText`（純文字） | structured JSON |
| schema | 無 | `review-output.schema.json` |

**Native Review**：送 target，Codex 內建 reviewer 自己看 diff 產出 review。
**Adversarial Review**：把 Codex 當通用 LLM，自己組 prompt + 要求 JSON schema 輸出。

## Adversarial Review Prompt 設計——分段約束

核心設計哲學：**與其給一個模糊的角色描述，不如用多個正交的約束條件圍出精確的行為空間**。

每個段落各司其職：

| Section | 作用 |
|---------|------|
| `<role>` | 設定身份：adversarial reviewer |
| `<task>` | 指定 review target 和 user focus |
| `<operating_stance>` | 認知立場：預設懷疑，不因意圖良好放過 |
| `<attack_surface>` | 7 類高風險區域（auth、data loss、race condition 等） |
| `<review_method>` | 主動嘗試推翻，追蹤 bad input 的流動 |
| `<finding_bar>` | 每個 finding 必須回答 4 問：會壞什麼、為什麼脆弱、影響、怎麼修 |
| `<structured_output_contract>` | JSON schema 輸出，verdict + findings + next_steps |
| `<grounding_rules>` | 每個 finding 必須有程式碼證據，不可捏造 |
| `<calibration_rules>` | 一個強 finding 勝過數個弱 finding |
| `<final_check>` | 最終檢查：adversarial、有定位、真實場景、可操作 |

## Structured Output Schema

```json
{
  "verdict": "approve" | "needs-attention",
  "summary": "string",
  "findings": [{
    "severity": "critical" | "high" | "medium" | "low",
    "confidence": 0.0-1.0,
    "file": "path",
    "line_start": 42,
    "line_end": 47,
    "title": "string",
    "body": "string",
    "recommendation": "string"
  }],
  "next_steps": ["string"]
}
```

## Review-Only 約束——三層防護

1. **Command frontmatter**：`disable-model-invocation: true`
2. **Prompt 層**：「Do not fix issues, apply patches, or suggest that you are about to make changes」
3. **Sandbox 層**：`sandbox: "read-only"`

## Stop Gate Hook（特色功能）

啟用後，每次 Claude 要 `/stop` 時，hook 先對上一輪 code changes 跑 adversarial review。發現問題就 BLOCK，乾淨才 ALLOW。15 分鐘 timeout 防無限迴圈。

## Background Job Tracking

完整的 job lifecycle：
- `spawnDetachedTaskWorker()` 產生 detached process
- JSON 持久化 job 狀態（queue → run → complete/cancel）
- Session-aware 清理（SessionEnd hook 自動終止）
- `/codex:status`、`/codex:result`、`/codex:cancel` 管理指令

## 值得借鏡的設計模式

1. **Verbatim Pass-Through**：Review 結果原樣回傳，不摘要、不改寫
2. **Smart Execution Mode**：先估算 review 範圍（`git diff --shortstat`），多檔案時建議 background
3. **Broker Pattern**：單一共用 app-server，避免冷啟動和併發衝突
4. **Prompt 模板化**：`prompts/` 目錄集中管理，用 `interpolateTemplate()` 填入變數

## Codex CLI 可用的 Flags

```bash
# exec 模式（通用 agent）
codex exec --sandbox read-only --ephemeral -m <model> -o <output-file> -

# exec review 模式（內建 reviewer）
codex exec review --base <branch> --uncommitted --commit <sha>

# 頂層 review
codex review --base <branch> --uncommitted
```

關鍵 flags：
- `--sandbox read-only`：技術層面禁止寫檔
- `--ephemeral`：不持久化 session
- `-o <file>`：最後一則 agent message 寫入檔案
- `-`：從 stdin 讀 prompt
- `--output-schema <file>`：要求 JSON structured output
