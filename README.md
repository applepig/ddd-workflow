# AGENTS

跨 AI Agent CLI 的共用設定檔與 DDD（Document Driven Development）工作流。

透過 symlink 將統一的指令檔和 skills/agents 部署到多個 AI agent 的設定目錄，修改一處即全部生效。

## 支援的 Agent CLI

| Agent | 設定目錄 | 指令檔名稱 |
|-------|---------|-----------|
| Claude Code | `~/.claude/` | `CLAUDE.md` |
| Gemini CLI | `~/.gemini/` | `GEMINI.md` |
| Codex CLI | `~/.codex/` | `AGENTS.md` |

## 專案結構

```
scripts/
  cli.js                 # CLI 工具：deploy / undeploy / test
src/
  AGENTS.md              # 唯一真相來源——所有 agent 共用的指令檔
  skills/                # DDD 工作流 skills
    ddd.<name>/SKILL.md  # Skill 定義（YAML frontmatter + markdown）
  agents/                # Subagent 定義
    ddd-<role>.md        # Agent 定義（YAML frontmatter + system prompt）
```

## 快速開始

```bash
# 部署到所有 agent
npm run deploy

# 只部署到特定 agent
npm run deploy:claude

# 驗證部署狀態
npm test

# 移除部署
npm run undeploy
```

## DDD 工作流

Document Driven Development——先寫文件、再寫測試、最後寫程式碼。

### Skills（Slash Commands）

| Skill | 用途 |
|-------|-----|
| `/ddd.plan` | 需求不明確時的前置規劃 |
| `/ddd.research` | 技術調研，驗證可行性 |
| `/ddd.spec` | 撰寫正式規格書 |
| `/ddd.tasks` | 將 spec 拆解為 milestone + task |
| `/ddd.work` | 以 TDD 循環執行開發任務 |
| `/ddd.xreview` | Cross review（Gemini + Claude 獨立審查） |
| `/ddd.architect-refactor` | 架構層級重構 |
| `/ddd.create-hooks` | 設定 Claude Code hooks |
| `/ddd.code-to-spec` | 從既有程式碼反向萃取規格 |
| `/ddd.agent-browser` | E2E 除錯（瀏覽器自動化） |

### Subagents

| Agent | 角色 |
|-------|-----|
| `ddd-developer` | 開發者，以 TDD 循環實作功能與測試 |
| `ddd-debugger` | 系統性分析錯誤、驗證修復 |
| `ddd-reviewer` | 獨立審查程式碼變更 |
| `ddd-researcher` | 技術調研，評估方案 |

## 開發

新增 skill 或 agent 後，執行 `npm run deploy` 建立 symlink。由於是 symlink，修改 `src/` 下的檔案會即時生效，不需要重新部署。
