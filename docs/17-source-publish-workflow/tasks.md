# Tasks: Source / Publish Workflow Rebuild

## Decision Gate

本 sprint 需要獨立 `tasks.md`。

原因：範圍包含 `ddd-authoring` worktree 建立、Vite tooling 導入、source/publish build、agent transpiler refactor、deploy CLI rebuild、runtime scripts namespace 與文件清理。這些工作跨多個 module，且有明確的介面先行與匯合點需求；若只放在 `spec.md` Milestones 會讓需求文件過長，也不利於平行派工。

## Scope Update: 2026-05-26

- `~/Dropbox/projects/ddd-authoring/` 是本 sprint 的遷移目標 worktree，使用 `feat/17-source-publish-workflow` branch。
- AGENTS 原 worktree 切回 `dev`，不再作為第一波 migration 的實作場地。
- 第一波必須包含 `scripts/build.js` 與 `scripts/cli.js` 的核心能力遷移到 Vite tooling pipeline。
- 暫緩的「其他 scripts refactor」僅指 `./scripts` 下與第一波 pipeline 無關的工具，例如 `claude-r`、subtree status、hook setup。

## Scope Update: 2026-06-03

- 使用者決策：runtime / shell / skill 測試檔集中搬到 authoring-only `tests/ddd-workflow/...`；`src/ddd-workflow/` 不放測試檔，`.publish/ddd-workflow/` 也不得包含 `*.test.*` / `*.spec.*`。
- Deploy module 目前以合併式 `src/tooling/deploy/deploy-local.js` 實作 agent/config/runtime/skills planner 與 applier，而不是依原 tasks 拆成多檔；本 sprint 接受此形態，後續若要重構再另開任務。

## Milestone 1: Tooling 基礎與測試骨架（序列）

> 預期結果：Vite/Vitest 成為新 tooling pipeline 的入口，後續 module 可用一致方式測試與 build。
> 驗證方式：`pnpm test` 執行 Vitest；`pnpm build` 至少能產出多 entrypoint tooling dist skeleton。

- [x] Task 1.0: 在 `ddd-authoring` worktree 建立 authoring root baseline：更新 package metadata、`.gitignore`、`src/ddd-workflow/` source root 與 `.publish/` ignore（Green）
- [x] Task 1.1: 撰寫 Vite/Vitest config 與 package scripts contract 測試（Red）
- [x] Task 1.2: 將 `pnpm test` 切為 Vitest 主入口，保留舊驗證為 legacy smoke（若仍需要），並在 `package.json` 宣告 `packageManager` 使用 pnpm（Green）
- [x] Task 1.3: 導入 Vite tooling skeleton、多 entrypoint build、`tsconfig` 與 `src/tooling/shared/*` 基礎 module（Green）
- [x] Task 1.4: 建立 module fixture 目錄與測試資料約定（Green）
- [x] Task 1.5: 定義 `SOURCE_ROOT`、`PUBLISH_ROOT`、`DIST_ROOT` 等 shared paths constants，並測試 source/dist 執行環境解析一致（Green）
- [x] Task 1.6: 更新 `vitest.config` include，確保新 `src/**/*.test.ts` 與既有測試可並行（Refactor）

## Milestone 2: Agent Transpiler Refactor（序列）

> 預期結果：既有 Gemini/OpenCode/Codex agent 轉檔規則搬入 `src/tooling/agent-transpiler/`，並以 golden output 鎖住行為。
> 驗證方式：`pnpm test -- src/tooling/agent-transpiler` 通過，且 golden output 與既有 `scripts/build.js` 規則等價。

- [x] Task 2.1: 以真實 agents 的複製版建立 `agent-transpiler` fixture input 與 expected golden output（Red）
- [x] Task 2.2: 撰寫 Gemini conversion exact output 測試（Red）
- [x] Task 2.3: 搬移並調整 Gemini conversion module（Green）
- [x] Task 2.4: 撰寫 OpenCode permission / override golden 測試（Red）
- [x] Task 2.5: 搬移並調整 OpenCode conversion module（Green）
- [x] Task 2.6: 撰寫 Codex TOML escaping golden 測試（Red）
- [x] Task 2.7: 搬移並調整 Codex conversion module（Green）
- [x] Task 2.8: 建立 `bin/transpile-agents.mjs` generated entrypoint 與 dist output 測試（Green）
- [x] Task 2.9: 建立 `bin/deploy-agents.mjs` generated entrypoint skeleton 與 smoke test（Green）
- [x] Task 2.10: 驗證 root `dist/` 只包含 Vite tooling；平台 agent output 只生成到 `.publish/ddd-workflow/dist/{gemini,opencode,codex}/agents`（Refactor）

## Milestone 3: Publish Builder Rebuild（序列）

