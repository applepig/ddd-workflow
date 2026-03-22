# claude-r Spec

## 目標

提供一個宣告式 CLI 工具管理 tmux 背景中的 Claude Code remote session：

- **宣告式管理**：使用者管「期望狀態」（add/rm），daemon 負責「實際調和」（start/stop/restart）
- **Auto-restart**：session 掛掉自動重啟，reboot 後自動恢復
- **Command 模式**：類 Docker CLI 風格的 subcommand + flags
- **Interactive 模式**：游標選單式操作，無需記命令

## 非目標

- 不管 Claude Code 內部狀態（只管 tmux 層）
- 不做 session 間的通訊或排程
- 不做多 host 管理

---

## 架構概觀

```
使用者 CLI                          Daemon（systemd）
──────────                         ────────────────
claude-r add ──→ state file ←── claude-r daemon
claude-r rm  ──→ state file         │
claude-r ls  ──→ state + tmux       │  reconciliation loop:
claude-r resume ──→ tmux attach     │  state file vs tmux sessions
                                    │  缺的補、掛的重啟
                                    ▼
                                  tmux sessions
                                    │
                                  claude --dangerously-skip-permissions
```

### 檔案配置

```
AGENTS/scripts/claude-r/                      # 原始碼（本專案內）
  ├── main.ts                                 # CLI 入口
  ├── ...
~/.config/claude-r/sessions.json              # 期望狀態
~/.config/systemd/user/claude-r.service       # systemd user service
~/.bashrc                                     # alias claude-r="tsx ~/Dropbox/projects/AGENTS/scripts/claude-r/main.ts"
```

### 角色分工

| 角色 | 職責 |
|------|------|
| CLI | 管理期望狀態（state file）+ 即時操作（直接建/殺 tmux） |
| Daemon | 週期性調和——state file 裡有但 tmux 沒有的 session，按 restart policy 重建 |
| State file | SSOT——記錄所有受管理的 session 及其設定 |
| tmux | 提供 terminal 環境，讓 claude process 在背景執行 |

---

## User Stories

### US-1：註冊新 session

> 身為開發者，我想宣告「這個目錄需要一個 Claude session」，
> 工具自動建立並在掛掉時重啟。

驗收條件：
- `claude-r add` 將 session 寫入 state file 並立即建立 tmux session
- tmux 內執行 `claude --dangerously-skip-permissions --name "<session_name>"`
- Session 預設使用 `restart: always` policy

### US-2：查看所有 session

> 身為開發者，我想一覽所有受管理的 session，
> 包含期望狀態與實際狀態。

驗收條件：
- `claude-r ls` 顯示所有受管理的 session
- 顯示：名稱、工作目錄、restart policy、實際狀態（running / dead）
- 無 session 時顯示提示訊息

### US-3：移除 session

> 身為開發者，我想移除不再需要的 session，daemon 不再重啟它。

驗收條件：
- `claude-r rm <name>` 從 state file 移除並殺掉 tmux session
- `claude-r rm --all` 移除所有 session
- Daemon 不會再重建已移除的 session

### US-4：重啟 session

> 身為開發者，我想重啟一個 session（保留設定），
> 用於 Claude 卡住或行為異常時。

驗收條件：
- `claude-r restart <name>` 殺掉並重建 tmux session（同設定）
- Session 在 state file 中的設定不變

### US-5：重新命名 session

> 身為開發者，我想改 session 名稱，讓它更好辨認。

驗收條件：
- `claude-r rename <old> <new>` 更新 state file 並重建 tmux session（套用新名稱）
- Claude 的 `--name` flag 使用新名稱

### US-6：接上 session

> 身為開發者，我想 attach 到 tmux session 除錯。

驗收條件：
- `claude-r resume <name>` 接上 tmux session
- `Ctrl+B D` detach 離開

### US-7：互動式操作

> 身為開發者，我想直接打 `claude-r` 進入互動選單，
> 用游標選 session、選操作。

驗收條件：
- `claude-r`（無參數，TTY）進入互動模式
- 列表顯示所有 session，方向鍵選擇
- 選中後顯示操作選單（resume / restart / remove）
- 提供「Add new session」選項
- 非 TTY 自動 fallback 到 `claude-r ls`

### US-8：Auto-restart

> 身為開發者，我的 Claude session 掛掉或 host 重開機後，
> 我希望 session 自動恢復，不需手動操作。

驗收條件：
- Claude process 異常退出後，daemon 在數秒內重建 session
- 系統重開機後，systemd 啟動 daemon，daemon 重建所有 `restart: always` 的 session
- `restart: no` 的 session 不會被重建

