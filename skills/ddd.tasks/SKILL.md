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
   - **平行評估**（必做）：對每個 milestone，列出所有 task 涉及的檔案路徑，識別不重疊的 task 群組，標記為平行工作線。詳見下方「平行工作切分」。

### Milestone 粒度指引

決定 milestone 的粒度時，考慮以下原則：

- **可展示原則**：每個 milestone 完成後，應能向使用者展示一個可觀察的進展（例如：新 API 端點可呼叫、頁面可渲染、資料可儲存）。
- **時間範圍**：理想的 milestone 包含 2~6 個 task。太少（1 個 task）代表粒度太細不需要獨立 milestone；太多（>6 個 task）代表應再拆分。
- **依賴鏈**：milestone 之間盡量減少依賴。如果 Milestone 2 的每個 task 都依賴 Milestone 1 的全部完成，這是合理的線性依賴；但若只依賴其中一個 task，考慮重新分組。
- **風險前置**：技術風險高的部分放在前面的 milestone，這樣能早期發現問題。

### 平行工作切分

當功能涉及多個獨立模組（例如前端 + 後端、多個獨立 API），**必須主動評估是否能平行開發**。平行切分的關鍵是：**兩條工作線不會互相修改同一個檔案**。

判斷能否平行的標準：
- ✅ 可平行：各自有獨立的檔案、獨立的測試、透過明確的介面（API contract / shared types）銜接
- ❌ 不可平行：共用相同的狀態管理、需要同時修改同一個檔案、一方的介面尚未確定

#### Agentic 平行執行模式

平行工作線不只是「標記」——在 agentic 環境中，它代表**可同時派發給多個 Agent 子行程執行**的工作單元。規劃 tasks.md 時，應以「能否被獨立 agent 自主完成」為切分依據。

**Agent 派發原則：**

1. **Worktree 隔離**：每條平行工作線在獨立的 git worktree 中執行，避免檔案衝突。Agent 完成後，變更以分支形式保留，由主行程負責合併。
2. **自足性**：每條工作線必須包含足夠的上下文（要修改哪些檔案、介面契約、測試預期），讓 agent 不需要回問就能獨立完成。
3. **介面先行**：平行工作線之間的銜接點（shared types、API contract）必須在分線前確定。若介面尚未定義，先用一個序列 task 確立介面，再分線。
4. **匯合點必測**：平行工作線合併後，必須有整合測試驗證各線的銜接正確。

**適合 Agent 平行的典型模式：**

| 模式 | 範例 | 工作線數 |
|------|------|---------|
| 前後端分離 | API + UI 各自開發 | 2 |
| 多獨立端點 | 3 個不相關的 REST endpoint | 2~3 |
| 多獨立模組 | auth module + notification module | 2 |
| 測試與 fixture | 測試資料準備 + 測試案例撰寫 | 2 |

**不適合平行的情境：**
- 工作線之間有隱性依賴（例如共用 database migration）
- 一條線的產出是另一條線的輸入（序列關係）
- 共用全域狀態（store、context、singleton）

#### tasks.md 平行標記格式

用 `🔀 可平行工作線` 標記可同時派發的區塊，用 `🔗 匯合點` 標記合併後的驗證步驟。每條工作線用 `[A]`、`[B]` 等字母標識。

**每條工作線的 blockquote 是 worker 的上下文卡片**——`/DDD.work` 的 coordinator 會直接從這裡擷取資訊組裝 worker prompt，所以必須包含 agent 獨立作業所需的一切：

| 欄位 | 說明 | 必要性 |
|------|------|--------|
| 範圍 | 本工作線涉及的檔案/目錄路徑 | 必填 |
| 依賴 | 前置 task 或外部依賴 | 必填 |
| 介面契約 | 與其他工作線的銜接介面（types、API schema） | 有平行線時必填 |
| 驗證方式 | 完成後如何驗證——unit test 指令、E2E 步驟、或 curl 命令 | 必填 |

