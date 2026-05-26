# Source / Publish Workflow Restructure

## 目標

重新整理 AGENTS 專案的開發、發布與部署邊界，將日常 authoring 移到 `~/Dropbox/projects/ddd-authoring/` worktree。AGENTS worktree 回到一般專案資料與文件位置；`ddd-authoring` worktree 則承接 ddd-workflow source、local pipeline 與 publish workflow。公開的 `ddd-workflow` GitHub repo 由 build 產生，避免目前 `ddd-workflow/` subtree、`dist/`、deploy symlink 三者責任交疊造成同步遺漏。

新的工作模式以 Vite 作為本機 tooling build system。Vite 不負責 bundle Markdown 或 shell scripts；它只負責 TypeScript/JavaScript tooling、Vitest、以及可重複的 build/test/publish/deploy pipeline。Markdown、shell、JSON、TOML 等 publishable content 仍以檔案同步方式原樣進入公開 repo。

新的工作模式：

```text
~/Dropbox/projects/ddd-authoring/   # feat/17-source-publish-workflow worktree
src/ddd-workflow/                  # ddd-authoring 內唯一手改 publishable source
  -> pnpm run build                 # Vite build tooling + 產生公開 repo working tree
.publish/ddd-workflow/              # GitHub publish repo，外層 Git ignore
  -> npx skills / bin/*             # 使用者或本機 deploy 產生平台輸出
~/.claude / ~/.config/opencode / ... # 實際部署結果
```

本 sprint 同時要收斂三個分類決策：

- Skills 採用 Agent Skills 標準目錄，安裝與跨 agent 路徑交給 Vercel `npx skills`。
- Agents 仍作為公開 source 發布；第一波直接遷移既有 `scripts/build.js` 的 agent transpiler 規則到 Vite tooling 管線的 `src/tooling/agent-transpiler/`，再由 build 產生公開 repo 內的 `bin/` entrypoint。
- Skill-owned runtime scripts 是 skill package contract 的一部分。source 層可在 `src/ddd-workflow/_runtime/` 共用 shell lib/template；publish build 必須產生 skill-local 實體檔到 `skills/<skill>/scripts/**`，不可依賴 symlink 或跨 skill/runtime 目錄。
- Package-level runtime scripts（例如 Claude statusline、OpenCode Codex usage、session trigger）屬於公開 package 的一部分，保留在公開 repo 的 `scripts/` 下並改成清楚 namespace；部署時放到 `~/.config/ddd-workflow/runtime/` 或平台要求的位置。

## 非目標

- 不在本 sprint 更名 `ddd.plan`、`ddd.work` 等 dotted skill name；只加入驗證以監控 `npx skills` 相容性。
- 不建立 GitHub Actions 或遠端 CI/CD；本 sprint 只做 `package.json` 驅動的 local pipeline。
- 不解決未來外部 contributor 是否應對 source repo 或 publish repo 發 PR 的政策；目前先假設 publish repo 可由 maintainer 發布。
- 不把 `dist/gemini`、`dist/opencode`、`dist/codex` 這類平台 agent 產物 commit 到公開 repo。
- 不改 DDD workflow 的產品行為、slash command 語意或 coordinator/developer/reviewer 角色分工。
- 本 sprint 會移除舊 `ddd-workflow/` source root 與 `subtree:*` scripts，不保留作為 legacy 主流程。
- 不把 Vite 引入為 runtime dependency；Vite 只屬於本機 build/test tooling。
- 本 sprint 不重構 `./scripts` 下與第一波 pipeline 無關的其他工具程式；`scripts/build.js` 與 `scripts/cli.js` 屬於第一波必遷移範圍，`scripts/claude-r/`、`scripts/subtree-status.mjs`、`scripts/setup-githooks.mjs` 等另行處理。

## 背景

目前專案同時有：

- `ddd-workflow/`：subtree，兼具日常 source 與公開 repo 內容。
- `scripts/build.js`：只處理 `ddd-workflow/agents/*.md`，輸出 `dist/{gemini,opencode,codex}/agents`。
- `scripts/cli.js`：負責 global deploy，skills 直接 symlink source，agents 對 Claude symlink source、對其他平台 symlink `dist/`。
- `package.json`：同時含 deploy、test、subtree push/pull/status。

