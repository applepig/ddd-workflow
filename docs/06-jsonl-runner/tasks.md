# Tasks: JSONL Progress Runner

## Milestone 1: Foundation — Types + State + Copilot Adapter

> 目標：所有可獨立測試的基礎模組就緒。
> 完成後可展示：state file 的 atomic write/read 正常運作、Copilot JSONL 事件能正確 parse。

- [ ] Task 1.1: 定義所有 TypeScript 型別（`CliAdapter`、`ProgressEvent`、`RunOptions`、`Usage`、`StateSchema`）

### 🔀 可平行工作線

**[A] State Module** — `isolation: worktree`
> 範圍：`scripts/jsonl-runner/state.ts`、`scripts/jsonl-runner/__tests__/state.test.ts`
> 依賴：Task 1.1 完成的型別定義
> 介面契約：`writeState(jobId, state)` 使用 atomic write + rename；`readState(jobId)` 回傳 `StateSchema | null`；毀損時 throw `CorruptedStateError`
> 驗證方式：`npx vitest run scripts/jsonl-runner/__tests__/state.test.ts` 全過
- [ ] Task 1.2: 撰寫 state module 測試——atomic write/read、毀損 JSON 處理、schema version 驗證、目錄權限 0700 (Red)
- [ ] Task 1.3: 實作 state module (Green)

**[B] Copilot Adapter** — `isolation: worktree`
> 範圍：`scripts/jsonl-runner/adapters/copilot.ts`、`scripts/jsonl-runner/__tests__/copilot.test.ts`、`scripts/jsonl-runner/__tests__/fixtures/copilot/`
> 依賴：Task 1.1 完成的型別定義
> 介面契約：`parseEvent(line)` → `ProgressEvent | null`；`buildCommand(options)` → `{ command, args }`；`extractResult(events)` 從 `assistant.message` 事件組裝文字；`extractUsage(events)` 從 `result` 事件提取 usage
> 驗證方式：`npx vitest run scripts/jsonl-runner/__tests__/copilot.test.ts` 全過
- [ ] Task 1.4: 準備 Copilot JSONL fixtures（從 research.md 的實測事件格式）+ 撰寫 adapter 測試——parseEvent 各事件類型、buildCommand 含 `--read-only` flag、extractResult 從 message 事件累積、extractUsage (Red)
- [ ] Task 1.5: 實作 Copilot adapter (Green)

### 🔗 匯合點
> 合併 [A]、[B] 分支後，驗證型別定義一致。
> 驗證方式：`npx vitest run scripts/jsonl-runner/__tests__/` 全過（state + copilot）
- [ ] Task 1.6: 合併分支，確認無型別衝突

## Milestone 2: Runner Core + start 命令

> 目標：能 spawn Copilot CLI job 並即時追蹤進度。
> 完成後可展示：`jsonl-runner start copilot "say hello" --model gpt-5-mini` 印出 job ID，state file 即時更新。
> 驗證方式：`npx vitest run scripts/jsonl-runner/__tests__/runner.test.ts scripts/jsonl-runner/__tests__/cli.test.ts` 全過

- [ ] Task 2.1: 撰寫 runner 測試——mock child process spawn、JSONL 逐行 parse、state 更新、timeout（SIGTERM → SIGKILL）、process crash 處理、progress array 截斷（>100 條）(Red)
- [ ] Task 2.2: 實作 runner core——spawn process、pipe stdout 逐行讀取、呼叫 adapter.parseEvent、更新 state、內部維護完整事件列表、timeout/signal 處理 (Green)
- [ ] Task 2.3: 撰寫 CLI `start` 子命令測試——引數解析、stdin pipe 輸入、`--model`/`--timeout`/`--cwd`/`--agent`/`--read-only` flag、exit code 反映 job 建立成功/失敗 (Red)
- [ ] Task 2.4: 實作 CLI entry point + `start` 子命令 (Green)
- [ ] Task 2.5: 手動 E2E 驗證——用真實 Copilot CLI 跑 `start`，確認 state file 即時更新、最終 result 正確

## Milestone 3: Query 命令——status、result、cancel、list

> 目標：完整的 job lifecycle 管理。
> 完成後可展示：所有子命令正常運作，exit code 符合行為表格定義。
> 驗證方式：`npx vitest run scripts/jsonl-runner/__tests__/commands.test.ts` 全過

- [ ] Task 3.1: 撰寫 query 命令測試——status（正常/job 不存在/state 毀損）、result（正常/未完成/不存在）、cancel（正常/已結束 → no-op）、list（有 job/空）、list --cleanup（跳過 running）(Red)
- [ ] Task 3.2: 實作 `status` + `result` 命令——讀取 state file、格式化輸出（human-readable + `--json`）、exit code 依行為表格 (Green)
- [ ] Task 3.3: 實作 `cancel` 命令——讀取 PID、發 SIGTERM、更新 state、已結束 job 視為 no-op exit 0 (Green)
- [ ] Task 3.4: 實作 `list` + `list --cleanup` 命令——掃描 state 目錄、格式化表格、cleanup 只清已結束 job (Green)

## Milestone 4: OpenCode Adapter

> 目標：第二個 CLI 支援就緒。
> 完成後可展示：`jsonl-runner start opencode "say hello" --model copilot.gpt-5-mini` 正常運作。
> 驗證方式：`npx vitest run scripts/jsonl-runner/__tests__/opencode.test.ts` 全過

- [ ] Task 4.1: 準備 OpenCode JSONL fixtures（`tool_use`、`text`、`reasoning`、`step_start`、`step_finish`、`error`）+ 撰寫 adapter 測試——parseEvent、buildCommand 含 `--read-only`（agent 定義 permission deny）、extractResult 從 `text` 事件累積、extractUsage (Red)
- [ ] Task 4.2: 實作 OpenCode adapter (Green)
- [ ] Task 4.3: 手動 E2E 驗證——用真實 OpenCode 跑 `start`，確認 state file 正確、result 正確
