# Tasks: claude-r

## ~~v1: 宣告式 CLI + Daemon~~（已廢棄）

> v1 採用 state file + daemon + systemd 架構，開發完成後發現 daemon 有 process leak 問題。
> 決定以 v2 取代，見 ADR-1。

---

## v2: 互動式 tmux session picker

> 移除 daemon/state file/systemd，改為純互動式選單。
> tmux 為唯一真相來源，無額外狀態管理。

### Milestone 1: 核心模組重寫

> 精簡 tmux.ts，移除 state/fuzzy-match/resolve-name/types 等 v1 模組。
> 驗證方式：`vitest run`

- [x] Task 1.1: tmux module 重寫——listSessions 回傳 name + dir、createSession 產生 UUID session ID、attachSession、killSession、generateSessionName
- [x] Task 1.2: tmux module 測試——39 tests

### Milestone 2: 互動式選單

> 用 raw stdin 實作選單，支援數字鍵 + 方向鍵。
> 驗證方式：`vitest run`

- [x] Task 2.1: 選單渲染（renderMenu）——純函式，顯示 session 列表 + 新建選項
- [x] Task 2.2: 按鍵處理（handleInput）——數字鍵選取、方向鍵移動、Enter 確認、q 離開
- [x] Task 2.3: CLI 進入點——無 session 自動建立、有 session 顯示選單、非 TTY 報錯
- [x] Task 2.4: main.test.ts——39 tests（parseKey、shortenDir、renderMenu、handleInput）

### Milestone 3: Terminate / Restart 功能

> 選單內直接操作 session，不需離開選單。
> 驗證方式：`vitest run`

- [x] Task 3.1: terminate 動作（x 鍵）——killSession 後更新選單
- [x] Task 3.2: restart 動作（r 鍵）——讀取 CLAUDE_SESSION_ID、killSession、createSessionWithResume（或 createSession）
- [x] Task 3.3: session ID 追蹤——createSession 產生 UUID、存入 tmux environment、getClaudeSessionId 讀取

### Milestone 4: v1 殘留清理

> 移除 v1 遺留但 v2 不再使用的程式碼。

- [x] Task 4.1: 刪除 commands/ 目錄（v2 main.ts 不再 route 到 subcommands）
- [x] Task 4.2: 同步 spec.md——補齊 x/r 按鍵、session ID 機制、tmux 操作表
- [x] Task 4.3: 同步 tasks.md + works.md
