# 簡化 DDD 文件包格式

## 目標

將 DDD 工作流的 Sprint 文件包收斂為兩個核心檔案（spec + works），並把 `plan.md`、`research.md`、`tasks.md` 都降為可選輔助文件，降低認知負擔與文件同步成本。

## 非目標

- 不改動 `/ddd.work` 的 TDD 循環本身，或 `/ddd.xreview` 的 review 語意；但會調整 `/ddd.work` 平行 Worker orchestration 與相關 publish layout 腳本契約，使其符合新的任務來源與 coordinator 直接派工方向
- 不改動 `/ddd.fixbug`、`/ddd.e2e`、`/ddd.agent-browser`
- 不改動 `PRD.md`、`TECHSTACK.md` 等專案層級文件
- 不遷移既有 sprint 文件包（向前不強制改動）

## User Story

作為 DDD 工作流使用者，我想要更精簡的文件結構，以便減少「現在該看哪個檔案」的困惑和跨文件同步的心智負擔。

### 驗收條件

- [ ] AC1: Sprint 文件包的核心檔案只有 `spec.md` 和 `works.md`；`plan.md`、`research.md`、`tasks.md` 為可選輔助文件，不是主流程的固定產出
- [ ] AC2: `tasks.md` 只在複雜執行協調時建立，且必須經使用者確認後才可作為任務來源；簡單 sprint 直接使用 `spec.md` Milestones
- [ ] AC3: `/ddd.brainstorming` 成為 deprecated alias，遇到 brainstorming 需求時轉交 `/ddd.plan` 的 Deep Planning / Brainstorming 強度；`/ddd.plan` 探索完成後直接 invoke `/ddd.spec`；若需要留下初步筆記或 long sprint 拆分 note，可選擇寫入 `plan.md`，但不跑 Plan Self-Review 或 User Review Gate
- [ ] AC4: `/ddd.spec` 的 Milestone 格式包含範圍、驗證方式、預期結果三個欄位；範圍可填預期涉及的檔案/目錄、模組、或待探索區域，不要求規格階段精準猜出所有檔案
- [ ] AC5: `/ddd.tasks` 的職責變為：(1) 細化 `spec.md` 裡的 Milestones，(2) 必要時建立 optional `tasks.md` 作為複雜執行計畫，(3) scope 過大時將 spec 拆成 semver-like 子編號資料夾（如 `20.1-xxx/`、`20.2-xxx/`）
- [ ] AC6: `/ddd.tasks` 更新 `spec.md` 或建立 `tasks.md` 後必須停在 User Review Gate；只有使用者確認，或使用者明確表示跳過審閱直接進行，才可進入 `/ddd.work`
- [ ] AC7: `/ddd.work` 預設從 `spec.md` 讀取任務；若本 sprint 有已確認的 optional `tasks.md`，則以 `tasks.md` 作為任務來源
- [ ] AC8: `references/AGENTS.md`、`agents/ddd-developer.md`、`agents/ddd-reviewer.md`、`README.md`、`skills/ddd.xreview/SKILL.md`、`skills/ddd.xreview/references/review-lenses.md` 同步更新
- [ ] AC9: `/ddd.spec` 的 Self-Review 在格式檢查前，先做「需求完整性比對」——回溯對話紀錄，確認所有需求、約束、偏好都已記錄在 `spec.md` 中；`/ddd.brainstorming` 作為 deprecated alias 轉交 `/ddd.plan` 時，以及 `/ddd.plan` 交接給 `/ddd.spec` 前，也要確保需求、約束、偏好會帶入 spec，但不建立 `plan.md` gate
- [ ] AC10: `ddd-developer`、`ddd-reviewer`、`/ddd.xreview` 的任務來源預設為 `spec.md` Milestones；已確認的 optional `tasks.md` 可作任務來源，legacy `tasks.md` 不可未經確認就作完成度或規格一致性的判定來源
- [ ] AC11: `works.md` 明確定位為 `/ddd.work`、`/ddd.xreview`、`/ddd.fixbug` 的成果與決策紀錄；規劃階段不必產出 `works.md`
- [ ] AC12: Milestone 的「驗證方式」依專案與任務性質臨機應變，優先使用既有測試指令或可重現驗收步驟；不要求所有專案採同一種測試層級
- [ ] AC13: `/ddd.work` 平行模式不再透過舊的 skill-local runner / `work-orchestrator.sh` / `opencode-worker.sh` fan-out；Coordinator 直接派發 `ddd-developer` subagent。`agent-runner.sh` 與 `opencode.sh` 保留為 `/ddd.xreview` review fan-out 相關契約，publish layout 測試需覆蓋 symlink dereference 與 source-only test exclusion

## 相關檔案

