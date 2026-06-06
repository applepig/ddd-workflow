# CLAUDE.md

本 worktree 是 `ddd-authoring`，用來維護 ddd-workflow 的 source / publish pipeline。

## 架構

```text
src/ddd-workflow/                  # 唯一手改 publishable source
src/tooling/                       # Vite / Vitest tooling source
dist/tooling/                      # generated tooling entrypoints
.publish/ddd-workflow/             # generated publish checkout，外層 Git ignore
```

## 主流程

- 編輯 skills、agents、runtime scripts 時，只改 `src/ddd-workflow/`。
- 編輯 build、publish、deploy 行為時，只改 `src/tooling/`。
- `pnpm run build` 先跑 Vite tooling build，再用 `dist/tooling/publish/build-publish.mjs` 重建 `.publish/ddd-workflow/`。
- `pnpm run test:pack` 執行 repo-local `skills add ./.publish/ddd-workflow --list`，作為 dotted skill name 與 package layout gate。
- `pnpm deploy:dry-run` 會串起 `test -> build -> test:pack -> deploy-local --dry-run`，不寫入 HOME。

## Git 策略

- 外層 repo 是 local authoring repo，不推 GitHub branch。
- GitHub 上的 `applepig/ddd-workflow` 只接受 `.publish/ddd-workflow/` 內層 publish checkout 的 commit。
- 更新公開 PR 時，只在 `.publish/ddd-workflow/` 內 commit / push；不要把外層 `feat/*`、`ddd-authoring` 或其他 local branch 推到 GitHub。
- 目前 publish PR branch 是 `publish/17-source-publish-workflow`，對應 PR：`https://github.com/applepig/ddd-workflow/pull/15`。

## 常用指令

```bash
pnpm test
pnpm run build
pnpm run test:pack
pnpm deploy:dry-run
pnpm deploy:check
```

`pnpm deploy` 會實際寫入 HOME；沒有明確需求時先用 dry-run。
`pnpm deploy:check` 會寫入 `/tmp/ddd-workflow-deploy-check` 並跳過 skills 安裝，用來驗證 non-skill deploy output。

## 退場流程

舊 `ddd-workflow/` subtree source root、`scripts/build.js`、`scripts/cli.js` 與 `subtree:*` package scripts 不再是主流程。`./scripts` 下其他工具程式若尚未遷移，不要在本 sprint 順手重構。

## 命名慣例

- Skill 資料夾與 frontmatter `name` 維持 `ddd.<動作>`，例如 `ddd.plan`、`ddd.work`。
- Agent 檔名與 `name` 維持 `ddd-<角色>`，例如 `ddd-developer`、`ddd-reviewer`。
- package-level runtime scripts 放在 `src/ddd-workflow/scripts/<platform-or-shared>/`。