> 預期結果：`src/ddd-workflow/` 可安全同步到 `.publish/ddd-workflow/`，且 dirty guard 與 allowlist/denylist 被測試保護。
> 驗證方式：`pnpm test -- src/tooling/publish` 通過；fixture/temp dir build 在 clean publish tree 可成功，在 dirty publish tree 會 warning 但不 fail。

- [x] Task 3.1: 撰寫 publish tree allowlist/denylist contract 測試，確認 `_runtime/` 不會原樣 publish（Red）
- [x] Task 3.2: 實作 `sync-publish-tree`，只同步 publishable content，並保留 managed checkout 的 `.git`（Green）
- [x] Task 3.3: 撰寫 `.publish/ddd-workflow` dirty guard 測試：clean / dirty warning（Red）
- [x] Task 3.4: 實作 `check-publish-dirty` 與 `build-publish` destructive sync（Green）
- [x] Task 3.5: 撰寫 `publish:status`、`publish:diff` temp git repo 測試（Red）
- [x] Task 3.6: 實作 `publish:init`、`publish:status`、`publish:diff` tooling entrypoint；`publish:init` 明確 clone/設定 remote，build 缺 checkout 時 fail（Green）
- [x] Task 3.7: 實作 build-publish 注入 generated `bin/*.mjs`、self-contained skill runtime 實體檔，並產生 `.publish/ddd-workflow/dist/{gemini,opencode,codex}/agents`（Green）
- [x] Task 3.8: 驗證 build 不複製外層 `docs/`、`reference/`、`.opencode/`、`dist/`、local-only 檔案（Refactor）
- [x] Task 3.9: 驗證 `.publish/ddd-workflow` 不包含任何 symlink（Refactor）

## Milestone 4: Source Content 遷移（序列）

> 預期結果：`src/ddd-workflow/` 成為唯一手改 source，舊 `ddd-workflow/` 不再是主流程 source。
> 驗證方式：`pnpm build` 產生完整 publish tree；外層 `git status --short` 不追蹤 `.publish/`。

- [x] Task 4.1: 搬移 `ddd-workflow/skills` 至 `src/ddd-workflow/skills`（Green）
- [x] Task 4.2: 搬移 `ddd-workflow/agents`、`references`、`config`、`policies`、`.claude-plugin`、`gemini-extension.json`（Green）
- [x] Task 4.3: 將 package-level runtime scripts 搬入 `src/ddd-workflow/scripts/{claude,opencode,shared}` namespace（Green）
- [ ] Task 4.4: 建立 `src/ddd-workflow/_runtime/`，把 source-level shared shell lib/template 放入 source-only runtime input（Green）
- [ ] Task 4.5: 重建 skill-owned runtime output：build 產生 `skills/ddd.xreview/scripts/**`、`skills/ddd.work/scripts/**` 實體檔，不再使用 symlink 或 invocation-basename hack（Green）
- [x] Task 4.6: 加入 `.publish/` ignore 與 publish repo 自身 `dist/` ignore（Green）
- [x] Task 4.7: 移除舊 `ddd-workflow/` source root，避免與 `src/ddd-workflow/` 並存（Green）
- [x] Task 4.8: 更新測試中所有舊 `ddd-workflow/` source path 為新 source / publish contract（Refactor）

## Milestone 5: Deploy CLI Rebuild（介面先行後可平行）

> 預期結果：local deploy dogfood `.publish/ddd-workflow/`，skills 交給 `npx skills`，非 skill 項目由自家 deploy module 處理。
> 驗證方式：fake HOME integration test 通過；`deploy --dry-run` 不產生副作用且列出預期動作；實際 deploy copy generated 檔案，不依賴 symlink。

- [x] Task 5.1: 從舊 `scripts/cli.js` 抽出第一波 non-skill deploy contract：copy / overwrite-generated / copy-if-missing-config / skip / dry-run event schema；不建立 symlink（Red）
- [x] Task 5.2: 實作 deploy action planner，不直接寫入檔案系統；skills 安裝僅產生 `npx skills` command，不重作 installer（Green）

### 🔀 可平行工作線

**[A] Agent Deploy** — `isolation: worktree`

> 範圍：`src/tooling/deploy/deploy-agents.ts`、`src/tooling/deploy/*.test.ts`
> 依賴：Task 5.1、Task 5.2 action contract 完成；Milestone 2 transpiler dist contract 完成
> 介面契約：輸入 `.publish/ddd-workflow` 與 target platform，輸出 deploy action list；實際套用時 copy generated agent 檔案，不建立 symlink
> 驗證方式：fake HOME 測試 Claude/Gemini/Codex/OpenCode agent target；確認內容來自 `.publish/ddd-workflow` 或其 generated `dist/`，不指向 `src/ddd-workflow`