- `src/ddd-workflow/skills/ddd.brainstorming/SKILL.md` — deprecated alias，轉交 `/ddd.plan` Deep Planning / Brainstorming
- `src/ddd-workflow/skills/ddd.plan/SKILL.md` — 整合 Deep Planning / Brainstorming，移除 plan.md gate
- `src/ddd-workflow/skills/ddd.spec/SKILL.md` — 強化 Milestone 格式
- `src/ddd-workflow/skills/ddd.tasks/SKILL.md` — 完全改寫
- `src/ddd-workflow/skills/ddd.work/SKILL.md` — 預設使用 spec.md，並支援已確認的 optional tasks.md
- `src/ddd-workflow/skills/ddd.work/scripts/work-orchestrator.sh` — 移除舊 `/ddd.work` runner symlink
- `src/ddd-workflow/skills/ddd.work/scripts/opencode-worker.sh` — 移除舊 `/ddd.work` worker adapter symlink
- `src/ddd-workflow/skills/ddd.xreview/SKILL.md` — 任務來源改為 spec.md Milestones，弱化 tasks.md
- `src/ddd-workflow/skills/ddd.xreview/references/review-lenses.md` — 任務完成度檢查改為 spec Milestones
- `src/ddd-workflow/scripts/_include/agent-runner.sh` — 保留為 `/ddd.xreview` shared runner，不再承載 `/ddd.work` fan-out
- `src/ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.sh` — 保留為 `/ddd.xreview` OpenCode review adapter
- `src/ddd-workflow/references/AGENTS.md` — 文件結構、執行流程
- `src/ddd-workflow/agents/ddd-developer.md` — 任務來源預設 spec.md，必要時使用已確認 tasks.md
- `src/ddd-workflow/agents/ddd-reviewer.md` — 任務來源預設 spec.md，必要時使用已確認 tasks.md
- `src/ddd-workflow/README.md` — 文件結構圖、工作流圖
- `src/tooling/publish/build-publish.test.js` — 驗證 publish layout 對 skill-local symlink 與 source-only test file 的處理

## 設計細節

### 新的文件結構

```
docs/
├── PRD.md
├── TECHSTACK.md
└── <編號>-<名稱>/
    ├── plan.md            # (optional) 初步筆記或 long sprint 拆分 note，不是 gate
    ├── research.md        # (optional) 技術調研筆記
    ├── spec.md            # 核心：目標、驗收條件、ADR、Milestones
    ├── tasks.md           # (optional) 複雜執行計畫，需確認後才作任務來源
    └── works.md           # 核心：work / xreview / fixbug 成果與決策紀錄
```

### Milestone 格式（預設輕量）

```markdown
### Milestone 1: <名稱>
> 範圍：預期涉及的檔案/目錄、模組、或待探索區域
> 驗證：專案合適的測試指令或可重現驗收步驟
> 預期結果：完成後可觀察到什麼
- [x] Red → Green → Refactor
```

`/ddd.tasks` 可選擇性在 `spec.md` 內展開為細粒度格式（含平行工作線 🔀、匯合點 🔗、per-task Red/Green 標記），或在內容太長時建立 optional `tasks.md`。更新後必須停在 User Review Gate；若使用者明確表示不審直接進行，才可進入 `/ddd.work`。

### Skill Chain 架構

```
/ddd.brainstorming → deprecated alias → /ddd.plan（Deep Planning / Brainstorming）
/ddd.plan          → Light / Standard / Deep 探索 → invoke /ddd.spec → spec.md
/ddd.spec          → 直接寫 spec                                  → spec.md
```

`/ddd.brainstorming` 不再維護獨立流程，而是 deprecated alias：遇到 brainstorming / greenfield / blank slate 情境時，立即轉交 `/ddd.plan` 的 **Deep Planning / Brainstorming** 強度。`/ddd.plan` 依 Light / Standard / Deep 強度調整探索深度，最後都匯入 `/ddd.spec` 做 spec 撰寫；`/ddd.spec` 是唯一的 spec 撰寫流程。

`plan.md` 不再是這條 chain 的正式產物或 gate。它只保留給兩種情境：使用者想先留下初步筆記，或 long sprint 拆分時需要暫存思路。即使寫入 `plan.md`，也不觸發 Plan Self-Review 或 User Review Gate；正式 gate 一律落在 `spec.md`。

### ddd.tasks 新職責

