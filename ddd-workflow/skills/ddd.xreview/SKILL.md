---
name: DDD.Xreview
description: >
  Cross review——同時派 Gemini 和 Claude 獨立審查程式碼，整合雙方意見回報。
  Use when the user says "review code", "cross review", "let's review",
  "check my changes", "review this sprint", or invokes "/DDD.xreview".
  Use after development work to get independent code review from two different
  AI models before committing or pushing.
---

# DDD:xreview — Cross Review

以「第二雙眼睛」的概念，同時派出兩個獨立的 reviewer（Gemini + Claude）審查當前 sprint 的變更，再整合雙方意見呈現給使用者決定是否採納。

不同模型有不同的訓練資料與推理傾向，交叉比對能找出單一模型容易忽略的問題。

## 嚴格禁令 (Never Do)

- **嚴禁自動修改程式碼**：review 的目的是產出建議，不是直接改 code。自動修改會繞過使用者的判斷，讓 review 變成黑箱。所有修改必須由使用者確認後才執行。
- **嚴禁省略任一 reviewer 的意見**：即使兩邊結論相似，仍須完整呈現。使用者需要看到兩個獨立觀點才能做出判斷。

## 執行步驟

### 1. 確認 Review 範圍

確認要 review 什麼：

- **Sprint 文件路徑**：當前 sprint 的 `spec.md`、`tasks.md` 位置
- **變更範圍**：是 uncommitted changes（`git diff HEAD`）還是 branch diff（`git diff main...HEAD`）

不需要預先讀取這些內容——reviewer 會自己蒐集。

### 2. 組裝 Review Prompt

使用下方的 prompt 模板，將步驟 1 確認的範圍資訊填入 `<placeholder>` 處，組成完整的 review prompt。兩個 reviewer 使用相同的 prompt。

<details>
<summary>Review Prompt 模板</summary>

```
你是一位資深的 code reviewer。請審查以下範圍的程式碼變更。

## Review 範圍

- **Sprint 文件**：<spec.md 和 tasks.md 的路徑>
- **變更內容**：請自行執行 `<git diff 指令>` 取得變更

請先讀取 sprint 文件理解目標與驗收條件，再檢視程式碼變更。

## 審查維度

請依以下維度逐一審查，每個維度給出「通過 / 建議改善 / 需修正」的判定：

1. **正確性 (Correctness)**：邏輯是否正確？是否符合 spec 的驗收條件？
2. **邊界案例 (Edge Cases)**：是否處理了空值、錯誤輸入、極端情況？
3. **安全性 (Security)**：是否有注入、XSS、敏感資料洩漏等風險？
4. **效能 (Performance)**：是否有不必要的迴圈、重複計算、記憶體洩漏？
5. **可維護性 (Maintainability)**：命名是否清楚？結構是否合理？是否符合專案規範？
6. **測試覆蓋 (Test Coverage)**：變更的邏輯是否都有對應的測試？

## 輸出格式

請用以下格式回覆：

### 總評
<一段話總結整體品質>

### 各維度評估
| 維度 | 判定 | 說明 |
|------|------|------|
| 正確性 | ✅/⚠️/❌ | ... |
| 邊界案例 | ✅/⚠️/❌ | ... |
| 安全性 | ✅/⚠️/❌ | ... |
| 效能 | ✅/⚠️/❌ | ... |
| 可維護性 | ✅/⚠️/❌ | ... |
| 測試覆蓋 | ✅/⚠️/❌ | ... |

### 具體問題
1. **[嚴重度: 高/中/低]** 檔案:行號 — 問題描述與建議修正方式
2. ...

### 優點
- 值得肯定的設計或實作
```

</details>

### 3. 平行派出兩個 Reviewer

使用 `run_in_background` 同時發出兩個 review 請求，兩邊都不帶當前對話 context，確保 reviewer 的判斷不受開發者（主 agent）思路影響。

**[A] External Reviewer**（透過系統上安裝的其他 AI agent CLI，如 `gemini`、`codex` 等）：

```bash
echo "$review_prompt" | gemini --yolo --output-format text
```

> 透過 stdin pipe 傳入 prompt，避免 prompt 內容暴露在 process 命令列中。若系統上沒有 Gemini CLI，可替換為其他可用的 AI CLI（如 `codex`）。

**[B] Claude Reviewer**（Agent tool）：

使用 Agent tool 啟動 subagent，將組裝好的 review prompt 作為 `prompt` 參數傳入。subagent 自帶 Read、Glob、Grep、Bash 等工具，可自行讀取檔案與執行 git 指令。

> 不使用 `claude -p` CLI 的原因：Claude Code 禁止巢狀啟動（nested session），在 Claude Code 內執行 `claude -p` 會直接報錯。Agent tool 的 subagent 擁有獨立 context，功能等價且無此限制。

兩邊都設定 `run_in_background: true`，平行執行不阻塞。

### 4. 整合與呈現

收到兩邊結果後，整理成對照報告呈現給使用者：

```markdown
# Cross Review 報告

## 🤖 Gemini 評估
<Gemini 的完整 review 結果>

## 🧠 Claude 評估
<Claude subagent 的完整 review 結果>

## 📊 交叉比對
| 維度 | Gemini | Claude | 共識 |
|------|--------|--------|------|
| 正確性 | ✅ | ✅ | 一致 |
| 邊界案例 | ⚠️ | ✅ | 分歧——需使用者判斷 |
| ... | ... | ... | ... |

## 🔍 分歧點
<列出兩邊意見不同的地方，說明各自的理由>

## ✅ 共識問題
<列出兩邊都指出的問題——這些最值得優先處理>
```

### 5. 使用者決策

用 AskUserQuestion 向使用者確認：
- 哪些建議要採納並修正？
- 哪些可以忽略？
- 是否需要針對特定問題深入討論？

使用者決定後，由主 agent 執行修正。

## 注意事項

- 兩邊 reviewer 都會讀到同一份 AGENTS.md，共享 coding style 規範，不需要在 prompt 中重複
- Reviewer 自己有能力讀檔案、跑 git 指令，prompt 只需指定 review 範圍與審查維度
- 執行時間可能較長（60-120 秒），務必使用 `run_in_background` 避免阻塞
- **安全性**：Gemini 端一律用 stdin pipe 傳 prompt，嚴禁用 `-p` 參數直接帶入（會暴露在 process 命令列）
- 若變更範圍太大，考慮按檔案或 milestone 拆分 review
- 若任一 reviewer 超時或失敗，先呈現已取得的單邊結果，提示使用者是否重試另一邊

## 產出

- Cross Review 對照報告（在對話中呈現）
- 使用者確認後的程式碼修正

## 結束條件

使用者確認 review 結果，修正完成（或決定不修正）。
