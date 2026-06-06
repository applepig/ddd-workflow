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
- `publish`：使用 temp dir integration test 驗證 allowlist/denylist、dirty warning guard 行為。
- `deploy`：使用 fake HOME 驗證 symlink/copy target，並要求 target 指向 `.publish/ddd-workflow/`，不可指向 `src/ddd-workflow/`。
- `skills pack validation`：用 `npx skills add ./.publish/ddd-workflow --list` 作為 dotted skill name 與 package layout gate。
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
- skills deploy 納入 `deploy-local`，由 `npx skills add ./.publish/ddd-workflow ...` 負責；dry-run 只列出 command。
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

## 2026-05-25

### Brainstorming 討論結論：Milestones / Tasks

- Milestone 1 起採新架構作為主線：`pnpm test` 直接切為 Vitest 主入口，舊 `scripts/cli.js test` 不再佔據主流程。
- Vite build 採多 entrypoint 輸出，產生 `dist/tooling/**.mjs`；避免新版 tooling router 再變成大雜燴。
- `package.json` 需宣告 `packageManager` 使用 pnpm，讓文件、lockfile、scripts contract 一致。
- Agent transpiler golden fixtures 使用真實 agents 的複製版，而不是 live source 直測；root `dist/` 只放 Vite tooling，平台 agent output 只生成到 `.publish/ddd-workflow/dist/{gemini,opencode,codex}/agents`。
- `.publish/ddd-workflow` 定義為外層 Git ignore 的 managed checkout，不是真 submodule；`publish:init` 負責 clone/設定 remote，`build` 缺 checkout 時 fail。
- `gemini-extension.json` 是 Gemini CLI extension manifest，需作為 publish source 搬到 `src/ddd-workflow/` 並同步到 publish repo root。
- Skill 自帶 shell entrypoint 是 skill package contract 的一部分。source 層可在 `src/ddd-workflow/_runtime/` 共用 shell lib/template，但 publish build 必須產生 skill-local `scripts/**` 實體檔。
- Package-level runtime scripts 與 skill-owned runtime 分流：非 skill-owned runtime 部署到 `~/.config/ddd-workflow/runtime/` 或平台指定位置；user-editable config 仍在 `~/.config/ddd-workflow/` root，例如 `xreview.json`。
- `~/.config/ddd-workflow/` 採分區模型：`xreview.json` 等 config copy-if-missing，`runtime/**` 為 generated runtime 可同名覆蓋，`state/**` 保留給未來 manifest/deploy metadata。
- Full deploy 的 skills 安裝維持交給 `npx skills`；publish tree 內 skill runtime 必須是實體檔，讓 `npx skills` 安裝後不依賴 symlink。
- 新 build/deploy pipeline 明確禁止 publish tree 內出現 symlink；generated deploy output 也不建立 symlink。
- `pnpm deploy` 預設實際部署並寫入 HOME；`pnpm deploy:dry-run` 提供無副作用檢查。
- README / CLAUDE.md 中舊 subtree 主流程需完全移除；歷史脈絡只保留在本 sprint works.md。

### 已套用修正

- 更新 `spec.md`：補 managed checkout、M1 test 主線、pnpm package manager、no-symlink publish、skill-owned runtime build、`~/.config/ddd-workflow/` 分區、Gemini manifest、M6/M7 決策。
- 更新 `tasks.md`：調整 M1/M2/M3/M4/M5/M6/M7 tasks，反映 real-agent fixtures、publish-only agent dist、`_runtime/` source-only input、skill-local built runtime、copy-based deploy、no-symlink 驗證與 legacy subtree 文件移除。

## 2026-05-26

### xreview 修正

- **Worktree 路徑約定不一致**：將目前有效設定、skill 文件、xreview opencode adapter 與既有文件中的 worktree 目錄統一為 `.worktree/`，並同步更新 `.gitignore`。

### 第一波 scope 修正

- 使用者確認 `~/Dropbox/projects/ddd-authoring/` 是本 sprint 遷移目標；AGENTS 原 worktree 切回 `dev`，`ddd-authoring` 使用 `feat/17-source-publish-workflow`。
- 第一波實作範圍包含 `scripts/build.js` 與 `scripts/cli.js` 的核心能力遷移到 Vite tooling pipeline。
- 暫緩的「其他 scripts refactor」限於 `./scripts` 其他工具程式，例如 `claude-r`、subtree status、hook setup；不包含 build/deploy 主線。
- 已建立 baseline empty commits：AGENTS `dev` 為 `chore: mark agents baseline`，`ddd-authoring` 為 `chore: mark ddd-authoring baseline`。

### 第一波實作結果

- 將舊 `ddd-workflow/` 搬到 `src/ddd-workflow/`，並將 package-level runtime scripts 分到 `scripts/claude/`、`scripts/opencode/`、`scripts/shared/`。
- 將舊 `scripts/build.js` 搬成 `src/tooling/agent-transpiler/agent-transpiler.js`，並新增 Vite entrypoint `src/tooling/bin/transpile-agents.js`。
- 建立 `src/tooling/publish/build-publish.js`，可從 `src/ddd-workflow/` 重建 `.publish/ddd-workflow/`，保留 `.git`，跳過 `_runtime/`，將 source symlink materialize 成 publish 實體檔，並產生 `.publish/ddd-workflow/dist/{gemini,opencode,codex}/agents`。
- 建立 `src/tooling/deploy/deploy-local.js` 與 `src/tooling/bin/deploy-agents.js`。第一波 deploy contract 改為 action planner：skills 交給 `npx skills`，non-skill files 採 copy / copy-if-missing，`--dry-run` 只列動作。
- 移除舊 `scripts/cli.js` 主流程入口，並將 `package.json` 收斂到 `pnpm test`、`pnpm run build`、`pnpm run test:pack`、`pnpm deploy:dry-run`。
- 更新 root `README.md` 與 `CLAUDE.md`，移除 subtree / symlink deploy 作為主流程的描述。

