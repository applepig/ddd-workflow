---
name: xreview reviewer 重構完成
description: xreview-3 扶正 + review-prompt.md 整合進 ddd-reviewer agent，所有 review 邏輯集中在 agent 定義中
type: project
---

xreview 經歷了兩次重構，目前狀態：

**第一階段**（2026-04-07，commit 441869f）：xreview-3 扶正合併到 `ddd.xreview`
- CLI 抽象層（`xreview-runner.sh` 支援 `cli:model` 格式）
- 獨立的 `review-prompt.md` 模板 + `cli-adapters.md` 參考文件
- Timeout 預設 1200 秒

**第二階段**（2026-04-08，commit e3ff3b4）：reviewer 重構
- `references/review-prompt.md` 已刪除，review prompt 整合進 `ddd-reviewer.md` agent 定義
- 動機：ddd-reviewer 也會安裝在外部 agent（Gemini 等），把 prompt 放在 agent 裡可以跨平台沿用
- 參考了 GitHub 上熱門 review skill 的做法

**How to apply:** review prompt 的修改現在直接改 `ddd-workflow/agents/ddd-reviewer.md`，不再有獨立的 prompt 模板檔。Gemini reviewer 因 429 rate limit 暫停中（AGENTS.md 已移除）。
