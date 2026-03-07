---
name: DDD.Tasks
description: >
  This skill should be used when the user asks to "break down tasks",
  "create a task list", "split into milestones", "plan the implementation steps",
  or invokes "/DDD.tasks". Use after spec.md is confirmed and the feature needs
  to be decomposed into testable, incremental milestones following Agentic TDD.
---

# DDD:tasks — 任務拆解

任務拆解階段。將 spec.md 拆解為可執行、可測試的 milestone 與 task。

## 執行步驟

1. **讀取規格**
   - 讀取當前 sprint 的 `spec.md`
   - 確認所有驗收條件

2. **拆解任務**
   - 將功能拆成 2~5 個 milestone，每個 milestone 必須是一個「可獨立交付且可測試的增量」。
   - 每個 task 的拆解必須符合 **Agentic TDD** 限制：
     - 測試與實作分離：不要把「寫測試與實作」混在同一個 task 中，應確保測試先行 (Test-First)。
     - 原子性：每個 task 只能專注修改單一行為或模組。

### Milestone 粒度指引

決定 milestone 的粒度時，考慮以下原則：

- **可展示原則**：每個 milestone 完成後，應能向使用者展示一個可觀察的進展（例如：新 API 端點可呼叫、頁面可渲染、資料可儲存）。
- **時間範圍**：理想的 milestone 包含 2~6 個 task。太少（1 個 task）代表粒度太細不需要獨立 milestone；太多（>6 個 task）代表應再拆分。
- **依賴鏈**：milestone 之間盡量減少依賴。如果 Milestone 2 的每個 task 都依賴 Milestone 1 的全部完成，這是合理的線性依賴；但若只依賴其中一個 task，考慮重新分組。
- **風險前置**：技術風險高的部分放在前面的 milestone，這樣能早期發現問題。

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

使用者確認任務規劃後，引導使用者執行 `/DDD.work`。