1. **細化 Milestones**：在 spec.md 裡展開特定 milestone 的 task 列表、標記平行工作線（🔀）和匯合點（🔗），加上 worker 上下文卡片
2. **建立 optional tasks.md**：當 task 上下文太長、需要多 agent / 多 worktree 平行協調、或放進 spec 會干擾需求閱讀時，建立 `tasks.md` 作為已確認的任務來源
3. **拆分 Sprint**：scope 過大時拆成 semver-like 子編號資料夾。例如 `18-user-auth/` 拆成 `18.1-data-layer/`、`18.2-auth-api/`、`18.3-auth-ui/`，每個子 sprint 先產出獨立 `spec.md`；`works.md` 由後續 `/ddd.work`、`/ddd.xreview`、`/ddd.fixbug` 建立或更新

拆分後，父 sprint 不再承載可執行任務；它可以保留為索引或決策脈絡，但 `/ddd.work`、`/ddd.xreview`、`ddd-developer`、`ddd-reviewer` 都只以各子 sprint 的 `spec.md` 或已確認的 optional `tasks.md` 作為任務來源。

### Self-Review 新增「需求完整性比對」

在現有的四項格式檢查（Placeholder 掃描、內部一致性、Scope 檢查、歧義檢查）之前，插入第 0 關：

> **需求完整性比對**：回溯本次對話紀錄，逐一比對使用者提出的需求、約束、偏好，確認全部已記錄在文件中。遺漏的立即補上。

適用於 `/ddd.spec` 的 Spec Self-Review。`/ddd.brainstorming` 作為 deprecated alias 轉交 `/ddd.plan` 時，以及 `/ddd.plan` 在 invoke `/ddd.spec` 前，應確保對話中的需求、約束、偏好都會進入 `spec.md`；但不建立 `plan.md` Self-Review 或 User Review Gate。邏輯是：格式再正確，漏了需求就白搭——完整性必須排在格式之前。

### ddd.work 任務來源

預設從 `spec.md` 讀取。若本 sprint 有已確認的 optional `tasks.md`，則改以 `tasks.md` 作為任務來源。平行模式的觸發條件不變：任務來源中有 🔀 標記就進入平行模式。

平行模式的 orchestration 改為 coordinator 直接派發 `ddd-developer` subagent，不再透過 `/ddd.work` skill-local `work-orchestrator.sh` / `opencode-worker.sh` 或舊 runner fan-out。`src/ddd-workflow/scripts/_include/agent-runner.sh` 仍是 `/ddd.xreview` 的 shared runner；`src/ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.sh` 仍是 `/ddd.xreview` 的 OpenCode review adapter。publish layout 測試需確保 skill-local symlink dereference 與 source-only test file exclusion 行為維持正確。

### works.md 產出責任

`works.md` 是執行與審查階段的成果紀錄，不是規劃階段的 gate。主要由三個流程更新：`/ddd.work` 記錄 milestone 實作、測試結果、技術決策與 worker 匯合；`/ddd.xreview` 記錄 review 結論、使用者決策與後續修正；`/ddd.fixbug` 記錄 bug 現象、根因、修正與驗證結果。

## 邊界案例

- **既有 sprint 有 tasks.md**：不影響檔案保存，但不得因為檔案存在就自動視為已確認任務來源。需要繼續執行的舊 sprint，必須先由使用者或 Coordinator 明確確認：沿用 `tasks.md`、或把仍有效的任務整合回 `spec.md` Milestones；確認前只能把 `tasks.md` 當歷史參考
- **Deep Planning / Brainstorming 探索過程產出大量筆記**：仍可存入 plan.md 作為參考，但不需要走 Self-Review → User Review gate

## ADR

### 決策：將 brainstorming 併入 plan，讓 spec 成為唯一 spec 撰寫流程

`/ddd.brainstorming` 改為 deprecated alias，將 greenfield / blank slate / 腦力激盪需求交給 `/ddd.plan` 的 Deep Planning / Brainstorming 強度；`/ddd.plan` 完成探索後 chain 到 `/ddd.spec`，讓 `/ddd.spec` 作為 spec 撰寫邏輯的唯一實作。

**原因**：避免模板、Self-Review、User Gate 邏輯重複，也避免維護三個產 spec 的 skill。brainstorming 與 planning 的差異是探索強度，不是產出文件或 gate 差異。

**替代方案**：保留 `/ddd.brainstorming` 的獨立流程。不選是因為它會再次產生 plan gate 與 spec chain 的重複維護成本。

### 決策：`/ddd.work` Worker orchestration 由 coordinator 直接派 subagent

`/ddd.work` 平行模式採 coordinator 直接派發 `ddd-developer` subagent，不再維護舊的 skill-local runner / `work-orchestrator.sh` / `opencode-worker.sh` fan-out。`agent-runner.sh` 與 `opencode.sh` 的 scope 收斂到 `/ddd.xreview` review fan-out。

**原因**：`/ddd.work` 的 worker prompt 需要由 coordinator 根據 spec / tasks 的任務來源、工作線上下文卡片與使用者確認即時組裝；直接派 subagent 更符合目前 agentic workflow，也避免破損 symlink 與 publish layout 混淆。