---

## 命令參考

### 總覽

```
claude-r                                        # 互動模式（TTY）/ ls（非 TTY）
claude-r add [--dir PATH] [--name NAME] [--restart POLICY]
claude-r rm <NAME> [--all] [--force]
claude-r ls [--quiet]
claude-r restart <NAME>
claude-r rename <OLD> <NEW>
claude-r resume <NAME>
claude-r daemon                                 # systemd 呼叫
claude-r install                                # 安裝 systemd service
claude-r uninstall                              # 移除 systemd service
claude-r help
```

### `claude-r add`

註冊一個新的受管理 session。

```bash
claude-r add                              # $PWD，名稱取 basename
claude-r add -d ~/projects/foo            # 指定目錄
claude-r add -d ~/projects/foo -n myapi   # 指定目錄 + 自訂名稱
claude-r add --restart no                 # 不自動重啟
```

| Flag | Short | 說明 | 預設值 |
|------|-------|------|--------|
| `--dir <path>` | `-d` | 工作目錄 | `$PWD` |
| `--name <name>` | `-n` | Session 名稱 | `basename-<短 hash>`（base36 timestamp 避免衝突） |
| `--restart <policy>` | `-r` | Restart policy：`always`、`on-failure`、`no` | `always` |

行為：
1. 解析工作目錄，驗證存在
2. 決定 session 名稱：若有 `--name` 使用指定值並驗證不重複；否則自動產生 `basename-<base36 timestamp>`（不會衝突，無需驗證）
3. 寫入 state file
4. 立即建立 tmux session：`tmux new-session -d -s cr-<name> -c <dir>`
5. 在 tmux 內執行：`claude --dangerously-skip-permissions --name "<name>"`
6. 輸出結果

```
✓ Added: my-project
  Dir:     ~/projects/my-project
  Restart: always
```

名稱衝突時：報錯 `Session "my-project" already exists. Use --name to specify a different name.`

### `claude-r rm`

移除受管理的 session。

```bash
claude-r rm my-project           # 移除指定
claude-r rm --all                # 移除全部
claude-r rm --all --force        # 移除全部，跳過確認
```

| Flag | Short | 說明 |
|------|-------|------|
| `--all` | `-a` | 移除所有 session |
| `--force` | `-f` | 跳過確認提示 |

行為：
- 單一 session：直接移除（無確認）
- `--all`：確認提示 `Remove N session(s)? [y/N]`，`--force` 跳過
- 從 state file 移除 + 殺掉 tmux session

### `claude-r ls`

列出所有受管理的 session。別名：`list`。

```bash
claude-r ls
claude-r ls -q         # 只輸出名稱
```

| Flag | Short | 說明 |
|------|-------|------|
| `--quiet` | `-q` | 只輸出 session 名稱（方便 scripting） |

輸出格式：

```
NAME          DIR                      RESTART    STATUS
my-project    ~/projects/my-project    always     running
api-server    ~/projects/api-server    always     dead (restarting...)
scratch       ~/tmp/scratch            no         dead
```

`STATUS` 欄位：
- `running`：tmux session 存在且 claude process 在跑
- `dead`：tmux session 不存在
- `dead (restarting...)`：tmux session 不存在，但 restart policy 會重建

### `claude-r restart`

重啟指定 session（保留設定）。

```bash
claude-r restart my-project
```

行為：
1. 從 state file 讀取設定
2. 殺掉 tmux session
3. 以相同設定重建 tmux session

### `claude-r rename`

重新命名 session。

```bash
claude-r rename my-project my-api
```

行為：
1. 驗證舊名稱存在、新名稱不衝突
2. 更新 state file（舊 key → 新 key）
3. 殺掉舊 tmux session
4. 以新名稱重建 tmux session（`--name` 使用新名稱）

### `claude-r resume`

接上 tmux session。

```bash
claude-r resume my-project
```

行為：
- `tmux attach-session -t cr-<name>`
- `Ctrl+B D` detach 離開
- Session 不存在時報錯

### `claude-r daemon`

執行 reconciliation loop，由 systemd 呼叫。

行為：
1. 每 N 秒（預設 5 秒）執行一次調和
2. 讀取 state file，列出 tmux sessions
3. 對每個 state file 中的 session：
   - tmux session 存在 → 不動
   - tmux session 不存在 + `restart: always` → 重建
   - tmux session 不存在 + `restart: on-failure` → 檢查上次退出狀態，非零才重建
   - tmux session 不存在 + `restart: no` → 不動
