# Source / Publish Workflow Restructure Works

## 2026-05-19

### 討論結論

- 將 AGENTS 外層 repo 定位為 source 與 local pipeline，而不是直接作為公開 pack 的日常編輯位置。
- 新 source root 為 `src/ddd-workflow/`；公開 GitHub repo working tree 為 `.publish/ddd-workflow/`，由 build 產生。
- `npx skills` 已可作為 Agent Skills 的跨 agent installer；本專案不應再自製 skills 轉檔或跨平台安裝邏輯。
- 現有 `ddd.plan` dotted skill name 不符合 Agent Skills spec 的嚴格命名描述，但 `npx skills@1.5.7` 實測可 list 與 install，因此本 sprint 暫不更名，改用 `test:pack` 作為相容性 gate。
- Agents 不是 `npx skills` 覆蓋範圍，仍需作為 source 發布；若找不到成熟 agent/subagent 轉檔 framework，就把既有轉檔邏輯整理成 publish repo 內的 `bin/` entrypoint。
- Claude statusline、OpenCode Codex usage、shared runner 等 runtime scripts 是公開 package 能力，應繼續發布，但改用 `scripts/<platform-or-shared>/` namespace。

### 已探索的現況

- `package.json` 目前以 `node scripts/build.js && node scripts/cli.js deploy` 組合 build/deploy。
- `scripts/build.js` 目前只將 `ddd-workflow/agents/*.md` 轉為 `dist/gemini/agents`、`dist/opencode/agents`、`dist/codex/agents`。
- `scripts/cli.js` 目前直接 symlink `ddd-workflow/skills`，Claude agents 也 symlink source；Gemini/OpenCode/Codex agents 則 symlink `dist/`。
- `ddd-workflow/README.md` 目前描述公開 repo 可透過 Claude plugin、Gemini extension 或手動 symlink 使用。
- `.gitignore` 已忽略 `dist/`，但尚未有 `.publish/`。

### 工具調研摘要

- `npx skills@1.5.7 add ./ddd-workflow --list` 可找到 9 個現有 `ddd.*` skills。
- `npx skills@1.5.7 add ./ddd-workflow --skill ddd.plan -a opencode --copy -y` 可成功安裝 dotted skill name。
- Agent Skills 官方 spec 文件仍寫明 `name` 僅允許 lowercase alphanumeric 與 hyphen，因此 dotted name 屬於實作相容但非 spec-pure。
- 初步搜尋到 `vsync`、`conforme`、`ai-rules-sync` 等 agent config sync 類工具，但尚未確認有像 `npx skills` 一樣成熟且可直接取代本專案 agent transpiler 的標準工具。

### 文件產出

- 建立 `docs/17-source-publish-workflow/spec.md`。
- 建立 `docs/17-source-publish-workflow/works.md`。

### 待使用者確認

- 是否接受本 sprint 範圍包含目錄遷移、publish build、skills installer 切換、agent transpiler 公開化與 script namespace 整理。
- 若 scope 過大，建議先拆成兩個 sprint：`source/publish layout` 與 `agent deploy/tooling`。

## 2026-05-20

### 討論結論

- 本 sprint 採完整 rebuild，而不是在舊 `scripts/cli.js` 與 `scripts/build.js` 上持續 patch。
- 導入 Vite/Vitest 作為 local tooling build system，建立自然的 `test -> build -> test:pack -> deploy` pipeline。
- Vite 只負責 TypeScript/JavaScript tooling 與測試，不負責 bundle Markdown、shell scripts、JSON、TOML 等 publishable content。
- `scripts/build.js` 的 agent 轉檔規則不重寫，改以 refactor 搬入 `src/tooling/agent-transpiler/`，並用 fixture + golden output 防止回歸。
- `scripts/cli.js` 的 deploy 流程重建為 `src/tooling/deploy/`，並以 fake HOME、dry-run、action contract 測試保證正確性。
- `src/ddd-workflow/` 是唯一手改 source；`.publish/ddd-workflow/` 是 build output 與 local deploy 的 dogfood source。
- 每個 module 必須有明確 contract：輸入、輸出、副作用、錯誤情境與驗證方式，不能只靠人工 smoke test。

