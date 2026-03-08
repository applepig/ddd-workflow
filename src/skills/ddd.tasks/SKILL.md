---
name: DDD.Tasks
description: >
  將 spec.md 拆解為 milestone + task checklist，產出 tasks.md。
  Use when the user says "break down tasks", "create a task list", "split into
  milestones", "plan the implementation steps", or invokes "/DDD.tasks".
  Use after spec.md is confirmed and the feature needs to be decomposed into
  testable, incremental milestones following Agentic TDD.
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

### 平行工作切分

當功能涉及多個獨立模組（例如前端 + 後端、多個獨立 API），應考慮是否能平行開發。平行切分的關鍵是：**兩條工作線不會互相修改同一個檔案**。

判斷能否平行的標準：
- ✅ 可平行：各自有獨立的檔案、獨立的測試、透過明確的介面（API contract / shared types）銜接
- ❌ 不可平行：共用相同的狀態管理、需要同時修改同一個檔案、一方的介面尚未確定

若適合平行，在 tasks.md 中用標記區分工作線：

```markdown
## Milestone 2: 使用者認證

### 🔀 可平行工作線

**[A] Backend API**
- [ ] Task 2.1: 撰寫 POST /auth/login 測試 (Red)
- [ ] Task 2.2: 實作 login endpoint (Green)

**[B] Frontend Form**
- [ ] Task 2.3: 撰寫登入表單元件測試 (Red)
- [ ] Task 2.4: 實作登入表單元件 (Green)

### 🔗 匯合點
- [ ] Task 2.5: 撰寫前後端整合測試 (Red)
- [ ] Task 2.6: 串接前後端並通過整合測試 (Green)
```

3. **撰寫 tasks.md**

   **✅ 好的拆解**——測試先行、每個 task 只改一件事：
   ```markdown
   # Tasks: 使用者登入功能

   ## Milestone 1: 資料層
   - [ ] Task 1.1: 撰寫 User model 與 password hashing 測試 (Red)
   - [ ] Task 1.2: 實作 User model 與 password hashing (Green)
   - [ ] Task 1.3: 撰寫 session store 測試 (Red)
   - [ ] Task 1.4: 實作 session store (Green)

   ## Milestone 2: API + 前端（可平行）
   ### [A] Backend
   - [ ] Task 2.1: 撰寫 POST /auth/login endpoint 測試 (Red)
   - [ ] Task 2.2: 實作 login endpoint (Green)
   ### [B] Frontend
   - [ ] Task 2.3: 撰寫登入表單元件測試 (Red)
   - [ ] Task 2.4: 實作登入表單元件 (Green)
   ### 匯合
   - [ ] Task 2.5: 前後端整合測試 (Red → Green)
   ```

   **❌ 不好的拆解**——測試與實作混在一起、粒度太大：
   ```markdown
   ## Milestone 1: 登入功能
   - [ ] Task 1.1: 建立 User model 並寫測試
   - [ ] Task 1.2: 實作完整的登入 API 和前端頁面
   ```

4. **任務審查**
   - 將 tasks.md 呈現給使用者
   - 根據回饋調整粒度和順序，直到使用者明確同意

## 產出

`docs/<編號>-<名稱>/tasks.md`

## 結束條件

使用者確認任務規劃後，引導使用者執行 `/DDD.work`。