前述結構的主要問題是 source、publish repo、generated dist 和 deployed state 沒有清楚分層。尤其 `ddd-workflow/` 既是內層 Git/subtree，也是日常編輯區，容易忘記同步 subtree 或在錯誤層級修改。另一方面，若未來公開 repo 只放 Claude-compatible 原始檔，Gemini/OpenCode/Codex 使用者仍需要轉檔能力；但 skills 已可交給 `npx skills`，不應再自製 skill deploy/transpile。

## User Story

### Story 1：Maintainer 只編輯 source

作為 ddd-workflow maintainer，
我想只在 `src/ddd-workflow/` 手改 skills、agents、scripts、config 與 references，
以便外層 Git 成為唯一 source history，不再同時維護 nested/subtree Git 狀態。

### Story 2：公開 repo 是乾淨可安裝 package

作為 ddd-workflow 使用者，
我想 clone 或透過 `npx skills add applepig/ddd-workflow` 安裝公開 repo，
以便不用理解 AGENTS 外層雜物間也能取得 skills、agents source 與必要 runtime scripts。

### Story 3：非 skill 項目仍可部署

作為多 agent CLI 使用者，
我想讓 agents、instruction files、OpenCode plugin、Claude statusline 等非 skill 項目仍有清楚的 deploy 工具，
以便 `npx skills` 不涵蓋的部分不會被遺漏。

### Story 4：本機 pipeline dogfood 公開 package

作為 maintainer，
我想本機 deploy 從 `.publish/ddd-workflow/` 執行，
以便測到的行為與公開 repo 使用者取得的內容一致。

## 驗收條件

- [ ] 新增 `src/ddd-workflow/` 作為 publishable source，包含 `skills/`、`agents/`、`scripts/`、`config/`、`policies/`、`references/`、`.claude-plugin/`、`gemini-extension.json`、`README.md`、`LICENSE`；同時包含 source-only 的 `_runtime/`，但 `_runtime/` 不得原樣進入 publish repo。
- [ ] `.publish/ddd-workflow/` 作為 generated publish repo working tree，外層 `.gitignore` 忽略 `.publish/`，但 `.publish/ddd-workflow/.git` 可保留公開 repo remote。
- [ ] `.publish/ddd-workflow/` 是外層 Git ignore 的 managed checkout；`publish:init` 明確 clone/設定 publish remote，`pnpm run build` 若 checkout 不存在則 fail 並提示先 init。
- [ ] `pnpm run build` dirty-check 後權威重建 `.publish/ddd-workflow/` 內容，保留 `.git`，但在 `.publish/ddd-workflow` 有未提交變更時預設 fail，需明確 force 才可覆蓋。
- [ ] 導入 Vite / Vitest 作為 local tooling pipeline，`pnpm test`、`pnpm build`、`pnpm test:pack`、`pnpm deploy` 的順序與責任清楚。
- [ ] Milestone 1 起 `pnpm test` 即為 Vitest 主入口，`package.json` 明確宣告 `packageManager` 使用 pnpm；舊 `scripts/cli.js test` 不再佔據主流程。
- [ ] 每個新 module 都有明確 contract 測試：輸入、輸出、副作用、錯誤情境與 dry-run 行為可被測試驗證。
- [ ] build 不複製外層 `docs/`、`reference/`、`.opencode/`、`dist/` 或 local-only 檔案到 publish repo。
- [ ] publish repo 內的 generated platform outputs（如 `dist/`）被 publish repo 自己的 `.gitignore` 忽略。
- [ ] publish repo 不包含任何 symlink；所有 installable output 都是實體檔。
- [ ] `npx skills add ./.publish/ddd-workflow --list` 可找到所有 `ddd.*` skills，作為 dotted skill name 與 Agent Skills CLI 相容性 gate。
- [ ] skills deploy 改由 `npx skills` 負責；publish tree 內的 skill-local `scripts/**` 必須是 build 後實體檔，`deploy-local` 會呼叫 `npx skills add ./.publish/ddd-workflow ...`，dry-run 只列出 command、不執行。
- [ ] agents 以 canonical source 放入 publish repo；既有 agent 轉換規則被 refactor 成 `src/tooling/agent-transpiler/`，並由 build 產生 publish repo 內可執行的 `bin/transpile-agents.mjs` 或等價入口。
- [ ] 既有 agent 轉換行為維持相容：Gemini tool 名稱映射、OpenCode permission 推導、Codex TOML 輸出、per-agent override 不回歸。
- [ ] 需要公開給使用者的 package-level runtime scripts 進入 publish repo 的 `scripts/` namespace，例如 `scripts/claude/statusline.sh`、`scripts/opencode/codex-usage-*`、`scripts/shared/session-trigger.mjs`；skill-owned runner/adapters 則 build 到各自 skill-local `scripts/`。
- [ ] local deploy 從 `.publish/ddd-workflow/` dogfood 公開 package，先 build publish repo，再執行 pack validation 與部署。
- [ ] `package.json` scripts 反映新 pipeline，例如 `publish:init`、`build`、`test:pack`、`deploy`、`publish:status`、`publish:diff`。
- [ ] `pnpm deploy` 預設實際部署並寫入 HOME；`pnpm deploy:dry-run` 提供無副作用檢查。
- [ ] 舊 `ddd-workflow/` source root 與 `subtree:*` scripts 已移除，README / CLAUDE.md 不再把 subtree 描述為主流程。
- [ ] README 說明一般使用者如何用 `npx skills` 安裝 skills，以及如何使用 publish repo 內 `bin/` entrypoints 處理 agents / scripts。
- [ ] `pnpm test` 或等價測試涵蓋 publish build、pack validation、agent transpiler、deploy path，不只檢查舊 symlink。

