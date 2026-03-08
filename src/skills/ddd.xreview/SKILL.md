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

讀取 `references/review-prompt.md` 取得 prompt 模板，將步驟 1 確認的範圍資訊填入，組成完整的 review prompt。兩個 reviewer 使用相同的 prompt。

### 3. 平行派出兩個 Reviewer

使用 Bash tool 的 `run_in_background` 同時發出兩個 review 請求：

**[A] Gemini Reviewer**：

```bash
gemini -p "<review_prompt>" --yolo --output-format text
```

**[B] Claude Reviewer**：

```bash
claude -p "<review_prompt>" --allowedTools "Read,Glob,Grep,Bash(git diff:git log:git show)"
```

兩邊都是獨立 process，不帶當前對話 context，確保 reviewer 的判斷不受開發者（主 agent）思路影響。

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

使用者決定後，由主 agent（人家）執行修正。

## 注意事項

- 兩邊 reviewer 都會讀到同一份 AGENTS.md，共享 coding style 規範，不需要在 prompt 中重複
- Reviewer 自己有能力讀檔案、跑 git 指令，prompt 只需指定 review 範圍與審查維度
- CLI 執行時間可能較長（60-120 秒），務必使用 `run_in_background` 避免阻塞
- 若變更範圍太大，考慮按檔案或 milestone 拆分 review
- 若任一 reviewer 超時或失敗，先呈現已取得的單邊結果，提示使用者是否重試另一邊

## 產出

- Cross Review 對照報告（在對話中呈現）
- 使用者確認後的程式碼修正

## 結束條件

使用者確認 review 結果，修正完成（或決定不修正）。