4. 寫 log 到 stdout（systemd journal 收集）

### `claude-r install`

安裝 systemd user service。

```bash
claude-r install     # 安裝並啟動
```

行為：
1. 產生 `~/.config/systemd/user/claude-r.service`
2. `systemctl --user daemon-reload`
3. `systemctl --user enable --now claude-r.service`
4. 檢查 `loginctl enable-linger` 狀態，未啟用則提示

### `claude-r uninstall`

移除 systemd user service。

```bash
claude-r uninstall
```

行為：
1. `systemctl --user disable --now claude-r.service`
2. 移除 service 檔案
3. `systemctl --user daemon-reload`

### `claude-r help`

顯示使用說明。`--help`、`-h`、不合法 subcommand 均觸發。

---

## 互動模式

### 進入條件

- `claude-r` 無參數
- stdin 為 TTY

兩者皆滿足進入互動模式，否則 fallback 到 `claude-r ls`。

### 流程

```
┌──────────────────────────────────────────────────┐
│  Claude Remote Sessions                          │
│                                                  │
│  ▸ my-project     ~/projects/foo    running      │
│    api-server     ~/projects/bar    running      │
│    scratch        ~/tmp/scratch     dead         │
│    ────────────────────────────                  │
│    + Add new session                             │
│    ✕ Remove all sessions                         │
└──────────────────────────────────────────────────┘
         │
         ▼ (選中一個 session)
┌──────────────────────────────────────────────────┐
│  my-project                                      │
│  ~/projects/foo · always · running               │
│                                                  │
│  ▸ Resume                                        │
│    Restart                                       │
│    Remove                                        │
│    ────────────────────────────                  │
│    ← Back                                        │
└──────────────────────────────────────────────────┘
```

### 互動 UI 實作

使用 `@clack/prompts`（Node.js TUI library），提供：
- `select()` 方向鍵游標選擇
- `confirm()` 確認提示
- `text()` 文字輸入（rename、add 時輸入名稱）

不需外部二進位依賴（gum、fzf）。

### 無 session 時

```
┌──────────────────────────────────────────────────┐
│  No claude sessions.                             │
│                                                  │
│  Add a new session in ~/current/dir? [Y/n]       │
└──────────────────────────────────────────────────┘
```

---

## State File

### 路徑

```
~/.config/claude-r/sessions.json
```

### Schema

```jsonc
{
  "my-project": {
    "dir": "/home/user/projects/my-project",
    "restart": "always",       // "always" | "on-failure" | "no"
    "created_at": "2026-03-22T02:45:00Z"
  },
  "api-server": {
    "dir": "/home/user/projects/api-server",
    "restart": "always",
    "created_at": "2026-03-22T02:46:00Z"
  }
}
```

- Key = session 名稱（使用者可見，可 rename）
- `dir` = 工作目錄絕對路徑
- `restart` = restart policy
- `created_at` = 建立時間（ISO 8601）

### 操作語義

| CLI 命令 | State file 操作 | tmux 操作 |
|---------|----------------|-----------|
| `add` | 新增 entry | 建立 session |
| `rm` | 刪除 entry | 殺掉 session |
| `restart` | 不變 | 殺掉 + 重建 |
| `rename` | 刪舊 key + 建新 key | 殺掉 + 重建（新名稱） |
| `ls` | 讀取 | 查詢狀態 |
| `resume` | 不變 | attach |

---

## Session 管理

### 命名規則

- **使用者名稱**：`add --name` 指定，或自動取目錄 basename
- **tmux session 名稱**：`cr-<使用者名稱>`（`cr-` prefix 用於過濾）
- 名稱限制：英數、`-`、`_`，不允許空白與特殊字元
- 名稱唯一性：在 state file 中不可重複

```bash
claude-r add -d ~/projects/my-project
# 使用者名稱: my-project
# tmux session: cr-my-project

claude-r add -d ~/projects/my-project -n myproj
# 使用者名稱: myproj
# tmux session: cr-myproj
```

### Basename 衝突處理

未指定 `--name` 時，自動產生 `basename-<base36 timestamp>` 作為名稱，因此不同目錄即使 basename 相同也不會衝突：

```bash
claude-r add -d ~/projects/foo/api    # 名稱: api-lk2f8g
claude-r add -d ~/projects/bar/api    # 名稱: api-lk2f9a（不同 timestamp，自動避免衝突）
```

明確指定 `--name` 時，若名稱已存在則報錯：`Session "xxx" already exists. Use --name to specify a different name.`