- [x] Task 5.A1: 撰寫 agents fake HOME deploy 測試（Red）
- [x] Task 5.A2: 實作 agents deploy planner / applier（Green；合併於 `deploy-local.js`）

**[B] Config 與 Runtime Scripts Deploy** — `isolation: worktree`

> 範圍：`src/tooling/deploy/deploy-config.ts`、`src/tooling/deploy/deploy-runtime-scripts.ts`、`src/tooling/deploy/*.test.ts`
> 依賴：Task 5.1、Task 5.2 action contract 完成；Milestone 4 runtime scripts namespace 完成
> 介面契約：user-editable config 用 copy-if-missing；generated runtime scripts / plugins 用 copy overwrite；非平台指定位置的 package runtime 放在 `~/.config/ddd-workflow/runtime/`；dry-run 不寫入 HOME
> 驗證方式：fake HOME 測試 Claude statusline、OpenCode plugin/tui plugin、`~/.config/ddd-workflow/runtime/`、xreview config copy-if-missing

- [x] Task 5.B1: 撰寫 config/runtime fake HOME deploy 測試（Red）
- [x] Task 5.B2: 實作 config/runtime deploy planner / applier（Green；合併於 `deploy-local.js`）

**[C] Skills Deploy 與 Pack Gate** — `isolation: worktree`

> 範圍：`src/tooling/deploy/deploy-local.ts`、`package.json` scripts、`src/tooling/deploy/*.test.ts`
> 依賴：Milestone 3 publish builder 完成；`npx skills` 可在本機執行
> 介面契約：skills install 不由自家 module 轉檔；publish tree 內的 skill-local `scripts/**` 必須是實體檔；deploy pipeline 必須先跑 `test:pack`，再由 `deploy-local` 呼叫 `npx skills add ./.publish/ddd-workflow ...`；dry-run 只列出 command
> 驗證方式：mock command runner 測試 `npx skills add ./.publish/ddd-workflow --list` 是 deploy 前置 gate，實際 deploy 會呼叫 skills install command，且 publish skill runtime 沒有 symlink

- [x] Task 5.C1: 撰寫 skills install command 與 dry-run 測試（Red）
- [x] Task 5.C2: 實作 skills install command 與 deploy-local orchestration / `--dry-run`（Green；pack gate 由 package script `test:pack` 負責）

### 🔗 匯合點

> 驗證方式：`pnpm test -- src/tooling/deploy`、`pnpm deploy:dry-run`。

- [x] Task 5.3: 合併 [A]、[B]、[C]，處理 action schema / path contract 差異（合併於 `deploy-local.js`）
- [x] Task 5.4: 建立 end-to-end fake HOME deploy smoke test，驗證 config/runtime 分區與 no-symlink deploy output（Red → Green）
- [x] Task 5.5: 移除或降級舊 `scripts/cli.js` 主流程入口，避免與新 deploy module 並存造成誤用（Refactor）

## Milestone 6: Pack Validation 與 Pipeline Smoke（序列）

> 預期結果：`test -> build -> test:pack -> deploy:dry-run` 能重複執行，且每個 gate 失敗會阻止後續步驟。
> 驗證方式：完整執行 `pnpm test`、`pnpm build`、`pnpm test:pack`、`pnpm deploy:dry-run`。

- [x] Task 6.1: 撰寫 package scripts command contract 測試，鎖定 `test -> build -> test:pack -> deploy-local` gate 與 `deploy:dry-run` 無副作用（Red）
- [x] Task 6.2: 收斂 `package.json` scripts 為新 pipeline；`pnpm deploy` 預設實際部署，`pnpm deploy:dry-run` 只列出動作（Green）
- [x] Task 6.3: 撰寫 publish package generated files smoke test（Red）
- [x] Task 6.4: 修正 build output、`bin/` entrypoint、publish package `package.json` 直到 smoke test 通過（Green）
- [x] Task 6.5: 驗證 `pnpm deploy` 包含 `test`、`build`、`test:pack`、`deploy-local`，且 `deploy:dry-run` 不寫入 HOME（Green）
- [x] Task 6.6: 執行完整 pipeline 並記錄結果到 `works.md`（Refactor）

## Milestone 7: 文件與 Legacy Cleanup（序列）

> 預期結果：使用者、maintainer、未來 agent 都能從文件理解新 workflow；舊 subtree 流程不再被誤認為主線。
> 驗證方式：README、CLAUDE.md、spec.md、tasks.md、works.md 與 package scripts 一致。

