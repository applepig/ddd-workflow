# Optional Tasks Workflow

## 目標

調整 DDD workflow 的文件模型，讓 `tasks.md` 從每個 sprint 必備文件改為 optional execution plan。預設由 `spec.md` 承載需求、驗收條件與輕量 Milestones；只有在需要複雜依賴、平行工作線、匯合點或跨 agent 派工時，才抽出獨立 `tasks.md`。

這次變更要解決近期觀察到的問題：`/ddd.tasks` 將 spec 轉譯成另一份任務文件後，容易和 spec 原本想做的事情 detach。若為了避免 detach 而加入大量 traceability 欄位，分離成本反而超過收益。

## 非目標

- 不移除 `/ddd.tasks` skill。
- 不取消 `works.md`；執行日誌仍應與需求文件分離。
- 不建立 heavyweight RTM（Requirements Traceability Matrix）或要求每個 task 都加 ID 對照。
- 不改 `ddd.work` 的平行 worker runner、worktree isolation 或 `DONE:` / `FAIL:` 協議。
- 不改部署流程、build 產物或 symlink 策略。

## 背景

外部實務中，requirements / user stories / acceptance criteria 與 tasks 分離很常見，但它們通常依賴工具鏈或 RTM 維持 traceability。在我們的 markdown-first agent workflow 裡，手動維護細粒度 traceability 會變成額外儀式，也容易讓文件失去協作效率。

因此新的定位是：

- `spec.md` 是每個 sprint 的主要 SSOT，包含需求與可執行的輕量 Milestones。
- `tasks.md` 是複雜執行協調工具，不是需求 traceability 的補丁。
- 若執行計畫大到需要很多 milestone/task 才能描述，優先拆 sprint，而不是加厚 `tasks.md`。

## User Story

### Story 1：使用者 review 單一主要文件

作為使用者，
我想在一般 sprint 中只 review `spec.md`，
以便需求、驗收條件與執行切片保持在同一個上下文中，不必跨文件比對。

### Story 2：Coordinator 有明確 gate 判斷 tasks 是否必要

作為 coordinator，
我想在 `/ddd.tasks` 開始時先判斷是否真的需要獨立 `tasks.md`，
以便簡單 sprint 不產生多餘文件，太大的 sprint 不被硬塞進一份巨大 execution plan。

### Story 3：複雜派工仍保留獨立 tasks.md

作為 coordinator，
我想在多 agent / 多 worktree / 平行工作線的情境保留 `tasks.md`，
以便 worker prompt 有清楚的工作線、依賴、介面契約與匯合點。

## 驗收條件

- [ ] 共用 workflow 文件明確標示 `spec.md`、`works.md` 必備，`tasks.md` optional。
- [ ] `ddd.spec` 模板包含 `Milestones` 區塊，並在結束條件引導 `/ddd.work` 或必要時 `/ddd.tasks`。
- [ ] `ddd.tasks` 開頭有 Decision Gate，能判斷：直接用 spec、建立 tasks、或拆 sprint。
- [ ] `ddd.tasks` 明確禁止用巨大 `tasks.md` 承接過大的 scope；超過複雜度門檻時應回到 plan/spec 拆 sprint。
- [ ] `ddd.work` 可從 `spec.md` Milestones 或 `tasks.md` 讀取任務來源。
- [ ] `ddd.xreview`、`ddd-developer`、`ddd-reviewer` 對任務來源的描述不再假設 `tasks.md` 必定存在。
- [ ] README 與 `ddd-workflow/references/AGENTS.md` 的流程、文件結構與核心原則同步更新。
- [ ] `npm test` 通過，確認 skill frontmatter 與部署驗證未受影響。

## 相關檔案

### 新增

- `docs/13-optional-tasks-workflow/spec.md`：本 sprint 規格。
- `docs/13-optional-tasks-workflow/tasks.md`：本 sprint 複雜執行計畫。
- `docs/13-optional-tasks-workflow/works.md`：本 sprint 工作日誌。

### 修改

- `ddd-workflow/references/AGENTS.md`：共用 DDD workflow 原則與文件結構。
- `ddd-workflow/README.md`：流程圖、文件結構與 skill 說明。
- `ddd-workflow/skills/ddd.spec/SKILL.md`：spec 模板與結束導引。
- `ddd-workflow/skills/ddd.tasks/SKILL.md`：optional tasks Decision Gate 與拆 sprint gate。
- `ddd-workflow/skills/ddd.work/SKILL.md`：任務來源改為 spec Milestones 或 tasks。
- `ddd-workflow/skills/ddd.xreview/SKILL.md`：review prompt 的任務來源描述。
- `ddd-workflow/skills/ddd.plan/SKILL.md`：spec 完成後導引。
- `ddd-workflow/skills/ddd.brainstorming/SKILL.md`：spec 完成後導引。
- `ddd-workflow/agents/ddd-developer.md`：worker 補上下文時不假設 tasks 存在。
- `ddd-workflow/agents/ddd-reviewer.md`：reviewer 讀取任務來源時不假設 tasks 存在。

