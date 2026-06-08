# Works: 簡化 DDD 文件包格式

## 2026-06-08

- 完成文件結構簡化：`spec.md` 為最高權重 SSOT，`plan.md`、`research.md`、`tasks.md` 為 optional 輔助文件。
- 將 `/ddd.brainstorming` 改為 deprecated alias，交給 `/ddd.plan` 的 Deep Planning / Brainstorming。
- 將 `/ddd.work` 平行派工改為 coordinator 直接派 `ddd-developer`，移除舊 worker symlink。
- Cross review 後修正 AGENTS gate、`tasks.md` 草稿狀態、publish layout 範圍與 spec 一致性。
- 驗證：`pnpm run test:pack`、`pnpm exec vitest run src/tooling/publish/build-publish.test.js` 通過。
- PR #17 review 修正：`deploy-local` 安裝 skills 時不再依賴 publish package 內不存在的 `pnpm exec skills`；改為先檢查 PATH 中是否有 `skills` CLI，沒有時 fallback 到 `npx -y skills`。
- 驗證：`pnpm vitest run src/tooling/deploy/deploy-local.test.js`、`pnpm run publish:refresh`、`pnpm run test:pack` 通過。