## 相關檔案

### 新增

- `docs/17-source-publish-workflow/spec.md`：本 sprint 規格。
- `docs/17-source-publish-workflow/tasks.md`：本 sprint 複雜執行計畫。
- `docs/17-source-publish-workflow/works.md`：本 sprint 工作日誌。
- `src/ddd-workflow/`：新的 publishable source root。
- `.publish/ddd-workflow/`：generated publish repo working tree（外層 Git ignore）。
- `src/tooling/bin/transpile-agents.ts` 或等價 module：build 產生 publish repo 的 `bin/transpile-agents.mjs`。
- `src/tooling/bin/deploy-agents.ts` 或等價 module：build 產生 publish repo 的 `bin/deploy-agents.mjs`，處理 `npx skills` 不涵蓋的 agents / scripts / config 部署。
- `src/ddd-workflow/_runtime/`：source-only shared shell runtime input；build 會 vendoring 成 skill-local 實體檔，不得原樣同步到 publish repo。

### 修改

- `package.json`：重整 local pipeline scripts。
- `.gitignore`：加入 `.publish/`，保留 `dist/` ignore。
- `vite.config.ts`、`vitest.config.ts`：導入 Vite/Vitest tooling pipeline。
- `scripts/build.js`：不再作為主 build；功能拆分為新的 Vite tooling module 與 publish build module。
- `scripts/cli.js`：不在原檔內修補；以新的 deploy module 重建，skills 交由 `npx skills`，非 skill 項目才保留自家部署。
- `scripts/build.test.js`、runtime shell smoke tests 等測試：改以新路徑與新 pipeline 驗證。
- `ddd-workflow/`：遷移到 `src/ddd-workflow/` 後移除，避免雙重 source root。
- `README.md`、`ddd-workflow/README.md`：同步 source/publish/install 說明。

## 介面/資料結構

此 sprint 不新增 runtime network API；主要介面是檔案結構與 CLI。

### Tooling module layout

