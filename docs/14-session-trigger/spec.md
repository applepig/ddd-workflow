# Session Trigger

## 目標

用單一 Node.js script 取代目前散落的 6 條 crontab entry，定時觸發 Claude Code 和 Codex CLI 的 rolling session window，並驗證 window 是否成功啟動。

### 非目標

- 不做 Gemini CLI（24 小時 window，不需要頻繁 trigger）
- 不做 web dashboard 或 Telegram 通知
- 不做 quota 監控或用量追蹤

## User Story

> 身為使用者，我希望在工作日自動觸發 AI agent CLI 的 rolling session，讓我坐下來工作時 window 已經在跑，減少等待時間。觸發失敗時能自動重試，不需要我手動介入。

## 驗收條件

### AC-1：定時觸發

- [ ] 在設定的 tick 時間（預設工作日 07:00、12:00、17:00）執行觸發
- [ ] 每個 CLI 獨立觸發，一個失敗不影響其他
- [ ] 所有可調參數（命令列、tick 時間、tolerance）抽為檔案最前面的 const

### AC-2：Session 驗證

- [ ] Claude Code：解析 `--output-format json` 的 `rate_limit_event`，確認 `status === "allowed"` 且 `resetsAt` 有值
- [ ] Codex CLI：解析 `--json` 的 `thread.started` 取得 thread_id，再從 `~/.codex/sessions/` 的 session file 讀取 `rate_limits.primary.resets_at`
- [ ] 驗證失敗視為觸發失敗，進入 retry 邏輯

### AC-3：Retry 邏輯

- [ ] 觸發失敗時，檢查該 CLI 的 window 到期時間（`resetsAt`）
- [ ] 若 `resetsAt` 在當前 trigger time 起算 `TOLERANCE`（預設 45 分鐘）內到期：等到到期後重送
- [ ] 若 `resetsAt` 超過 `TOLERANCE`：放棄，等下一次 tick
- [ ] 若無法取得 `resetsAt`（如網路錯誤）：等待固定間隔後重試一次

### AC-4：執行方式

- [ ] 以 crontab 觸發（一條 entry 取代現有六條），或以 systemd timer 觸發
- [ ] 每次執行為 one-shot，不是 daemon
- [ ] 輸出結構化 log 到 stdout（含時間戳、CLI 名稱、結果、resetsAt）

### AC-5：設定集中

- [ ] 檔案最前面定義所有 const：
  - `AGENTS`：命令列陣列（如 `["claude -p hi --output-format json", "codex exec hi --json"]`）
  - `TICK_SCHEDULE`：cron expression 或時間陣列
  - `TOLERANCE_MS`：retry 判斷的到期容忍值（預設 45 分鐘 = 2700000ms）
  - `RETRY_DELAY_MS`：無法取得 resetsAt 時的固定重試延遲

## 邊界案例

| 情境 | 處理方式 |
|------|---------|
| CLI 不存在（未安裝） | 跳過該 agent，log 警告 |
| CLI 已 rate limited | 解析 resetsAt，依 retry 規則處理 |
| CLI hang 超時 | 設定 timeout（預設 60s），kill 後視為失敗 |
| 多個 agent 同時失敗 | 各自獨立 retry，互不影響 |
| resetsAt 已經過期（window 已結束） | 立即重試 |

## ADR

### ADR-1：One-shot script vs daemon

**決策**：one-shot script，由 crontab/systemd timer 觸發。

**原因**：需求是固定時段觸發，不需要 event-driven。one-shot 不用處理 process management、crash recovery。crontab 本身就是可靠的 scheduler。

### ADR-2：Node.js vs Bash

**決策**：Node.js。

**原因**：
- 專案已有 `scripts/cli.js` 用 Node.js
- JSON parsing 原生支援（Claude 的 json output 是 array、Codex 的 session file 是 JSONL）
- retry 的計時邏輯用 `setTimeout` 比 bash 的 `sleep` + arithmetic 清楚
- 無外部依賴（不需要 `jq`）

### ADR-3：驗證策略

**決策**：Claude 從 stdout JSON 驗證；Codex 從 session file 驗證。

**原因**：
- Claude 的 `--output-format json` 直接在 stdout 帶 `rate_limit_event`，一次呼叫就能觸發 + 驗證
- Codex 的 `--json` stdout 不帶 rate limit data，必須從 session file 補讀
- 不用 OAuth API / app-server JSON-RPC，避免額外的 auth 處理和 rate limit 問題

## Milestones

### M1：核心觸發 + 驗證

實作 `ddd-workflow/scripts/session-trigger.mjs`：
- 定義 const 區塊（AGENTS、TOLERANCE_MS、RETRY_DELAY_MS、EXEC_TIMEOUT_MS）
- 實作 Claude trigger + `rate_limit_event` 驗證
- 實作 Codex trigger + session file 驗證
- 實作 retry 邏輯（tolerance 內等到期重送 / 超過 tolerance 放棄）
- 結構化 log 輸出

### M2：部署整合

- 產出 crontab entry 範例（或 systemd timer unit）
- 更新 `scripts/cli.js` 的 deploy 流程（若需要 symlink）
- 移除舊的 6 條 crontab entry 的說明
