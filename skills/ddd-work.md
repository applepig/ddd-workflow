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

## 重要規則

* 每次只專注一個 milestone，完成後再進入下一個
* 遇到需要變更規格的情況，立即暫停，回到 `/DDD:spec` 流程
* works.md 的更新是完成 milestone 的必要條件，不是事後補充

## 產出
- 通過測試的程式碼
- 更新後的 `tasks.md`（勾選進度）
- 更新後的 `works.md`（開發日誌）
- Git commits

## 結束條件
所有 milestone 完成後，引導使用者執行 `/DDD:xwrap`。
