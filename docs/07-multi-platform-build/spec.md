# Multi-Platform Agent Build

## 目標

在 deploy 前加入 build 步驟，將 `ddd-workflow/agents/*.md`（Claude 格式）自動轉換為 Gemini、OpenCode、Codex 各平台的 agent 定義格式，讓各平台的 tool 權限設定與進階功能能正確生效。

## 非目標

- Skills 轉換（各平台 skill 格式高度一致，繼續 symlink）
- Claude 的 build 產出（原始檔即為 Claude 格式，繼續直接 symlink）
- Watch mode（使用頻率低，手動 `npm run build` 即可）
- Override 檔案（所有轉換邏輯與特例設定集中在 build.js）
- 打包 `scripts/` 目錄下的 JS 腳本

## User Story

作為 ddd-workflow 的維護者，我想要只編輯一份 Claude 格式的 agent 定義檔，在 deploy 時系統自動轉換為各平台專屬格式（Gemini 的 snake_case tool 名稱、OpenCode 的 permission 結構、Codex 的 TOML），以便不用手動維護多份內容相同但格式不同的檔案。

### 驗收條件

- [ ] `npm run build` 讀取 `ddd-workflow/agents/*.md`，產出 `dist/gemini/agents/`、`dist/opencode/agents/`、`dist/codex/agents/`
- [ ] Gemini 產出為 Markdown，tool 名稱正確映射（`Read`→`read_file` 等），欄位名正確映射（`maxTurns`→`max_turns`）
- [ ] OpenCode 產出為 Markdown，`tools` 轉為 `permission` 巢狀結構，含 `mode` 與 `steps` 欄位
- [ ] Codex 產出為 TOML，markdown body 轉為 `developer_instructions`，含 `sandbox_mode` 欄位
- [ ] `npm run deploy` 執行時自動先 build，Gemini/OpenCode/Codex 的 agent symlink 指向 `dist/` 產出
- [ ] Claude deploy 不變（繼續 symlink `ddd-workflow/agents/`）
- [ ] 舊的 `ddd-workflow/opencode/agents/` 目錄移除
- [ ] `dist/` 加入 `.gitignore`
- [ ] `npm test` 驗證 build 產出存在且 frontmatter 格式正確

## 相關檔案

- `scripts/build.js`（新增）— build 主邏輯：讀取原始檔、轉換、輸出
- `scripts/cli.js`（修改）— deploy/undeploy/test 路徑調整
- `package.json`（修改）— 新增 `build` script、加入 `gray-matter` 依賴
- `ddd-workflow/agents/*.md`（不修改）— Claude 格式原始檔，SSOT
- `.gitignore`（修改）— 加入 `dist/`

## 介面/資料結構

### 原始檔（Claude 格式，不修改）

```yaml
---
name: ddd-reviewer
description: >
  DDD 程式碼審查 subagent——獨立審查程式碼變更，產出 review 報告。
  ...
model: inherit
color: blue
tools: ["Read", "Grep", "Glob", "Bash"]
---

你是 DDD 工作流中的獨立程式碼審查員...
```

### Gemini 產出（`dist/gemini/agents/ddd-reviewer.md`）

```yaml
---
name: ddd-reviewer
description: >
  DDD 程式碼審查 subagent——獨立審查程式碼變更，產出 review 報告。
  ...
model: inherit
color: blue
tools:
  - read_file
  - grep_search
  - glob
  - run_shell_command
---

你是 DDD 工作流中的獨立程式碼審查員...
```

轉換規則：
- Tool 名稱映射（見映射表）
- 欄位名映射：`maxTurns` → `max_turns`
- 移除 Gemini 不認識的欄位：`permissionMode`、`skills`、`hooks`、`isolation`、`effort`、`background`、`disallowedTools`
- 保留：`name`、`description`、`model`、`color`、`tools`（已映射）、`max_turns`（已映射）
- Markdown body 原封不動

### OpenCode 產出（`dist/opencode/agents/ddd-reviewer.md`）

```yaml
---
name: ddd-reviewer
description: >
  DDD 程式碼審查 subagent——獨立審查程式碼變更，產出 review 報告。
  ...
mode: subagent
steps: 50
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  edit: deny
  bash: allow
  webfetch: deny
  websearch: deny
  task: deny
  question: deny
---

你是 DDD 工作流中的獨立程式碼審查員...
```

轉換規則：
- 移除 `tools`、`color`、`model`（OpenCode 用 config 設定 model）
- 從 Claude `tools` 自動推導 `permission`（見推導規則表）
- 加入 `mode`（預設 `subagent`）和 `steps`（預設 `50`，或從 `maxTurns` 取）
- 保留：`name`、`description`
- Per-agent 特例可覆蓋預設值（見特例設定）
- Markdown body 原封不動

### Codex 產出（`dist/codex/agents/ddd-reviewer.toml`）

```toml
name = "ddd-reviewer"
description = "DDD 程式碼審查 subagent——獨立審查程式碼變更，產出 review 報告。"
sandbox_mode = "read-only"
developer_instructions = """
你是 DDD 工作流中的獨立程式碼審查員...
"""
```

