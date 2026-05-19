# Hotfix: opencode Codex usage status

## 問題描述
- **症狀**：opencode Codex usage status 將 5hr 與 weekly 顯示在同一行，欄位不易對齊；當 reset time 已超過時，仍可能用 stale JSON 顯示舊 usage。
- **預期行為**：5hr 與 weekly 改成兩行顯示，label、百分比、reset remaining 欄位以 padding 對齊；reset time 已過期時，usage 直接推定為 0%。
- **影響範圍**：opencode TUI 右側 Codex usage status 顯示。

## 根因分析
- **根因**：顯示端直接使用 capture 保存的 `used_percent`，沒有依目前時間判斷 `reset_at` 是否已過期；版面也用 row + separator，無法做每欄對齊。
- **定位過程**：確認 `opencode-codex-usage-capture.js` 只負責保存 header JSON，實際顯示在 `opencode-codex-usage-status.tsx`；追蹤後發現 `LimitView` 直接 render 同一行且只 `Math.round` usage。
- **受影響的檔案**：`ddd-workflow/scripts/opencode-codex-usage-status.tsx`、`ddd-workflow/scripts/opencode-codex-usage-format.js`、`scripts/cli.js`、`vitest.config.js`。

## 修復內容
- **修了什麼**：新增 usage format helper，集中處理 reset 已過期歸零、remaining time 與欄位 padding；TUI 改為 column 兩行式顯示；部署清單新增 helper symlink，讓 opencode plugin relative import 可解析。
- **測試**：新增 `ddd-workflow/scripts/opencode-codex-usage-format.test.js`，覆蓋 reset 過期歸零、reset 前保留 usage、兩行對齊欄位 padding。
- **驗證結果**：`pnpm vitest run` 通過 207 tests；`pnpm deploy:opencode && pnpm test` 通過。

### 2026-05-18 placeholder 顯示修正

- **症狀**：opencode Codex usage status 在本機尚未 capture 到 usage JSON 時完全不顯示；當目前時間超過 `reset_at` 時，仍顯示 `0% reset 0m`。
- **根因**：`UsageView` 用 `Show when={usage}` 包住整個 UI，沒有資料時直接不 render；formatter 對 missing / elapsed data 沒有 unknown state，只能輸出 `0%` 或 `0m`。
- **修復內容**：移除 `UsageView` 的 usage gate，讓 5hr / week 兩行永遠顯示；`limitColumns` 在沒有資料或 reset 已過期時輸出 `--% reset --:--`。
- **測試**：補上無 usage data 與 reset elapsed 的 placeholder 測試。
- **驗證結果**：`pnpm vitest run ddd-workflow/scripts/opencode-codex-usage-format.test.js` 通過。
