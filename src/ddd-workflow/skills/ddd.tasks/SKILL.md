---
name: ddd.tasks
description: >
  任務拆解：spec.md 確認後，必要時細化 Milestones、建立 optional tasks.md 作為複雜執行計畫，
  或將過大的 scope 拆成 semver-like 子編號資料夾。
  Trigger: "細化 milestones", "拆分 sprint", "break down tasks",
  "create a task list", "split into sub-sprints", /ddd.tasks。
---

# ddd.tasks — 細化 Milestones ／Optional Tasks ／拆分 Sprint

任務拆解階段。`tasks.md` 是 optional，不是每個 sprint 的必備文件；簡單 sprint 直接使用 `spec.md` Milestones。

<HARD-GATE>
嚴禁在 spec.md 未獲使用者確認前拆任務。
更新 spec.md 或建立 tasks.md 後必須停在 User Review Gate，使用者確認或明確跳過審閱後才可進入 /ddd.work。
嚴禁因為 sprint 目錄存在 legacy tasks.md 就自動把它當任務來源；必須先取得使用者確認。
嚴禁用過大的 spec 或 tasks.md 硬撐；scope 過大時必須先拆 sprint。
</HARD-GATE>

## Decision Gate

讀取 spec.md 後，先判斷下一步：

- **不需要 tasks**：Milestone 已夠清楚、沒有平行工作線、沒有複雜匯合點、task 總數約 10 個以內。不要建立 tasks.md，直接引導 `/ddd.work`。
- **在 spec.md 內細化**：需要展開少量 task、補範圍/驗證、或標記簡單平行工作線，但內容仍適合留在 spec.md。→ 更新 spec.md Milestones。
- **建立 optional tasks.md**：需要多 agent / 多 worktree 平行派工、跨模組依賴、介面先行、複雜匯合點，或 task 上下文太長，放在 spec.md 會干擾需求閱讀。→ 建立 `tasks.md`，經使用者確認後作任務來源。
- **拆分 sprint**：預期超過 5 個 milestone、超過約 15 個 task，或涵蓋多個可獨立交付的子系統。→ 拆成 semver-like 子編號資料夾。

## Checklist

1. **讀取 spec.md** — 確認目標、非目標、驗收條件、邊界案例、ADR 與既有 Milestones
2. **檢查 legacy tasks.md** — 若已存在 tasks.md，先確認它是歷史參考、要沿用，或要整合回 spec.md
3. **Decision Gate** — 判定：不需要 tasks、在 spec.md 內細化、建立 optional tasks.md、或拆分 Sprint
4. **執行** — 更新 spec.md Milestones、建立 tasks.md，或建立子 sprint 資料夾與各自的 spec.md
5. **Self-Review** — 依下方清單自我檢查，修正問題
6. **User Review Gate** — 呈現任務來源，等待確認；若建立 `tasks.md`，只有 User Review Gate 通過後才可把狀態更新為「已由使用者確認作為本 sprint 任務來源」，再引導 `/ddd.work`

## 細化 Milestones

將 spec.md 的 Milestone 就地展開為 task 列表。每個 task 遵循 Agentic TDD：測試與實作分離、原子性（一個 task 專注一個行為）。

適合條件：細化後仍容易閱讀、沒有大量 worker 上下文卡片、task 不會把 spec.md 撐成執行手冊。

### 細化後的 Milestone 格式範例

```markdown
### Milestone 2: API + 前端
> 範圍：`server/routes/auth/`、`components/auth/`
> 驗證：`vitest run server/routes/auth/ components/auth/`
> 預期結果：使用者可透過前端表單登入，取得有效 session token

#### 🔀 可平行工作線

**[A] Backend API** — `isolation: worktree`
> 範圍：`server/routes/auth/`、`server/services/auth/`
> 依賴：M1 完成的 User model + session store
> 介面契約：POST /auth/login → LoginResponse { token, user }
> 驗證：`vitest run server/routes/auth/` 全過
- [ ] 撰寫 POST /auth/login endpoint 測試 (Red)
- [ ] 實作 login endpoint (Green)

**[B] Frontend Form** — `isolation: worktree`
> 範圍：`components/auth/`、`composables/useAuth.ts`
> 依賴：LoginRequest/LoginResponse type 定義
> 介面契約：LoginForm emit `submit` 帶 LoginRequest payload
> 驗證：`vitest run components/auth/` 全過
- [ ] 撰寫登入表單元件測試 (Red)
- [ ] 實作登入表單元件 (Green)

#### 🔗 匯合點
> 驗證：`vitest run tests/integration/auth/` 全過
- [ ] 合併 [A]、[B] 分支，解決衝突
- [ ] 前後端整合測試 (Red → Green)
```