### 驗證結果

- `pnpm test`：通過，8 個 test files、132 個 tests。
- `pnpm run build`：通過，Vite 產出 `dist/tooling/**`，publish builder 產出 `.publish/ddd-workflow` 與 platform agent dist。
- `pnpm run test:pack`：通過，`npx skills add ./.publish/ddd-workflow --list` 成功找到 9 個 skills。
- `pnpm deploy:dry-run`：通過，完整串起 `test -> build -> test:pack -> deploy-local --dry-run`，只輸出 action list。
- `find .publish/ddd-workflow -type l -ls`：無輸出，確認 publish tree 沒有 symlink。

### 尚未完成

- `publish:init`、`publish:status`、`publish:diff` 尚未重建成正式 tooling module；目前 `publish:status` / `publish:diff` 仍是 package script 直接呼叫 Git。
- `_runtime/` template 化尚未建立；第一波先用 publish builder materialize source 層 symlink，達成 publish no-symlink。
- Deploy 的 uninstall、manifest/state 與完整 fake HOME e2e 尚未完成；第一波完成 action planner 與 dry-run gate。
- `./scripts` 其他工具程式仍保留，依使用者指示不在第一波重構。

### Remote branch 與 fake HOME deploy check

- 已將 `feat/17-source-publish-workflow` 推到 GitHub remote branch `ddd-authoring`，並設定 upstream 為 `ddd-workflow/ddd-authoring`。
- 新增 `deploy-local --home-dir <path>` 與 `--skip-skills`，讓 non-skill deploy 可套用到 fake HOME。
- 新增 `pnpm deploy:check`，會寫入 `/tmp/ddd-workflow-deploy-check` 並跳過 `npx skills` 安裝。
- 新增 `src/tooling/deploy/deploy-local.test.js`，驗證 fake HOME copy output、no-symlink、copy-if-missing config、dry-run 無副作用與 CLI args。
- `pnpm deploy:check`：通過，測試 9 files / 136 tests，全流程 build 後成功寫入 `/tmp/ddd-workflow-deploy-check`。
- `find /tmp/ddd-workflow-deploy-check -type l -ls`：無輸出，確認 fake HOME output 沒有 symlink。

## 2026-05-29

### xreview 修正同步

- 從 AGENTS `dev` 的 `fix(xreview): route gpt reviewers through codex` 同步實質 xreview 行為修正到 `ddd-authoring` source。
- 更新 `src/ddd-workflow/config/xreview.json`：`5.x` 與 `5.5` alias 改為 `codex:gpt-5.5`。
- 更新 `src/ddd-workflow/skills/ddd.xreview/references/cli-adapters.md`：說明 OpenCode adapter 仍可明確指定完整 `opencode:*` spec，但 GPT 5 系列預設 alias 由 `xreview.json` 決定，可能指向 Codex 或其他 CLI。
- 未照搬 AGENTS 舊 layout 的 runner symlink path；`ddd-authoring` 仍維持 `scripts/shared/agent-runner.sh` namespace。

### Publish checkout 試串

- 用 `gh repo view applepig/ddd-workflow` 確認 publish repo 為 `https://github.com/applepig/ddd-workflow`，default branch 為 `main`。
- 將 `.publish/ddd-workflow/` 初始化為 nested Git checkout，remote `origin` 指向 `https://github.com/applepig/ddd-workflow`。
- 建立本機 branch `publish/17-source-publish-workflow`，以 `origin/main` 作為 base；尚未 commit、尚未 push。
- `pnpm run publish:status` 現在可正確顯示 nested publish repo 的 diff。

### Publish flow 驗證結果

- `pnpm run build`：在 publish checkout 有未提交 diff 時會列出 dirty warning 並繼續同步，符合後續降級決策；日常 publish branch diff 不再阻塞 build。
- `pnpm run build && pnpm run publish:status && pnpm run test:pack && node dist/tooling/deploy/deploy-local.mjs --dry-run`：通過，可作為目前手動試串流程。
- `pnpm run test:pack`：通過，`npx skills add ./.publish/ddd-workflow --list` 找到 9 個 skills。
- `deploy-local --dry-run`：通過，只列出 `npx skills` command 與 copy actions，不寫入 HOME。

### 待補缺口

- 需要正式 `publish:init` tooling，避免手動 Git init / fetch / reset 流程散落在 shell 指令。
- `publish:refresh` 保留為明確重建 publish diff 的便利 script，但 dirty checkout 不再分兩種 build 模式；`build` 預設 warning 後繼續。
- `publish:status` / `publish:diff` 仍是 package script 直接呼叫 Git，尚未重建為 tested tooling module。
- `pnpm deploy:dry-run` 目前仍會先跑 `pnpm run build`；dirty checkout 只會 warning，不再阻塞完整 deploy dry-run。

### Milestone 3.5 / 3.6 實作結果

