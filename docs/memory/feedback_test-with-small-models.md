---
name: 真實測試用小模型
description: 端到端／實跑測試一律用各家 CLI 的小模型（mini / flash / haiku）節省成本
type: feedback
originSessionId: c86afa16-07c7-44b8-90f0-59b3eae019ee
---
真實呼叫 CLI 的 e2e / smoke test 用各家小模型：`claude:haiku` / `gemini:flash` / `opencode:...mini` / `codex` 小模型。

**Why**：跑 xreview 實測時預設用旗艦模型（opus / pro / gpt-5.4）會吃掉大量 token quota，對 sprint 工作驗證只要看流程跑通即可，不需要最高品質 review。

**How to apply**：
- M7.4 類端到端驗證改用 haiku/flash/mini 跑 4 reviewer
- 臨時 smoke test 直接覆寫 CLI args（`... haiku flash mini <codex-small>`）而非動 config 預設
- 需要真實品質評估（正式 cross review commit 前）才用旗艦模型
- `~/.config/ddd-workflow/xreview.json` 的 `reviewers` 預設保持旗艦（`opus / 5.4 / pro`）供正式 review，測試時 ad-hoc 覆蓋
