# JSONL Progress Runner

## 目標

建立一個 TypeScript CLI script（`jsonl-runner`），能 spawn 外部 AI coding CLI、即時 parse 其 JSONL streaming output、將進度寫入 state file，讓 Claude Code main agent 可以 polling 追蹤。

作為 **general purpose agent runner**——不限於 reviewer，任何 prompt 都能送。Use case 涵蓋短時間 review（1-3 分鐘）到長時間 developer session（30-40 分鐘）。

## 非目標

- 不做 MCP server（留給未來，core 可復用）
- 不取代 `xreview-runner.sh`（共存，xreview skill 可漸進遷移）
- 不做 UI dashboard
- 不做 agent-to-agent 雙向通訊（單向：prompt in → progress + result out）

## User Story

作為 Claude Code main agent（coordinator），我想要送一個 prompt 給外部 CLI agent 並即時追蹤進度，以便在背景任務執行期間向使用者回報狀態、在 agent 完成後取得結果。

### 驗收條件

- [ ] `jsonl-runner start copilot "Review this code" --model gpt-5-mini` 啟動 Copilot CLI 並回傳 job ID
- [ ] 執行期間，`jsonl-runner status <job-id>` 回傳目前 phase、最近的進度訊息、經過時間
- [ ] 執行完成後，`jsonl-runner result <job-id>` 回傳完整的 agent 回覆文字
- [ ] `jsonl-runner cancel <job-id>` 可以中斷正在執行的 job
- [ ] `jsonl-runner list` 顯示所有 job 及其狀態
- [ ] Copilot CLI adapter 能正確 parse `assistant.turn_start`、`assistant.message`、`assistant.turn_end`、`result` 事件
- [ ] State file 在每個重要事件時即時更新（不是等到結束才寫）
- [ ] 支援 `--timeout` flag 在指定秒數後自動中斷
- [ ] 支援 stdin pipe 傳入 prompt（`cat prompt.md | jsonl-runner start copilot --model gpt-5-mini`）
- [ ] `start` 的 exit code 反映 job 建立成功/失敗（0 = job 已建立，非零 = 建立失敗）；agent 最終的 exit status 記錄在 state file 的 `exitCode` 欄位
- [ ] OpenCode adapter 能正確 parse `tool_use`、`text`、`step_start`、`step_finish` 事件
- [ ] 使用 gpt-5-mini（0x）測試時，`result` 回傳的 usage 正確擷取計費欄位（測試環境預期 `premiumRequests: 0`，但此數值依賴上游計費策略，驗收重點在欄位有被正確擷取）

## 相關檔案

- `ddd-workflow/skills/ddd.xreview/scripts/xreview-runner.sh` — 現有的 CLI wrapper（要共存）
- `ddd-workflow/skills/ddd.xreview/references/cli-adapters.md` — 各 CLI 的呼叫文件
- `reference/codex-plugin-cc/plugins/codex/scripts/lib/` — 參考架構（job tracking、state file）

## 資料結構

### Job State File

位置：`/tmp/jsonl-runner/<job-id>/state.json`

**寫入策略**：所有 state 寫入使用 atomic write——先寫到 `state.json.tmp` 再 `rename` 到 `state.json`，確保 polling 端不會讀到不完整的 JSON。State 目錄使用 `0700` 權限，state file 使用 `0600` 權限。

**毀損處理**：`status`/`result` 讀取 state file 時，若 JSON parse 失敗，回傳明確的錯誤訊息（`"error: corrupted state file"`）並以 exit code 2 退出。不嘗試自動修復。

**Schema version**：state file 頂層包含 `"version": 1` 欄位，供未來格式變更時做相容性判斷。

```json
{
  "version": 1,
  "id": "jr-1712345678-abc",
  "cli": "copilot",
  "model": "gpt-5-mini",
  "status": "running",
  "phase": "investigating",
  "pid": 12345,
  "startedAt": "2026-04-03T12:00:00.000Z",
  "completedAt": null,
  "exitCode": null,
  "progress": [
    { "ts": "2026-04-03T12:00:01.000Z", "phase": "starting", "message": "Session initialized" },
    { "ts": "2026-04-03T12:00:03.000Z", "phase": "investigating", "message": "Reading file: src/index.ts" },
    { "ts": "2026-04-03T12:00:05.000Z", "phase": "investigating", "message": "Running command: git diff --shortstat" }
  ],
  "lastMessage": "Running command: git diff --shortstat",
  "usage": null
}
```

### 完成後的 State

```json
{
  "version": 1,
  "id": "jr-1712345678-abc",
  "cli": "copilot",
  "model": "gpt-5-mini",
  "status": "completed",
  "phase": "done",
  "pid": null,
  "startedAt": "2026-04-03T12:00:00.000Z",
  "completedAt": "2026-04-03T12:01:30.000Z",
  "exitCode": 0,
  "progress": [ "..." ],
  "lastMessage": "Review complete",
  "result": "## Review findings\n\n1. ...",
  "usage": {
    "premiumRequests": 0,
    "totalApiDurationMs": 23811,
    "sessionDurationMs": 32008
  }
}
```

