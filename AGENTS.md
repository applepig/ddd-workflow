# AGENTS.md

本 worktree 是 `ddd-authoring`，用來維護 ddd-workflow 的 source / publish pipeline。

## Git 策略

- 外層 repo（本目錄）是 local authoring repo，只用來保存本機 source / tooling 工作狀態。
- 外層 repo 不推 GitHub branch；不要把 `feat/*`、`ddd-authoring` 或其他外層工作分支推到 `applepig/ddd-workflow`。
- GitHub 上公開的 `applepig/ddd-workflow` 只接受 `.publish/ddd-workflow/` 這個內層 publish checkout 的 commit。
- 若要更新 GitHub PR，只在 `.publish/ddd-workflow/` 內檢查、commit、push。
- 目前 active publish PR / branch 以 GitHub 為準；需要時用 `gh pr list --repo applepig/ddd-workflow` 查詢，不在此文件硬編碼。
- 建立或更新 publish PR 前，必須先確認外層 source branch 與 `.publish/ddd-workflow/` 內層 publish branch 的對應關係；禁止在 branch 名稱未對齊或不確定時直接開 PR。
- 內層 publish branch 應使用與外層工作 branch 相同的功能識別（編號／slug），例如外層 `feat/17-source-publish-workflow` 對應內層 `publish/17-source-publish-workflow`；若外層是 `main`、`ddd-authoring` 這類泛用名稱，先詢問使用者 publish branch 名稱。
- 建 PR 前必查：外層 `git branch --show-current`、內層 `.publish/ddd-workflow/` 的 `git branch --show-current`、以及 `gh pr list --repo applepig/ddd-workflow --head <publish-branch>`；不要沿用已 merged / closed PR branch 建新 PR，除非使用者明確要求。
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
