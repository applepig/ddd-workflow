# Works: 簡化 DDD 文件包格式

## 2026-06-08

- 完成文件結構簡化：`spec.md` 為最高權重 SSOT，`plan.md`、`research.md`、`tasks.md` 為 optional 輔助文件。
- 將 `/ddd.brainstorming` 改為 deprecated alias，交給 `/ddd.plan` 的 Deep Planning / Brainstorming。
- 將 `/ddd.work` 平行派工改為 coordinator 直接派 `ddd-developer`，移除舊 worker symlink。
- Cross review 後修正 AGENTS gate、`tasks.md` 草稿狀態、publish layout 範圍與 spec 一致性。
- 驗證：`pnpm run test:pack`、`pnpm exec vitest run src/tooling/publish/build-publish.test.js` 通過。
- PR #17 review 修正：`deploy-local` 安裝 skills 時不再依賴 publish package 內不存在的 `pnpm exec skills`；改為先檢查 PATH 中是否有 `skills` CLI，沒有時 fallback 到 `npx -y skills`。
- 驗證：`pnpm vitest run src/tooling/deploy/deploy-local.test.js`、`pnpm run publish:refresh`、`pnpm run test:pack` 通過。

### Milestone 4 收尾：tasks.md 提及去重複

- **問題**：tasks.md 雖降為 optional，但「已確認／legacy／歷史參考」整套限定詞被原樣複製到每個 skill，`ddd.work` 一檔就出現 9 次，形成 over-documentation。
- **決策**：tasks.md 定位釐清為「短期 optional、長期 remove」＝ deprecating。採單一真相策略——完整生命週期規則只留在 owner `ddd.tasks/SKILL.md`（補上 deprecating 聲明），其他檔案名詞化用「任務來源」，legacy guard 只保留在兩個真正做決定的 consumer（`ddd.work` 讀任務、`ddd.xreview` 判完成度）。
- **變更**：8 檔去重複——`ddd.work` 9→3、`ddd.spec` 2→0、`AGENTS.md` 6→1、`README.md` 4→2、`review-lenses` 1→0；文件結構與 README Skills 表將 tasks.md 標為 `(optional, 淘汰中)`。
- **驗證**：`pnpm test` 文件相關全數通過（245 passed）。`agent-runner.test.js` 的 skills install planner（`pnpm` vs `sh`）為先前 npx fallback hotfix 遺留的失敗，與本次純 markdown 變更無關，另案處理。
