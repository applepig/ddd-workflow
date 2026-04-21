# TypeScript xreview Orchestrator

## 目標

用 TypeScript + ACP SDK 重寫 xreview orchestrator，取代現有 bash orchestrator + adapter shells，同時簡化 SKILL.md 文件。

**核心改善**：
1. 消除各 CLI adapter 中的重複邏輯（jq 解析、CLI 啟動、error handling）
2. 將 config 解析、alias 解析、dedup 邏輯從 bash 移到 TypeScript（易測試、易維護）
3. 簡化 main agent 認知負荷：不再需要解析事件流、讀多份 `.final.txt`、判斷 content-layer 失敗

## 非目標

- 改變 Skill 的公開介面 — Skill 仍然主導主流程，Monitor 呼叫方式不變
- 支援 Codex ACP — `codex-acp` 是社區 Rust binary，待穩定後再加（Phase 2）
- 改變 xreview.json 格式或 reviewer 清單機制 — 配置格式保持相容
- 改變各 CLI 的 ACP 啟動方式 — 只是用 ACP SDK 代替各自 adapter

## User Story

### Story 1：Skill maintainer 望簡化測試
**作為** Skill maintainer，
**我想要** 用 TypeScript + Vitest 重寫 orchestrator（而不是依賴 bash 測試），
**以便** 簡化單元測試、mock 第三方 CLI、提升可維護性。

### Story 2：Main agent 望減少認知負荷
**作為** main agent，
**我想要** 不再需要解析 START/RETURN/FAIL 事件流、讀多份 `.final.txt`、判斷 content-layer 失敗，
**以便** 集中在準備 review prompt、驗證 findings、呈現報告。

### 驗收條件
- [ ] TypeScript orchestrator 用 `@agentclientprotocol/sdk` 支援 claude / gemini / opencode 三個 CLI
- [ ] Config 解析、alias resolve、dedup 邏輯全部轉移到 TypeScript（有 Vitest 單元測試覆蓋）
- [ ] Orchestrator 輸出結構化 JSON 結果（包含 reviewer spec、status、content、error 欄位）
- [ ] Orchestrator 與現有 bash orchestrator 併行（bash 保留，不刪，直到 TypeScript 穩定）
- [ ] ddd-reviewer persona 成功注入到每個 reviewer（prepend to prompt）
- [ ] SKILL.md 改寫：主要流程簡化為 6 步，shell 技術細節移至 `references/orchestrator-internals.md`
- [ ] Orchestrator 與現有 Monitor 機制相容（timeout、stdout 格式）
- [ ] 每個 reviewer 有獨立的 50 分鐘 timeout（via timeout race）
- [ ] Content-layer 失敗（empty final）被標記為 `status: "empty"`，不會誤判為成功

## 相關檔案

### 現有
- `ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.sh` — bash orchestrator（493 行）
- `ddd-workflow/skills/ddd.xreview/scripts/adapters/*.sh` — 四個 CLI adapter（共 474 行）
- `ddd-workflow/skills/ddd.xreview/SKILL.md` — Skill 文件（284 行）
- `~/.config/ddd-workflow/xreview.json` — 配置檔（reviewers + aliases）
- `~/.claude/agents/ddd-reviewer.md` — ddd-reviewer agent 定義

### 新增
- `ddd-workflow/skills/ddd.xreview/orchestrator/` — TypeScript orchestrator 包
  - `package.json` / `tsconfig.json` / `vitest.config.ts`
  - `src/cli.ts` — 入口
  - `src/config.ts` — 配置讀取、alias resolve、dedup
  - `src/orchestrator.ts` — fan-out 主邏輯
  - `src/reviewers/{types,acp-runner,claude,gemini,opencode}.ts`
  - `src/__tests__/*.test.ts` — Vitest 單元測試
- `ddd-workflow/skills/ddd.xreview/references/orchestrator-internals.md` — shell 技術細節

### 修改
- `ddd-workflow/skills/ddd.xreview/SKILL.md` — 改寫步驟、簡化文件
- `ddd-workflow/skills/ddd.xreview/references/cli-adapters.md` — 加 ACP 欄位、bash 移到 legacy

## 介面/資料結構

### CLI 入口
```bash
node dist/cli.js <prompt-file> [spec1 spec2 ...]
# 或
node dist/cli.js --prompt-file <file> --output <out.json> --timeout-sec 3000

# 返回：
# - 成功時：stdout 輸出 JSON
# - 失敗時：exit code 1 + stderr 錯誤訊息
```

