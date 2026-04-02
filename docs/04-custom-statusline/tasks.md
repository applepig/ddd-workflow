# Tasks: Custom Status Line — Phase 2（OAuth Usage API）

> 來源：`docs/04-custom-statusline/spec.md`
> 目標檔案：`ddd-workflow/scripts/statusline.sh`
> 測試方式：bash test script，用 mock JSON 餵入、驗證 stdout 輸出

## Milestone 1: OAuth Token 讀取 + API 呼叫 + 快取

> 風險最高的部分先做——確認能拿到 token、打到 API、快取機制可用。
> 驗證方式：手動執行 `bash ddd-workflow/scripts/statusline.sh` 並檢查 `/tmp/claude/statusline-usage-cache.json` 是否產生

- [x] Task 1.1: 撰寫 OAuth token 讀取測試（Red）
  - 測試三種來源：環境變數 → credentials 檔案 → keyring
  - 測試找不到 token 時的 fallback 行為
- [x] Task 1.2: 實作 `getOAuthToken` 函式（Green）
  - 依優先序讀取：`$CLAUDE_CODE_OAUTH_TOKEN` → `~/.claude/.credentials.json` → `secret-tool`
  - 找不到 token 時回傳空字串，不中斷執行
- [x] Task 1.3: 撰寫 API 呼叫 + 快取測試（Red）
  - 測試快取命中（60 秒內不重複呼叫）
  - 測試快取過期重新呼叫
  - 測試 API 失敗 fallback 到舊快取
  - 測試 API timeout 5 秒上限
- [x] Task 1.4: 實作 `fetchUsageAPI` 函式 + 快取機制（Green）
  - `curl --max-time 5` 呼叫 API
  - 快取寫入 `/tmp/claude/statusline-usage-cache.json`
  - 失敗時 fallback：舊快取 → StatusJSON → 不顯示

## Milestone 2: Line 2 資料源替換（API → 現有格式）

> 前置依賴：Milestone 1 完成（API 資料可用）
> 不改佈局——維持現有的 Reset timer + Session bar（█░ 格式），僅替換資料來源。
> 驗證方式：用 mock JSON + mock API cache 測試 Line 2 輸出

- [x] Task 2.1: 撰寫資料源替換測試（Red）
  - 測試 API 資料可用時，`used_pct` 改用 `five_hour.utilization`
  - 測試 API 資料可用時，`resets_at` 改用 API 的 ISO 時間（轉 Unix timestamp）
  - 測試 API 不可用時，fallback 回 StatusJSON 的 `rate_limits` 資料
- [x] Task 2.2: 實作資料源替換邏輯（Green）
  - 若 M1 的 API 快取有資料，用 API 的 `five_hour.utilization` 覆蓋 `json_used_pct`
  - 若 M1 的 API 快取有資料，用 API 的 `five_hour.resets_at`（ISO → epoch）覆蓋 `json_resets_at`
  - 無 API 資料時維持原樣（StatusJSON fallback）

## Milestone 3: Compact 模式（窄 Terminal）

> 獨立於 M1/M2 的 API 整合——純顯示邏輯。但因共用同一檔案，仍需序列執行。
> 驗證方式：設定 `COLUMNS=50` 測試 compact 輸出

- [x] Task 3.1: 撰寫 compact 模式測試（Red）
  - 測試 terminal 寬度 <60 時輸出單行格式
  - 測試 CTX/USG 色彩規則（0–60% 綠、60–80% 橘、80%+ 紅）
  - 測試 RES 不套用色彩
  - 測試 terminal 寬度 ≥60 時維持三行格式
- [x] Task 3.2: 實作 compact 模式（Green）
  - `tput cols` 偵測寬度，<60 走 compact 路徑
  - 單行格式：`Opus 4.6 | CTX 22% | USG 84% | RES 10m`
  - 分隔符號 ` | ` 不上色
- [x] Task 3.3: Refactor — 抽出共用的色彩判斷邏輯
  - compact 模式的 CTX/USG 色彩規則與完整版的 bar 色彩規則共用同一組閾值
