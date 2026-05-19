# Hotfix: session trigger Codex bucket

## 問題描述

- **症狀**：`07:00` cron log 顯示 Codex trigger `ok`，但稍後開啟 Codex / opencode 時，5h reset time 仍顯示約 `16:05`，代表 window 是使用當下才開始。
- **預期行為**：cron trigger 應啟動實際互動使用的 Codex / opencode model bucket，讓 reset time 依排程提前。
- **影響範圍**：工作日 `07:00`、`12:00`、`17:00` 的 session trigger 對 Codex / opencode rolling window keepalive 失效或不穩定。

## 根因分析

- **根因**：`session-trigger.mjs` 使用 `gpt-5.4-mini` ping 官方 Codex CLI，與實際互動畫面使用的 `gpt-5.4` / 後續要觀察的 `gpt-5.5` bucket 不一致；opencode 的 usage status 也來自 opencode 自己對 `chatgpt.com/backend-api/codex/responses` 的 response headers，原本 trigger 沒有 ping opencode。
- **定位過程**：比對 `~/.session-trigger/session-trigger.log`、cron journal、Codex session file 與 opencode usage JSON，確認 cron 有跑，但 reset time 仍由後續互動請求開始；使用者貼出的 Codex 畫面顯示 reset `16:05`，排除單純 opencode 顯示 stale 的假設。
- **受影響的檔案**：`ddd-workflow/scripts/session-trigger.mjs`、`ddd-workflow/scripts/session-trigger.test.js`。

## 修復內容

- **修了什麼**：將 Codex trigger model 改為 `gpt-5.5` + low reasoning；新增 opencode trigger，使用 `openai/gpt-5.5` + low variant，並解析 opencode usage capture 寫出的 `codex-usage.json` 作為 reset 驗證。
- **測試**：新增 `ddd-workflow/scripts/session-trigger.test.js`，覆蓋 Codex / opencode 使用 `gpt-5.5` bucket 與 opencode agent 存在。
- **驗證結果**：`pnpm vitest run ddd-workflow/scripts/session-trigger.test.js` 通過；`node --check ddd-workflow/scripts/session-trigger.mjs` 通過。明天依 cron 實際 log 觀察 reset 是否提前。