### Module correctness 策略

- `agent-transpiler`：使用 fixture input + golden output exact compare，覆蓋 Gemini tool mapping、OpenCode permission/override、Codex TOML escaping。
- `publish`：使用 temp dir integration test 驗證 allowlist/denylist、dirty guard、force 覆蓋行為。
- `deploy`：使用 fake HOME 驗證 symlink/copy target，並要求 target 指向 `.publish/ddd-workflow/`，不可指向 `src/ddd-workflow/`。
- `skills pack validation`：用 `npx skills add .publish/ddd-workflow --list` 作為 dotted skill name 與 package layout gate。
- `runtime scripts`：保留 bash smoke tests 與 symlink resolution tests，確保 skill-local entrypoint、shared runner、adapter 路徑不斷。
- `package scripts`：用 pipeline smoke test 驗證 `pnpm test`、`pnpm build`、`pnpm test:pack`、`pnpm deploy:dry-run` 的順序與 gate。

### 文件更新

- 更新 `spec.md`，加入 Vite tooling、module layout、module contracts、ADR-7、ADR-8。
- 新增 `tasks.md`，拆出 7 個 milestones，包含 Milestone 5 的 deploy 平行工作線與匯合點。

### 待使用者確認

- 是否接受目前 `spec.md` 與 `tasks.md` 的拆分方式。
- 若確認，下一步進入 `/ddd.work`，由 coordinator 依 `tasks.md` 逐 milestone 派工實作。

### Cross Review 結果

- 執行 `/ddd.xreview`，範圍為未提交的 `docs/17-source-publish-workflow/` 文件，啟用 Docs Lens。
- Reviewer 組成：`claude:opus`、`opencode:openai/gpt-5.5`、`gemini:pro`，三者皆完成。
- 共識問題：`tools/` 目錄定位不清、agent transpile 未納入 local pipeline、skills deploy contract 不完整、Milestone 3/4 驗證順序不一致。
- 其他問題：`publish:status` / `publish:diff` module 未列入 layout、deploy 未包含 test gate、`npx skills` 版本策略未定、舊 `ddd-workflow/` 與 `subtree:*` scripts 退場不明確、scope 偏大、`vite-node` 與 `dist` 執行模式混用、`tsconfig` / shared path constants 未列入 M1。

### 使用者決策

- `tools/` 改名為 publish package 的 `bin/`，避免和 LLM tools 混淆。
- `bin/*.mjs` 採 build generated 模型：source 在 `src/tooling/bin/*`，產物注入 `.publish/ddd-workflow/bin/`。
- agent transpile 放在 build 階段，產生 `.publish/ddd-workflow/dist/{gemini,opencode,codex}/agents`。
- skills deploy 納入 `deploy-local`，由 `npx skills add .publish/ddd-workflow ...` 負責；dry-run 只列出 command。
- Milestone 3 改為 fixture/temp dir 驗證；真實完整 publish tree 驗證放到 Milestone 4/6。
- `publish:status` / `publish:diff` 補成正式 module。
- 完整 `deploy` 包含 `test`、`build`、`test:pack`、`deploy-local`。
- `npx skills` 保持追最新版，不 pin `skills@1.5.7`。
- 舊 `ddd-workflow/` source root 與 `subtree:*` scripts 在本 sprint 直接移除。
- 維持單 sprint，但在 tasks self-review 記錄 scope 風險。
- 正式 package scripts 全部跑 `dist/` entrypoint；開發期直跑 source 可另設 `dev:*`，不列主流程。
- Milestone 1 補入 `tsconfig`、shared paths constants 與 source/dist 路徑解析測試。

### 已套用修正

- 更新 `spec.md`：將 public helper 目錄從 `tools/` 改為 `bin/`；補 status/diff/deploy-skills/bin modules；補 build agent transpile 與 full deploy gate；移除 subtree legacy 保留策略。
- 更新 `tasks.md`：補 `tsconfig`、paths constants、`bin/` entrypoints、agent dist generation、skills install deploy、完整 deploy gate、舊 source root / subtree scripts 移除任務。
