# ddd.clisync — 跨平台 Project Config 同步

## 背景

AGENTS 專案已有 `build.js`（agent 格式轉換）和 `cli.js`（symlink 部署）處理 **global scope** 的跨平台同步。但 **project scope** 的設定（hooks、MCP、project-local skills/agents）尚未涵蓋。

各 AI CLI 工具（Claude Code、Gemini CLI、Codex CLI、OpenCode）在 project 內各自維護設定檔，格式與位置皆不同，容易 out of sync。

## 目標

建立 `/ddd.clisync` skill，在 project 層級同步四個平台的：

- **Hooks**：event-driven 自動化
- **Skills**：project-local skill 定義
- **Agents**：project-local agent 定義
- **MCP servers**：Model Context Protocol server 設定

## 非目標

- Global scope 同步（已由 `npm run deploy` 處理）
- Instructions/rules 檔案同步（已由 symlink 處理；dotagent 做的事）
- Permissions / model preferences 等設定同步

## 兩種操作模式

### Greenfield（Push）

使用者在某個平台寫好設定後，同步到其他平台。

典型場景：「我寫了一個 skill，幫我 clisync 到其他平台。」

流程：
1. 使用者指定 source platform + 要同步的項目
2. 讀取 source 的 project config
3. 轉換為 CC canonical 格式（中間表示）
4. 從 canonical 輸出到各 target platform
5. 列出「無法對映」的項目讓使用者決定

### Brownfield（Audit）

蒐集所有平台的 project config，比對語意等價性，產出健檢報告。

典型場景：「幫我看看各平台的設定有沒有 out of sync。」

流程：
1. 派 subagent 蒐集各平台的 project config
2. 正規化為 canonical 格式後比對
3. 產出 diff 報告：missing / out-of-sync / format error / unsupported
4. 使用者決定要修哪些

## 各項目的同步策略

### MCP Servers — invoke mcpup

