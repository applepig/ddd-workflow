# Hotfix: session trigger 遺失

## 問題描述

- **症狀**：crontab 指向 `/home/applepig/Dropbox/projects/AGENTS/ddd-workflow/scripts/session-trigger.mjs`，但 `main` 分支內沒有該檔案。
- **預期行為**：cron 可直接執行 session trigger script，定時啟動 Claude / Codex rolling window keepalive。
- **影響範圍**：工作日 07:00、12:00、17:00 的 session trigger 不會執行；stderr 若只寫 `2>&1` 也不會落到指定 log 檔。

## 根因分析

- **根因**：`session-trigger.mjs` 曾提交在 `feat/optional-tasks-workflow`，但沒有進入目前 `main` 分支，導致 cron 指向不存在的路徑。
- **定位過程**：用檔案搜尋確認 repo 內不存在 `session-trigger.mjs`，再從 git reflog / commit history 找到 `85cc291` 保留了該檔案內容，並確認只有 `feat/optional-tasks-workflow` 包含該 commit。
- **受影響的檔案**：`ddd-workflow/scripts/session-trigger.mjs`、`scripts/shared-agent-runner.test.js`。

## 修復內容

- **修了什麼**：恢復 `ddd-workflow/scripts/session-trigger.mjs`，並調整 inline crontab 範例為 `>/dev/null 2>&1`，避免誤以為 `2>&1` 會自行寫入 log。
- **測試**：新增 regression test，確認 session trigger script 存在且具 executable bit。
- **驗證結果**：`pnpm vitest run scripts/shared-agent-runner.test.js` 通過；`node --check ddd-workflow/scripts/session-trigger.mjs` 通過。
