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