- 新增 `src/tooling/publish/init-publish.js`，提供 `publish:init` tooling entrypoint；預設 repo 為 `https://github.com/applepig/ddd-workflow`，預設 branch 為 `publish/17-source-publish-workflow`，並支援 `--repo`、`--branch`、`--base`。
- 新增 `src/tooling/publish/status.js` 與 `src/tooling/publish/diff.js`，由 dist entrypoint 執行 nested publish checkout 的 `git status --short --branch` 與 `git diff --stat`；缺 checkout 時提示先執行 `pnpm run publish:init`。
- 更新 `package.json`：新增 `publish:init`、`publish:refresh`，並將 `publish:status` / `publish:diff` 改為 `node dist/tooling/publish/*.mjs`。
- 更新 `vite.config.js`：新增 `publish/init-publish`、`publish/status`、`publish/diff` Rollup input，讓 `pnpm run build:tooling` 產生對應 dist entrypoint。
- 更新 `build-publish`：缺少 managed publish checkout 時明確 fail，避免 `pnpm run build` 自動建立或覆蓋非 managed 目錄。
- 新增 Vitest 覆蓋：非空非 Git 目錄 fail、既有 Git checkout 不清空且可補 origin、status/diff 缺 checkout fail、package scripts contract、Vite entrypoint contract。

### Coordinator 驗收

- `pnpm test`：通過，12 個 test files、142 個 tests。
- `pnpm run build:tooling`：通過，產生 `dist/tooling/publish/init-publish.mjs`、`status.mjs`、`diff.mjs` 與既有 tooling entrypoints。
- `pnpm run publish:status`：通過，顯示 nested publish checkout branch `publish/17-source-publish-workflow` 與目前 publish diff。
- `pnpm run publish:diff`：通過，顯示 publish diff stat。
- `pnpm run publish:refresh`：通過，重建 `.publish/ddd-workflow/`，保留 nested Git checkout。
- `pnpm run test:pack`：通過，`npx skills add ./.publish/ddd-workflow --list` 找到 9 個 skills。
- `node dist/tooling/deploy/deploy-local.mjs --dry-run`：通過，只列出技能安裝 command 與 copy actions，未寫入 HOME。

### Publish Package PR 準備

- 更新 `src/ddd-workflow/README.md`，移除舊 Claude plugin / Gemini extension / manual symlink 安裝說明，改為 `npx skills` 安裝、`bin/` entrypoints、agents build/deploy 與 runtime scripts 說明。
- 修正 publish package public bin output：`build-publish` 會一併複製 Vite generated `chunks/` 與 `deploy/` runtime，避免 `bin/*.mjs` 在公開 repo 缺相對 import。
- 調整 Vite 設定，不再 externalize `gray-matter`，讓 `bin/transpile-agents.mjs` 可在沒有 publish `node_modules` 的公開 package 中執行。
- `pnpm test`：通過，12 個 test files、143 個 tests。
- `pnpm run publish:refresh`：通過。
- `pnpm run test:pack`：通過，`npx skills add ./.publish/ddd-workflow --list` 找到 9 個 skills。
- 在 `.publish/ddd-workflow` 執行 `node bin/transpile-agents.mjs`：通過。
- 在 `.publish/ddd-workflow` 執行 `node bin/deploy-agents.mjs --dry-run`：通過。
- `find .publish/ddd-workflow -type l -print`：無輸出，確認 publish tree 沒有 symlink。
- 掃描 `.publish/ddd-workflow/**/*.mjs`：沒有 external `gray-matter` import。
- `.publish/ddd-workflow/node_modules` 不存在，確認 public bin 驗證未依賴 publish-local dependencies。
- `.publish/ddd-workflow` commit：`782dc5c feat: publish source workflow package`。
- 已 push branch `publish/17-source-publish-workflow` 到 `applepig/ddd-workflow`。
- 已建立 GitHub PR：`https://github.com/applepig/ddd-workflow/pull/15`。

### Self-contained Public Bin 修正

- 決策：publish package 的 public `bin/*.mjs` 應為 self-contained script；authoring `dist/tooling` 可以保留 Vite/Rollup shared chunks，但 `.publish/ddd-workflow` 不應發布 `chunks/` 或 `deploy/` runtime 目錄。
- 更新 `build-publish`：publish 階段改為針對 `bin/transpile-agents.mjs`、`bin/deploy-agents.mjs` 逐支以 Vite programmatic build 打包，關閉 code splitting，Node builtins external，其餘 dependency bundle 進各自 script。
- 調整 direct-run guard：`agent-transpiler.js` 與 `deploy-local.js` 只在原始檔直接執行時觸發，避免 bundle 進 public bin 後誤觸內部 CLI guard。
- `pnpm test`：通過，12 個 test files、143 個 tests。
- `pnpm run publish:refresh`：通過。
- `pnpm run test:pack`：通過，`npx skills add ./.publish/ddd-workflow --list` 找到 9 個 skills。
- 在 `.publish/ddd-workflow` 執行 `node bin/transpile-agents.mjs`：通過。
- 在 `.publish/ddd-workflow` 執行 `node bin/deploy-agents.mjs --dry-run`：通過。
- `.publish/ddd-workflow/chunks`、`.publish/ddd-workflow/deploy`、`.publish/ddd-workflow/node_modules` 均不存在。
- 掃描 `.publish/ddd-workflow/bin/*.mjs`：沒有 `../chunks`、`../deploy` 或 external `gray-matter` import。

