# ddd-authoring

`ddd-authoring` 是 ddd-workflow 的 authoring 與 publish pipeline worktree。

日常手改內容放在 `src/ddd-workflow/`；`pnpm run build` 會產生 `.publish/ddd-workflow/`，再由 `npx skills` 與 publish package 內的 `bin/` entrypoints 供本機或公開 repo 使用。

## 專案結構

```text
src/ddd-workflow/                  # 唯一手改 publishable source
  skills/                          # Agent Skills package
  agents/                          # Claude-compatible canonical agents
  scripts/                         # package-level runtime scripts
src/tooling/                       # Vite-built local tooling
dist/tooling/                      # generated tooling entrypoints
.publish/ddd-workflow/             # generated publish checkout，外層 Git ignore
```

## 常用指令

```bash
pnpm test
pnpm run build
pnpm run test:pack
pnpm deploy:dry-run
```

`pnpm deploy` 會實際寫入 HOME；先用 `pnpm deploy:dry-run` 檢查動作。

## 發布流程

1. 修改 `src/ddd-workflow/` 或 `src/tooling/`。
2. 執行 `pnpm test`。
3. 執行 `pnpm run build`，產生 `.publish/ddd-workflow/`。
4. 執行 `pnpm run test:pack`，確認 `npx skills` 可辨識所有 `ddd.*` skills。
5. 檢查 `.publish/ddd-workflow` diff 後，再由 maintainer 發布公開 repo。

舊 subtree 與 symlink deploy 流程已退場；`scripts/build.js` 與 `scripts/cli.js` 的主線能力已遷移到 `src/tooling/`。
