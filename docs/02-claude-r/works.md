# Works: claude-r

## 2026-03-22

### Milestone 1: 專案骨架 + 核心模組

- Task 1.1 由 ddd-developer 完成專案初始化（package.json、tsconfig、vitest、types.ts）
- [A] State + Fuzzy Match 和 [B] tmux Module 平行派發至 worktree
- State module：同步 API（readFileSync/writeFileSync），config path 可注入方便測試
- Fuzzy match：純函式，exact match 優先於 substring
- tmux module：mock execSync 測試，所有函式內部處理 `cr-` prefix
- 匯合後 28 tests 全過，無衝突

### Milestone 2: CLI 命令

- Task 2.1 建立 CLI routing（main.ts）+ help + 6 個 stub，附帶 18 個整合測試
- [A] add + ls 平行實作：add 支援 --dir/--name/--restart flags，ls 支援 --quiet 和 STATUS 顯示
- [B] rm + resume + restart + rename 平行實作：抽出共用 resolve-name.ts 做模糊比對
- 匯合後修復 main.test.ts 的 7 個過時 stub 測試（命令已實作，不再回傳 "not yet implemented"）
- 匯合後 104 tests 全過

### Milestone 3: Daemon + systemd

- [A] daemon reconciliation：reconcile() 做單次比對，runDaemon() 跑 loop，main.ts 用 dynamic import
- [B] install/uninstall：產生 systemd user service file，含 linger 檢查提示
- 匯合後 136 tests 全過

### Milestone 4: Interactive Mode

- 使用 @clack/prompts 實作兩層選單（主選單 → action submenu）
- main.ts 偵測 TTY 環境，非 TTY fallback 到 ls
- 無 session 時直接 confirm 是否 add
- dead session 的 Resume 選項標示 hint 提醒
- 19 個測試覆蓋所有流程分支（Ctrl+C、back、rename 文字輸入等）
- 最終 155 tests 全過