- [x] Task 7.1: 更新 root README 的 source / publish / deploy 說明（Green）
- [x] Task 7.2: 更新 publish README 的 `npx skills`、agents `bin/` entrypoints、runtime scripts 說明（Green）
- [x] Task 7.3: 更新專案操作文件，完全移除 subtree 主流程說明；歷史脈絡只保留在 works.md（Green）
- [x] Task 7.4: 移除 `package.json` 的 `subtree:*` scripts（Green）
- [x] Task 7.5: 更新 `works.md` 完成狀態、測試結果與舊 subtree 流程移除結果（Green）
- [x] Task 7.6: 執行 self-review，確認 spec 驗收條件都對映到 task 或測試（Refactor）

## Milestone 8: Deploy Manifest（序列）

> 預期結果：build 產生 `.build-manifest.json`，deploy 讀取 manifest 比對 hash 決定 skip/install/remove，stale build 被擋住。
> 驗證方式：`pnpm test` 涵蓋 manifest 產生與比對；`pnpm deploy:dry-run` 列出 manifest-aware 動作；stale source 觸發 build gate。

- [x] Task 8.1: 定義 build manifest schema 與 unit hash 計算函式，撰寫 unit test（Red）
- [x] Task 8.2: 在 `build-publish` 尾端產生 `.publish/ddd-workflow/.build-manifest.json`，記錄 `sourceTreeHash` 與每個 unit 的 content hash（Green）
- [x] Task 8.3: 定義 deploy manifest schema 與 diff 演算法（build manifest vs deploy manifest → action list），撰寫 unit test（Red）
- [x] Task 8.4: 在 `deploy-local` 加入 stale build gate：重算 sourceTreeHash，與 build manifest 不一致時 fail（Green）
- [x] Task 8.5: 在 `deploy-local` 加入 manifest-aware deploy：skip unchanged、install changed/new、remove orphaned，完成後寫入 `~/.config/ddd-workflow/deploy.json`（Green）
- [x] Task 8.6: `deploy --dry-run` 根據 manifest diff 列出 skip/install/remove 動作，不修改 deploy manifest（Green）
- [x] Task 8.7: 整合測試：fake HOME 下跑完整 build→deploy 兩次，第二次全部 skip；改一個 source file 後第三次只 reinstall 該 unit（Refactor）

### Milestone 8 XReview Hardening: 2026-06-01

> 目的：修正 cross review 指出的 manifest-aware deploy false completion，確保 diff 不只用於 log，也實際控制 deploy 副作用。

- [x] Task 8.X1: 補測 orphaned unit `action=remove` 會刪除 deploy manifest 中記錄的 managed file target，並清理 manifest entry。
- [x] Task 8.X2: 補測 changed unit deploy 時，unchanged / skipped target 不會被全量 deploy 覆寫。
- [x] Task 8.X3: 補測同名 agent 在 Claude/Gemini/OpenCode/Codex 平台的 deploy manifest target 使用 precise unit mapping，不用 source filename substring 猜測。
- [x] Task 8.X4: 補測 source tree symlink retarget 會改變 `sourceTreeHash`，同時維持 `_runtime/` source-only skip 既有行為。
- [x] Task 8.X5: 實作 selective apply：只套用 `install` units、`skip` units 不動、`remove` units 依既有 deploy manifest target 安全刪除；`target=null` 或 `npx-skills` 僅清理 manifest entry。
- [x] Task 8.X6: 補測並修正同一 unit 多 target 情境：`reference:AGENTS.md` 在 Claude/Gemini/Codex 的 targets 需全部寫入 deploy manifest，orphan removal 需刪除所有 managed targets。
- [x] Task 8.X7: 補測並修正 target-specific deploy / `--skip-skills` 不得把 scope 外 build units 寫入 deploy manifest。
- [x] Task 8.X8: 補測並修正 OpenCode TUI config 使用 copy-if-missing，不覆寫既有 `~/.config/opencode/tui.json`。
- [x] Task 8.X9: 補測並修正 public `agents:deploy` 在缺 `dist/{gemini,opencode,codex}/agents` 時 fail 並提示先跑 `npm run agents:build`。

## Self-Review

- Spec 覆蓋度：已覆蓋 Vite tooling、source/publish split、`npx skills` gate、agent transpiler、deploy、runtime scripts、legacy cleanup。
- Task 完整性：每個 milestone 都有預期結果與驗證方式；測試先行 task 以 Red 標示，實作以 Green 標示。
- 依賴一致性：Milestone 5 的平行工作線在 deploy action contract 之後才分線；匯合點包含 fake HOME smoke test。
- Scope 檢查：任務數量偏多但集中在單一 migration/rebuild 主題，使用者已決定維持單 sprint；M4/M5 因 runtime 與 deploy contract 改為 no-symlink/copy 模型，若執行中發現 shell runtime build 超過預期，再獨立拆出後續 sprint。
