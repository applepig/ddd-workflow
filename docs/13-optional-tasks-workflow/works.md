# Works — Optional Tasks Workflow

## 2026-05-15

### 背景與決策

- 一開始嘗試直接修改 workflow prompt，把 `tasks.md` 改成 optional。
- 使用者指出這個 workflow 變更比看起來複雜，應留下完整文件包並延續既有 sprint 編號。
- 檢查 `docs/` 後，目前最高編號為 `12-shared-agent-runner`，因此建立 `docs/13-optional-tasks-workflow/`。
- 決定此 sprint 本身保留獨立 `tasks.md`，因為變更橫跨多個 skills、agents、README 與共用 AGENTS，符合「複雜執行協調」條件。

### 已完成修改

- 更新 `ddd-workflow/references/AGENTS.md`：`tasks.md` 改為 optional，`spec.md` 與 `works.md` 為每個 sprint 必備。
- 更新 `ddd-workflow/README.md`：流程圖加入「需要獨立 tasks？」判斷，skill 表格改為 spec 或 tasks 確認後進入 work。
- 更新 `ddd-workflow/skills/ddd.spec/SKILL.md`：模板新增 `Milestones`，User Review Gate 預設導向 `/ddd.work`，必要時才導向 `/ddd.tasks`。
- 更新 `ddd-workflow/skills/ddd.tasks/SKILL.md`：新增 Decision Gate，區分不需要 tasks、需要 tasks、需要拆 sprint。
- 更新 `ddd-workflow/skills/ddd.work/SKILL.md`：任務來源改為 `spec.md` Milestones 或 `tasks.md`。
- 更新 `ddd-workflow/skills/ddd.xreview/SKILL.md`、`ddd.plan`、`ddd.brainstorming`、`ddd-developer`、`ddd-reviewer`：不再假設 tasks.md 必定存在。

### 驗證

- `git diff --check` 通過。
- `npm test` 通過：Claude / Gemini / Codex / OpenCode 的 skill frontmatter、agents frontmatter、部署 symlink 與 opencode tui config 驗證皆通過。

### 待 review

- Decision Gate 的門檻目前是約略值：1~3 個 Milestone、約 10 個 task 以內不需要 tasks；超過 5 個 Milestone、約 15 個 task 或多個可獨立交付子系統時拆 sprint。
- 需要確認 `spec.md` 同時承載 Milestones 是否會讓規格過長；若是，可再調整為更輕的「Execution Notes」格式。
- 需要確認既有 `/ddd.work` 在沒有 tasks.md 時是否要有更強的前置檢查，避免複雜 spec 直接進入實作。
