# claude-r v2 Spec

## 目標

提供一個精簡的互動式 CLI，用 tmux 管理 Claude Code session：

- **SSH 斷線保護**：Claude Code 跑在 tmux 裡，SSH 斷掉後 session 繼續活著
- **快速 pickup**：SSH 重連後，一個指令列出所有 session，選擇 attach
- **iPad 友善**：同時支援數字鍵和方向鍵選取（iPad 上方向鍵不方便）

## 非目標

- 不做 daemon / auto-restart（v1 的 daemon 有 process leak 問題，且 tmux 本身就保活）
- 不做 state file（直接查 tmux 即為真相）
- 不做 systemd 整合
- 不管 Claude Code 內部狀態（remote control 連線等）
- 不做多 host 管理

---

## 架構概觀

```
使用者
  │
  ▼
claude-r（互動式選單）
  │
  ├── 列出 cr-* tmux sessions
  ├── 選擇 → tmux attach
  └── 新建 → tmux new-session + claude --dangerously-skip-permissions
```

無 daemon、無 state file、無 systemd。tmux 是唯一的真相來源。

### 檔案配置

```
AGENTS/scripts/claude-r/
  ├── main.ts          # CLI 進入點 + 互動選單邏輯
  ├── tmux.ts          # tmux 操作模組
  ├── main.test.ts     # 選單邏輯測試
  ├── tmux.test.ts     # tmux 模組測試
  ├── vitest.config.ts
  ├── tsconfig.json
  └── package.json

~/.bashrc
  alias cr="tsx ~/Dropbox/projects/AGENTS/scripts/claude-r/main.ts"
```

---

## User Story

### US-1：SSH 重連後快速接上 session

> 身為開發者，我從 iPad SSH 進工作機後，
> 想用一個指令看到所有 Claude Code session，選一個接上。

驗收條件：
- 執行 `cr` 顯示互動選單，列出所有 `cr-` prefix 的 tmux session
- 每個選項顯示 session 名稱和工作目錄
- 可用**數字鍵**直接選取，或**方向鍵 + Enter** 選取
- 選中後 attach 到該 tmux session

### US-2：在當前目錄建立新 session

> 身為開發者，我想在當前專案目錄建立一個新的 Claude Code session。

驗收條件：
- 選單最後一個選項是「Start new session here（目錄路徑）」
- 選取後建立 tmux session，在裡面執行 `claude --dangerously-skip-permissions`，然後 attach
- Session 命名為 `cr-<目錄 basename>`，同名時加 suffix

### US-3：無 session 時自動建立

> 身為開發者，第一次使用時不想看到空選單。

驗收條件：
- 沒有任何 `cr-` session 時，跳過選單，直接建立新 session 並 attach

---

## 互動選單

### 外觀

```
  Claude Code Sessions

  [1] ● cr-AGENTS       ~/Dropbox/projects/AGENTS
  [2] ● cr-aistudio     ~/Dropbox/projects/5-aistudio

  [3] ○ Start new session here (~/Dropbox/projects/AGENTS)

  ↑↓/數字 選擇  Enter 連線  q 離開
```

- `●` 表示現有 session
- `○` 表示新建選項
- `[N]` 數字標記，按對應數字鍵直接選取
- `>` 標記目前游標位置（方向鍵移動）

### 按鍵

| 按鍵 | 行為 |
|------|------|
| `1`–`9` | 直接選取對應選項 |
| `↑` / `↓` | 移動游標（循環） |
| `Enter` | 確認目前游標選項 |
| `x` | 終止目前選取的 session |
| `r` | 重啟目前選取的 session（保留 session ID 以 resume 對話） |
| `q` / `Ctrl+C` | 離開 |

### 行為流程

```
啟動
  │
  ├── 無 session → 自動建立 + attach
  │
  └── 有 session → 顯示選單
        │
        ├── 選現有 session
        │     ├── Enter / 數字鍵 → tmux attach
        │     ├── x → 終止 session，更新選單
        │     └── r → 重啟 session（嘗試 resume 對話）
        └── 選「Start new」 → 建立 + attach
```

---

## Session 管理

### 命名規則

- tmux session prefix：`cr-`
- 名稱 = `cr-` + 當前目錄 basename（如 `cr-AGENTS`）
- 同名已存在時，加 base36 timestamp suffix（如 `cr-AGENTS-lk2f`）

### tmux 操作

| 動作 | 指令 |
|------|------|
| 列出 session | `tmux list-sessions -F '#{session_name}:#{pane_current_path}'` |
| 建立 session | `tmux new-session -d -s <name> -c <dir>` |
| 啟動 claude | `tmux send-keys -t <name> 'claude --session-id <uuid> --dangerously-skip-permissions' Enter` |
| 儲存 session ID | `tmux set-environment -t <name> CLAUDE_SESSION_ID <uuid>` |
| 讀取 session ID | `tmux show-environment -t <name> CLAUDE_SESSION_ID` |
| Resume claude | `tmux send-keys -t <name> 'claude --resume <uuid> --dangerously-skip-permissions' Enter` |
| 終止 session | `tmux kill-session -t <name>` |
| 接上 session | `tmux attach-session -t <name>`（stdio: inherit） |

### 辨識策略

只管 `cr-` prefix 的 tmux session，不干擾使用者自建的 session。

---

## 邊界案例

| 情境 | 行為 |
|------|------|
| 無 tmux server | 等同無 session，自動建立 |
| stdin 非 TTY | 報錯 exit 1 |
| 目錄名含 `.` | basename 中的 `.` 替換為 `_`（避免 tmux target 語法衝突） |
| tmux session 存在但 claude 已退出 | 仍然顯示在列表中（attach 後使用者自行處理） |
| 重啟 session 時有 session ID | 用 `--resume` 恢復對話 |
| 重啟 session 時無 session ID | 用新 session ID 重新建立 |

---

## 技術棧

| 層級 | 選擇 |
|------|------|
| 語言 | TypeScript（ESM） |
| Runtime | tsx（無 build step） |
| 互動 UI | Raw stdin（process.stdin.setRawMode）——支援數字鍵 + 方向鍵 |
| Process 管理 | `node:child_process`（execFileSync 呼叫 tmux） |
| 測試 | Vitest |

### 為何不用 `@clack/prompts`

`@clack/prompts` 的 select 不支援數字鍵直接選取。iPad 上方向鍵操作不方便，數字鍵是必要功能，因此用 raw stdin 自己實作。

---

## ADR

### ADR-1：移除 daemon / state file / systemd

**決定**：v2 移除所有 daemon 相關功能。

理由：
- v1 的 daemon 有嚴重 process leak（systemd Restart=always 累積 88 個 orphan process）
- tmux 本身就保活，SSH 斷線後 session 不會消失
- State file 和 tmux 狀態的同步是額外的複雜度來源
- 直接查 tmux 即為真相，不需要第二個 SSOT

### ADR-2：保留 tmux prefix `cr-`

**決定**：沿用 v1 的 `cr-` prefix。

理由：
- 短，不佔 tmux session 名稱空間
- 與使用者自建的 tmux session 不衝突
- `tmux ls -F | grep cr-` 過濾簡單

### ADR-3：Raw stdin 而非 TUI library

**決定**：用 `process.stdin.setRawMode` 自己處理按鍵。

理由：
- 核心需求是數字鍵 + 方向鍵，沒有現成 library 同時支援
- 選單邏輯簡單（單層列表），不需要完整 TUI framework
- 零外部依賴，純函式好測試
