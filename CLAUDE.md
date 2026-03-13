# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

AGENTS 是跨 AI agent CLI 的共用設定檔專案。透過 `scripts/cli.js` 將統一的指令檔（`src/AGENTS.md`）和 DDD skills 以 symlink 部署到三個 agent 的設定目錄：

- `~/.claude/CLAUDE.md` + `~/.claude/skills/`
- `~/.gemini/GEMINI.md` + `~/.gemini/skills/`
- `~/.codex/AGENTS.md` + `~/.codex/skills/`

## 架構

```
scripts/
  cli.js               # CLI 工具：deploy / undeploy / test
src/
  AGENTS.md            # 唯一真相來源——所有 agent 共用的指令檔
  skills/              # DDD 工作流 skills，每個 skill 一個子目錄
    ddd.<name>/
      SKILL.md         # Skill 定義（YAML frontmatter + markdown 內容）
      references/      # (optional) skill 引用的參考資料
  agents/              # Subagent 定義
    ddd-<role>.md      # Agent 定義（YAML frontmatter + system prompt）
```

### 關鍵設計決策

- **src/AGENTS.md 是 SSOT**：所有 agent 共用同一份指令檔，透過 symlink 而非複製，修改一處即全部生效
- **cli.js 清理策略**：每次安裝會先移除目標 skills/agents 目錄中所有 `ddd*` 項目，再重新建立個別 symlink，確保不留殘餘
- **Skill 命名**：`ddd.<動作>` 格式（如 `ddd.plan`、`ddd.work`），對應 slash command `/DDD.<PascalCase>`
- **Agent 命名**：`ddd-<角色>` 格式（如 `ddd-developer`、`ddd-reviewer`）

## 常用指令

```bash
# 安裝/更新 symlinks 到所有 agent
npm run deploy

# 驗證 symlink 狀態
npm test
```

## 編輯指引

- 修改 `src/AGENTS.md` 後不需要重新 deploy（因為是 symlink）
- 新增 skill：在 `src/skills/` 下建立 `ddd.<name>/SKILL.md`，遵循現有 YAML frontmatter 格式
- 新增 agent：在 `src/agents/` 下建立 `ddd-<role>.md`，frontmatter 必須有 `name`、`description`（含 examples）、`model`、`color`
- Skill 的 `name` 欄位用 `DDD.PascalCase`，`description` 須同時包含中文說明和英文 trigger phrases
- 新增 skill/agent 目錄後需重新執行 `npm run deploy` 建立 symlink
