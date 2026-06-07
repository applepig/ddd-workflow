---
name: ddd.work
description: >
  TDD 開發執行：以 Red → Green → Refactor 循環實作 spec.md Milestones 或已確認的 optional tasks.md。
  遇到 🔀 平行工作線時，coordinator 直接派 ddd-developer subagent 分工。
  Trigger: "start implementing", "begin development", "let's code", "do TDD",
  "開始實作", "開始寫", "動工", /ddd.work。
  spec.md 已確認後，準備寫程式碼時使用；若本 sprint 有 optional tasks.md，也必須先確認。
---

# ddd.work — 開發執行

開發執行階段。以 TDD 循環逐一完成任務來源中的 milestone。任務來源預設為 `spec.md` Milestones；若本 sprint 有已確認的 optional `tasks.md`，則使用 `tasks.md`。

不指定 milestone 編號時，從第一個未完成的 milestone 開始。

若 sprint 目錄存在 `tasks.md`，但 prompt、spec 或 works.md 沒有明確顯示它已被使用者確認為本次任務來源，先停下來請使用者確認：沿用 tasks.md、整合回 spec.md、或只當歷史參考。

## 模式判定

讀取當前任務來源的 milestone 時，根據其結構判定執行模式：

- **序列模式**：milestone 內沒有 `🔀 可平行工作線` → 主行程逐一執行 TDD 循環
- **平行模式**：milestone 內有 `🔀 可平行工作線` → coordinator 直接派發 `ddd-developer` subagent

## 序列模式：TDD 開發循環

適用於一般的線性 milestone。

1. **鎖定範圍**
   - 讀取任務來源（spec.md Milestones 或已確認 tasks.md），確認當前 milestone 的範圍與驗收條件
   - 讀取 spec.md 中對應的驗收條件；tasks.md 只承載執行計畫，不取代 spec.md 的需求定義

2. **TDD 開發循環（Red → Green → Refactor）**
   - **Red**：根據驗收條件撰寫測試案例（Vitest / Playwright）
   - **Green**：撰寫程式碼直到測試通過
   - **Refactor**：最佳化程式碼結構，確保測試維持通過

3. **Simplify**
   - 呼叫 `/simplify`（Claude Code 內建 skill，非 DDD skill）審查本次 git diff
   - 它會平行啟動 code reuse / code quality / efficiency 三個 review agent 並直接修正問題

4. **自我驗收**
   - 執行所有相關測試，確認全部通過
   - 執行 E2E 驗證（若任務來源有標註驗證方式，依其步驟執行）
   - 檢查是否符合 spec 中的驗收條件

5. **更新文件**
   - 任務來源：勾選已完成的 task（`- [x]`）
   - `works.md`：記錄本次 milestone 的技術決策與問題解決

6. **回報使用者**
   - 展示完成的功能與測試結果
   - 等待使用者確認後才 commit
   - 嚴禁自動提交，測試通過不等於提交授權

## 平行模式：Coordinator 派發

適用於 milestone 內包含 `🔀 可平行工作線` 的情境。主行程作為 coordinator，直接派發 `ddd-developer` subagent。

### Phase 1: 準備派發

1. **解析工作線**
   - 從任務來源讀取所有 `[A]`、`[B]`… 工作線
   - 確認每條線的範圍、依賴、介面契約與驗證方式
   - 若工作線會修改同一檔案或介面尚未確定，退回序列模式

