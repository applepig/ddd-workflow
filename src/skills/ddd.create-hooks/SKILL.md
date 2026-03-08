---
name: DDD.CreateHooks
description: >
  設定 Claude Code hooks——掃描專案環境，建議並寫入 .claude/settings.json。
  Use when the user says "create hooks", "set up hooks", "add safety hooks",
  "configure auto-lint", "protect sensitive files", or invokes "/DDD.create-hooks".
  Covers security guards, code quality checks, and commit review hooks.
---

# DDD:create-hooks — Hook 設定

Utility skill。掃描專案環境，建議並設定 Claude Code hooks（`.claude/settings.json`）。

## 嚴格禁令 (Never Do)

- **嚴禁修改程式碼**：這是設定工具，不是開發工具。修改程式碼會模糊 skill 的職責邊界，讓使用者搞不清楚什麼被改了。此 skill 只操作 `.claude/settings.json`。
- **嚴禁覆蓋現有 hooks**：使用者可能已經花時間調校過 hooks，直接覆蓋等於丟棄他們的客製化。若 settings.json 已有 hooks 設定，必須合併而非覆蓋。

## 執行步驟

1. **掃描專案環境**
   - 讀取 `package.json`、`pyproject.toml` 等，判斷技術棧
   - 確認 lint/format 工具（ESLint、Prettier、Ruff、Biome 等）
   - 檢查是否有 `.env`、secrets 相關檔案
   - 讀取現有 `.claude/settings.json`（若存在）

2. **從推薦清單比對適用項目**
   - 參考 `references/hook-templates.md` 中的推薦 hook 清單
   - 依照專案技術棧，篩選適合的 hooks

3. **向使用者提案**
   - 用表格列出建議的 hooks，標示分類、用途、handler type
   - 用 AskUserQuestion 讓使用者勾選要安裝哪些
   - 說明每個 hook 的行為與風險

4. **撰寫 hook scripts**
   - 將需要的 shell script 放在 `.claude/hooks/` 目錄
   - 確保 script 有執行權限（`chmod +x`）
   - Script 注意事項：
     - stdout 只能輸出 JSON，不可有其他文字
     - 用 exit code 0（通過）或 2（阻擋）控制行為
     - 阻擋時 stderr 訊息會傳給 Claude

5. **寫入 settings.json**
   - 合併至現有的 `.claude/settings.json`
   - 若檔案不存在則建立
   - 完成後用 AskUserQuestion 確認是否需要調整

## 注意事項

- Hook 在 session 啟動時 snapshot，修改後需重啟 session 才生效
- `.bashrc` / `.zshrc` 若有印出文字，會汙染 JSON 解析，需注意
- PostToolUse 無法撤銷已執行的操作，只能回報問題
- agent/prompt type 的 hook 會消耗額外 token

## Additional Resources

### Reference Files

詳細的 hook 範例與推薦清單：
- **`references/hook-templates.md`** — 各分類的 hook 範本與設定範例

## 產出

- `.claude/settings.json`（hooks 設定）
- `.claude/hooks/` 目錄下的 shell scripts

## 結束條件

使用者確認 hooks 設定完成，提醒需重啟 session 生效。