## CLI 介面

```bash
# 啟動 job（prompt 作為引數）
jsonl-runner start <cli> "prompt text" [options]

# 啟動 job（prompt 從 stdin）
cat prompt.md | jsonl-runner start <cli> [options]

# 查看 job 狀態
jsonl-runner status <job-id>          # 單一 job
jsonl-runner status <job-id> --json   # JSON 格式
jsonl-runner list                     # 所有 jobs
jsonl-runner list --json

# 取得結果
jsonl-runner result <job-id>          # 純文字（agent 回覆）
jsonl-runner result <job-id> --json   # 完整 JSON state

# 中斷
jsonl-runner cancel <job-id>

# 選項
--model <model>       # 指定模型（預設：依 CLI 而定）
--timeout <seconds>   # 超時自動中斷（預設：600）
--cwd <directory>     # 工作目錄（預設：當前目錄）
--agent <agent>       # 指定 custom agent（如有）
--read-only           # 啟用 read-only 模式（deny write/shell）
--json                # 輸出格式為 JSON
```

### 子命令行為定義

| 子命令 | 成功輸出 | 失敗情境 | Exit Code | 說明 |
|--------|---------|---------|-----------|------|
| `start` | 印出 job ID | CLI 不存在、prompt 為空 | 0=建立成功，1=建立失敗 | 啟動後立即回傳，不等 agent 完成 |
| `status` | 印出 phase + 進度 + 經過時間 | job ID 不存在、state 毀損 | 0=成功讀取，1=job 不存在，2=state 毀損 | |
| `result` | 印出 agent 回覆文字 | job 尚未完成、job 不存在、state 毀損 | 0=成功，1=job 不存在/未完成，2=state 毀損 | job 未完成時提示目前狀態 |
| `cancel` | 印出確認訊息 | job 不存在、job 已結束 | 0=已送出 signal，1=job 不存在/已結束 | cancel 已完成/timeout 的 job 視為 no-op，exit 0 |
| `list` | 印出 job 表格 | — | 0 | 無 job 時印空表格 |
| `list --cleanup` | 印出清理數量 | — | 0 | 只清理已結束的 job，跳過 running job |

### `--read-only` 跨 Adapter 支援

| Adapter | 支援方式 | Enforcement 強度 | 備註 |
|---------|---------|-----------------|------|
| Copilot | `--deny-tool='write' --deny-tool='shell'` | 強——deny 優先於所有 allow | 可靠，`--deny-tool` 無法被 `--allow-all-tools` 覆蓋 |
| OpenCode | `permissions.write: deny` + `permissions.bash: deny`（agent 定義） | 強——agent 層級的 permission deny | 需要預安裝 read-only agent 定義檔 |

不支援 `--read-only` 的 adapter（未來新增時）應 **fail fast**——在 `buildCommand` 階段拋錯，不啟動 process。

## 架構

```
jsonl-runner/
├── cli.ts                 # CLI entry point（parse args → dispatch subcommand）
├── runner.ts              # 核心：spawn process → pipe JSONL → update state（內部維護完整事件列表，獨立於 state 中截斷的 progress array）
├── state.ts               # State file 讀寫
├── adapters/
│   ├── types.ts           # Adapter interface 定義
│   ├── copilot.ts         # Copilot CLI adapter（parse events → progress）
│   └── opencode.ts        # OpenCode adapter
└── __tests__/
    ├── runner.test.ts      # Runner 整合測試（mock process）
    ├── copilot.test.ts     # Copilot adapter 單元測試（parse JSONL fixtures）
    └── opencode.test.ts    # OpenCode adapter 單元測試
```

### Adapter Interface

```typescript
interface CliAdapter {
  /** CLI 名稱 */
  name: string

  /** 建構 spawn 的 command + args */
  buildCommand(options: RunOptions): { command: string; args: string[] }

  /** Parse 一行 JSONL，回傳統一的 ProgressEvent 或 null（忽略） */
  parseEvent(line: string): ProgressEvent | null

  /**
   * 從累積的事件中組裝最終回覆文字。
   * 注意：最終文字的來源因 CLI 而異——Copilot 主要在 `assistant.message`，
   * OpenCode 主要在 `text` 事件。`result` 事件通常是 lifecycle/統計事件，
   * 不一定包含完整文字。Adapter 負責知道從哪些事件類型提取。
   * 此方法接收的是獨立於 progress array 的完整事件列表，不受 progress 截斷影響。
   */
  extractResult(events: ProgressEvent[]): string | null

  /**
   * 從 terminal event 提取 usage 資訊。
   * 各 CLI 的 usage 來源不同（Copilot 在 `result` 事件，OpenCode 在 `step_finish`）。
   */
  extractUsage(events: ProgressEvent[]): Usage | null
}

interface ProgressEvent {
  type: "start" | "progress" | "message" | "tool_call" | "tool_result" | "result" | "error"
  phase: string | null
  message: string
  timestamp: string
  raw: unknown
}
```

