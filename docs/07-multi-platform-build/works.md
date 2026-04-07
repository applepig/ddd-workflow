# Works: Multi-Platform Agent Build

## 2026-04-07

### Milestone 1: Build 核心——轉換引擎

**完成內容**：
- `scripts/build.js`：三平台轉換引擎（Gemini、OpenCode、Codex）
- `scripts/build.test.js`：161 個測試
- `vitest.config.js`：根目錄 vitest 設定
- `package.json`：新增 `gray-matter`、`vitest`、`build`/`test:unit` scripts

**技術決策**：
- Codex TOML 用字串拼接而非引入 TOML 套件——欄位結構簡單固定，不值得加依賴
- `vitest.config.js` 的 `include` 限制為 `scripts/**/*.test.{js,ts}`，避免吃到 `reference/` 目錄的測試
- build.js 的 CLI 入口用 `import.meta.url === \`file://${process.argv[1]}\`` 判斷直接執行，避免被 import 時觸發 build

**Coordinator 驗收修正**：
- Worker 誤將 `color` 加入 Gemini 的移除欄位清單，但 spec 明確列為「保留」欄位。已修正 `GEMINI_REMOVE_FIELDS` 並更新對應測試

### Milestone 2: CLI 整合

**完成內容**：
- `scripts/cli.js`：deploy/undeploy/test 函式修改，Gemini/OpenCode/Codex agent 改從 `dist/` 取
- `package.json`：deploy scripts 加入 `build.js` 前置步驟
- 刪除 `ddd-workflow/opencode/agents/`（舊的手動維護目錄）

**變更細節**：
- `linkDir` filter 新增 `.toml` 支援（Codex agent 為 TOML 格式）
- `deployCodex` 新增 agent deploy、`undeployCodex` 新增 agent unlinkDir、`testCodex` 新增 agent 驗證
- `deployOpencode` 移除 `existsSync` guard（dist/ 應由 build 保證存在）
- `deploy:claude` 不加 build 前置步驟（Claude 不走 dist）