```text
src/tooling/
├── publish/
│   ├── build-publish.ts            # source -> publish tree destructive sync
│   ├── init-publish.ts             # 初始化 .publish/ddd-workflow working tree
│   ├── check-publish-dirty.ts      # dirty guard
│   ├── sync-publish-tree.ts        # allowlist/denylist 檔案同步
│   ├── status.ts                   # publish repo status helper
│   └── diff.ts                     # publish repo diff helper
├── deploy/
│   ├── deploy-local.ts             # dogfood .publish/ddd-workflow
│   ├── deploy-agents.ts            # deploy npx skills 不涵蓋的 agents
│   ├── deploy-skills.ts            # 呼叫 npx skills 安裝 skills
│   ├── deploy-config.ts            # copy user-editable config template
│   ├── deploy-runtime-scripts.ts   # copy platform/package runtime scripts
│   ├── uninstall.ts                # 移除本專案部署的 managed files
│   └── validate-install.ts         # fake HOME / installed target validation
├── agent-transpiler/
│   ├── convert-to-gemini.ts
│   ├── convert-to-opencode.ts
│   ├── convert-to-codex.ts
│   ├── overrides.ts
│   └── transpile-agents.ts
├── bin/
│   ├── transpile-agents.ts         # 產生 publish package bin/transpile-agents.mjs
│   └── deploy-agents.ts            # 產生 publish package bin/deploy-agents.mjs
└── shared/
    ├── paths.ts
    ├── paths.test.ts
    ├── fs.ts
    ├── git.ts
    └── logger.ts
```

### Module contracts

| Module | Contract | 主要驗證 |
| --- | --- | --- |
| `agent-transpiler` | 讀取 Claude-compatible `agents/*.md`，輸出 Gemini/OpenCode/Codex agent 產物；不得修改 source tree。 | fixture input + golden output exact compare。 |
| `publish` | 只從 `src/ddd-workflow/` 同步 allowlist 內容到 `.publish/ddd-workflow/`；dirty publish repo 預設 fail。 | temp dir integration test、allowlist/denylist、dirty/force 測試。 |
| `deploy` | 只從 `.publish/ddd-workflow/` 讀取內容；支援 dry-run；不可偷吃 `src/ddd-workflow/`；generated files 同名覆蓋，user-editable config copy-if-missing。 | fake HOME copy assertion、no-symlink assertion、dry-run 無副作用測試。 |
| `publish status/diff` | 只讀取 `.publish/ddd-workflow/` Git 狀態與差異；若 dist 尚未存在，仍可輸出清楚錯誤。 | temp git repo status/diff 測試。 |
| `publish bin` | 由 Vite build 從 `src/tooling/bin/*` 產生 `.publish/ddd-workflow/bin/*.mjs`；不得存在於 `src/ddd-workflow/`。 | generated files smoke test。 |
| `skill runtime build` | 從 `src/ddd-workflow/_runtime/` 產生 self-contained skill-local `scripts/**` 實體檔；不得依賴 symlink、package root runtime 或跨 skill 相對路徑。 | bash smoke test、no-symlink scan、skill-local path resolution test。 |
| `package runtime scripts` | 非 skill-owned runtime scripts 在 publish repo `scripts/<platform-or-shared>/` 有清楚 namespace；deploy 到 `~/.config/ddd-workflow/runtime/` 或平台要求位置。 | fake HOME copy assertion、dry-run 無副作用測試。 |
| `package scripts` | `test -> build -> test:pack -> deploy` 可重複執行，失敗會停在正確 gate。 | top-level pipeline smoke test。 |
| `skills pack validation` | `npx skills` 可辨識所有 `ddd.*` skills，作為 dotted name 風險 gate。 | `npx skills add ./.publish/ddd-workflow --list`。 |

### Source tree

```text
src/ddd-workflow/
├── _runtime/                       # source-only：shared shell lib/template，不原樣 publish
├── skills/                         # Agent Skills package，交給 npx skills
│   └── ddd.plan/
│       ├── SKILL.md
│       └── references/
├── agents/                         # Canonical agent source
│   ├── ddd-developer.md
│   └── ddd-reviewer.md
├── scripts/                        # 公開 runtime scripts
│   ├── claude/
│   │   └── statusline.sh
│   ├── opencode/
│   │   ├── codex-usage-capture.js
│   │   ├── codex-usage-status.tsx
│   │   └── codex-usage-format.js
│   └── shared/
│       └── session-trigger.mjs
├── config/
├── policies/
├── references/
├── .claude-plugin/
├── gemini-extension.json            # Gemini CLI extension manifest
├── README.md
└── LICENSE
```

### Publish tree

