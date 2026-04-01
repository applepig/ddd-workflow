# OpenCode CLI 調研

調研日期：2026-03-31
來源：https://github.com/anomalyco/opencode（v1.3.9）

## 概述

OpenCode 是開源 AI coding agent CLI（MIT License），定位與 Claude Code / Codex CLI / Gemini CLI 相同。核心差異：**不綁定任何 provider**，支援 20+ 家模型供應商。

- Stars：133,150
- 語言：TypeScript（Bun runtime）
- npm package：`opencode-ai`
- TUI：自研 OpenTUI 引擎

## 關鍵特性

| 面向 | 說明 |
|------|------|
| 多 Provider | OpenAI、Anthropic、Google、GitHub Copilot、Bedrock、Azure、Groq、OpenRouter、本地模型等 |
| Client/Server 架構 | TUI 只是 client 之一，可 `opencode serve` 啟動 headless server |
| LSP 整合 | 內建 LSP 支援（type info、diagnostics） |
| Plugin 系統 | npm package 形式的 plugin |
| Agent Skills 標準 | 支援 `SKILL.md`，相容 `.claude/skills`、`.cursor/skills` 目錄 |
| Desktop App | Electron，Beta 階段 |

## Headless 模式

```bash
# 非互動式執行
opencode run "prompt here"
opencode run --model google/gemini-2.5-flash "prompt"
opencode run --agent reviewer --model openai/gpt-5.4 "prompt"
opencode run --format json "prompt"     # JSON 事件流輸出

# stdin pipe
echo "prompt" | opencode run

# 繼續 session
opencode run --continue
opencode run --session <id>

# 啟動 headless server
OPENCODE_SERVER_PASSWORD=secret opencode serve --port 4096
```

`run` 模式下所有 permission request **自動 deny**。

## Permission 系統

每種 tool 有三種權限等級：`allow`、`ask`、`deny`。支援 glob pattern 細粒度控制。

```yaml
# Agent 定義的 YAML frontmatter
permission:
  edit: deny                    # 簡單格式
  bash:                         # 物件格式（glob pattern）
    "*": deny
    "git diff*": allow
    "git log*": allow
  webfetch: deny
```

### 可用 Permission 鍵

| 鍵 | 控制對象 | Pattern 匹配 |
|---|---|---|
| `read` | 讀取檔案 | 檔案路徑 |
| `edit` | 所有檔案修改 | 檔案路徑 |
| `bash` | 執行 shell 指令 | 指令字串 |
| `glob` | 檔案搜尋 | glob pattern |
| `grep` | 內容搜尋 | regex |
| `list` | 列出目錄 | 目錄路徑 |
| `task` | 啟動 subagent | agent 名稱 |
| `webfetch` | 抓取 URL | URL |
| `websearch` | 網頁搜尋 | query |
| `question` | 向使用者提問 | — |
| `external_directory` | 存取工作目錄外路徑 | 路徑 pattern |

## Agent 定義格式

放在 `~/.config/opencode/agents/<name>.md` 或 `.opencode/agents/<name>.md`。

```markdown
---
description: "Agent 說明"
model: "provider/model-id"
mode: "subagent"              # primary | subagent | all
temperature: 0.1
steps: 10                     # 最大 agentic 迭代次數
permission:
  edit: deny
  bash:
    "*": deny
    "git log*": allow
---

System prompt 內容（markdown body）
```

### 驗證通過的 Reviewer Agent 設定

```yaml
---
description: Read-only code reviewer
permission:
  read: allow
  edit: deny
  bash:
    "*": deny
    "git log*": allow
    "git diff*": allow
    "git show*": allow
    "git status*": allow
    "git branch*": allow
    "git --no-pager*": allow
    "git rev-parse*": allow
    "git merge-base*": allow
    "git ls-files*": allow
  glob: allow
  grep: allow
  list: allow
  webfetch: deny
  websearch: deny
  task: deny
  question: deny
---
```

驗證結果（2026-03-31）：
- ✅ `edit: deny` 確實阻擋寫入
- ✅ `bash` 白名單正確放行 git 指令
- ✅ stdin pipe 正常運作
- ✅ Google AI 和 OpenAI API key 認證正常
- ⚠️ 模型名稱需用短格式（`gemini-2.5-flash` 而非 `gemini-2.5-flash-preview-05-20`）