**替代方案**：保留舊 runner fan-out 並修復 symlink。不選是因為這會繼續維護與目前 `/ddd.work` SKILL.md 不一致的派工路徑。

### 決策：Milestone 預設輕量，tasks.md 保持 optional

**原因**：大多數 sprint 的 milestone 不需要 task 級別的展開。維持 spec.md 的可讀性，只在需要平行派工、複雜依賴或長上下文協調時才用 `/ddd.tasks` 細化；若細化內容太長，才建立 optional `tasks.md`。

**替代方案**：完全移除 `tasks.md` 或每個 milestone 都展開 task 列表。不選是因為前者會讓複雜協調失去獨立空間，後者會增加 spec.md 的篇幅和維護成本。

### 決策：拆 sprint 用 semver-like 子編號資料夾

**原因**：保持 `<編號>-<名稱>/` 的命名慣例，子編號（18.1、18.2）清楚表達從屬關係和執行順序。這裡借用 semver 的階層感，但不代表完整套用 software versioning 語義。

**替代方案**：同一資料夾下多個 spec 檔案（spec-1.md、spec-2.md）。不選是因為 works.md 無法區分哪個 spec 的日誌，而且違反「一個文件包 = 一個 sprint」的 SSOT 原則。

## Milestones

### Milestone 1: brainstorming deprecated alias + plan 移除 plan.md gate
> 範圍：`skills/ddd.brainstorming/SKILL.md`、`skills/ddd.plan/SKILL.md`
> 驗證：閱讀 SKILL.md，確認 `/ddd.brainstorming` 是 deprecated alias 並轉交 `/ddd.plan` Deep Planning / Brainstorming；`/ddd.plan` 探索完直接 chain 到 /ddd.spec；若留下 plan.md，也只作初步筆記或 long sprint 拆分 note
> 預期結果：brainstorming 不再維護獨立產 spec 流程；plan.md 只是可選參考；交接給 /ddd.spec 前完成需求完整性摘要檢查
- [x] Red → Green → Refactor

### Milestone 2: 強化 spec Milestone 格式 + 清理 tasks.md 參考
> 範圍：`skills/ddd.spec/SKILL.md`、`skills/ddd.work/SKILL.md`、`skills/ddd.work/scripts/work-orchestrator.sh`、`skills/ddd.work/scripts/opencode-worker.sh`、`scripts/_include/agent-runner.sh`、`skills/ddd.xreview/scripts/adapters/opencode.sh`、`src/tooling/publish/build-publish.test.js`
> 驗證：閱讀 SKILL.md，確認 Milestone 模板有三個新欄位、範圍欄位允許模組或探索範圍、ddd.work 預設使用 spec.md 並可使用已確認的 optional tasks.md；確認 ddd.work 平行模式由 coordinator 直接派 `ddd-developer` subagent；確認舊 ddd.work symlink 已移除、agent-runner/opencode adapter scope 屬於 xreview；執行 publish layout 相關快速測試
> 預期結果：spec 模板含範圍/驗證/預期結果；ddd.work 預設從 spec.md 讀任務，複雜 sprint 可讀已確認的 tasks.md；平行 worker 由 coordinator 直接派工；Spec Self-Review 含需求完整性比對
- [x] Red → Green → Refactor

### Milestone 3: 改寫 ddd.tasks
> 範圍：`skills/ddd.tasks/SKILL.md`
> 驗證：閱讀 SKILL.md，確認新職責為細化 Milestones、必要時建立 optional tasks.md、以及拆分 Sprint；更新 spec.md 或 tasks.md 後停在 User Review Gate
> 預期結果：ddd.tasks 預設更新 spec.md，複雜協調時可產出已確認的 tasks.md，scope 過大時拆分 semver-like 子編號資料夾；使用者確認或明確跳過審閱後才可進入 /ddd.work
- [x] Red → Green → Refactor

### Milestone 4: 同步 AGENTS.md、agents、README、xreview
> 範圍：`references/AGENTS.md`、`agents/ddd-developer.md`、`agents/ddd-reviewer.md`、`README.md`、`skills/ddd.xreview/SKILL.md`、`skills/ddd.xreview/references/review-lenses.md`
> 驗證：全文搜尋 `tasks.md`、`plan.md` gate 相關字眼，確認已更新、移除、或明確標為 optional / legacy 參考
> 預期結果：所有文件與新的文件結構和流程一致；`works.md` 被描述為 work / xreview / fixbug 的成果紀錄；xreview 與 reviewer 只使用 `spec.md` 或已確認的 optional `tasks.md` 判定任務完成度
- [x] Red → Green → Refactor