## 2026-05-31

### Milestone 8: Deploy Manifest（Build / Deploy Lock）

#### 設計決策

- 仿 `npx skills` 的 `skills-lock.json`（`computedHash` SHA-256）自建 deploy lock 機制，涵蓋 skills 以外的 agents、config、scripts、references、policies、plugins。
- 兩份分離的 manifest：build manifest 在 `.publish/ddd-workflow/.build-manifest.json`，deploy manifest 在 `~/.config/ddd-workflow/deploy.json`（machine-local，不進 git）。
- `config:xreview` 標記 `strategy: "copy-if-missing"`，target 已存在時無條件 skip，不比 hash。
- Orphan detection：deploy manifest 有但 build manifest 沒有的 unit → 移除 target。
- Stale build gate：deploy 前重算 sourceTreeHash，與 build manifest 不一致時擋住。

#### 實作結果

- 新增 `src/tooling/manifest/build-manifest.js`：6 個 exported 函式（computeFileHash、computeDirectoryHash、computeSourceTreeHash、computeUnitHash、discoverUnits、generateBuildManifest）。
- 新增 `src/tooling/manifest/deploy-manifest.js`：6 個 exported 函式（readBuildManifest、readDeployManifest、diffManifests、writeDeployManifest、buildDeployManifest、checkStaleBuild）。
- 修改 `src/tooling/publish/build-publish.js`：在 assertNoSymlinks 之後產生 `.build-manifest.json`。
- 修改 `src/tooling/deploy/deploy-local.js`：新增 `runManifestAwareDeploy()` 整合 stale check → diff → deploy → write manifest；direct-run block 改用此函式。
- Unit keys 涵蓋：skill、agent（claude/gemini/opencode/codex）、config、script（claude/opencode/shared）、reference、policy、plugin。

#### 驗證結果

- `pnpm test`：通過，14 個 test files、217 個 tests。
- 整合測試 4 個 scenario：首次 deploy 安裝所有 units、第二次無變更全部 skip、修改 source 後只更新變更 unit、stale build gate 擋住。
- 新增測試數：build-manifest 39 個、deploy-manifest 19 個、deploy-local 整合 15 個。

## 2026-06-01

### XReview 修正：Deploy Manifest 實際副作用

#### 問題確認

- Critical：`runManifestAwareDeploy()` 只記錄 manifest diff，沒有實際處理 `action=remove` 的 orphaned unit，導致 managed target 殘留。
- Critical：只要有任一 changed unit，實作仍呼叫 `planDeploy()` + `applyDeployActions()` 全量 deploy，造成 `skip` unit 仍被覆寫。
- Important：`resolveUnitTarget()` 用 `source.includes(file_hint)` 猜 target，跨平台同名 agent 可能把 Gemini/OpenCode/Codex target 記成 Claude target。
- Important：`computeSourceTreeHash()` 只收一般檔案，忽略 source tree symlink metadata，symlink retarget 不會觸發 stale build gate。

#### 實作結果

- `deploy-local` 的 copy actions 補上 precise `unit` key；`resolveUnitTarget()` 先用 exact unit match，並保留 deterministic fallback 給已知 unit target。
- `runManifestAwareDeploy()` 改為 selective apply：只套用 `install` units；`skip` units 不動；`remove` units 依 deploy manifest 中既有 `target` 刪除 managed file 並清理 manifest entry。
- `remove` 安全邊界：忽略 `null` 與 `npx-skills` target；目前只對 manifest 明確記錄的 file target 使用 `rmSync(..., { force: true })`，不擴大處理目錄。
- `copy-if-missing config` 維持 target 已存在時 skip，不覆寫使用者檔案；manifest 可保留 `skipped: true`。
- `dry-run` 維持只 log diff / copy / remove 動作，不寫 deploy manifest、不修改 HOME。
- `computeSourceTreeHash()` 與 directory hash 納入 symlink path + link target metadata；source-only `_runtime/` skip 行為維持既有測試保護。

#### 測試結果

- Red phase：`pnpm test -- src/tooling/deploy/deploy-local.test.js src/tooling/manifest/build-manifest.test.js` 預期失敗 4 個案例：跨平台 target mapping、changed deploy 不應覆寫 skipped target、orphan target 刪除、symlink retarget hash。
- Green phase：同一目標測試通過，14 個 test files、221 個 tests。
- Full validation：`pnpm test` 通過，14 個 test files、221 個 tests。

#### 尚未執行

- 本次 xreview 修正未執行 `pnpm run build`、`pnpm run test:pack`、`pnpm deploy:dry-run`；目前僅完成 Vitest 層驗證。

### XReview 漏網修正：同一 unit 多 deploy targets

#### 問題確認

- `reference:AGENTS.md` 是單一 build/deploy unit，但實際 deploy 會複製到多個平台 target：Claude `~/.claude/CLAUDE.md`、Gemini `~/.gemini/GEMINI.md`、Codex `~/.codex/AGENTS.md`。
- 前次修正雖改為 exact `action.unit` mapping，但 deploy manifest 仍只記錄第一個 target，導致 orphan removal 只能刪除第一個 target，其餘平台 reference target 會殘留。

#### 實作結果

