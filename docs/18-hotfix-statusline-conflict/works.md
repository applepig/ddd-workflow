# Hotfix: Statusline conflict regression

## 問題描述

- **症狀**：`ddd-workflow/scripts/statusline.sh` 在近期 conflict resolution 後，Usage API throttle 失效，full mode 百分比會直接顯示 API decimal，Session bar 也可能畫成 0 格。
- **預期行為**：Usage API 快取過期但 throttle 仍新鮮時，不重複打 API；百分比在輸出前統一 round 成 0-100 的整數；bar 格數依 `BAR_WIDTH` 與整數百分比比例繪製。
- **影響範圍**：Claude Code custom statusline 的 API 呼叫頻率、full mode 百分比格式、Session bar 顯示與顏色判斷。

## 根因分析

- **根因**：`chore(statusline): log statusline invocations` 合併時混入舊版區塊，刪掉 throttle 檢查；同時 API `five_hour.utilization` 可為 decimal，但 script 直接拿來做 Bash arithmetic 與輸出，造成格式不一致與 bar 計算失敗。
- **定位過程**：比對 `552c575` 與目前版本後確認 throttle 讀取邏輯遺失；新增 decimal utilization 測試後重現 `42.6%` 被直接輸出且 filled bar 為 0。
- **受影響的檔案**：`ddd-workflow/scripts/statusline.sh`、`ddd-workflow/scripts/test-statusline.sh`。

## 修復內容

- **修了什麼**：恢復 fresh throttle 使用舊快取的邏輯；新增 `normalizePct()` 將百分比 round 並 clamp 到 0-100；新增 `pctToFilled()` 依 `BAR_WIDTH` 比例 round 格數；保留 compact 短 label `CTX / USG / RES`。
- **測試**：新增 throttle regression 測試與 API decimal utilization full mode 測試，確認 `42.6` 顯示為 `43%` 並填滿 11 格。
- **驗證結果**：`bash ddd-workflow/scripts/test-statusline.sh` 通過 65/65；`npm test` 通過。