## 建立 optional tasks.md

當執行計畫太長或需要獨立協調空間時，建立 `docs/<編號>-<名稱>/tasks.md`。它只在本 sprint 被使用者確認後成為任務來源；否則只是草稿或歷史參考。

新建 `tasks.md` 的預設狀態必須是草稿／待使用者確認。User Review Gate 通過前，不得把狀態寫成已確認；通過後才可更新狀態並作為 `/ddd.work` 任務來源。

### tasks.md 格式

```markdown
# Tasks: <功能名稱>

## 任務來源

- Spec: `docs/<編號>-<名稱>/spec.md`
- 狀態：草稿，待使用者確認；確認前不得作為本 sprint 任務來源

## Milestone 1: <名稱>
> 範圍：...
> 驗證：...
> 預期結果：...

- [ ] 撰寫/更新測試 (Red)
- [ ] 實作最小功能 (Green)
- [ ] Refactor 並確認測試維持通過
```

## 平行工作指引

若 task 總數不超過 4 個且只涉及 1–2 個檔案，直接序列執行，跳過平行分析。

**切分標準**：兩條工作線不會修改同一個檔案，且透過明確介面（API contract / shared types）銜接，即可平行。反之若共用全域狀態、需要同時改同一檔案、或介面尚未確定，則不可平行。

**執行原則**：
- **Worktree 隔離**：每條平行工作線在獨立 git worktree 執行，完成後以分支保留，主行程負責合併
- **介面先行**：銜接介面必須在分線前確定；未定義則先用序列 task 確立
- **匯合點必測**：合併後必須有整合測試驗證銜接正確

**Worker 上下文卡片**：每條工作線的 blockquote 是 worker 的上下文卡片——`/ddd.work` 的 coordinator 直接擷取這裡的資訊組裝 worker prompt。必須包含：範圍（檔案/目錄路徑）、依賴（前置 task 或外部依賴）、介面契約（有平行線時必填）、驗證（完成後的驗證方式）。

## 拆分 Sprint

scope 過大時，拆成 semver-like 子編號資料夾：

```
docs/18-user-auth/          # 父 sprint：保留為索引或決策脈絡
docs/18.1-data-layer/
    └── spec.md
docs/18.2-auth-api/
    └── spec.md
docs/18.3-auth-ui/
    └── spec.md
```

拆分後，父 sprint 不再承載可執行任務。`/ddd.work`、`/ddd.xreview`、`ddd-developer`、`ddd-reviewer` 都只以各子 sprint 的 `spec.md` 或已確認的 optional `tasks.md` 作為任務來源。

## Self-Review

以新鮮眼光對照 spec 自我檢查：

1. **Spec 覆蓋度**：逐條掃描 spec 的目標、驗收條件、邊界案例，確認每項都反映在任務來源中。列出遺漏並修正
2. **Task 完整性**：檢查是否有模糊描述、測試與實作混在同一 task、缺少 Red/Green 標記、milestone 缺少預期結果或驗證方式
3. **依賴一致性**：平行工作線的介面契約是否在分線前確立？Milestone 間的依賴方向是否合理？
4. **SSOT 清楚度**：若建立 tasks.md，是否明確標示為草稿／待使用者確認？是否只有 User Review Gate 通過後才把狀態更新為已由使用者確認作為本 sprint 任務來源？spec.md 是否仍保留需求與驗收條件，而不是被 tasks.md 取代？

發現問題直接修正。若發現 tasks.md 只是把 spec 機械轉成更長的 checklist，刪除 tasks.md 草稿，維持原本的輕量 Milestones。

## 產出

- 不需要 tasks：不新增檔案，直接引導 `/ddd.work`
- spec 細化：更新 `docs/<編號>-<名稱>/spec.md` 的 Milestones
- optional tasks：建立 `docs/<編號>-<名稱>/tasks.md`
- 拆分：建立 `docs/<編號>.<子編號>-<名稱>/spec.md`

## 結束條件

使用者確認任務來源後，引導執行 `/ddd.work`。
