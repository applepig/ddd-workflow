# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

AGENTS 是跨 AI agent CLI 的共用設定檔部署工具。透過 `scripts/cli.js` 將 `ddd-workflow/` submodule 中的指令檔、skills、agents 以 symlink 部署到各 agent 的設定目錄：

- `~/.claude/CLAUDE.md` + `~/.claude/skills/` + `~/.claude/agents/`
- `~/.gemini/GEMINI.md` + `~/.gemini/skills/` + `~/.gemini/agents/`
- `~/.codex/AGENTS.md` + `~/.codex/skills/`

## 架構

```
AGENTS/                          # wrapper repo
├── ddd-workflow/                # git submodule（dev branch）
│   ├── skills/                  # DDD 工作流 skills
│   │   └── ddd.<name>/
│   │       ├── SKILL.md         # Skill 定義（YAML frontmatter + markdown）
│   │       └── references/      # (optional) skill 引用的參考資料
│   ├── agents/                  # Subagent 定義
│   │   └── ddd-<role>.md        # Agent 定義（YAML frontmatter + system prompt）
│   └── references/
│       └── AGENTS.md            # 所有 agent 共用的指令檔
└── scripts/
    └── cli.js                   # CLI 工具：deploy / undeploy / test
```

### 關鍵設計決策

- **ddd-workflow 是 SSOT**：所有可部署內容都在 submodule 中，wrapper repo 只負責部署邏輯
- **Submodule 追蹤 dev branch**：本地開發在 dev branch，發布時 merge 到 main
- **Symlink 部署**：修改 submodule 內的檔案後不需要重新 deploy（因為是 symlink）
- **cli.js 清理策略**：每次安裝會先移除目標 skills/agents 目錄中所有 `ddd*` 項目，再重新建立個別 symlink，確保不留殘餘
- **Skill 命名**：`ddd.<動作>` 格式（如 `ddd.plan`、`ddd.work`），對應 slash command `/DDD.<PascalCase>`
- **Agent 命名**：`ddd-<角色>` 格式（如 `ddd-developer`、`ddd-reviewer`）

## 常用指令

```bash
# 安裝/更新 symlinks 到所有 agent
npm run deploy

# 驗證 symlink 狀態
npm test

# 更新 submodule 到最新
git submodule update --remote
```

## 編輯指引

- 所有 skills、agents、AGENTS.md 的編輯都在 `ddd-workflow/` 內進行
- 修改後不需要重新 deploy（symlink 直接生效）
- 新增 skill：在 `ddd-workflow/skills/` 下建立 `ddd.<name>/SKILL.md`，遵循現有 YAML frontmatter 格式
- 新增 agent：在 `ddd-workflow/agents/` 下建立 `ddd-<role>.md`，frontmatter 必須有 `name`、`description`（含 examples）、`model`、`color`
- Skill 的 `name` 欄位用 `DDD.PascalCase`，`description` 須同時包含中文說明和英文 trigger phrases
- 新增 skill/agent 後需重新執行 `npm run deploy` 建立 symlink
- 記得在 `ddd-workflow/` 內 commit 並 push（submodule 有獨立的 git 歷史）
