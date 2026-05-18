# Tasks: Optional Tasks Workflow

此 sprint 本身符合「需要獨立 tasks.md」條件：變更橫跨共用 workflow 文件、多個 skills、agents 與 README，且需要維持新規則在所有入口一致。因此保留獨立 execution plan。

## Milestone 1: 文件包與規格補齊（序列）
> 預期結果：本 workflow 變更有延續編號的 sprint 文件包作為 SSOT。
> 驗證方式：`docs/13-optional-tasks-workflow/` 包含 spec/tasks/works，且內容能解釋本次 workflow 決策。

- [x] Task 1.1: 建立 `docs/13-optional-tasks-workflow/`。
- [x] Task 1.2: 撰寫 `spec.md`，定義 optional tasks workflow 的目標、驗收條件與 ADR。
- [x] Task 1.3: 撰寫 `tasks.md`，記錄此 sprint 為何需要獨立 execution plan。
- [x] Task 1.4: 撰寫 `works.md`，記錄已完成的第一版修改與驗證結果。

## Milestone 2: Workflow prompt 對齊（序列）
> 預期結果：所有主要 skill/agent 文件不再假設 tasks.md 必定存在。
> 驗證方式：搜尋舊語意並確認只剩有意保留的 optional tasks 描述。

- [x] Task 2.1: 更新 `ddd-workflow/references/AGENTS.md` 的核心原則、文件結構與流程。
- [x] Task 2.2: 更新 `ddd-workflow/README.md` 的流程圖、文件結構與 skill 說明。
- [x] Task 2.3: 更新 `ddd.spec`，讓 spec 模板包含輕量 Milestones 並導向 `/ddd.work` 或必要時 `/ddd.tasks`。
- [x] Task 2.4: 更新 `ddd.tasks`，加入 Decision Gate 與拆 sprint gate。
- [x] Task 2.5: 更新 `ddd.work`，支援從 spec Milestones 或 tasks.md 讀取任務來源。
- [x] Task 2.6: 更新 `ddd.plan`、`ddd.brainstorming`、`ddd.xreview` 與 agents 的任務來源引用。

## Milestone 3: 驗證與 review（序列）
> 預期結果：部署驗證通過，使用者可 review diff 與文件包。
> 驗證方式：`git diff --check`、`npm test`。

- [x] Task 3.1: 執行 `git diff --check`。
- [x] Task 3.2: 執行 `npm test`。
- [ ] Task 3.3: 使用者 review 文件包與 workflow diff。
- [ ] Task 3.4: 依 review 回饋調整後再驗證。