### 模糊比對

所有接受 `<NAME>` 的命令支援部分匹配：

1. 完全匹配 → 使用
2. 部分匹配（substring）→ 唯一時使用
3. 多個匹配 → 列出候選，要求明確指定
4. 無匹配 → 報錯

```bash
claude-r resume my       # 若只有 my-project 匹配 → 接上
claude-r resume api      # 若 api-server 和 api-client 都匹配 → 列出候選
```

### Daemon Reconciliation

```
每 5 秒:
  desired = 讀取 sessions.json
  actual  = tmux list-sessions | grep '^cr-'

  for session in desired:
    tmux_name = "cr-" + session.name
    if tmux_name not in actual:
      if session.restart == "always":
        → 建立 tmux session
      elif session.restart == "on-failure":
        → 檢查上次退出碼，非零才重建
      elif session.restart == "no":
        → 不動
```

---

## 邊界案例

| 情境 | 行為 |
|------|------|
| 無 tmux server | `ls` 顯示 session 列表，STATUS 全為 dead |
| `--dir` 指定不存在的目錄 | 報錯 exit 1 |
| `rm` / `resume` 指定不存在的 session | 報錯 exit 1 |
| `rename` 新名稱已存在 | 報錯 exit 1 |
| 同一目錄 `add` 兩次（不同名稱） | 允許 |
| 同一目錄 `add` 兩次（同名稱） | 報錯 name conflict |
| State file 不存在 | 自動建立空 `{}` |
| State file 損壞（非法 JSON） | 報錯，提示手動修復 |
| `resume` 但 tmux session 是 dead | 報錯，提示 `restart` |
| Daemon 未啟動時使用 CLI | 正常運作（CLI 直接操作 tmux），但無 auto-restart |
| 非 TTY 環境 `claude-r`（無參數） | Fallback 到 `ls` |

---

## 技術棧

| 層級 | 選擇 |
|------|------|
| 語言 | TypeScript |
| Runtime | Node.js + tsx（無 build step） |
| CLI framework | 手刻或輕量 lib（如 `citty`） |
| Interactive UI | `@clack/prompts` |
| Process 管理 | `node:child_process`（execSync 呼叫 tmux） |
| State 儲存 | JSON file（`node:fs`） |
| Service 管理 | systemd user service |

### 入口

bashrc alias：
```bash
alias claude-r="tsx ~/Dropbox/projects/AGENTS/scripts/claude-r/main.ts"
```

原始碼位於 `AGENTS/scripts/claude-r/`，無需 symlink 或全域安裝。

---

## ADR

### ADR-1：TypeScript + tsx 而非 bash

**決定**：TypeScript + tsx。

理由：
- Daemon 的 reconciliation loop + state file 管理超出 bash 舒適範圍
- tsx 不需 build step，修改即生效（跟 bash 一樣快）
- 互動 UI 用 `@clack/prompts`，比依賴外部二進位（gum）更整合

### ADR-2：宣告式架構（add/rm）而非指令式（start/stop）

**決定**：CLI 管理期望狀態，daemon 調和實際狀態。

理由：
- 使用者只需宣告「我要這個 session」，不需管 process 生命週期
- Crash recovery 和 reboot recovery 自然落在 daemon 身上
- 與 Docker / Kubernetes 的心智模型一致

### ADR-3：State file 作為 SSOT

**決定**：`~/.config/claude-r/sessions.json` 記錄所有受管理 session。

理由：
- 純 tmux 查詢無法記住 restart policy 和原始設定
- State file 讓 daemon 能在 reboot 後重建 session
- CLI 操作同時更新 state file + tmux，保持一致

### ADR-4：tmux session prefix `cr-`

**決定**：所有受管理的 tmux session 以 `cr-` 為 prefix。

理由：
- 短（比 `claude-remote-` 省空間）
- 不會與使用者自建的 tmux session 衝突
- `tmux ls | grep '^cr-'` 即可過濾

### ADR-5：`@clack/prompts` 而非 gum / fzf

**決定**：Node.js 原生 TUI library。

理由：
- 已在 Node.js 生態中，不需安裝外部二進位
- 多步驟互動流程（select → action submenu）直接用 JS 串接
- 美觀、輕量、維護活躍

### ADR-6：rename 會重建 tmux session

**決定**：`rename` 更新 state file 後重建 tmux session。

理由：
- Claude 的 `--name` flag 在啟動時設定，無法動態更改
- 只改 tmux session 名稱會導致 Remote Control 顯示舊名稱
- 重建確保所有層面的名稱一致
