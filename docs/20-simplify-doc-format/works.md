# Works: 簡化 DDD 文件包格式

## 2026-06-08

- 完成文件結構簡化：`spec.md` 為最高權重 SSOT，`plan.md`、`research.md`、`tasks.md` 為 optional 輔助文件。
- 將 `/ddd.brainstorming` 改為 deprecated alias，交給 `/ddd.plan` 的 Deep Planning / Brainstorming。
- 將 `/ddd.work` 平行派工改為 coordinator 直接派 `ddd-developer`，移除舊 worker symlink。
- Cross review 後修正 AGENTS gate、`tasks.md` 草稿狀態、publish layout 範圍與 spec 一致性。
- 驗證：`pnpm run test:pack`、`pnpm exec vitest run src/tooling/publish/build-publish.test.js` 通過。
