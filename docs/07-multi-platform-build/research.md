# Research: Multi-Platform Agent 格式調研

調研日期：2026-04-07

## 各平台 Agent 格式比較

### Claude Code

- **路徑**：`~/.claude/agents/*.md`
- **格式**：Markdown + YAML frontmatter
- **必要欄位**：`name`、`description`
- **可選欄位**：`model`、`tools`、`color`、`maxTurns`、`permissionMode`、`skills`、`hooks`、`isolation`、`effort`、`background`、`disallowedTools`、`mcpServers`
- **Tool 名稱慣例**：PascalCase（`Read`、`Write`、`Edit`、`Grep`、`Glob`、`Bash`）
- **指令位置**：markdown body

**範例**：

```yaml
---
name: ddd-reviewer
description: >
  DDD 程式碼審查 subagent——獨立審查程式碼變更，產出 review 報告。
model: inherit
color: blue
tools: ["Read", "Grep", "Glob", "Bash"]
---

You are an independent code reviewer...
```

### Gemini CLI

- **路徑**：`~/.gemini/agents/*.md`
- **格式**：Markdown + YAML frontmatter
- **必要欄位**：`name`、`description`
- **可選欄位**：`model`、`tools`、`color`、`max_turns`、`kind`（local/remote）、`temperature`、`timeout_mins`、`mcpServers`
- **Tool 名稱慣例**：snake_case（`read_file`、`write_file`、`replace`、`grep_search`、`glob`、`run_shell_command`、`list_directory`）
- **指令位置**：markdown body
- **注意**：Gemini CLI 最近更換了 policy engine，spec 階段需要重新調查權限相關欄位是否有變動

**Tool 名稱映射表**：

| Claude | Gemini |
|--------|--------|
| `Read` | `read_file` |
| `Write` | `write_file` |
| `Edit` | `replace` |
| `Grep` | `grep_search` |
| `Glob` | `glob` |
| `Bash` | `run_shell_command` |

### OpenCode

- **路徑**：`~/.config/opencode/agents/*.md`
- **格式**：Markdown + YAML frontmatter
- **必要欄位**：`description`
- **可選欄位**：`name`、`mode`（primary/subagent/all）、`steps`、`permission`（巢狀結構）、`model`（provider/model-id 格式）、`temperature`、`top_p`、`color`、`disable`、`hidden`
- **Tool 系統**：不使用 `tools` 欄位，改用 `permission` 巢狀結構
- **指令位置**：markdown body

**Permission 結構**：

```yaml
permission:
  read: allow          # 簡單的 allow/ask/deny
  edit: deny
  glob: allow
  grep: allow
  list: allow
  bash:                # 支援 pattern matching
    "*": deny
    "git log*": allow
    "git diff*": allow
  webfetch: deny
  websearch: deny
  task: deny
  question: deny
  external_directory:
    "*": deny
    "/tmp/*": allow
```

**可用 permission tool 清單**：`read`、`edit`、`glob`、`grep`、`list`、`bash`、`webfetch`、`websearch`、`codesearch`、`task`、`skill`、`lsp`、`question`、`external_directory`、`doom_loop`

**Claude tools → OpenCode permission 推導規則**（草案）：

| Claude tool | OpenCode permission |
|-------------|-------------------|
| `Read` | `read: allow`、`glob: allow`、`grep: allow`、`list: allow` |
| `Write` | `edit: allow` |
| `Edit` | `edit: allow` |
| `Grep` | `grep: allow` |
| `Glob` | `glob: allow` |
| `Bash` | `bash: allow` |
| 未列出的 tool | 對應 permission 設為 `deny` |

### Codex CLI

- **路徑**：`~/.codex/agents/*.toml`
- **格式**：**TOML**（非 Markdown）
- **必要欄位**：`name`、`description`
- **可選欄位**：`developer_instructions`、`model`、`model_reasoning_effort`（low/medium/high）、`sandbox_mode`（read-only/workspace-write/danger-full-access）、`nickname_candidates`、`mcp_servers`
- **指令位置**：`developer_instructions` 欄位（非 markdown body）
- **權限模型**：`sandbox_mode` 三級制

**Claude tools → Codex sandbox_mode 推導規則**（草案）：

| Claude tools 包含 | Codex sandbox_mode |
|------------------|-------------------|
| `Write` 或 `Edit` | `workspace-write` |
| 僅 `Read`、`Grep` 等 | `read-only` |

**範例**：

```toml
name = "ddd-reviewer"
description = "DDD 程式碼審查 subagent——獨立審查程式碼變更，產出 review 報告。"
sandbox_mode = "read-only"
developer_instructions = """
You are an independent code reviewer...
"""
```

## Skills 格式比較

各平台 skill 格式高度一致，皆使用 `name` + `description` YAML frontmatter，差異極小。目前 symlink 策略可繼續使用，本次不處理。

## 現有專案狀態

- `ddd-workflow/agents/`：2 個 agent（ddd-developer、ddd-reviewer），Claude 格式
- `ddd-workflow/opencode/agents/`：1 個 agent（ddd.xreviewer），為 ddd-reviewer 的 OpenCode 版，新架構完成後可刪除
- `scripts/cli.js`：現有 deploy/undeploy/test 邏輯，需修改 Gemini/OpenCode/Codex 的 deploy 路徑指向 `dist/`

## Gemini CLI Policy Engine 調查結果（2026-04-07）

Gemini CLI 新 policy engine 是**獨立的 `policy.toml` 檔案**，不影響 agent frontmatter 格式。

- Agent `.md` 的 `tools` 欄位仍然有效，policy engine 在 tools 之上加一層細粒度控制
- Policy rules 用 TOML 定義，支援 `toolName`、`argsPattern`、`commandPrefix`、`decision`（allow/deny/ask_user）等欄位
- Policy 可透過 `subagent` 屬性指定特定 agent 的規則
- 支援四種模式：default、autoEdit、plan、yolo
- Tool wildcard 支援：`*`、`mcp_*`、`mcp_server-name_*`

**對 build 的影響**：無。Agent frontmatter 轉換維持原計畫（tool 名稱映射 + 欄位名映射），policy 是獨立關注點。

## 待查事項

- [ ] 各平台對不認識的 frontmatter 欄位的容錯行為（忽略？警告？報錯？）
- [ ] Codex TOML 的完整欄位驗證規則