```text
.publish/ddd-workflow/
├── .git/                           # ddd-workflow GitHub repo
├── skills/
│   ├── ddd.work/scripts/            # build 後實體檔，無 symlink
│   └── ddd.xreview/scripts/         # build 後實體檔，含 adapters/lib/policies
├── agents/
├── scripts/
├── bin/                            # generated public CLI entrypoints
├── config/
├── policies/
├── references/
├── .claude-plugin/
├── gemini-extension.json
├── dist/                           # local generated，publish repo ignore
├── package.json
├── README.md
└── LICENSE
```

### Local pipeline commands

```json
{
  "scripts": {
    "test": "vitest run",
    "build:tooling": "vite build",
    "publish:init": "pnpm run build:tooling && node dist/tooling/publish/init-publish.mjs",
    "build": "pnpm run build:tooling && node dist/tooling/publish/build-publish.mjs",
    "test:pack": "npx skills add ./.publish/ddd-workflow --list",
    "deploy": "pnpm test && pnpm run build && pnpm run test:pack && node dist/tooling/deploy/deploy-local.mjs",
    "deploy:dry-run": "pnpm test && pnpm run build && pnpm run test:pack && node dist/tooling/deploy/deploy-local.mjs --dry-run",
    "publish:status": "node dist/tooling/publish/status.mjs",
    "publish:diff": "node dist/tooling/publish/diff.mjs"
  }
}
```

### Public package commands

公開 repo 可提供自己的 `package.json`，但不是本 sprint 的硬性 runtime API。建議入口：

```json
{
  "scripts": {
    "agents:build": "node bin/transpile-agents.mjs",
    "agents:deploy": "node bin/deploy-agents.mjs"
  }
}
```

使用者安裝 skills 的主要方式：

```bash
npx skills add applepig/ddd-workflow --skill '*' -g -a claude-code -a opencode -a codex -a gemini-cli
```

### Agent transpiler contract

本 sprint 採用自家 transpiler refactor，不等待外部 framework。轉換規則至少必須支援：

| 能力 | 必要性 |
| --- | --- |
| Claude-compatible agent frontmatter 讀取 | 必須 |
| Gemini tool 名稱映射 | 必須 |
| OpenCode permission 推導與 `mode`/`steps` | 必須 |
| Codex TOML `developer_instructions` 輸出 | 必須 |
| Per-agent override | 必須 |
| 非互動 CLI、可在 publish repo 執行 | 必須 |

轉換規則從外層 local-only script 移到 `src/tooling/agent-transpiler/`，並由 build 產生 publish package 的 `bin/transpile-agents.mjs`。未來若有成熟外部 framework，可另開 sprint 以同一組 golden tests 評估替換。

## 邊界案例

### Case 1：`.publish/ddd-workflow` 不存在

處理：`pnpm run build` 應 fail 並提示先執行 `pnpm run publish:init`。`build` 不自動建立非 Git publish dir；`publish:init` 才是建立 managed checkout 與設定 remote 的入口。

### Case 2：`.publish/ddd-workflow` 有未提交變更

處理：build 預設 fail，列出 `git -C .publish/ddd-workflow status --short`，避免覆蓋 publish repo 中尚未處理的手動變更或 build 產物差異。

### Case 3：`npx skills` 未來嚴格禁止 dotted skill name

處理：`test:pack` fail，停止 deploy/publish。此 sprint 不更名，但錯誤要能早期暴露；後續另開 sprint 評估 `ddd.plan` → `ddd-plan` 或雙軌相容策略。

### Case 4：外部 agent 轉檔 framework 不支援現有 override

處理：不採用該工具；保留自家 `transpile-agents`，並在 ADR 記錄排除原因。

### Case 5：skill runtime build output 缺檔或路徑斷裂

處理：測試需檢查 `ddd.work`、`ddd.xreview` 等 skill 內部 `scripts/` entrypoint、adapters、lib、policies 都是 skill-local 實體檔，沒有 symlink，且 deploy / `npx skills` 安裝後可執行。

### Case 6：本機 deploy 從 `src/` 跑，公開 repo 卻缺檔

處理：deploy-local 必須以 `.publish/ddd-workflow/` 為 source；若偵測到從 `src/` 或舊 `ddd-workflow/` 部署應 fail 或警告。

