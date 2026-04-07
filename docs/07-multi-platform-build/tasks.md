# Tasks: Multi-Platform Agent Build

## Milestone 1: Build 核心——轉換引擎（序列）
> 驗證方式：`node scripts/build.js` 成功執行，`dist/gemini/agents/`、`dist/opencode/agents/`、`dist/codex/agents/` 產出正確格式的檔案

- [x] Task 1.1: 安裝 `gray-matter` 依賴，更新 package.json
- [x] Task 1.2: 撰寫 build.js 骨架與平台映射表的測試（Red）
  - 測試 tool 名稱映射（Claude → Gemini）
  - 測試 Claude tools → OpenCode permission 推導
  - 測試 Claude tools → Codex sandbox_mode 推導
  - 測試 per-agent override deep merge
- [x] Task 1.3: 實作 build.js 骨架——讀取原始檔、解析 frontmatter、定義映射表與 AGENT_OVERRIDES config（Green）
- [x] Task 1.4: 撰寫 Gemini 轉換的測試（Red）
  - 輸入 Claude frontmatter，驗證產出的 tool 名稱、欄位名、移除的欄位
  - 驗證 markdown body 保留不變
- [x] Task 1.5: 實作 Gemini 轉換——tool 名稱映射、欄位名映射、移除不認識的欄位，輸出 markdown（Green）
- [x] Task 1.6: 撰寫 OpenCode 轉換的測試（Red）
  - 輸入 Claude frontmatter，驗證 permission 結構、mode、steps
  - 驗證 per-agent override（ddd-reviewer 的 bash 白名單）正確合併
- [x] Task 1.7: 實作 OpenCode 轉換——tools → permission 推導、加入 mode/steps、deep merge override，輸出 markdown（Green）
- [x] Task 1.8: 撰寫 Codex 轉換的測試（Red）
  - 輸入 Claude frontmatter + markdown body，驗證產出的 TOML 格式
  - 驗證 developer_instructions 包含完整 body
  - 驗證 sandbox_mode 正確推導
- [x] Task 1.9: 實作 Codex 轉換——格式轉 TOML、body → developer_instructions、推導 sandbox_mode（Green）
- [x] Task 1.10: 撰寫 build 主流程測試（Red）——讀取 ddd-workflow/agents/、清空 dist/、輸出三個平台目錄
- [x] Task 1.11: 實作 build 主流程——掃描原始檔、逐一呼叫各平台轉換、寫入 dist/（Green）
- [x] Task 1.12: 邊界案例測試與處理——YAML 解析錯誤、未知 tool 名稱 warn

## Milestone 2: CLI 整合（序列）
> 驗證方式：`npm run deploy` 成功執行，Gemini/OpenCode/Codex 的 agent symlink 指向 dist/，Claude 不變。`npm test` 全部通過。

- [ ] Task 2.1: 撰寫 cli.js 修改的驗證測試（Red）——deploy 後 Gemini/OpenCode/Codex 的 agent symlink 指向 dist/
- [ ] Task 2.2: 修改 `cli.js` 的 deploy 函式——Gemini/OpenCode/Codex agent 改為 symlink dist/ 產出，Claude 不變（Green）
- [ ] Task 2.3: 修改 `cli.js` 的 undeploy 與 test 函式，適應新路徑結構
- [ ] Task 2.4: 更新 `package.json` scripts——新增 `build`，修改 `deploy` 系列為先 build 再 deploy
- [ ] Task 2.5: `.gitignore` 加入 `dist/`
- [ ] Task 2.6: 刪除 `ddd-workflow/opencode/agents/` 舊目錄，修改 cli.js 中 deployOpencode 對應的舊路徑邏輯
- [ ] Task 2.7: 端對端驗證——`npm run build && npm run deploy && npm test` 全部通過