## 介面/資料結構

此 sprint 不新增 runtime API。文件介面調整如下。

### spec.md Milestones

```markdown
## Milestones

### Milestone 1: <名稱>
> 預期結果：完成後可觀察到什麼
> 驗證方式：`測試指令` 或手動驗收步驟

- [ ] 撰寫/更新測試（Red）
- [ ] 實作最小功能（Green）
- [ ] Refactor 並確認測試維持通過
```

### tasks.md Decision Gate

`/ddd.tasks` 必須先產生三選一判斷：

| 判斷 | 行為 |
| --- | --- |
| 不需要 tasks.md | 回到 spec.md 補強 Milestones，引導 `/ddd.work` |
| 需要 tasks.md | 產出獨立 execution plan，供複雜協調與平行派工使用 |
| 需要拆 sprint | 停止產生 tasks.md，回到 `/ddd.plan` 或 `/ddd.spec` 拆分 scope |

## 邊界案例

### Case 1：簡單 sprint 被使用者要求執行 `/ddd.tasks`

處理：`/ddd.tasks` 不應機械產生 `tasks.md`；先說明 spec Milestones 已足夠，必要時只補強 spec，然後引導 `/ddd.work`。

### Case 2：複雜 sprint 沒有 tasks.md 就進入 `/ddd.work`

處理：`/ddd.work` 讀取 spec Milestones 後若發現有平行工作線、跨 agent 派工或複雜匯合點，應暫停並引導回 `/ddd.tasks` 產生 execution plan。

### Case 3：tasks.md 開始膨脹成大型專案計畫

處理：若拆解後超過約 5 個 milestone、15 個 task，或包含多個可獨立交付子系統，停止拆 tasks，回到 sprint 拆分。

### Case 4：既有 sprint 已有 tasks.md

處理：保留既有 tasks.md，不需要遷移；新規則只影響後續 sprint 的預設行為。

### Case 5：reviewer 或 worker 找不到 tasks.md

處理：改讀 spec.md 的 Milestones 作為任務來源；只有 tasks.md 存在時才讀取。

## ADR

### ADR-1：tasks.md 改為 optional，而不是加強 traceability matrix

**決策**：預設把輕量 task checklist 放回 `spec.md`，`tasks.md` 僅在複雜協調時建立。

**原因**：detach 的主因是需求文件被轉譯成另一份執行文件後失去原意。用更多 ID / matrix 補救會增加管理成本，且不符合 markdown-first agent workflow 的輕量目標。

**替代方案**：保留必備 tasks.md 並新增 AC/EC/ADR 對照欄位。排除原因是文件儀式過重，且使用者 review 成本更高。

### ADR-2：太複雜時拆 sprint，而不是加厚 tasks.md

**決策**：`/ddd.tasks` 必須有「需要拆 sprint」出口。

**原因**：tasks.md 的價值是協調單一 sprint 的執行，不應成為承接過大 scope 的容器。

**替代方案**：允許任意長 tasks.md。排除原因是會降低 review 品質，也增加 agent context 腐爛與派工失焦風險。

### ADR-3：保留 tasks.md 支援平行 worktree / agent 派工

**決策**：不刪除 `/ddd.tasks`，也不刪除 tasks.md 的平行工作線格式。

**原因**：多 worker 派工需要獨立上下文卡片、介面契約與匯合點；這些內容放在 spec.md 會干擾需求閱讀。

## Milestones

### Milestone 1: 文件包與規格補齊
> 預期結果：本 workflow 變更有延續編號的 sprint 文件包作為 SSOT。
> 驗證方式：檢查 `docs/13-optional-tasks-workflow/` 包含 spec/tasks/works。

- [ ] 建立 `docs/13-optional-tasks-workflow/`。
- [ ] 撰寫 `spec.md`，定義 optional tasks workflow 的目標、驗收條件與 ADR。
- [ ] 撰寫 `tasks.md`，記錄此 sprint 為何需要獨立 execution plan。
- [ ] 撰寫 `works.md`，記錄已完成的第一版修改與驗證結果。

### Milestone 2: Workflow prompt 對齊
> 預期結果：所有主要 skill/agent 文件不再假設 tasks.md 必定存在。
> 驗證方式：搜尋舊語意並確認只剩有意保留的 optional tasks 描述。

- [ ] 更新共用 AGENTS 與 README 的文件結構與流程。
- [ ] 更新 `ddd.spec`、`ddd.tasks`、`ddd.work` 的主要流程。
- [ ] 更新 `ddd.plan`、`ddd.brainstorming`、`ddd.xreview` 與 agents 的引用。

### Milestone 3: 驗證與 review
> 預期結果：部署驗證通過，使用者可 review diff 與文件包。
> 驗證方式：`git diff --check`、`npm test`。

- [ ] 執行 whitespace 檢查。
- [ ] 執行 repo test。
- [ ] 回報變更摘要與待 review 重點。
