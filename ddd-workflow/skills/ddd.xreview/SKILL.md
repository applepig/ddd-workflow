---
name: DDD.Xreview
description: >
  Cross review：派發多個 AI 模型獨立審查程式碼，交叉比對 findings 提升品質。
  Claude subagent 固定使用，外部模型清單見 AGENTS.md。
  Trigger: "review code", "cross review", "let's review", "check my changes",
  "審查程式碼", "code review", "review 一下", /DDD.xreview。
  開發完成後、commit 或 push 前使用。
---

# DDD:xreview — Cross Review

使用多種獨立模型交叉審查程式碼變更。Claude subagent 固定參與，外部模型透過指定的 CLI 呼叫——具體使用哪些模型見 AGENTS.md 的「Cross Review 模型設定」。

不同模型有不同的訓練資料與推理傾向，交叉比對能找出單一模型容易忽略的問題。分段約束 prompt 確保每個 finding 都有程式碼證據、嚴重度和信心評估。

## 嚴格禁令 (Never Do)

- **嚴禁自動修改程式碼**：review 的目的是產出建議，不是直接改 code。所有修改必須由使用者確認後才執行。
- **嚴禁省略任一 reviewer 的意見**：即使結論相似，仍須完整呈現各方觀點。使用者需要看到獨立觀點才能做出判斷。
- **嚴禁在 command line 暴露 prompt 內容**：外部 CLI 一律用 stdin pipe 傳 prompt。

## 執行步驟

### 1. 確認 Review 範圍

確認要 review 什麼：

- **Sprint 文件路徑**：當前 sprint 的 `spec.md`、`tasks.md` 位置
- **變更範圍**：是 uncommitted changes（`git diff HEAD`）還是 branch diff（`git diff main...HEAD`）

不需要將完整內容傳給各個 reviewer，每個 reviewer 會自行蒐集。

### 2. 組裝 Review Prompt 並寫入暫存檔

讀取 `references/review-prompt.md` 模板，將步驟 1 確認的範圍資訊填入 placeholder：

- `{{SPEC_PATH}}`：spec.md 的路徑
- `{{TASKS_PATH}}`：tasks.md 的路徑
- `{{GIT_DIFF_CMD}}`：實際的 git diff 指令

所有 reviewer 使用**相同的 prompt**。prompt 採用分段約束結構，每個段落控制 reviewer 行為的一個面向——詳見 `references/review-prompt.md`。

**組裝後寫入暫存檔**（`mktemp /tmp/xreview-XXXXXX.md`），避免在多個 Bash 呼叫中重複嵌入同一份 prompt。

### 3. 平行派出 Reviewer

所有 reviewer 都設定 `run_in_background: true`，平行執行不阻塞。

**[A] Claude Reviewer**（固定，Agent tool）：

```
Agent({
  subagent_type: "ddd-reviewer",
  prompt: "這是一次 cross review，你負責 Claude 端的獨立審查。\n請閱讀 <review_prompt_file 路徑> 中的 review prompt 並依照指示執行 code review。\n審查完成後依照 prompt 中的輸出格式回報。",
  run_in_background: true
})
```

Claude subagent 從暫存檔讀取完整 prompt（使用 Read tool），避免在 main agent context 中重複嵌入整份 prompt。

**[B+] 外部 Reviewer**（依 AGENTS.md 模型清單，每個模型一個 xreview-runner.sh）：

```bash
bash ~/.claude/skills/ddd.xreview/scripts/xreview-runner.sh \
  "$review_prompt_file" <cli>:<model>
```

`<cli>:<model>` 從 AGENTS.md 的「Cross Review 模型設定」表格讀取。例如 `opencode:github-copilot/gpt-5.4`。

以 `Bash({ command: ..., run_in_background: true })` 執行。對 AGENTS.md 表格中的每個模型都派一個。

> `xreview-runner.sh` 是精簡的 shell proxy：包 timeout、根據 `<cli>:<model>` 格式分發到對應 CLI、失敗時補 `XREVIEW_ERROR` summary。各 CLI 的詳細呼叫慣例見 `references/cli-adapters.md`。

### 4. 失敗處理與退化

**失敗判定**：Bash exit code 非零，或輸出含 `XREVIEW_ERROR` marker。不需對 reviewer 內容做語意判斷。

**退化策略**：

1. 查 AGENTS.md 表格中該模型的「退化模型」欄位
2. 有退化模型 → 重試一次，替換 model 參數
3. 無退化模型或退化也失敗 → 在報告中標示失敗，呈現已取得的結果

### 5. 整合與呈現

收到所有結果後，整理成交叉比對報告。報告結構根據實際完成的 reviewer 數量動態調整：

```markdown
# Cross Review 報告

## Reviewer 組成
| Reviewer | 模型 | 狀態 |
|----------|------|------|
| Claude | (inherit) | ✅ 完成 |
| 外部 A | <model-id> | ✅ 完成 / ❌ 失敗 |
| ... | ... | ... |

---

## 各 Reviewer 評估
<每個成功的 reviewer 各一個 section，完整呈現其 review 結果>

---

## 交叉比對
| 維度 | Claude | 外部 A | ... | 共識 |
|------|--------|--------|-----|------|
| 正確性 | ... | ... | ... | 一致/分歧 |
| ... | ... | ... | ... | ... |

## 共識問題（多數 reviewer 都指出）
<最值得優先處理的問題>

## 分歧點
<列出意見不同的地方，說明各自的理由>

## 共識優點
<多方都認可的設計>
```

### 6. 使用者決策

用 AskUserQuestion 向使用者確認：
- 哪些建議要採納並修正？
- 哪些可以忽略？
- 是否需要針對特定問題深入討論？

使用者決定後，由主 agent 派 ddd-developer 執行修正。

## 注意事項

- 所有 reviewer 共享相同的 AGENTS.md coding style 規範，不需要在 prompt 中重複
- Reviewer 自己有能力讀檔案、跑 git 指令，prompt 只需指定 review 範圍
- 執行時間可能較長（90-180 秒），務必使用 `run_in_background` 避免阻塞
- **安全性**：外部 CLI 一律用 stdin pipe 傳 prompt，嚴禁用命令列參數直接帶入
- 若變更範圍太大，考慮按 milestone 拆分 review
- 若某個 reviewer 超時或失敗且退化也失敗，先呈現已取得的結果，提示使用者
- **暫存檔清理**：所有 reviewer 完成後，執行 `rm -f "$review_prompt_file"` 清理暫存檔

## 前提條件

- **外部 CLI**：至少安裝一種（AGENTS.md 表格列出的 CLI），並設定好認證。安裝與設定詳見 `references/cli-adapters.md`
- 若所有外部 CLI 均未安裝，退化為僅 Claude subagent 的單方 review

## 產出

- Cross Review 對照報告（在對話中呈現）
- 使用者確認後的程式碼修正（由 ddd-developer 執行）

## 結束條件

使用者確認 review 結果，修正完成（或決定不修正）。
