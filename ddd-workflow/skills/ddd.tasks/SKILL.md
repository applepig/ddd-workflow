---
name: ddd.tasks
description: >
  任務拆解：必要時將 spec.md 的輕量 Milestones 抽出為獨立 tasks.md，處理複雜依賴、平行工作線與跨 agent 派工。
  Trigger: "break down tasks", "create a task list", "split into milestones",
  "拆任務", "建 task list", "規劃實作步驟", /ddd.tasks。
  spec.md 確認後、需要複雜執行協調時使用；簡單 sprint 直接用 spec.md Milestones 進入 /ddd.work。
---

# ddd.tasks — 任務拆解

任務拆解階段。只有當 spec.md 內的輕量 Milestones 不足以支撐執行協調時，才建立獨立 tasks.md。

<HARD-GATE>
嚴禁在 spec.md 未獲使用者確認前拆任務。
嚴禁把 tasks.md 當成每個 sprint 的必備文件。簡單 sprint 應直接回到 spec.md Milestones。
嚴禁用巨大 tasks.md 硬接過大的 scope；太複雜時必須先拆 sprint。
</HARD-GATE>

## Decision Gate

開始拆解前，先判斷是否真的需要獨立 tasks.md：

- **不需要 tasks.md**：spec.md 已有 1~3 個清楚 Milestone、沒有平行工作線、沒有複雜匯合點、task 總數約 10 個以內。此時不要產生 tasks.md，回到 spec.md 補強 Milestones 後引導 `/ddd.work`。
- **需要 tasks.md**：需要多 agent / 多 worktree 平行派工、跨模組依賴、介面先行、匯合點、或 task 上下文太長，放在 spec.md 會干擾需求閱讀。
- **需要拆 sprint**：拆解後預期超過 5 個 milestone、超過約 15 個 task、或涵蓋多個可獨立交付的子系統。此時停止產生 tasks.md，建議回到 `/ddd.plan` 或 `/ddd.spec` 拆成多個 sprint。

tasks.md 是複雜執行協調工具，不是 traceability 補丁。若只是為了避免 spec/task detach 而加很多對照欄位，優先把 tasks 留在 spec.md。

## Scope Check

若 Decision Gate 判定需要獨立 tasks.md，再檢查 spec 的範圍：

- 若 spec 涵蓋**多個獨立子系統**（例如前台 + 後台管理 + 排程服務），應先拆成多個 sprint，而不是建立一份巨大 tasks.md。
- 若 spec 過大但子系統間有強依賴，標記出來並建議使用者在 spec 層級先拆分，再回來拆任務。
- 若 spec 範圍合理（單一功能或緊密相關的功能群），直接進入拆解。

## Checklist

你必須為以下每個項目建立 task 並依序完成：

1. **讀取規格** — 讀取當前 sprint 的 spec.md，確認目標、非目標、驗收條件、邊界案例、ADR 與既有 Milestones
2. **Decision Gate** — 判定：直接用 spec.md、建立 tasks.md、或拆 sprint
3. **拆解任務** — 僅在需要 tasks.md 時，將功能拆成 milestone + task（見下方指引）
4. **撰寫 tasks.md** — 按格式寫入檔案
5. **Self-Review** — 依下方 Self-Review 清單自我檢查，修正問題
6. **任務審查** — 呈現給使用者，根據回饋調整，等待確認

## 拆解指引

- 將功能拆成 2~5 個 milestone，每個 milestone 必須是一個「可獨立交付且可測試的增量」。超過此範圍通常代表應拆 sprint。
- 每個 task 的拆解必須符合 **Agentic TDD** 限制：
  - 測試與實作分離：不要把「寫測試與實作」混在同一個 task 中，應確保測試先行 (Test-First)。
  - 原子性：每個 task 只能專注修改單一行為或模組。
- **平行評估**（必做）：對每個 milestone，列出所有 task 涉及的檔案路徑，識別不重疊的 task 群組，標記為平行工作線。詳見下方「平行工作指引」。

### Milestone 粒度指引

決定 milestone 的粒度時，考慮以下原則：

- **預期結果**：每個 milestone 必須寫明完成後的具體可觀察結果（例如：「User model 可建立、密碼可雜湊驗證」），讓驗收有明確標準。
- **可展示原則**：每個 milestone 完成後，應能向使用者展示一個可觀察的進展（例如：新 API 端點可呼叫、頁面可渲染、資料可儲存）。
- **時間範圍**：理想的 milestone 包含 2~6 個 task。太少（1 個 task）代表粒度太細不需要獨立 milestone；太多（>6 個 task）代表應再拆分。
- **依賴鏈**：milestone 之間盡量減少依賴。如果 Milestone 2 的每個 task 都依賴 Milestone 1 的全部完成，這是合理的線性依賴；但若只依賴其中一個 task，考慮重新分組。
- **風險前置**：技術風險高的部分放在前面的 milestone，這樣能早期發現問題。