### Case 7：`dist/` 被誤加入 publish repo

處理：publish repo `.gitignore` 必須 ignore `dist/`；`publish:status` 若出現 `dist/` tracked diff，需在 works.md 記錄並修正 ignore 或 build 路徑。

### Case 8：`dist/tooling` 尚未產生就執行 publish helper

處理：正式 `package.json` scripts 一律跑 `dist/` entrypoint；需要 tooling 的 helper 需先執行 `pnpm run build:tooling`，若 `dist/` 不存在要輸出清楚錯誤或由 script 自動前置 build。

## ADR（Architecture Decision Record）

### ADR-1：採用 source/publish split，不再讓 subtree 兼任 source

**決策**：外層 Git 管 `src/ddd-workflow/` 與 local pipeline；`.publish/ddd-workflow/` 是 build 產生的 GitHub repo working tree。

**原因**：現在的 `ddd-workflow/` 同時是 subtree、source、publish 內容，容易忘記 subtree push/pull 或在錯誤層級修改。source/publish split 讓同步方向固定為 `src -> .publish -> remote`。

**替代方案**：保留 subtree 並加強 hook。排除原因是 hook 只能提醒，不能消除雙向可編輯 Git history 的根本摩擦。

### ADR-2：skills 安裝交給 `npx skills`

**決策**：不自製 skills 跨平台 deploy/transpile；使用 Vercel `skills` CLI 作為 skill package manager。

**原因**：Agent Skills 已有公開 spec 與跨多 agent 的 installer，且目前可 list / install 現有 `ddd.*` skills。自製同功能會增加維護成本，也偏離生態系標準。

**替代方案**：保留 `scripts/cli.js` 對各平台 skills 的 symlink。排除原因是會繼續維護一套 `npx skills` 已經處理的功能。

### ADR-3：dotted skill name 暫時保留，但用 pack validation 守住風險

**決策**：本 sprint 不更名 `ddd.plan`、`ddd.work`、`ddd.xreview` 等 dotted skill name。

**原因**：dotted name 與 slash command 語意一致，且目前 `npx skills@1.5.7` 實測可 list / filter / install。更名會影響使用者記憶與現有文件。

**替代方案**：立即改為 spec-pure `ddd-plan`。排除原因是命名遷移成本高，且目前沒有實際相容性阻塞。

### ADR-4：agents 作為 source 發布，轉檔能力也要發布

**決策**：`agents/` 進入 publish repo；多平台 agent output 不 commit，但 publish repo 必須提供產生 agent output 的能力。

**原因**：`npx skills` 不處理 subagent/agent 定義。若公開 repo 只放 Claude-compatible agents，其他平台使用者會缺少轉檔工具；若 commit 多平台 dist，又會產生多份衍生內容同步問題。

**替代方案**：只發布 Claude agents，不提供轉檔。排除原因是與本專案「跨 AI agent CLI 共用設定」定位不符。

### ADR-5：runtime scripts 分為 skill-owned 與 package-level

**決策**：skill-owned runtime 是 skill package contract 的一部分，publish build 會從 source-only `_runtime/` 產生 self-contained skill-local `scripts/**` 實體檔。Claude statusline、OpenCode Codex usage、session trigger 等 package-level runtime scripts 放在 publish repo 的 `scripts/<platform-or-shared>/`；部署到使用者端時，非平台指定位置的 runtime 放在 `~/.config/ddd-workflow/runtime/`。

**原因**：`npx skills` 的安裝邊界是 skill 目錄，`ddd.work`、`ddd.xreview` 這類需要 shell entrypoint 的 skill 不能依賴 package root symlink 或跨 skill 相對路徑。source 層可共用 shell lib/template，但 installable output 必須是實體檔。Package-level runtime 則不是某個 skill 的契約，應與 user-editable config 分區管理。

**替代方案**：把所有 scripts 留在外層 `scripts/`，由 skill-local symlink 指回 shared runner。排除原因是 copy 型 installer 或單獨安裝 skill 時容易斷鏈，也會讓 invocation basename 與相對路徑成為隱性 contract。

### ADR-6：local pipeline 用 `package.json`，不引入正式 CI/CD

