# Tasks: claude-r

## Milestone 1: 專案骨架 + 核心模組

> 建立專案結構與三個核心模組：state（狀態檔管理）、tmux（tmux 操作封裝）、fuzzy-match（模糊比對）。
> 完成後可在程式碼中 import 使用，所有後續命令都依賴這三個模組。
> 驗證方式：`pnpm --filter claude-r test` 全過

- [x] Task 1.1: 專案初始化——package.json、tsconfig、vitest config、types.ts

### 🔀 可平行工作線

**[A] State + Fuzzy Match** — `isolation: worktree`
> 範圍：`scripts/claude-r/state.ts`、`scripts/claude-r/fuzzy-match.ts`、對應測試
> 依賴：Task 1.1 完成的 types.ts
> 介面契約：
> - `loadState(): Promise<State>` — 讀取 sessions.json，不存在則回傳 `{}`
> - `saveState(state: State): Promise<void>` — 寫入 sessions.json
> - `fuzzyMatch(input: string, candidates: string[]): FuzzyResult` — 回傳 `{ type: 'exact' | 'unique' | 'ambiguous' | 'none', matches: string[] }`
> 驗證方式：`pnpm --filter claude-r test state fuzzy`

- [x] Task 1.2: State module + fuzzy-match 測試 (Red)
- [x] Task 1.3: State module + fuzzy-match 實作 (Green)

**[B] tmux Module** — `isolation: worktree`
> 範圍：`scripts/claude-r/tmux.ts`、對應測試
> 依賴：Task 1.1 完成的 types.ts
> 介面契約：
> - `createSession(name: string, dir: string, claudeName: string): void` — 建立 detached tmux session `cr-<name>`，執行 claude
> - `killSession(name: string): void` — 殺掉 tmux session `cr-<name>`
> - `listSessions(): TmuxSession[]` — 列出所有 `cr-` 開頭的 tmux session
> - `attachSession(name: string): void` — attach 到 tmux session（execSync, inherit stdio）
> - `sessionExists(name: string): boolean` — 檢查 session 是否存在
> 驗證方式：`pnpm --filter claude-r test tmux`

- [x] Task 1.4: tmux module 測試 (Red)
- [x] Task 1.5: tmux module 實作 (Green)

### 🔗 匯合點
> 合併 [A]、[B] 分支後確認所有模組測試通過。
> 驗證方式：`pnpm --filter claude-r test`

- [x] Task 1.6: 合併並驗證所有基礎模組

---

## Milestone 2: CLI 命令

> 建立 CLI 入口與所有命令。完成後 `claude-r` 可透過 command 模式操作。
> 驗證方式：`pnpm --filter claude-r test`

- [x] Task 2.1: CLI 入口 + command routing + help 骨架（main.ts）

### 🔀 可平行工作線

**[A] add + ls + help** — `isolation: worktree`
> 範圍：`scripts/claude-r/commands/add.ts`、`commands/ls.ts`、`commands/help.ts`、對應測試
> 依賴：Task 2.1 完成的 main.ts routing
> 介面契約：每個 command 匯出 `(args: string[]) => Promise<void>`
> 驗證方式：`pnpm --filter claude-r test add ls help`
> 手動驗證：
> - `claude-r add -d /tmp/test-proj` → state file 新增 entry + tmux session 建立
> - `claude-r ls` → 顯示 session 列表
> - `claude-r help` → 顯示使用說明

- [x] Task 2.2: add + ls + help 測試 (Red)
- [x] Task 2.3: add + ls + help 實作 (Green)

**[B] rm + resume + restart + rename** — `isolation: worktree`
> 範圍：`scripts/claude-r/commands/rm.ts`、`commands/resume.ts`、`commands/restart.ts`、`commands/rename.ts`、對應測試
> 依賴：Task 2.1 完成的 main.ts routing
> 介面契約：每個 command 匯出 `(args: string[]) => Promise<void>`，接受 positional name 參數 + flags
> 驗證方式：`pnpm --filter claude-r test rm resume restart rename`
> 手動驗證：
> - `claude-r rm test-proj` → state file 移除 + tmux session 殺掉
> - `claude-r restart test-proj` → 舊 session 殺掉、新 session 建立
> - `claude-r rename test-proj new-name` → state file key 更新、tmux session 重建
> - `claude-r resume test-proj` → attach 到 tmux session

- [x] Task 2.4: rm + resume + restart + rename 測試 (Red)
- [x] Task 2.5: rm + resume + restart + rename 實作 (Green)

### 🔗 匯合點
> 合併 [A]、[B] 分支後，所有 CLI 命令整合測試。
> 驗證方式：`pnpm --filter claude-r test`

- [x] Task 2.6: 合併並驗證所有 CLI 命令

---

## Milestone 3: Daemon + systemd

> 實作 daemon reconciliation loop 與 systemd service 安裝。
> 完成後 session 可在 crash / reboot 後自動恢復。
> 驗證方式：`pnpm --filter claude-r test`

### 🔀 可平行工作線

**[A] Daemon reconciliation** — `isolation: worktree`
> 範圍：`scripts/claude-r/commands/daemon.ts`、對應測試
> 依賴：M1 的 state + tmux module
> 介面契約：`runDaemon(): Promise<never>` — 無限 loop，每 5 秒調和一次
> 驗證方式：`pnpm --filter claude-r test daemon`
> 行為規格：
> - state 有、tmux 無 + `restart: always` → 重建
> - state 有、tmux 無 + `restart: no` → 不動
> - state 有、tmux 有 → 不動
> - log 每次調和結果到 stdout

- [x] Task 3.1: daemon reconciliation 測試 (Red)
- [x] Task 3.2: daemon reconciliation 實作 (Green)

**[B] install / uninstall** — `isolation: worktree`
> 範圍：`scripts/claude-r/commands/install.ts`、`commands/uninstall.ts`、對應測試
> 依賴：無（只是產生 service 檔案 + 呼叫 systemctl）
> 介面契約：
> - `install()` → 產生 `~/.config/systemd/user/claude-r.service`，enable + start
> - `uninstall()` → disable + stop，移除 service 檔案
> 驗證方式：`pnpm --filter claude-r test install uninstall`
> service 檔案內容：
> ```ini
> [Unit]
> Description=Claude Remote Session Manager
> [Service]
> Type=simple
> ExecStart=tsx {scripts/claude-r/main.ts 的絕對路徑} daemon
> Restart=always
> RestartSec=5
> [Install]
> WantedBy=default.target
> ```

- [x] Task 3.3: install + uninstall 測試 (Red)
- [x] Task 3.4: install + uninstall 實作 (Green)

### 🔗 匯合點
> 合併後整合測試 daemon + systemd 安裝。
> 驗證方式：`pnpm --filter claude-r test`

- [x] Task 3.5: 合併並驗證 daemon + systemd

---

## Milestone 4: Interactive Mode

> 實作互動式 UI，使用 `@clack/prompts`。
> 完成後 `claude-r`（無參數）進入游標選單。
> 驗證方式：`pnpm --filter claude-r test` + 手動驗證互動流程

- [x] Task 4.1: interactive mode 邏輯測試 (Red)——選項生成、action dispatch、non-TTY fallback
- [x] Task 4.2: interactive mode 實作 (Green)——@clack/prompts UI、session 列表、action submenu
- [x] Task 4.3: edge cases——無 session 提示 add、非 TTY fallback 到 ls