### tasks.md 格式範例

**✅ 好的拆解**——測試先行、平行標記清楚、每條工作線有完整上下文卡片：
```markdown
# Tasks: 使用者登入功能

## Milestone 1: 資料層與介面契約（序列）
> 預期結果：User model 可建立與查詢、密碼可雜湊與驗證、session 可 CRUD
> 驗證方式：`vitest run server/models/ server/services/session/`
- [ ] Task 1.1: 定義 LoginRequest/LoginResponse 型別與 API 契約
- [ ] Task 1.2: 撰寫 User model 與 password hashing 測試 (Red)
- [ ] Task 1.3: 實作 User model 與 password hashing (Green)
- [ ] Task 1.4: 撰寫 session store 測試 (Red)
- [ ] Task 1.5: 實作 session store (Green)

## Milestone 2: API + 前端
> 預期結果：使用者可透過前端表單登入，取得有效 session token
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

## 平行工作指引

若功能只涉及 1–2 個檔案且 task 總數不超過 4 個，可直接標記為序列執行，跳過以下平行分析。

### 切分標準

當功能涉及多個獨立模組（例如前端 + 後端、多個獨立 API），**必須主動評估是否能平行開發**。平行切分的關鍵是：**兩條工作線不會互相修改同一個檔案**。

判斷能否平行的標準：
- ✅ 可平行：各自有獨立的檔案、獨立的測試、透過明確的介面（API contract / shared types）銜接
- ❌ 不可平行：共用相同的狀態管理、需要同時修改同一個檔案、一方的介面尚未確定

### Agentic 平行執行模式

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

### 標記格式

用 `🔀 可平行工作線` 標記可同時派發的區塊，用 `🔗 匯合點` 標記合併後的驗證步驟。每條工作線用 `[A]`、`[B]` 等字母標識。格式範例見上方「好的拆解」。

**每條工作線的 blockquote 是 worker 的上下文卡片**——`/ddd.work` 的 coordinator 會直接從這裡擷取資訊組裝 worker prompt，所以必須包含 agent 獨立作業所需的一切：

| 欄位 | 說明 | 必要性 |
|------|------|--------|
| 範圍 | 本工作線涉及的檔案/目錄路徑 | 必填 |
| 依賴 | 前置 task 或外部依賴 | 必填 |
| 介面契約 | 與其他工作線的銜接介面（types、API schema） | 有平行線時必填 |
| 驗證方式 | 完成後如何驗證——unit test 指令、E2E 步驟、或 curl 命令 | 必填 |

### 平行度決策流程

拆解 milestone 時，依序評估：

1. **列出所有 task 涉及的檔案路徑**——檔案集合不重疊的 task 群是平行候選。
2. **檢查隱性依賴**——即使檔案不重疊，是否共用 DB schema、環境變數、全域 config？
3. **確認介面契約**——平行線之間的銜接介面是否已明確定義？未定義則先序列處理。
4. **評估合併成本**——若兩條線的合併需要大量調整，平行的效益可能不如預期。
5. **決定工作線數量**——一般不超過 3 條，過多的平行線增加合併複雜度。

## Self-Review

撰寫完 tasks.md 後，以新鮮眼光對照 spec 自我檢查。這是你自己跑的 checklist，不是派 subagent。

**1. Spec 覆蓋度**：逐條掃描 spec 的目標、非目標、驗收條件、邊界案例與 ADR，每個會影響實作的項目都能在 tasks.md 中被保留或反映嗎？列出遺漏。

**2. Task 完整性掃描**：檢查是否有以下問題：
- 模糊的 task 描述（「實作登入功能」而非「撰寫 POST /auth/login endpoint 測試 (Red)」）
- 測試與實作混在同一個 task
- 缺少 Red/Green 標記
- milestone 缺少預期結果或驗證方式

**3. 依賴一致性**：平行工作線之間的介面契約是否在分線前的 task 中確立？Milestone 之間的依賴方向是否合理——後面的 milestone 是否真的依賴前面的產出？

發現問題直接修正，不需重新 review。若發現 tasks.md 只是把 spec 內容機械轉成更長的 checklist，刪除 tasks.md 草稿，回到 spec.md Milestones。

## 產出

- 需要獨立執行計畫時：`docs/<編號>-<名稱>/tasks.md`
- 不需要獨立執行計畫時：更新 `docs/<編號>-<名稱>/spec.md` 的 Milestones，不建立 tasks.md

## 結束條件

使用者確認後，引導使用者執行 `/ddd.work`。若 Decision Gate 判定需要拆 sprint，停止在規劃階段並引導回 `/ddd.plan` 或 `/ddd.spec`。