## Premium Request 計費參考

### Multiplier 費率（付費 Copilot 方案）

| 模型 | Multiplier | 備註 |
|------|-----------|------|
| GPT-5 mini | **0x（免費）** | 測試首選 |
| GPT-4.1 | **0x（免費）** | 測試備選 |
| GPT-5.4 mini | 0.33x | |
| Claude Haiku 4.5 | 0.33x | |
| GPT-5.1 / 5.2 / 5.3-Codex / 5.4 | 1x | |
| Claude Sonnet 4 / 4.5 / 4.6 | 1x | |
| Claude Opus 4.5 / 4.6 | 3x | |

### Compaction 計費問題（已知 bug）

長時間 session（如 40 分鐘的 ddd.developer）會觸發 auto-compaction，目前有已知的計費 bug：

| CLI | Compaction 觸發時機 | 計費影響 | Issue |
|-----|-------------------|---------|-------|
| Copilot CLI | context ~95% limit | Bug：消耗 1 premium request | [copilot-cli#2068](https://github.com/github/copilot-cli/issues/2068) |
| OpenCode | context ~75-80% limit | 已修正（標為 agent-initiated） | [opencode#11753](https://github.com/anomalyco/opencode/issues/11753) |

短 session（review 級別）幾乎不會觸發。長 session 則需留意。

OpenCode 可透過 `OPENCODE_DISABLE_AUTOCOMPACT=1` 環境變數停用。Copilot CLI 目前無法停用，等官方修復。

## 邊界案例

1. **CLI 不存在**：`command -v copilot` 失敗 → 立即報錯，exit code 1
2. **JSONL parse 失敗**：某一行不是合法 JSON → 記錄到 log，不中斷（CLI 可能混入 non-JSON stderr）
3. **Timeout**：超時 → 發 SIGTERM，等 5 秒，若仍在就 SIGKILL，state 標為 `"status": "timeout"`
4. **Process crash**：非零 exit code 且沒有 `result` event → state 標為 `"status": "failed"`，保留已收集的 progress
5. **Stdin + 引數同時有 prompt**：引數優先，忽略 stdin
6. **State 目錄清理**：完成的 job state 保留 24 小時，`jsonl-runner list --cleanup` 可手動清理
7. **並行 job**：每個 job 獨立的 state file，不會互相干擾
8. **Empty response**：agent 回覆空字串 → `result` 回傳空字串，不報錯
9. **長時間 session**（30-40 分鐘）：progress array 可能膨脹 → 只保留最近 100 條 progress entries，舊的寫入 log file

## ADR

### ADR-1：TypeScript + tsx 而非純 Shell

- **決策**：用 TypeScript + tsx 取代 shell script
- **原因**：JSONL parsing 在 bash 中極其痛苦（`jq` streaming 可以做但脆弱）；TypeScript 有 type safety、容易測試、跟本專案的 Node.js 技術棧一致
- **替代方案**：純 bash + jq（排除：維護成本高、測試困難）；Python（排除：本專案不用 Python）

### ADR-2：State File Polling 而非 MCP Progress

- **決策**：用 `/tmp/jsonl-runner/<job-id>/state.json` 檔案做進度追蹤
- **原因**：Claude Code 不支援 MCP `notifications/progress`（[#4157](https://github.com/anthropics/claude-code/issues/4157)，NOT_PLANNED）；state file 是最簡單的 IPC 機制，main agent 用 `Bash("cat state.json")` 就能讀取
- **替代方案**：MCP Tasks primitive（排除：Claude Code 尚未支援）；stdout streaming（排除：main agent 用 `run_in_background` 時無法即時讀取 stdout）

### ADR-3：先 Copilot + OpenCode，漸進擴充

- **決策**：初始只實作 Copilot CLI 和 OpenCode 兩個 adapter
- **原因**：Copilot 已安裝且 gpt-5-mini 0x 免費測試；OpenCode 透過 Copilot provider 也 0x；Gemini / Codex 已有 xreview-runner.sh 支援，不急
- **替代方案**：一次做四個（排除：scope 太大，且 Gemini/Codex 的 JSONL 格式尚未實測）

### ADR-4：General Purpose Runner 而非 Review-Only

- **決策**：runner 接受任意 prompt，不限於 review 場景
- **原因**：xreview 只是最初的 use case；未來需要 delegate 各種任務（重構、測試撰寫、文件生成、ddd.developer 級別的長時間實作）給外部 agent
- **替代方案**：review 專用 runner（排除：限制了未來擴充性，且 general purpose 並不增加多少複雜度）

### ADR-5：`--read-only` 用 deny-tool 模擬

- **決策**：Copilot CLI 沒有原生 sandbox，用 `--deny-tool='write' --deny-tool='shell'` 模擬
- **原因**：`--deny-tool` 優先於所有 allow（包括 `--allow-all-tools`），是可靠的 enforcement
- **替代方案**：agent 定義中限制 tools（排除：需要預先安裝 agent 檔案，增加 deploy 複雜度）；兩者可並用，defense in depth
