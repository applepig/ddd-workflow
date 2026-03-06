# Skill: DDD:tasks

## 說明
任務拆解階段。將 spec.md 拆解為可執行、可測試的 milestone 與 task。

## 觸發指令
`/DDD:tasks`

## 輸入
已確認的 `spec.md`。

## 執行步驟

1. **讀取規格**
   - 讀取當前 sprint 的 `spec.md`
   - 確認所有驗收條件

2. **拆解任務**
   - 將功能拆成 2~5 個 milestone，每個 milestone 必須是一個「可獨立交付且可測試的增量」。
   - 每個 task 的拆解必須符合 **Agentic TDD** 限制：
     - 測試與實作分離：不要把「寫測試與實作」混在同一個 task 中，應確保測試先行 (Test-First)。
     - 原子性：每個 task 只能專注修改單一行為或模組。

3. **撰寫 tasks.md**
   ```markdown
   # Tasks: <功能名稱>

   ## Milestone 1: <名稱>
   - [ ] Task 1.1: 撰寫 XXX 相關測試 (Red)
   - [ ] Task 1.2: 實作 XXX 使測試通過 (Green)

   ## Milestone 2: <名稱>
   - [ ] Task 2.1: ...
   ```

4. **任務審查**
   - 將 tasks.md 呈現給使用者
   - 根據回饋調整粒度和順序，直到使用者明確同意

## 產出
`docs/<編號>-<名稱>/tasks.md`

## 結束條件
使用者確認任務規劃後，引導使用者執行 `/DDD:work`。
