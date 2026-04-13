---
name: xreview reviewer 重構完成
description: xreview 多階段重構終點——Monitor + orchestrator 派發、模型清單移到 ~/.config JSON、ddd.xreview2 扶正為 ddd.xreview
type: project
originSessionId: 944cf73b-f62b-465a-96eb-1ff85e8b9a89
---
xreview 經歷四階段重構，目前狀態：

**第一階段**（2026-04-07，commit 441869f）：xreview-3 扶正合併到 `ddd.xreview`
- CLI 抽象層（`xreview-runner.sh` 支援 `cli:model` 格式）
- 獨立的 `review-prompt.md` 模板 + `cli-adapters.md` 參考文件
- Timeout 預設 1200 秒

**第二階段**（2026-04-08，commit e3ff3b4）：reviewer 重構
- `references/review-prompt.md` 已刪除，review prompt 整合進 `ddd-reviewer.md` agent 定義
- 動機：ddd-reviewer 也會安裝在外部 agent（Gemini 等），把 prompt 放在 agent 裡可以跨平台沿用

**第三階段**（2026-04-13 早段，commit ed80973）：Monitor + orchestrator
- 新增 `xreview-orchestrator.sh`：單一 Monitor 入口 fan-out 所有 reviewer，繞過 Bash tool 10 分鐘 hard cap
- 以 `ddd.xreview2` fork 並存驗證

**第四階段**（2026-04-13 晚段）：扶正 + 配置中心化
- `ddd.xreview2` → `ddd.xreview`（覆蓋舊版，trash 處理）
- orchestrator 加雙模：CLAUDECODE → streaming（純事件流給 Monitor）；其他 → blocking（事件流 + footer 列出 log 路徑）
- 模型清單從 AGENTS.md 表格搬到 `~/.config/ddd-workflow/xreview.json`，CLI 參數可一次覆蓋
- `npm run deploy` 加 `deployConfig()`：copy if not exists（保留使用者自訂）
- 預設 Claude reviewer 改為 `claude-opus-4-6`
- AGENTS.md「Cross Review 模型設定」段落從整張表變一段話指向 config 路徑

**How to apply:**
- 改模型清單：直接編輯 `~/.config/ddd-workflow/xreview.json`，不需動 AGENTS.md
- 改 review 行為：改 `ddd-workflow/agents/ddd-reviewer.md`
- 改 orchestrator 行為：`ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.sh`，跑 `xreview-orchestrator.test.sh` 驗證
- Mode 偵測陷阱：opencode 跑在 CC 裡時 CLAUDECODE 會被繼承導致誤判 streaming，必要時用 `XREVIEW_MODE=blocking` 覆寫