### 輸出 JSON 格式
```json
{
  "runId": "12345-1744000000-4821",
  "timestamp": "2026-04-14T12:34:56Z",
  "reviewers": [
    {
      "spec": "claude:claude-opus-4-6",
      "status": "returned",
      "content": "## Critical\n\n- Issue 1: ...\n\nDONE: 2 critical, 1 warning",
      "error": null,
      "duration_ms": 45230
    },
    {
      "spec": "gemini:gemini-3-pro-preview",
      "status": "timeout",
      "content": null,
      "error": "timeout after 3000000ms",
      "duration_ms": 3000050
    },
    {
      "spec": "opencode:github-copilot/gpt-5.4",
      "status": "failed",
      "content": null,
      "error": "exit_code=1: command not found",
      "duration_ms": 250
    }
  ],
  "summary": {
    "total": 3,
    "returned": 1,
    "failed": 2,
    "empty": 0
  }
}
```

### Status 欄位
- `"returned"`：ACP 連線成功，有輸出內容
- `"empty"`：ACP 連線成功（exit 0），但最終 content 為空（content-layer 失敗）
- `"timeout"`：執行超過 timeout（default 3000000ms = 50 分鐘）
- `"failed"`：ACP 連線失敗或 CLI exit code != 0

## 邊界案例

### Case 1：CLI 不可用
**狀況**：`claude-agent-acp` 或 `gemini` 未安裝

**處理**：
- spawn 拋 ENOENT → catch → status: "failed", error: "command not found: <cmd>"
- Orchestrator 繼續派其他 reviewer，不中止

**驗收**：JSON 中該 reviewer 的 status 為 "failed"，error 欄位說明原因

### Case 2：Prompt 過大
**狀況**：Prompt 檔案超過某個 CLI 的 token limit（如 claude 100K context）

**處理**：
- Agent 在記憶體限制下執行，可能返回 context exceed 錯誤或空白內容
- ACP 連線仍然成功（exit 0），但最終 content 為空

**驗收**：status: "empty", error: null（或 content 含 agent 自陳的錯誤訊息）

### Case 3：Content-layer 失敗
**狀況**：Agent 正常退出（exit 0），但未產生任何有意義的輸出

**原因可能**：rate limit、sandbox 擋路、JSON 解析失敗、agent 格式錯誤

**處理**：
- ACP stream 中沒有 `agent_message_chunk` 或只有空白
- chunks.join("") 為空字串

**驗收**：status: "empty", content: null（或空字串）

### Case 4：Timeout
**狀況**：Reviewer 執行超過 50 分鐘

**處理**：
- 用 Promise.race + setTimeout 實現 timeout
- Timeout 時 spawn 進程被 SIGTERM + SIGKILL
- Error 訊息：`"timeout after 3000000ms"`

**驗收**：status: "timeout", duration_ms ≈ 3000000

### Case 5：多個 reviewer 同時失敗
**狀況**：三個 reviewer 都失敗（CLI 都不可用或都 timeout）

**處理**：
- Promise.allSettled 等待所有完成，部分失敗不中止其他
- JSON 中所有 reviewer 的 status 為 non-"returned"

**驗收**：JSON 中 summary.returned == 0，但不報 error（由 Skill 決定是否重試）

### Case 6：Alias 衝突（Dedup）
**狀況**：使用者指定 `--spec opus claude:claude-opus-4-6`（兩個都解析到同一個）

**處理**：
- Config 解析後 dedup：去除重複，只保留第一次出現
- 第二次出現的 spec 被跳過，stderr 警告 `XREVIEW_WARN: deduped duplicate spec: claude:claude-opus-4-6`

**驗收**：JSON reviewers 陣列中只有一個 claude:claude-opus-4-6 entry

### Case 7：Invalid spec 格式
**狀況**：使用者指定 `--spec "@invalid:model-name"`（CLI 或 model 欄位格式錯誤）

**格式規則**：
- CLI：`^[a-z0-9_-]+$`
- Model：`^[A-Za-z0-9._/:-]+$`

**處理**：
- Validate 在派工前執行
- Invalid spec 得到 status: "failed", error: "invalid spec format: <reason>"

**驗收**：JSON 中該 reviewer 的狀態明確標記為失敗，不嘗試派工

### Case 8：Ddd-reviewer persona 載入失敗
**狀況**：ddd-reviewer.md 不存在或格式錯誤

**處理**：
- 讀檔失敗時 throw，Orchestrator 整體失敗（返回 exit code 1）
- Stderr 輸出：`XREVIEW_ERROR: failed to load ddd-reviewer persona: <reason>`

**驗收**：CLI 返回 non-zero exit code，JSON 不被產生

## ADR（Architecture Decision Record）

### ADR-1：使用 ACP SDK 而不是各自 adapter shell
**決策**：採用 `@agentclientprotocol/sdk` 統一跟各 CLI 通訊，取代 claude.sh / gemini.sh / opencode.sh 各自的 jq 解析邏輯。

**原因**：
- ACP 是標準協議（JSON-RPC 2.0 over stdio），三個 CLI 都支援
- 消除各自不同的 JSON 格式解析邏輯（claude 用 jq 抽 `.result`；opencode 用 jq 合併 ndjson；gemini 用 jq 抽 `.response`）
- 統一的 ClientSideConnection 介面更易測試、易 mock