轉換規則：
- 格式從 Markdown 轉為 TOML
- `description` 取 frontmatter 的完整值（保留多行，TOML 用多行字串）
- Markdown body → `developer_instructions`
- 從 Claude `tools` 推導 `sandbox_mode`：含 `Write` 或 `Edit` → `workspace-write`，否則 → `read-only`
- 移除所有 Claude 專屬欄位（`model`、`color`、`tools` 等）
- 保留：`name`、`description`

### Tool 名稱映射表

| Claude | Gemini |
|--------|--------|
| `Read` | `read_file` |
| `Write` | `write_file` |
| `Edit` | `replace` |
| `Grep` | `grep_search` |
| `Glob` | `glob` |
| `Bash` | `run_shell_command` |

### Claude tools → OpenCode permission 推導規則

| Claude tool | 設為 allow 的 permission |
|-------------|------------------------|
| `Read` | `read`、`list` |
| `Grep` | `grep` |
| `Glob` | `glob` |
| `Write` | `edit` |
| `Edit` | `edit` |
| `Bash` | `bash` |

未被任何 tool 啟用的 permission 預設為 `deny`。完整的 deny 清單：`webfetch`、`websearch`、`task`、`question`、`codesearch`、`skill`、`lsp`、`external_directory`、`doom_loop`。

### Per-Agent 特例設定（build.js 內建）

```js
const AGENT_OVERRIDES = {
  'ddd-reviewer': {
    opencode: {
      mode: 'primary',
      permission: {
        bash: {
          '*': 'deny',
          'git log*': 'allow',
          'git diff*': 'allow',
          'git show*': 'allow',
          'git status*': 'allow',
          'git branch*': 'allow',
          'git --no-pager*': 'allow',
          'git rev-parse*': 'allow',
          'git merge-base*': 'allow',
          'git ls-files*': 'allow',
          'cat *': 'allow',
          'head *': 'allow',
          'tail *': 'allow',
          'wc *': 'allow',
        },
        external_directory: {
          '*': 'deny',
          '/tmp/*': 'allow',
        },
      },
    },
  },
}
```

特例設定採用 deep merge——只覆蓋指定的欄位，其餘保留自動推導的預設值。

## 邊界案例

- **Case 1（YAML 解析錯誤）**：來源的 `.md` 檔案 frontmatter 語法錯誤時，build 應輸出明確的錯誤訊息（含檔名與錯誤原因）並以非零 exit code 結束，不產出任何 dist 檔案
- **Case 2（未知 tool 名稱）**：Claude 原始檔出現映射表中沒有的 tool 名稱時，build 應 warn 並跳過該 tool（不中斷 build）
- **Case 3（新增 agent 檔案）**：新增的 agent 不在 `AGENT_OVERRIDES` 中時，全部使用預設推導規則，不需要手動加設定
- **Case 4（dist 目錄殘留）**：build 前先清空 `dist/` 再重建，避免已刪除的 agent 殘留在 dist 中
- **Case 5（deploy 前未 build）**：`npm run deploy` 內部先執行 build，使用者不需要手動分兩步

## ADR（Architecture Decision Record）

### ADR-1：使用純 Node.js script 而非 Vite

- **決策**：`scripts/build.js` 用 `gray-matter` + `fs` 實作，不引入 Vite
- **原因**：任務本質是文字轉換（讀 YAML → 映射欄位 → 寫檔案），不涉及 JS 打包、HMR、dev server 等前端需求。純 script 相依性低、速度快、與現有 `cli.js` 風格一致
- **替代方案**：Vite Plugin——配置繁瑣，語意不吻合

### ADR-2：轉換邏輯集中在 build.js，不使用 override 檔案

- **決策**：所有平台映射規則與 per-agent 特例都寫在 `build.js` 的 config 區段
- **原因**：override 檔案（如 `ddd-reviewer.opencode.yml`）會分散設定、增加檔案數量，且大部分 agent 的轉換規則是相同的。集中管理讓設定一目了然，新增 agent 時零設定即可工作
- **替代方案**：per-agent override 檔案——彈性高但維護成本也高

### ADR-3：Claude 繼續 symlink 原始檔

- **決策**：Claude deploy 不經過 build，繼續直接 symlink `ddd-workflow/agents/`
- **原因**：原始檔本身就是 Claude 格式，轉換是多此一舉。直接 symlink 讓修改即時生效，開發體驗最好
- **替代方案**：統一從 `dist/claude/` 部署——一致性高但每次修改都要 rebuild

### ADR-4：Codex 使用 TOML 輸出

- **決策**：Codex 產出為 `.toml` 格式，markdown body 放入 `developer_instructions` 欄位
- **原因**：Codex CLI 的 agent 定義格式就是 TOML，不支援 markdown frontmatter。這是唯一需要格式轉換（不只是欄位映射）的平台
- **替代方案**：無——Codex 不接受其他格式