**決策**：本 sprint 以 `package.json` scripts 定義 local build/test/deploy/publish helper。

**原因**：此專案目前是個人/小型工具鏈，沒有 worker 或遠端 CI/CD；先用本地 pipeline 取得清楚流程與可重複驗證即可。

**替代方案**：立即建立 GitHub Actions 自動 publish。排除原因是會提早處理 credential、PR policy、remote release gate，超出本 sprint。

### ADR-7：導入 Vite 作為 tooling build system

**決策**：使用 Vite/Vitest 管理本機 TypeScript/JavaScript tooling 的 build 與 test，形成自然的 `test -> build -> test:pack -> deploy` 流程。正式 package scripts 統一執行 `dist/` 產物；開發期若需要直跑 source，可另設 `dev:*` script，不作為主流程。

**原因**：本 sprint 需要重建多個 CLI/tooling module，若繼續以零散 Node script 維護，module contract、測試入口與 build output 會再次分散。Vite 能讓 TypeScript module、Vitest 測試與 dist CLI output 有一致的 pipeline。

**替代方案**：維持純 Node ESM scripts。排除原因是舊 `scripts/cli.js` 與 `scripts/build.js` 已經顯示單檔 script 容易累積過多職責，不利於 module-level correctness。

### ADR-8：完整 rebuild pipeline，僅 refactor agent 轉檔規則

**決策**：publish builder、deploy CLI、package scripts 採完整重建；agent 轉檔規則以 refactor 方式搬入 `src/tooling/agent-transpiler/`。

**原因**：舊 `build.js` 實際上是 agent transpiler，不是 publish builder；舊 `cli.js` 同時負責 skills、agents、config、runtime scripts、lint/test，已不適合在原檔修補。但 agent 轉檔規則已有測試覆蓋，完整重寫會增加不必要回歸風險。

**替代方案**：沿用舊 `cli.js` 並逐步 patch。排除原因是會保留 source、publish、dist、deploy 邊界混雜的根本問題。

## Milestones

### Milestone 1: Tooling 基礎與測試骨架
> 預期結果：Vite/Vitest 成為新 tooling pipeline 的入口，後續 module 可用一致方式測試與 build。
> 驗證方式：`pnpm test` 執行 Vitest；`pnpm build` 至少能產出多 entrypoint tooling dist skeleton。

- [ ] 導入 Vite/Vitest config 與 package scripts contract 測試，M1 起 `pnpm test` 即為 Vitest 主入口。
- [ ] 在 `package.json` 宣告 `packageManager` 使用 pnpm。
- [ ] 建立 `src/tooling/shared/*`、`tsconfig` 與 fixture 約定。
- [ ] 定義 `SOURCE_ROOT`、`PUBLISH_ROOT`、`DIST_ROOT` 等 shared paths constants，並測試 `pnpm test` 與 `node dist/...` 的解析一致性。

### Milestone 2: Agent Transpiler Refactor
> 預期結果：既有 Gemini/OpenCode/Codex agent 轉檔規則搬入 `src/tooling/agent-transpiler/`，並以 golden output 鎖住行為。
> 驗證方式：`pnpm test -- src/tooling/agent-transpiler` 通過，且 golden output 與既有 `scripts/build.js` 規則等價。

- [ ] 以真實 agents 的複製版建立 fixture input 與 golden output。
- [ ] 搬移 Gemini/OpenCode/Codex conversion 與 per-agent overrides。
- [ ] 建立 publish package 可執行的 `bin/transpile-agents.mjs`；root `dist/` 只放 Vite tooling，平台 agent output 只生成到 `.publish/ddd-workflow/dist/{gemini,opencode,codex}/agents`。

### Milestone 3: Publish Builder Rebuild
> 預期結果：`src/ddd-workflow/` 可安全同步到 `.publish/ddd-workflow/`，且 dirty guard 與 allowlist/denylist 被測試保護。
> 驗證方式：`pnpm test -- src/tooling/publish` 通過；fixture/temp dir build 在 clean publish tree 可成功，在 dirty publish tree 預設 fail。

