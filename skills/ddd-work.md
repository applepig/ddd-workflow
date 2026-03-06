# Skill: DDD:work

## 說明
開發執行階段。以 TDD 循環逐一完成 tasks.md 中的 milestone。

## 觸發指令
`/DDD:work [milestone 編號]`

不指定編號時，從第一個未完成的 milestone 開始。

## 輸入
已確認的 `tasks.md`，以及對應的 `spec.md` 作為驗收參考。

## 執行步驟

### 每個 Milestone 的循環：

1. **鎖定範圍**
   - 讀取 tasks.md，確認當前 milestone 的所有 task
   - 讀取 spec.md 中對應的驗收條件

2. **TDD 開發循環（Red → Green → Refactor）**
   - **Red**：根據驗收條件撰寫測試案例（Vitest / Playwright）
   - **Green**：撰寫程式碼直到測試通過
   - **Refactor**：最佳化程式碼結構，確保測試維持通過

3. **自我驗收**
   - 執行所有相關測試，確認全部通過
   - 檢查是否符合 spec 中的驗收條件

4. **更新文件**
   - `tasks.md`：勾選已完成的 task（`- [x]`）
   - `works.md`：記錄本次 milestone 的技術決策與問題解決

5. **回報使用者**
   - 展示完成的功能與測試結果
   - **等待使用者確認後才 commit**
   - 嚴禁自動提交，測試通過不等於提交授權

6. **提交**
   - 使用者同意後，執行 git commit（Conventional Commits 格式）
   - 繼續下一個 milestone，或全部完成時結束

## 核心防呆限制 (Agentic Constraints)

* **Red State Check**：寫完測試後必須先執行，**確認看到預期的測試失敗（Fail）**，才准進入實作階段。
* **No Logic Leaks**：嚴禁在撰寫測試的階段（Red）偷寫任何業務邏輯。
* **No Test Modification**：在實作階段（Green），**絕對禁止修改測試檔案**來讓測試通過。
* **Refactor Guard**：若重構導致原本通過的測試失敗，必須立即 **Undo（撤回）**，禁止在錯誤的基礎上疊加修補（打地鼠）。
* **Atomic Validation**：遇到測試報錯時，必須分析錯誤訊息，嚴禁盲目重試或猜測。
* **規格同步**：若發現規格有誤或需要變更，立即暫停開發，回到 `/DDD:spec`。
* **日誌更新**：`works.md` 必須記錄技術決策，不可事後敷衍。

## 產出
- 通過測試的程式碼
- 更新後的 `tasks.md`（勾選進度）
- 更新後的 `works.md`（開發日誌）
- Git commits

## 結束條件
所有 milestone 完成後，引導使用者執行 `/DDD:xwrap`。