- Deploy manifest 保留 `target` 作為第一個 / 主要 target，讓單 target unit 維持簡單讀法。
- 同一 unit 若對應多個 copy actions，manifest 額外寫入 `targets: string[]`，例如 `reference:AGENTS.md` 會記錄 Claude/Gemini/Codex 三個 managed targets。
- `applyRemoveActions()` 改為同時支援舊 manifest 的 `target` string 與新 manifest 的 `targets` array；會去重後刪除所有 managed file targets，並繼續忽略 `null` / `npx-skills`。

#### 測試結果

- Red phase：`pnpm test -- src/tooling/deploy/deploy-local.test.js src/tooling/manifest/build-manifest.test.js src/tooling/manifest/deploy-manifest.test.js` 預期失敗 1 個案例：`reference:AGENTS.md` manifest 缺少 `targets`。
- Green phase：同一指定測試通過，14 個 test files、222 個 tests。

#### 尚未執行

- 本次漏網修正未執行完整 `pnpm test`、`pnpm run build`、`pnpm run test:pack`、`pnpm deploy:dry-run`；目前依使用者要求完成相關 Vitest 驗證。

### Coordinator 補驗證

- `pnpm test`：通過，14 個 test files、222 個 tests。
- `pnpm run build`：`build:tooling` 通過；publish checkout 有本 sprint 未提交 diff 時列出 dirty warning 後仍同步 `.publish/ddd-workflow`。
- `pnpm run publish:refresh`：通過，重建 `.publish/ddd-workflow`，產生最新 `.build-manifest.json` 與 public bin。
- `pnpm run test:pack`：通過，`npx skills add ./.publish/ddd-workflow --list` 找到 9 個 skills。
- `node dist/tooling/deploy/deploy-local.mjs --dry-run`：通過，只列出 manifest diff 與 copy / command 動作，未寫入 deploy manifest 或 HOME。

## 2026-06-03

### Hotfix：agent-runner.sh 路徑解析 bug

#### 問題確認

- **症狀**：xreview orchestrator 對所有 reviewer 回報 `XREVIEW_ERROR: unknown cli`，三個 reviewer 全部 FAIL。
- **預期行為**：orchestrator 應正確找到 adapter scripts（claude.sh、codex.sh、gemini.sh、opencode.sh）。
- **影響範圍**：xreview 完全無法運作；work orchestrator 的 worker script fallback 路徑也同樣壞掉（但測試透過 `DDD_AGENT_RUNNER_WORKER_SCRIPT` env var 繞過）。

#### 根因分析