- [ ] 實作 publish tree allowlist/denylist contract，排除 source-only `_runtime/`。
- [ ] 實作 managed checkout `publish:init`、dirty guard、force 覆蓋與 `.publish/` ignore；build 缺 checkout 時 fail。
- [ ] 實作 `publish:init`、`publish:status`、`publish:diff`。
- [ ] build-publish 在同步 source 後注入 `bin/*.mjs`、self-contained skill runtime 實體檔，並產生 `.publish/ddd-workflow/dist/{gemini,opencode,codex}/agents`。
- [ ] 驗證 publish tree 沒有 symlink。

### Milestone 4: Source Content 遷移
> 預期結果：`src/ddd-workflow/` 成為唯一手改 source，舊 `ddd-workflow/` 不再是主流程 source。
> 驗證方式：`pnpm build` 產生完整 publish tree；外層 `git status --short` 不追蹤 `.publish/`。

- [ ] 搬移 skills、agents、references、config、policies、`.claude-plugin`。
- [ ] 搬移 `gemini-extension.json`，維持 Gemini CLI extension manifest 位於 publish repo root。
- [ ] 將 package-level runtime scripts 搬入 `scripts/{claude,opencode,shared}` namespace。
- [ ] 建立 `src/ddd-workflow/_runtime/` source-only runtime input，並修正 skill runtime build 測試路徑。
- [ ] build 產生 `skills/ddd.work/scripts/**` 與 `skills/ddd.xreview/scripts/**` 實體檔，取代舊 symlink / invocation-basename 模式。
- [ ] 移除舊 `ddd-workflow/` source root，避免與 `src/ddd-workflow/` 並存。

### Milestone 5: Deploy CLI Rebuild
> 預期結果：local deploy dogfood `.publish/ddd-workflow/`，skills 交給 `npx skills`，非 skill 項目由自家 deploy module 處理。
> 驗證方式：fake HOME integration test 通過；`deploy --dry-run` 不產生副作用且列出預期動作；實際 deploy copy generated 檔案，不依賴 symlink。

- [ ] 定義 deploy action contract 與 dry-run event schema：generated 檔案同名覆蓋，user-editable config copy-if-missing。
- [ ] 重建 agents、skills、config、runtime scripts 的 deploy modules。
- [ ] 以 fake HOME 驗證 deployed files 來自 `.publish/ddd-workflow/` 或 `.publish/ddd-workflow/dist/`，不指向 `src/ddd-workflow/`，且不建立 symlink。
- [ ] 使用者端分區：`~/.config/ddd-workflow/xreview.json` 為可編輯 config，`~/.config/ddd-workflow/runtime/**` 為工具管理 runtime，`~/.config/ddd-workflow/state/**` 保留給未來 state/manifest。

### Milestone 6: Pack Validation 與 Pipeline Smoke
> 預期結果：`test -> build -> test:pack -> deploy:dry-run` 能重複執行，且每個 gate 失敗會阻止後續步驟。
> 驗證方式：完整執行 `pnpm test`、`pnpm build`、`pnpm test:pack`、`pnpm deploy:dry-run`。

- [ ] 更新 `package.json` scripts 為新 pipeline。
- [ ] 驗證 `pnpm deploy` 預設實際部署；`pnpm deploy:dry-run` 無副作用。
- [ ] 驗證 `npx skills add ./.publish/ddd-workflow --list`。
- [ ] 驗證 `pnpm deploy` 包含 `test`、`build`、`test:pack`、`deploy-local`，且 `deploy:dry-run` 不寫入 HOME。
- [ ] 記錄完整 pipeline 結果到 `works.md`。

### Milestone 7: 文件與 Legacy Cleanup
> 預期結果：使用者與 maintainer 都能從 README 理解新 workflow，舊 subtree 流程不再造成誤用。
> 驗證方式：README、CLAUDE.md、spec.md、tasks.md、works.md 與 package scripts 一致。

- [ ] 更新 root README 與 publish README。
- [ ] 更新 `CLAUDE.md` 或專案操作文件，移除 subtree 主流程說明。
- [ ] 移除 `package.json` 的 `subtree:*` scripts。
- [ ] 在 `works.md` 記錄完成狀態、測試結果與舊 subtree 流程移除結果。
