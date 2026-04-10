---
name: Multi-platform agent build 已完成
description: build.js 轉換引擎已合併到 main（2026-04-07），改變 deploy 架構為 Claude 直接 symlink + 其他平台走 dist/
type: project
---

Multi-platform agent build 已完成並合併到 main（commits a5d6013、d532240，2026-04-07）。

**What changed:** Deploy 不再對所有平台用 symlink 指向 `ddd-workflow/` 原始檔。新架構：
- Claude：仍直接 symlink `ddd-workflow/agents/`（不經 build）
- Gemini / OpenCode / Codex：symlink `dist/<platform>/agents/`（由 `scripts/build.js` 轉換產出）
- `npm run deploy` 自動先 build 再 deploy
- 舊的 `ddd-workflow/opencode/agents/` 目錄已刪除

**Why:** 各平台 agent 格式有實質差異（Gemini tool 名稱 snake_case、OpenCode permission 結構、Codex TOML 格式），原本靠「容忍不認識欄位」的 symlink 策略讓工具權限無法生效。

**How to apply:** `dist/` 已加入 `.gitignore`。修改 agent 後需 `npm run build` 或 `npm run deploy`（後者會自動 build）。CLAUDE.md 的架構段落已反映新的 build 步驟。
