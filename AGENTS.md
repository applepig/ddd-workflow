# AGENTS.md

本 worktree 是 `ddd-authoring`，用來維護 ddd-workflow 的 source / publish pipeline。

## Git 策略

- 外層 repo（本目錄）是 local authoring repo，只用來保存本機 source / tooling 工作狀態。
- 外層 repo 不推 GitHub branch；不要把 `feat/*`、`ddd-authoring` 或其他外層工作分支推到 `applepig/ddd-workflow`。
- GitHub 上公開的 `applepig/ddd-workflow` 只接受 `.publish/ddd-workflow/` 這個內層 publish checkout 的 commit。
- 若要更新 GitHub PR，只在 `.publish/ddd-workflow/` 內檢查、commit、push。
- 目前 publish PR branch 是 `publish/17-source-publish-workflow`，對應 PR：`https://github.com/applepig/ddd-workflow/pull/15`。
- 若誤推外層 branch 到 GitHub，應先刪除 remote branch，再確認 `.publish/ddd-workflow/` 的 PR branch 是否需要補推。

## 目錄職責

- `src/ddd-workflow/`：唯一手改 publishable source。
- `src/tooling/`：Vite / Vitest tooling source。
- `dist/tooling/`：generated tooling entrypoints。
- `.publish/ddd-workflow/`：generated publish checkout，外層 Git ignore，但它自己是要推 GitHub 的內層 repo。

## 發布流程

- 編輯 skills、agents、runtime scripts 時，只改 `src/ddd-workflow/`。
- 編輯 build、publish、deploy 行為時，只改 `src/tooling/`。
- 用 `pnpm run publish:refresh` 產生 `.publish/ddd-workflow/` 的 publish diff。
- 用 `pnpm run test:pack` 驗證 publish package layout。
- 在 `.publish/ddd-workflow/` 內 commit 並 push PR branch。