- **根因**：`get_runner_file()` 使用 `readlink -f` 解析 symlink，得到 `scripts/_include/agent-runner.sh` 的絕對路徑。`get_xreview_script_dir()` 再從該路徑用 `../skills/ddd.xreview/scripts` 導航——但實際需要兩層 `../../`（因為 migration 把 runner 從 `scripts/` 搬到 `scripts/_include/`）。部署後 materialize 成 copy 則更糟：resolved path 就是 `skills/ddd.xreview/scripts/` 本身，`../skills/...` 嵌套成不存在路徑。
- **舊版 AGENTS 能跑**：runner 在 `ddd-workflow/scripts/agent-runner.sh`（一層），`../skills/...` 正確。migration 加了 `_include/` 一層但沒更新相對路徑。
- **受影響位置**：3 處（`get_runner_file:64`、`get_xreview_script_dir:69`、work mode worker path:228`）。

#### 修復內容

- `get_runner_file()`：移除 `readlink -f`，改用 `cd dirname + pwd` 返回 invocation path 的絕對路徑。不解析 symlink，dirname 直接對應 skill-local scripts 目錄。
- `get_xreview_script_dir()`：移除相對路徑導航 `../skills/ddd.xreview/scripts`，改為 `dirname "$runner_file"`（invocation 目錄本身就是 xreview scripts dir）。
- Work mode worker path：從 `dirname/$runner_file/../skills/ddd.work/scripts/` 改為 `dirname/$runner_file/opencode-worker.sh`（worker 跟 orchestrator 在同目錄）。

#### 未修項目

- **gemini.sh:45 policy path**：`$script_dir/../../../../policies/ddd.xreview.toml` 在 publish repo 正確（4 層到 package root），但部署後 policies 位於 `~/.gemini/policies/` 而非 `.agents/policies/`。這是部署結構問題，與 symlink 解析無關，列為獨立 issue。

#### 測試結果

- **Shell tests**：148 passed, 0 failed（修復前 94 pass / 48 fail）。
- **Vitest**：14 test files, 222 tests passed。
- **Build + deploy**：`pnpm run build -- --force` 通過（dirty guard 已降級為 warning，`--force` 不再是必要條件），部署後 xreview orchestrator 成功 START 三個 reviewer。

### XReview 修正：publish hygiene、manifest scope、OpenCode config、statusline 安全性

#### 使用者決策

- Runtime / shell / skill 測試檔為 authoring-only，集中搬到外層 `tests/ddd-workflow/...`。
- `src/ddd-workflow/` 不放 `*.test.*` / `*.spec.*`，`.publish/ddd-workflow/` 也不得包含測試檔。

#### 修復內容

- 將 `src/ddd-workflow/**/{*.test.js,*.test.sh}` 搬到 `tests/ddd-workflow/...`，保留原路徑結構並調整 import / shell source path。
- `vitest.config.js` 納入 `tests/**/*.test.{js,ts}`，新增 Vitest shell wrapper，讓 `pnpm test` 正式執行 shell tests。
- `syncPublishTree()` 新增 publish hygiene，保留 `scripts/_include/agent-runner.sh`，但排除 `*.test.*` / `*.spec.*` artifacts。
- `runManifestAwareDeploy()` 寫 deploy manifest 時只記錄本次 deploy scope 內的 units；target-specific deploy 不再把其他平台 agents 記成 deployed，`--skip-skills` 不再寫入 skill units。
- OpenCode TUI config 改為 `copy-if-missing-config`，`config:opencode-tui` 加入 target exists check 與 build manifest copy-if-missing strategy。
- `statusline.sh` 移除 raw input log 預設值，僅在 `STATUSLINE_INPUT_LOG=/path` opt-in 時寫入；`parseUsageResponse()` 對進入 `eval` 的 `resets_at` 使用 jq `@sh` quote；raw input log jq 加上 `-n` 修正 opt-in 寫入。
- `deploy-agents.js` / `planDeploy()` 對 Gemini/OpenCode/Codex generated agent dist 加 preflight，缺 `dist/{target}/agents` 時 fail 並提示 `npm run agents:build`；Claude 不需要 generated dist。
- 更新 `skills/ddd.xreview/references/cli-adapters.md`，改為 authoring `pnpm deploy` / `pnpm deploy:dry-run`、public `npm run agents:build` + `npm run agents:deploy -- opencode`、copy-based deploy、OpenCode `mode: all`。

#### 驗證結果

- Red phase：targeted tests 預期失敗 10 個案例，涵蓋 OpenCode config 覆寫、manifest false deployed、缺 dist preflight、publish test artifact、statusline raw log 預設與 shell tests。
- Green phase targeted：`pnpm vitest run src/tooling/deploy/deploy-local.test.js src/tooling/publish/build-publish.test.js tests/ddd-workflow/scripts/claude/statusline.test.js tests/ddd-workflow/shell-tests.test.js` 通過，4 test files / 44 tests。
- Full validation：`pnpm test` 通過，15 test files / 236 tests。
- `pnpm run publish:refresh`：通過，重建 `.publish/ddd-workflow/`。
- Publish hygiene：`src/ddd-workflow/**/*.test.*`、`src/ddd-workflow/**/*.spec.*`、`.publish/ddd-workflow/**/*.test.*`、`.publish/ddd-workflow/**/*.spec.*` 均無檔案。
- `pnpm run test:pack`：通過，`npx skills add ./.publish/ddd-workflow --list` 找到 9 個 skills。
- `node dist/tooling/deploy/deploy-local.mjs --dry-run`：通過，列出 manifest diff 與 copy / command 動作，未寫入 deploy manifest 或 HOME。

### Coordinator 驗收缺口修正：scoped diff 與 publish manifest ignore

#### 問題確認

- `runManifestAwareDeploy()` 寫 deploy manifest 時已過濾 scope 外 units，但 `diff` / `has_changes` 仍基於 build manifest 全部 units，造成 target-specific deploy 第二次仍被 Gemini/OpenCode/Codex units 判定有 changes。
- `include_skills: false` 時，skill units 仍會讓 scoped deploy 永遠顯示 `has_changes: true`。
- `.publish/ddd-workflow/.build-manifest.json` 是 generated local state，但 publish `.gitignore` 未忽略，`publish:refresh` 後會污染 publish PR status。

#### 修復內容

- `runManifestAwareDeploy()` 先建立 deploy actions / scope，再將 `diffManifests()` 結果過濾為 scoped diff；log、`has_changes`、apply、回傳 diff 與 manifest 寫入皆使用 scoped diff。
- scope 判斷保留 orphan removal 所需 fallback：即使 build unit 已移除、plan action 不存在，仍可依 unit key 與本次 `targets` / `include_skills` 判斷是否屬於本次 deploy scope。
- `writePublishGitignore()` 保留既有 `dist/`、`node_modules/`，並新增 `.build-manifest.json`。

#### 驗證結果

- Red phase：targeted tests 預期失敗 3 個案例：target-specific second deploy、`--skip-skills` second deploy、publish `.gitignore` 缺 `.build-manifest.json`。
- Green phase：`pnpm vitest run src/tooling/deploy/deploy-local.test.js src/tooling/publish/build-publish.test.js` 通過，2 test files / 38 tests。
- Full validation：`pnpm test` 通過，15 test files / 239 tests。
- `pnpm run publish:refresh`：通過。
- `.publish/ddd-workflow` 內 `git status --short`：沒有 `?? .build-manifest.json`。

### Coordinator 驗收修正：預設 shell test 過重

#### 問題確認

- 使用者回報 `pnpm test` 停在 `tests/ddd-workflow/shell-tests.test.js 6/7`，看起來像 deadloop 或 shell 測試過重。
- `shell-tests.test.js` 重複執行 `adapters.test.sh` 與四個 per-CLI adapter tests；其中 `adapters.test.sh` 已經 source 並執行四個 per-CLI suite。
- 預設 `pnpm test` 還把完整 `xreview-orchestrator.test.sh` 納入第 7 個 shell test，該 suite 是長跑整合測試，不適合每次主測試入口都跑。

#### 修復內容

- 預設 `pnpm test` 只跑 statusline shell test 與 adapter runner，保留 shell 行為測試 gate 但移除重複與長跑項目。
- 新增 `pnpm run test:shell:full`，透過 `DDD_WORKFLOW_FULL_SHELL_TESTS=1` 額外執行完整 `xreview-orchestrator.test.sh` suite。

#### 二次修正

- 再次量測後確認 `adapters.test.sh` 單獨耗時約 14.6 秒，仍不適合作為 preflight unit test。
- `pnpm test` 改為 exclude `tests/ddd-workflow/shell-tests.test.js`，只跑 JS/TS unit tests。
- 新增 `pnpm run test:shell` 跑預設 shell 行為測試；`pnpm run test:shell:full` 跑含完整 xreview orchestrator 的長跑 shell suite。

#### 三次修正

- 使用者確認 preflight 應該只跑真正 unit test；runtime / shell-adjacent tests 不應混在 `pnpm test`。
- `pnpm test` 透過 `DDD_WORKFLOW_TEST_SCOPE=preflight` 將 Vitest include 收斂為 `src/**/*.test.{js,ts}`，只掃 tooling unit / contract tests。
- 新增 `pnpm run test:runtime` 跑 `tests/ddd-workflow/**/*.test.js`（不含 shell wrapper），保留 runtime JS 測試但不拖慢 preflight。
- `test:runtime` / `test:shell` 同樣改用 `DDD_WORKFLOW_TEST_SCOPE` 由 Vitest config 控制 include，避免 CLI glob filter 行為造成找不到測試。

#### 驗證結果

- `pnpm test`：通過，10 test files / 206 tests，5.19 秒。
- `pnpm run test:runtime`：通過，4 test files / 26 tests，4.54 秒。
- `pnpm run test:shell`：通過，1 test file / 2 tests，17.27 秒；確認為非 preflight 長跑 shell suite。

### Coordinator 驗收修正：測試命名重新分組

#### 問題確認

- 使用者指出 `test` 周邊命名越切越亂，應回到語意清楚的三層：typical、preflight、full。

#### 修復內容

- `pnpm run test:preflight`：只跑關鍵路徑測試，涵蓋 package scripts、shared paths、Vite entrypoints、manifest、deploy、publish builder。
- `pnpm test`：跑 typical case，也就是一般 JS/TS unit / contract / runtime tests，但不跑 shell wrapper。
- `pnpm run test:full`：跑所有 Vitest tests，並透過 `DDD_WORKFLOW_FULL_SHELL_TESTS=1` 納入完整 xreview orchestrator shell suite。
- 移除 `test:runtime`、`test:shell`、`test:shell:full` 三個臨時命名，避免分組語意繼續發散。
- `deploy` / `deploy:dry-run` / `deploy:check` 的前置測試改用 `pnpm run test:preflight`，避免部署前 gate 跑 typical suite。

#### 驗證結果

- `pnpm run test:preflight`：通過，7 test files / 104 tests，3.57 秒。
- `pnpm test`：通過，14 test files / 232 tests，5.91 秒。
- `pnpm run test:full`：通過，15 test files / 235 tests，90.64 秒；確認完整 shell suite 只存在於 full gate。

## 2026-06-04

### 文件修正：publish dirty guard 降級

#### 決策確認

- 使用者確認阻塞式 dirty guard 太干擾日常 authoring / deploy dry-run，因此行為已降級為 warning 後繼續同步。
- `.publish/ddd-workflow` 是 generated publish checkout；未提交 publish diff 是常態工作狀態，不應讓 `pnpm run build` 每次都停在同一個 gate。
- 安全檢查改放在 publish PR 前：使用 `pnpm run publish:status` / `pnpm run publish:diff` 檢查最終 diff，再於 `.publish/ddd-workflow/` 內 commit / push。

#### 文件同步

- 更新 `spec.md` 驗收條件、module contract、邊界案例與 Milestone 3，將舊的阻塞式 guard 描述改為「dirty warning 後繼續同步」。
- 更新 `tasks.md` Milestone 3 驗證方式與 Task 3.3，對齊目前 `guardCleanPublish()` 測試行為。
- 更新本檔早期 publish flow 紀錄，避免 review 繼續引用已淘汰的雙模式 build 契約。

## 2026-06-05

### Deploy 補齊：session-trigger crontab 與 Claude statusLine

#### 決策確認

- `reference/` 屬於 local checkout / ignored reference 資料，不納入本次遷移與 commit 範圍。
- 舊 `scripts/cli.js` 的 `session-trigger` crontab 管理是 deploy 行為，應搬到新 `deploy-local` pipeline，而不是只複製 `session-trigger.mjs`。
- Claude Code `~/.claude/settings.json` 的 `statusLine.command` 也是 deploy 產物的一部分；外層 authoring deploy 可直接覆蓋，public package 的內層 deploy 則在既有不同 `statusLine` 時以互動確認決定是否覆蓋，非 TTY 模式保守 skip。

#### 實作結果

- `planRuntimeDeploy()` 新增 `crontab` action，安裝 managed block：`# BEGIN AGENTS session-trigger` / cron line / `# END AGENTS session-trigger`。
- crontab 指向 deployed runtime：`~/.config/ddd-workflow/runtime/shared/session-trigger.mjs`；dry-run 不寫，已正確時 skip，舊 unmanaged `session-trigger.mjs` line 會被替換。
- `planClaudeDeploy()` 新增 `claude-settings` action，確保 `~/.claude/settings.json` 的 `statusLine` 指向 `bash "$HOME/.claude/scripts/statusline.sh"`，並保留其他 settings 欄位。
- `runManifestAwareDeploy()` 即使 `session-trigger.mjs` 或 `statusline.sh` manifest 判定 unchanged，也會 idempotent ensure crontab / settings，避免環境狀態漏修。
- `bin/deploy-agents` 對 public package deploy 啟用互動覆蓋保護；非 TTY 不阻塞且不覆蓋既有不同 statusLine。

