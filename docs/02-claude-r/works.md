# Works: claude-r

## 2026-03-22

### v1: 宣告式 CLI + Daemon

- Milestone 1–4 完成：state module、fuzzy-match、tmux module、CLI commands（add/rm/ls/resume/restart/rename）、daemon reconciliation、systemd install/uninstall、interactive mode
- 最終 155 tests 全過
- 使用 @clack/prompts 做互動 UI

## 2026-03-28

### v2 重寫：互動式 tmux session picker

**動機**：v1 的 daemon 有嚴重 process leak（systemd Restart=always 累積 88 個 orphan process）。tmux 本身就保活，daemon + state file 是多餘的複雜度。

**變更**：
- 刪除 state file、daemon、systemd、fuzzy-match、resolve-name、types 等模組
- main.ts 重寫為 raw stdin 互動選單（支援數字鍵 + 方向鍵，iPad 友善）
- tmux.ts 精簡為純 tmux 操作封裝
- 新增 session ID 追蹤：createSession 產生 UUID 存入 tmux environment，restart 時用 --resume 恢復對話
- 新增 terminate（x 鍵）和 restart（r 鍵）操作
- 從 155 tests 精簡為 78 tests（移除所有 v1 command 測試）

**決策紀錄**：
- 不用 @clack/prompts，因為不支援數字鍵直接選取
- tmux 為唯一 SSOT，不維護第二份狀態
- 保留 `cr-` prefix 慣例

## 2026-04-01

### v1 殘留清理 + Dropbox 同步修復

**背景**：Dropbox 同步在兩台電腦之間失效數天。檢查後發現兩邊檔案已由 Dropbox 同步為一致，真正的差異是 git uncommitted changes。

**變更**：
- 刪除 `commands/` 目錄——v2 的 main.ts 不使用這些 v1 subcommands，裡面的 import 指向已刪除的模組（resolve-name.ts、state.ts 等），導致 4 個 test suite 失敗
- 更新 spec.md：補齊 x/r 按鍵說明、session ID 機制、完整 tmux 操作表
- 更新 tasks.md：改為反映 v2 實際完成的 milestones
- 確認 AGENTS_bak 與 AGENTS 內容一致，可安全刪除

## 2026-06-08

### ccr 啟動延遲與方向鍵重繪跳動修復

**問題描述**：
- Windows Terminal 執行 `ccr` 時，選單出現前前置時間很長，體感像 `npx` 正在安裝套件。
- 在互動選單用上下鍵移動游標時，畫面會跳動。

**根因分析**：
- 啟動延遲主因是選單啟動時呼叫 `listAndSync()`，除了 `tmux list-sessions` 之外，還對每個 session 逐一執行 `syncSessionId()`，造成每個 session 額外觸發 `tmux display-message`、`pgrep`、session file 讀取與 `tmux set-environment` 嘗試；session 越多，進選單前阻塞越久。
- 畫面跳動主因是 `draw()` 用 `content.split('\n').length` 當作下次 redraw 要往上移動的行數；但游標實際往下移動的 row 數等於 newline 數量，原本會多算一行，導致 `\x1b[<n>A` 偶爾移到選單上方並觸發終端捲動。

**修復內容**：
- 新增 `listMenuSessions()`，選單啟動與一般刷新只呼叫 `listSessions()`；`syncSessionId()` 保留在 `restart` 動作當下才執行，避免啟動路徑做昂貴同步。
- 新增 `getCursorRowOffset()`，`draw()` 改用 newline 數量計算游標 row offset，並在清除前補 `\r` 回到行首。
- 新增 regression tests 覆蓋「啟動不做 session ID sync」與「重繪行數用 newline 數量」。

**驗證結果**：
- `pnpm test`：96 tests passed。
- `pnpm exec tsc --noEmit`：未執行成功，子 package 目前沒有可用的本地 `tsc` bin（未安裝新套件以避免改動環境）。

### ccr startup verbose tracing

**問題描述**：
- 啟動延遲修正後，Windows Terminal 仍可觀察到前置等待；需要能拆分 script 內部步驟耗時，並判斷延遲是否發生在 `tsx`／wrapper 載入 script 之前。

**修復內容**：
- 新增 `--verbose` 與 `-v` CLI option。
- 新增 startup tracer，將 `script entered`、`read cwd`、`list tmux sessions`、`render initial menu`、`draw initial menu`、`enable raw stdin`、`ready for input` 的耗時印到 `stderr`。
- 新增 `parseCliOptions()` 與 `createStartupTracer()` 測試。

**驗證結果**：
- `pnpm test`：101 tests passed。
- `pnpm exec tsx main.ts --verbose`：可印出 startup timing；非 TTY 下維持既有 `stdin is not a TTY` 行為。
- `pnpm exec tsc --noEmit`：未通過，原因是子 package 既有 TypeScript 設定缺少 Node types 與 `allowImportingTsExtensions`，非本次 verbose 變更引入。
