# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

AGENTS 是跨 AI agent CLI 的共用設定檔部署工具。透過 `scripts/cli.js` 將 `ddd-workflow/` 中的指令檔、skills、agents 以 symlink 部署到各 agent 的設定目錄：

- `~/.claude/CLAUDE.md` + `~/.claude/skills/` + `~/.claude/agents/`
- `~/.gemini/GEMINI.md` + `~/.gemini/skills/` + `~/.gemini/agents/`
- `~/.codex/AGENTS.md` + `~/.codex/skills/`

## 架構

```
AGENTS/                          # monorepo
├── ddd-workflow/                # git subtree（origin: applepig/ddd-workflow dev branch）
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

opencode reference document放在 `reference/opencode/packages/web/src/content/docs/index.mdx`

### 關鍵設計決策

- **ddd-workflow 是 SSOT**：所有可部署內容都在 `ddd-workflow/` 中，其餘為部署邏輯與開發文件
- **Git subtree**：`ddd-workflow/` 以 subtree 方式嵌入，日常直接編輯、一起 commit，發布時用 `subtree push` 推到 GitHub
- **Symlink 部署**：修改 `ddd-workflow/` 內的檔案後不需要重新 deploy（因為是 symlink）
- **cli.js 清理策略**：每次安裝會先移除目標 skills/agents 目錄中所有 `ddd*` 項目，再重新建立個別 symlink，確保不留殘餘
- **Skill 命名**：`ddd.<動作>` 格式（如 `ddd.plan`、`ddd.work`），對應 slash command `/ddd.<name>`
- **Agent 命名**：`ddd-<角色>` 格式（如 `ddd-developer`、`ddd-reviewer`）

## 常用指令

```bash
# 每台電腦第一次 clone / Dropbox 同步後，啟用 tracked git hooks
npm run setup:hooks

# 安裝/更新 symlinks 到所有 agent
npm run deploy

# 驗證 symlink 狀態
npm test

# 檢查 ddd-workflow subtree 是否需要 push / pull
npm run subtree:status
```

## ddd-workflow subtree 工作流

`ddd-workflow/` 以 git subtree 嵌入，remote alias 為 `ddd-workflow`，追蹤獨立 repo 的 `dev` branch。AGENTS parent repo 的整合流程固定為：feature branch → `dev` → PR `dev` -> `main`。

### Branch 規則

- `main`：穩定主線，只接受從 `dev` 發出的 PR。
- `dev`：整合分支，所有 feature 完成後先 merge 到這裡驗證。
- `feat/<編號>-<slug>`：功能分支，編號必須對應 `docs/<編號>-<slug>/` 文件包。
- `subtree/*`：只作為 subtree split / 發布輔助分支，禁止 merge 回 `dev` 或 `main`。

範例：

```bash
git switch dev
git pull
git switch -c feat/16-subtree-sync-hooks
mkdir -p docs/16-subtree-sync-hooks
```

### 日常開發

直接在 feature branch 內編輯 `ddd-workflow/` 與 parent repo 檔案，並把對應文件包一起 commit：

```bash
vim ddd-workflow/skills/ddd.work/SKILL.md
vim scripts/cli.js
vim docs/16-subtree-sync-hooks/spec.md
git add -A
git commit -m "feat: add subtree sync hooks"
```

若 commit 觸及 `ddd-workflow/`，git hook 會用 JSONL 在 stderr 提示下一步，例如建議執行 `npm run subtree:push`。Hook 不會自動 push / pull；同步動作必須由使用者或 LLM agent 明確執行。

### 完成功能後進 dev

功能完成後，先在 feature branch 驗證：

```bash
npm test
npm run test:unit
npm run subtree:status
```

確認通過後，把 feature branch merge 到 `dev`：

```bash
git switch dev
git pull
git merge --no-ff feat/16-subtree-sync-hooks
npm test
npm run test:unit
```

若 `npm run subtree:status` 回報 `SUBTREE_PUSH_REQUIRED`，先同步獨立 repo：

```bash
npm run subtree:push
```

然後 push `dev`：

```bash
git push origin dev
```

### 從 dev 發 PR 到 main

`dev` 驗證完成後，用 GitHub PR 將 `dev` 合併到 `main`。不要直接把 feature branch merge 到 `main`。

```bash
gh pr create --base main --head dev
```

PR 合併後，所有工作站都應更新：

```bash
git switch main
git pull
git switch dev
git pull
npm run subtree:status
```

### 發布 ddd-workflow subtree

將 `ddd-workflow/` 的變更推送到獨立的 GitHub repo：

```bash
npm run subtree:push
```

### 從獨立 repo 拉回 ddd-workflow

只有當獨立 `ddd-workflow` repo 的 `dev` 有 AGENTS 尚未包含的變更時，才拉回 parent repo：

```bash
npm run subtree:pull
```

拉回後必須在 feature branch 或 `dev` 驗證並提交，不要直接在 `main` 操作。

### Git hooks

本 repo 使用 tracked `.githooks/`，避免 Dropbox 在不同電腦同步時留下絕對路徑。每台電腦第一次使用時執行：

```bash
npm run setup:hooks
```

Hook 原則：

- 只透過 stderr 輸出 JSONL 訊息，讓 LLM agent 可以讀取並決定下一步。
- 不自動執行 `git subtree push` / `git subtree pull`，避免 checkout、merge、push 階段產生隱性網路副作用。
- `pre-push` 會在 parent repo push 前擋下尚未同步的 subtree 變更，並提示 `npm run subtree:push`。
- 若確定要跳過檢查，可使用 `AGENTS_SKIP_SUBTREE_CHECK=1 git push`。

常見 hook code：

- `SUBTREE_PUSH_REQUIRED`：先執行 `npm run subtree:push`，再 push parent repo。
- `SUBTREE_PULL_AVAILABLE`：獨立 repo 有新變更，需要時執行 `npm run subtree:pull`。
- `SUBTREE_DIVERGED`：subtree 與 remote 分歧，先停止 push，檢查 history。
- `SUBTREE_SPLIT_BRANCH_DETECTED`：目前在 `subtree/*`，禁止 merge 回 `dev` / `main`。
- `SUBTREE_CROSS_REPO_COMMIT`：commit 同時修改 subtree 與 parent glue code；subtree push 只會發布 `ddd-workflow/` prefix，parent 變更仍要 push parent repo。

## 編輯指引

- 所有 skills、agents、AGENTS.md 的編輯都在 `ddd-workflow/` 內進行
- 修改後不需要重新 deploy（symlink 直接生效）
- 新增 skill：在 `ddd-workflow/skills/` 下建立 `ddd.<name>/SKILL.md`，遵循現有 YAML frontmatter 格式
- 新增 agent：在 `ddd-workflow/agents/` 下建立 `ddd-<role>.md`，frontmatter 必須有 `name`、`description`（含 examples）、`model`、`color`
- Skill 的 `name` 欄位用 `ddd.kebab-case`，與資料夾名稱一致，`description` 須同時包含中文說明和英文 trigger phrases
- 新增 skill/agent 後需重新執行 `npm run deploy` 建立 symlink
- Commit 後若要發布：`git subtree push --prefix=ddd-workflow ddd-workflow dev`