```markdown
## Milestone 2: 使用者認證

> 📋 介面契約：LoginRequest { email, password } → LoginResponse { token, user }
> 此契約在 Task 1.x 已確立，以下兩條工作線可同時派發給獨立 Agent。

### 🔀 可平行工作線

**[A] Backend API** — `isolation: worktree`
> 範圍：`server/routes/auth/`、`server/services/auth/`
> 依賴：Task 1.x 完成的 User model
> 介面契約：POST /auth/login → LoginResponse { token, user }
> 驗證方式：`vitest run server/routes/auth/` 全過；`curl -X POST localhost:3000/auth/login -d '{"email":"test@t.com","password":"pass"}' | jq .token` 回傳 JWT
- [ ] Task 2.1: 撰寫 POST /auth/login 測試 (Red)
- [ ] Task 2.2: 實作 login endpoint (Green)

**[B] Frontend Form** — `isolation: worktree`
> 範圍：`components/auth/`、`composables/useAuth.ts`
> 依賴：LoginRequest/LoginResponse type 定義
> 介面契約：LoginForm emit `submit` 事件帶 LoginRequest payload
> 驗證方式：`vitest run components/auth/` 全過
- [ ] Task 2.3: 撰寫登入表單元件測試 (Red)
- [ ] Task 2.4: 實作登入表單元件 (Green)

### 🔗 匯合點
> 合併 [A]、[B] 分支後，在主線執行整合驗證。
> 驗證方式：`vitest run tests/integration/auth/` 全過；啟動 dev server 後手動登入流程正常
- [ ] Task 2.5: 撰寫前後端整合測試 (Red)
- [ ] Task 2.6: 串接前後端並通過整合測試 (Green)
```

#### 平行度決策流程

拆解 milestone 時，依序評估：

1. **列出所有 task 涉及的檔案路徑**——檔案集合不重疊的 task 群是平行候選。
2. **檢查隱性依賴**——即使檔案不重疊，是否共用 DB schema、環境變數、全域 config？
3. **確認介面契約**——平行線之間的銜接介面是否已明確定義？未定義則先序列處理。
4. **評估合併成本**——若兩條線的合併需要大量調整，平行的效益可能不如預期。
5. **決定工作線數量**——一般不超過 3 條，過多的平行線增加合併複雜度。

3. **撰寫 tasks.md**

   **✅ 好的拆解**——測試先行、平行標記清楚、每條工作線有完整上下文卡片：
   ```markdown
   # Tasks: 使用者登入功能

   ## Milestone 1: 資料層與介面契約（序列）
   > 驗證方式：`vitest run server/models/ server/services/session/`
   - [ ] Task 1.1: 定義 LoginRequest/LoginResponse 型別與 API 契約
   - [ ] Task 1.2: 撰寫 User model 與 password hashing 測試 (Red)
   - [ ] Task 1.3: 實作 User model 與 password hashing (Green)
   - [ ] Task 1.4: 撰寫 session store 測試 (Red)
   - [ ] Task 1.5: 實作 session store (Green)

   ## Milestone 2: API + 前端
   > 介面契約已在 M1 確立，以下可平行派發。

   ### 🔀 可平行工作線

   **[A] Backend API** — `isolation: worktree`
   > 範圍：`server/routes/auth/`、`server/services/auth/`
   > 依賴：Task 1.x 完成的 User model + session store
   > 介面契約：POST /auth/login → LoginResponse { token, user }
   > 驗證方式：`vitest run server/routes/auth/` 全過
   - [ ] Task 2.1: 撰寫 POST /auth/login endpoint 測試 (Red)
   - [ ] Task 2.2: 實作 login endpoint (Green)

   **[B] Frontend Form** — `isolation: worktree`
   > 範圍：`components/auth/`、`composables/useAuth.ts`
   > 依賴：LoginRequest/LoginResponse type 定義
   > 介面契約：LoginForm emit `submit` 帶 LoginRequest payload
   > 驗證方式：`vitest run components/auth/` 全過
   - [ ] Task 2.3: 撰寫登入表單元件測試 (Red)
   - [ ] Task 2.4: 實作登入表單元件 (Green)

   ### 🔗 匯合點
   > 驗證方式：`vitest run tests/integration/auth/` 全過
   - [ ] Task 2.5: 合併 [A]、[B] 分支，解決衝突
   - [ ] Task 2.6: 前後端整合測試 (Red → Green)
   ```

   **❌ 不好的拆解**——測試與實作混在一起、粒度太大、沒標記平行機會：
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
