# Multi-Platform Agent Build 規劃

## 背景 (Background)

目前 `ddd-workflow/agents/*.md` 以 Claude Code 格式撰寫，透過 `scripts/cli.js` 以 symlink 直接部署到所有平台（Claude、Gemini、OpenCode、Codex）。但各平台的 agent 定義格式存在實質差異：

- **Gemini CLI**：tool 名稱用 snake_case（`read_file`、`run_shell_command`），欄位名如 `max_turns` 與 Claude 的 `maxTurns` 不同。另外 Gemini CLI 最近更換了 policy engine，權限相關欄位需要在 spec 階段重新調查
- **OpenCode**：不用 `tools` 欄位，改用 `permission` 巢狀結構控制工具存取；有 `mode`（primary/subagent）和 `steps` 等獨有欄位
- **Codex CLI**：完全不同的檔案格式（TOML），指令放在 `developer_instructions` 欄位而非 markdown body；權限用 `sandbox_mode` 三級制

目前的 symlink 策略靠各平台「容忍不認識的欄位」勉強運作，但 tool 權限設定實際上沒有生效，各平台也無法使用自身的進階功能。

## 粗略目標 (High-level Goals)

1. 在 deploy 前加入 build 步驟，將 Claude 格式的 agent 原始檔轉換為各平台專屬格式，輸出到 `dist/<platform>/agents/`
2. 所有轉換邏輯（包括平台特例）集中在 `scripts/build.js`，不使用 override 檔案
3. Claude 維持 symlink 原始檔（不經過 build）；Gemini、OpenCode、Codex 改為 symlink `dist/` 產出
4. 範圍限定為 agent 轉換，skills 繼續現有 symlink 策略

## 決策方向 (Selected Direction)

### 架構

```
ddd-workflow/agents/
  ddd-developer.md       # Claude 原始檔（SSOT）
  ddd-reviewer.md        # Claude 原始檔（SSOT）

scripts/build.js          # 全部轉換邏輯 + 平台映射表 + 特例設定

dist/                     # build 產出（加入 .gitignore）
  gemini/agents/          # Markdown，tool 名稱與欄位名映射
  opencode/agents/        # Markdown，tools → permission 轉換
  codex/agents/           # TOML，body → developer_instructions
```

### 轉換策略

以 Claude 格式為 SSOT，build.js 內建映射規則自動推導各平台格式：

**可自動推導的轉換**（寫在 build.js 的映射表）：

| 轉換 | 規則 |
|------|------|
| Gemini tool 名稱 | `Read`→`read_file`、`Write`→`write_file`、`Edit`→`replace`、`Grep`→`grep_search`、`Glob`→`glob`、`Bash`→`run_shell_command` |
| Gemini 欄位名 | `maxTurns`→`max_turns` |
| OpenCode permission | 從 Claude `tools` 推導：有 `Read` → `read: allow` 等，未列出 → `deny` |
| OpenCode mode | 預設 `subagent` |
| OpenCode steps | 從 `maxTurns` 推導，或使用預設值 |
| Codex sandbox_mode | 有 `Write`/`Edit` → `workspace-write`，否則 → `read-only` |
| Codex 格式 | Markdown → TOML，body → `developer_instructions` |

**平台特例**（也寫在 build.js 的 config 區段）：

例如 ddd-reviewer 在 OpenCode 需要 `mode: primary` 和細粒度 bash 白名單，這類例外直接在 build.js 中用 per-agent config 覆蓋預設值。

### Build 工具

純 Node.js script（`scripts/build.js`），搭配 `gray-matter` 解析 YAML frontmatter。不使用 Vite 或其他打包工具——這個任務本質是文字轉換，不需要前端打包生態。

### CLI 變更

- 新增 `npm run build`：`node scripts/build.js`
- 修改 `npm run deploy`：先 build 再 deploy
- `cli.js` 的 Gemini/OpenCode/Codex deploy 改為 symlink `dist/<platform>/agents/`
- Claude deploy 不變（繼續 symlink 原始檔）
- 現有的 `ddd-workflow/opencode/agents/` 目錄在新架構完成後刪除

### 不做的事

- Skills 轉換（格式差異極小，繼續 symlink）
- Watch mode（使用頻率低，手動 `npm run build` 即可）
- `dist/claude/`（Claude 直接 symlink 原始檔）
- Override 檔案（特例邏輯集中在 build.js）
- 中間格式 / 通用格式

## 待釐清事項 (Open Questions)

- Gemini CLI 新 policy engine 的具體格式與欄位變動（spec 階段調查）
- 各平台對不認識的 frontmatter 欄位的容錯行為
- Codex TOML 的完整欄位驗證規則
- OpenCode permission 推導規則的完整性驗證（是否有遺漏的 tool 對應）

## 下一步建議 (Next Step)

規劃已確認，建議執行 `/DDD.spec` 定義規格。Spec 階段需要：

1. 調查 Gemini CLI 新 policy engine 格式
2. 定義完整的平台映射表（含所有欄位的轉換規則）
3. 定義 build.js 的 per-agent config 結構
4. 定義驗收條件