## 認證方式

| 方式 | 說明 |
|------|------|
| API Key | 環境變數或 config 中 `providers.<name>.options.apiKey` |
| GitHub Copilot | 自動讀取 `~/.config/github-copilot/hosts.json` |
| OAuth | 支援 device code flow |
| AWS Bedrock | AWS credential chain |
| Azure OpenAI | Resource name + API key 或 Entra ID |

## 費用評估（搭配 Copilot Pro $10/月）

| 模型 | Multiplier | 300 reviews/月消耗 |
|------|-----------|-------------------|
| GPT-5.4 | 1x | 300 requests（剛好用完） |
| GPT-5.4 mini | 0.33x | 100 requests |
| Gemini 3.1 Pro | 1x | 300 requests |
| Claude Sonnet 4.6 | 1x | 300 requests |
| Claude Opus 4.6 | 3x | 900 requests（需 Pro+ 或超額） |

超額費率：$0.04/request。

直接用 API 的對比（每次 ~30K input + ~3K output）：

| 模型 | 每次成本 | 300 次/月 |
|------|---------|-----------|
| GPT-5.4 | $0.12 | $36 |
| Gemini 3.1 Pro | $0.10 | $29 |
| Gemini 2.5 Pro | $0.07 | $20 |
| Gemini 2.5 Flash | $0.02 | $5 |

Copilot Pro $10/月 ≈ $0.033/次，比直接 API 便宜約三倍。

## `run` 模式掛住問題調研（2026-03-31 追加）

### 問題

`opencode run --agent reviewer` 在 reviewer 碰到 permission denied 後永久掛住，Bash tool 顯示 `Status: running` 直到 timeout。

### 根因

1. **`external_directory` 預設 `"ask"`**：headless 模式無法回答互動式 prompt → 永久等待
2. **無內建 timeout**：`opencode run` 沒有 `--timeout`、`--max-turns` flag
3. **已知 bug**：GitHub issues #8203、#4506、#3503、#14473

### 解法（三層）

| 層次 | 機制 | 作用 |
|------|------|------|
| Agent 定義 | 所有 permission key 明確設為 allow/deny | 消除 `"ask"` hang |
| Agent 定義 | `steps: 50` | 限制迭代次數 |
| Shell wrapper | `timeout 300` 包裝 | 最終兜底 |

關鍵：`external_directory: deny` 必須明確設定。

### 替代方案：ACP 模式

OpenCode 有三種 server 模式：

| 模式 | 指令 | 協定 | 適用場景 |
|------|------|------|---------|
| Headless | `opencode run` | CLI stdio | 簡單一次性（會掛） |
| ACP | `opencode acp` | JSON-RPC over stdio | 自動化/IDE 整合 |
| HTTP | `opencode serve` | REST API | 遠端/多 client |
| MCP 管理 | `opencode mcp` | — | 只用來加 MCP server |

`opencode acp` 最適合自動化——JSON-RPC 協定可精確控制超時，但需要 client wrapper。

目前用 `run` + permission 修正 + timeout wrapper 已夠用，若仍不穩定再考慮 ACP。

## Gemini CLI Read-Only 調研（附帶結論）

在調研過程中也評估了 Gemini CLI 的 read-only 方案：

### `--approval-mode plan` 不適用

Plan mode 會注入系統 prompt：「你的唯一目的是研究、分析、建立詳細的實作計畫」——會與 review prompt 衝突。

### Policy Engine 可行但複雜

```toml
[[rule]]
toolName = "run_shell_command"
commandRegex = "^git (diff|log|show|status|branch)"
decision = "allow"
priority = 200

[[rule]]
toolName = "run_shell_command"
decision = "deny"
priority = 100

[[rule]]
toolName = ["write_file", "replace", "delete_file"]
decision = "deny"
priority = 100
```

### 結論

OpenCode 的 permission 系統比 Gemini Policy Engine 更簡潔，且不需要額外的 TOML 檔案。統一用 OpenCode 驅動所有外部 reviewer 是更好的選擇。