2. **組裝 worker prompt**

   每個 worker prompt 必須讓 worker 不需要自行探索就能理解任務。Coordinator 負責提供摘要和關鍵片段；完整檔案路徑列在「參考檔案」供 worker 按需讀取。

   Prompt 包含：

   ```markdown
   ## 整體目標
   （從 spec.md 摘要本 milestone 的目標）

   ## 你的工作線：[X] <標題>
   （從任務來源複製該工作線的完整內容，含所有 task）

   ## 檔案範圍
   （列出本工作線涉及的所有檔案/目錄路徑）

   ## 介面契約
   （從任務來源的 blockquote 複製介面定義）

   ## 關鍵上下文
   （貼介面定義、函式簽名、型別定義與關鍵邏輯片段；不要 raw dump 整個檔案）

   ## 參考檔案
   - `docs/<編號>-<名稱>/spec.md`
   - `docs/<編號>-<名稱>/tasks.md`（若本 sprint 使用已確認的 optional tasks.md）
   - （其他相關 source files）

   ## Worker 完成協議
   完成實作後，依序執行：
   1. Unit test：執行相關測試並回報完整結果
   2. E2E 驗證：若工作線有標註驗證方式，依步驟執行
   3. 回報：輸出 `DONE: <一句話摘要>（測試結果：X passed, Y failed）`；若失敗則輸出 `FAIL: <原因>`
   4. 不得自行 commit
   ```

3. **確認派發計畫**
   - 向使用者展示工作線清單與 subagent 數量
   - 使用 Question Tool 確認是否開始派發

### Phase 2: 派發與追蹤

1. **派發 subagent**
   - 對每條工作線呼叫 `ddd-developer` subagent
   - 多條工作線可平行派發；若 host 不支援平行派發，依序派發並明確告知
   - Worker 不得 commit；commit 由 coordinator 匯合後、經使用者確認才執行

2. **追蹤結果**
   - 收到 worker 回報後，檢查是否有 `DONE` / `FAIL` 與測試輸出
   - 沒有測試執行結果的 `DONE` 視為未完成，要求補驗證
   - Worker 失敗時，向使用者提供重試 / 主行程修復 / 跳過的決策選項

3. **匯合（🔗 匯合點）**
   - 逐一整合每條工作線的變更
   - 每整合一條工作線後立即跑該線相關測試
   - 全部整合後執行 `🔗 匯合點` 中的整合測試 task
   - 呼叫 `/simplify` 審查合併後的完整變更

4. **更新文件與回報**
   - 任務來源：勾選所有已完成的 task（含各工作線 + 匯合點）
   - `works.md`：記錄平行派發的決策、各 worker 結果、合併過程
   - 展示最終狀態與測試結果，等待使用者確認後 commit

## 核心防呆限制 (Agentic Constraints)

* **Red State Check**：寫完測試後必須先執行，確認看到預期的測試失敗，才准進入實作階段。
* **No Logic Leaks**：嚴禁在撰寫測試的階段偷寫任何業務邏輯。測試階段只產出測試檔案。
* **No Test Modification**：在 Green 階段絕對禁止修改測試檔案來讓測試通過。如果測試寫錯了，回到 Red 階段修正。
* **Refactor Guard**：若重構導致原本通過的測試失敗，必須立即撤回，禁止在錯誤的基礎上疊加修補。
* **Atomic Validation**：遇到測試報錯時，必須分析錯誤訊息，嚴禁盲目重試或猜測。
* **規格同步**：若發現規格有誤或需要變更，立即暫停開發，回到 `/ddd.spec` 更新規格。若變更影響已確認的 tasks.md，也必須同步更新並確認。
* **日誌更新**：`works.md` 必須記錄技術決策，不可事後敷衍。
* **Worker 自足性**：Worker prompt 必須讓 worker 理解「要做什麼」，並列出可按需讀取的參考檔案。
* **Worker 測試紀律**：未貼測試輸出、隱瞞失敗、或跳過環境問題，一律視為未完成。
* **Coordinator 驗收必跑測試**：每條 worker 結果匯合後，coordinator 必須立即執行該工作線的測試套件驗收。

## 產出

- 通過測試的程式碼
- 更新後的任務來源（`spec.md` Milestones 或已確認 `tasks.md`，勾選進度）
- 更新後的 `works.md`（開發日誌）
- Git commits（使用者確認後）

## 結束條件

所有 milestone 完成後，引導使用者執行 `/ddd.xreview`。