#### 驗證結果

- `pnpm test -- src/tooling/deploy/deploy-local.test.js`：通過，14 test files / 247 tests。
- `pnpm run build:tooling`：通過；僅有既有 `gray-matter` direct eval warning。

### Hotfix：deploy 前置 test:pack 未套用 npx -y

#### 問題描述

- 症狀：`pnpm run deploy` 在 skills package 尚未被 `npx` 安裝或 cache 時，會先於 `test:pack` 階段出現互動安裝提示，導致 deploy-local 內的 `npx -y skills add ...` 還沒執行就被卡住。
- 預期行為：deploy pipeline 的每個 `npx skills` 入口都應能在非互動情境自動同意 npx package 安裝。
- 影響範圍：外層 authoring repo 的 `pnpm run deploy` 與 `pnpm run test:pack`；deploy-local 的正式 skills install command 原本已有 `-y`，不受影響。

#### 根因分析

- 根因：`package.json` 的 `test:pack` 使用 `npx skills add ./.publish/ddd-workflow --list`，缺少給 `npx` 的 `-y`；`pnpm run deploy -y` 的額外參數也不會補進內層 `pnpm run test:pack`。
- 定位過程：比對 `package.json` deploy pipeline 與 `planSkillsInstall()`，確認卡點發生在 deploy-local 前置 gate，而不是 deploy-local 的 skills install action。
- 受影響檔案：`package.json`、`src/tooling/package-scripts.test.js`。