MCP 設定的跨平台同步已有成熟工具 [mcpup](https://github.com/mohammedsamin/mcpup)（Go，支援 13 clients）。

- Canonical config 在 `~/.mcpup/config.json`
- 支援 CC、Gemini、Codex、OpenCode 等
- 有 `doctor` 診斷、rollback、profiles

策略：skill 偵測 MCP 相關需求時，引導使用者透過 `mcpup` 操作，不自幹轉換。

### Skills — 自幹 project-scope sync

各平台都吃 `SKILL.md`（YAML frontmatter + Markdown），格式高度一致。

- CC：`.claude/skills/<name>/SKILL.md`
- Gemini：`.gemini/skills/<name>/SKILL.md`
- Codex：`.codex/skills/<name>/SKILL.md`
- OpenCode：通過 `opencode.json` 的 `skills.paths` 指定

策略：直接 copy 或 symlink，幾乎不需要格式轉換。

### Agents — 自幹（延伸 build.js 邏輯）

已有 `build.js` 處理 CC canonical → Gemini/OpenCode/Codex 的轉換，包括：

- Tool 名稱映射（CC → Gemini：`Read` → `read_file` 等）
- Permission 推導（CC tools → OpenCode permission 物件）
- Sandbox mode 推導（CC tools → Codex `sandbox_mode`）
- TOML 格式輸出（Codex）
- Per-agent override（`AGENT_OVERRIDES`）

策略：將 `build.js` 的轉換函式抽出，供 `transpile.js` 在 project scope 複用。

### Hooks — 自幹，AI-assisted

Hooks 是四個項目中差異最大的，也是目前生態系中**無人處理**的領域。

#### 平台差異

**設定檔位置：**

| 平台 | 檔案 | 格式 |
|------|------|------|
| Claude Code | `.claude/settings.json` → `hooks` | JSON |
| Gemini CLI | `.gemini/settings.json` → `hooks` | JSON（matcher group 結構） |
| Codex CLI | `codex.toml` → `[hooks.*]` | TOML（command/prompt/agent type） |
| OpenCode | plugin 系統 | 不直接設定，需透過 plugin |

**Event 名稱對照：**

| 語意 | Claude Code | Gemini CLI | Codex CLI | OpenCode |
|------|------------|-----------|-----------|----------|
| Session 開始 | `SessionStart` | `SessionStart` | `SessionStart` | plugin |
| Tool 執行前 | `PreToolUse` | `BeforeTool` | `PreToolUse` | plugin |
| Tool 執行後 | `PostToolUse` | `AfterTool` | `PostToolUse` | plugin |
| 使用者送出 prompt | `UserPromptSubmit` | `BeforeAgent` | `UserPromptSubmit` | plugin |
| Session 結束 | `Stop` | `SessionEnd` | `Stop` | plugin |
| Permission 攔截 | `PermissionRequest` | — | `PermissionRequest` | — |
| Model 前/後 | — | `BeforeModel` / `AfterModel` | — | — |
| Subagent 生命週期 | `SubagentStart` / `SubagentStop` | — | — | — |
| 壓縮前/後 | `PreCompact` / `PostCompact` | `PreCompress` | — | — |

**結構差異：**

```jsonc
// Claude Code
{ "hooks": { "PreToolUse": [{ "command": "...", "if": "Bash(git *)" }] } }

// Gemini CLI
{ "hooks": { "BeforeTool": [{ "matcher": "write_file", "hooks": [{ "name": "x", "type": "command", "command": "..." }] }] } }

// Codex CLI（TOML）
// [hooks.PreToolUse] 底下 matcher group，支援 command / prompt / agent 三種 type
```

**策略：** 無法機械轉換。Skill 提供：
1. 各平台的 API reference（hook schema 完整文件）
2. 按用途組織的 sample code（每份都含四平台寫法）
3. AI 在 context 中讀取 reference + sample，為使用者生成目標平台的 hook

## Canonical 格式

以 CC 的 JSON 結構為基礎，加上 `_ext` namespace 保留平台特有資訊：

```jsonc
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["server.js"],
      "env": { "API_KEY": "${API_KEY}" },
      "_ext": {
        "gemini": { "trust": true, "includeTools": ["search"] },
        "codex": { "default_tools_approval_mode": "approve" }
      }
    }
  }
}
```

Hooks 不使用 canonical 格式（差異太大），改用 reference + sample 引導 AI 生成。

## Skill 檔案結構

```
ddd-workflow/skills/ddd.clisync/
├── SKILL.md                          # 流程指引（greenfield / brownfield 模式）
├── references/
│   ├── platforms/                    # 各平台 API reference
│   │   ├── claude-code.md            # CC settings schema（hooks + MCP）
│   │   ├── gemini-cli.md             # Gemini settings schema
│   │   ├── codex-cli.md              # Codex config.toml schema
│   │   └── opencode.md              # OpenCode opencode.json schema
│   └── samples/                      # 按用途組織，每份含四平台寫法
│       ├── hooks/
│       │   ├── pre-tool-guard.md     # tool 執行前攔截檢查
│       │   ├── session-init.md       # session 開始注入 context
│       │   ├── post-edit-lint.md     # 編輯後自動 lint/format
│       │   └── stop-loop.md          # 結束前攔截（iterative loop）
│       ├── mcp/
│       │   ├── stdio-server.md       # 本地 stdio MCP server
│       │   ├── remote-server.md      # SSE / HTTP remote server
│       │   └── with-auth.md          # 帶認證的 server
│       └── agents/
│           ├── readonly-reviewer.md  # 唯讀 review agent
│           └── write-worker.md       # 可寫入的 worker agent
└── scripts/
    └── transpile.js                  # skills / agents 的 project-scope 格式轉換
```

## 外部工具依賴

| 工具 | 用途 | 安裝 |
|------|------|------|
| `mcpup` | MCP server 跨平台同步 | `brew install mcpup` 或 Go binary |

## 競品調研摘要

| 工具 | Stars | 做什麼 | 我們的關係 |
|------|-------|--------|-----------|
| **CC Switch** | 53.6k | Desktop GUI 全管理 | 不同定位（GUI vs CLI skill） |
| **dotagent** | 128 | Instructions/rules transpile（16 格式） | 不需要（我們用 symlink 已解決） |
| **mcpup** | 12 | MCP config sync（13 clients） | 直接 invoke |
| **agentlink** | 0 | MCP sync（CC/Gemini/OpenCode/Codex） | mcpup 的替代方案 |
| **ai-agent-config-sync** | 2 | Skills + MCP + instructions sync | 架構類似但用 rsync，不如我們完整 |

**Hooks 跨平台同步：目前生態系中無人處理，是本 skill 的差異化核心。**

## 待決事項

1. **OpenCode hooks**：它用 plugin 系統而非設定檔，是否支援？還是標 "unsupported" 在報告裡？
2. **Platform 偵測**：自動偵測 project root 有哪些 `.claude/`、`.gemini/` 目錄來決定 target？還是由使用者指定？
3. **transpile.js 與 build.js 的共用**：是 import build.js 的函式，還是 copy 一份獨立版本到 skill 裡？
4. **mcpup 安裝引導**：使用者沒裝 mcpup 時，skill 應該自動安裝還是只提示？
