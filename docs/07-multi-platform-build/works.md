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