#### 修復內容

- 修了什麼：將 `test:pack` 改為 `npx -y skills add ./.publish/ddd-workflow --list`，並新增 package script contract test 防止回歸。
- 測試：先新增 Red test 確認現況缺 `npx -y` 會失敗，再套用最小修復。
- 驗證結果：`pnpm vitest run src/tooling/package-scripts.test.js` 通過，3 tests；`pnpm run test:pack` 通過，成功列出 9 個 skills；`pnpm run test:preflight` 通過，7 test files / 119 tests；`pnpm run deploy:dry-run` 通過，確認完整 deploy pipeline 會先以 `npx -y` 跑 `test:pack`，deploy-local dry-run 也列出 `npx -y skills add ...`。

### Hotfix 後續：skills 改為 authoring devDependency

#### 決策確認

- 使用者確認 `skills` 已是 authoring pipeline 的正式工具，不應每次透過 `npx` 即時解析版本與安裝提示。
- `skills` 改列 `devDependencies`，由 `pnpm-lock.yaml` 固定版本；公開 repo 使用者仍可用 `npx skills add applepig/ddd-workflow` 安裝。
- 本機 `test:pack` 改用 repo-local `skills` binary；`deploy-local` 改用 `pnpm exec skills`，避免再依賴 `npx -y`。

#### 修復內容

- `pnpm add -D skills` 安裝 `skills@1.5.10`，更新 `package.json` 與 `pnpm-lock.yaml`。
- `test:pack` 改為 `skills add ./.publish/ddd-workflow --list`。
- `planSkillsInstall()` 改為 `pnpm exec skills add ...`，dry-run 顯示 repo-local CLI command。
- deploy manifest skill target sentinel 從 `npx-skills` 改為 `skills-cli`；remove 邏輯保留舊 `npx-skills` 過濾，避免既有 manifest 被誤當檔案路徑刪除。
- 同步更新 `spec.md`、`tasks.md`、root `README.md` 與 `CLAUDE.md` 的本機 pipeline 描述。

#### 驗證結果

- `pnpm vitest run src/tooling/package-scripts.test.js src/tooling/deploy/deploy-local.test.js src/tooling/manifest/deploy-manifest.test.js`：通過，3 test files / 68 tests。
- `pnpm run test:pack`：通過，使用 repo-local `skills add ./.publish/ddd-workflow --list` 成功列出 9 個 skills。
- `pnpm run deploy:dry-run`：通過，preflight 7 test files / 120 tests，dry-run 顯示 `pnpm exec skills add ...`，未執行實際 HOME 寫入。

## 2026-06-07

### Sprint 17 收尾

#### Task 4.4/4.5 取消

- Task 4.4（建立 `_runtime/` shared shell lib）與 Task 4.5（重建 skill-owned runtime output）標記取消。
- 原因：build 已在 M3 實現 source → publish 實體檔同步，M5 的 deploy 也已切為 copy 模式。目前 skill runtime scripts（`ddd.work/scripts/`、`ddd.xreview/scripts/`）由 build 直接從 source 同步到 publish tree，不需要額外的 source-only shared shell lib 抽象層。
- 若未來 skill runtime scripts 之間出現重複邏輯需要共用，再另開 sprint 處理。

#### 同步更新

- `references/AGENTS.md`：開發原則精煉——把四條改為五條更精確的描述（加 Root Cause First、拆分 YAGNI）。
- `ddd.agent-browser/SKILL.md`：歸檔為速查格式，移除過時的教學式內容。
- `ddd.xreview/SKILL.md`：加強 step 5——coordinator 必須先讀取 reviewer reports、回報驗證後結果，才用 Question Tool 發問。
- `agent-runner.test.js`：同步 `npx` → `pnpm exec` 斷言。