**替代方案**：
- 保留各自 adapter shell → 測試難度高、jq 解析邏輯分散
- 用 REST API 直接呼叫各 CLI 的 LLM 後端 → 失去 CLI 層面的安全沙箱、permission 控制

### ADR-2：Codex 暫跳過，Phase 2 再加
**決策**：Phase 1 只實作 claude / gemini / opencode 三個 CLI，Codex 延後到 Phase 2。

**原因**：
- `codex-acp` 是社區維護（cola-io/codex-acp），成熟度不如官方 CLI
- OpenAI 官方 Codex CLI 還沒有原生 ACP 支援
- 現有 bash adapter (codex.sh) 用 TOML 讀取 ddd-reviewer persona，實作複雜

**替代方案**：
- 現在就支援 → 引入不穩定的社區依賴，增加測試成本
- 改用 OpenAI REST API 直接呼叫 → 失去 permission 沙箱

### ADR-3：ddd-reviewer persona 用 Prepend 方案
**決策**：讀 `~/.claude/agents/ddd-reviewer.md`，prepend 到每個 reviewer 的 prompt，而不是用 ACP 的 systemPrompt 欄位。

**原因**：
- ACP `ClientSideConnection.newSession()` 的標準參數中沒有 `systemPrompt` 欄位
- Prepend 對所有 CLI 通用，不需要各自的 agent 機制（claude 有 `--agent`；gemini/opencode 沒有）
- Persona 的 YAML frontmatter 移除後直接當 system prompt 用，實作簡單

**替代方案**：
- 各 CLI 各自的 agent 機制 → 複雜，需要判斷每個 CLI 的 agent 載入方式
- 不注入 persona → reviewer 失去「skeptical code reviewer」的角色定位

### ADR-4：一次性輸出 JSON，不用 streaming event
**決策**：Orchestrator 結束後一次性輸出 JSON，而不是發送 START/RETURN/FAIL 的 streaming event。

**原因**：
- Main agent 不再需要逐行解析事件流，只需要 Read 一份 JSON
- 結束後的 JSON 包含完整的 runId、status、content、error，足以進行後續驗證
- Monitor 的作用只是繞過 bash 10 分鐘 cap，不需要即時事件通知（Skill 能等最終結果）

**替代方案**：
- 保留 streaming event（START/RETURN/FAIL/ALL_DONE） → main agent 的事件解析邏輯不變，簡化度不高
- 同時輸出 event stream 和 JSON → 複雜度翻倍

### ADR-5：TypeScript orchestrator 與 bash 版本併行
**決策**：新的 TypeScript orchestrator 在 `orchestrator/` 目錄，現有 bash `scripts/` 保留不刪，直到 TypeScript 版本穩定後才退役。

**原因**：
- 降低風險：bash 版本可作為 fallback，Skill 可同時測試兩個版本
- 漸進式遷移：Skill 文件先指向 TypeScript，bash 降為 legacy 說明
- 完整歷史記錄：code review 時能對比兩個版本的實作差異

**替代方案**：
- 直接刪除 bash 版本 → 如果 TypeScript 有問題，無法快速回滾

---

## 實作計畫

### M1：TypeScript 基礎（config + types）
- `src/config.ts`：讀 xreview.json、resolve aliases、dedup、validate spec 格式
- `src/reviewers/types.ts`：ReviewerSpec, ReviewResult, ReviewStatus enum
- Tests：config.test.ts（alias resolve, dedup, missing config, invalid spec）

### M2：ACP runner + claude reviewer
- `src/reviewers/acp-runner.ts`：spawn + ACP 連線邏輯 + timeout race + requestPermission auto-approve
- `src/reviewers/claude.ts`：spawn("claude-agent-acp") + ddd-reviewer persona prepend
- Tests：acp-runner.test.ts（mock spawn + ACP stream），claude.test.ts

### M3：gemini + opencode reviewers
- `src/reviewers/gemini.ts`：spawn("gemini", ["--acp"])
- `src/reviewers/opencode.ts`：spawn("opencode", ["acp"])
- Tests：gemini.test.ts, opencode.test.ts

### M4：orchestrator + cli
- `src/orchestrator.ts`：Promise.allSettled fan-out + per-reviewer timeout + JSON 輸出
- `src/cli.ts`：入口，argv 解析，config + orchestrator 呼叫，stdout JSON
- Tests：orchestrator.test.ts（happy path, one-fail, all-fail, timeout, dedup）

### M5：Skill + 文件更新
- `SKILL.md`：改寫（6 步驟，簡化事件流邏輯）
- `references/orchestrator-internals.md`：新建
- `references/cli-adapters.md`：更新（ACP 欄位，bash 移到 legacy）
