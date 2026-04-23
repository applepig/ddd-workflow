---
name: ddd.xreview
description: >
  Cross review：派多個獨立 AI 模型平行審查程式碼，交叉比對 findings 降低單一模型盲點，
  驗證高嚴重度問題後再交使用者決策。
  Trigger: "review code", "cross review", "let's review", "check my changes",
  "審查程式碼", "code review", "review 一下", /ddd.xreview。
  開發完成後、commit 或 push 前使用。
---

# ddd.xreview — Cross Review

派多個獨立模型平行審查，交叉比對 findings，**由 coordinator 驗證 Critical/Important 再呈給使用者**。主流程聚焦在「蒐集各方觀點 → 驗證 → 決策」，執行細節交給 orchestrator script。

## 嚴格禁令

- **禁止自動修改程式碼**：review 產出建議，不直接改 code。修改必須由使用者確認後才執行
- **禁止省略任一 reviewer 的意見**：即使結論相似，仍須完整呈現各方觀點
- **禁止以 main agent self-review 取代 cross review**：所有 reviewer 都失敗時直接告知使用者，不自己頂上

## 執行步驟

### 1. 確認 Review 範圍

- **Sprint 文件**：當前 sprint 的 `spec.md`、`tasks.md` 路徑
- **變更範圍**：uncommitted（`git diff HEAD`）或 branch diff（`git diff main...HEAD`）

各 reviewer 會自己讀檔案與跑 git，不需把完整內容塞進 prompt。

### 2. 組 Prompt 暫存檔

```bash
review_prompt_file=$(mktemp /tmp/xreview-XXXXXX.md) && cat > "$review_prompt_file" << 'XREVIEW_EOF'
請依照 ddd-reviewer 角色定義執行獨立 code review。

審查範圍：
- Sprint 規格：<spec.md 路徑>
- 任務清單：<tasks.md 路徑>
- 變更：請執行 `<git diff 指令>` 取得

先讀取 sprint 文件理解目標與驗收條件，再檢視程式碼變更。
XREVIEW_EOF
echo "$review_prompt_file"
```

審查方法論由各 reviewer 的 `ddd-reviewer` agent 定義自帶，prompt 只指定範圍即可。

### 3. 派 Orchestrator

**預設（Monitor 可用時）**：

```
Monitor({
  command: "bash ~/.claude/skills/ddd.xreview/scripts/xreview-orchestrator.sh $review_prompt_file; rc=$?; rm -f $review_prompt_file; exit $rc",
  timeout_ms: 3600000,
  persistent: false,
  description: "xreview 平行派 N 個 reviewer"
})
```

**沒有 Monitor 的 host**（gemini / codex / opencode 等，改走 blocking mode，同一支 orchestrator）：

```bash
XREVIEW_MODE=blocking bash <skill-dir>/scripts/xreview-orchestrator.sh "$review_prompt_file"; rc=$?; rm -f "$review_prompt_file"; exit "$rc"
```

> `<skill-dir>` 是這個 skill 被部署到當前 host 的絕對路徑，Skill tool 載入時會告訴你（例如 gemini host 上是 `~/.gemini/skills/ddd.xreview`、codex 是 `~/.codex/skills/ddd.xreview`、opencode 是 `~/.config/opencode/skills/ddd.xreview`）。請替換成實際值再執行。

臨時指定模型清單：在 orchestrator 後接 spec 位置參數，支援短名（`opus`、`5.4`、`pro` 等）：

```
... $review_prompt_file opus 5.4 pro; ...
```

Monitor mode 與 blocking mode 走**同一份** event schema、同一批 `.log`／`.final.txt` sidecar，差別只在 caller 是「執行中逐行收事件」還是「結束後一次拿完整 stdout」。深入細節見 `references/orchestrator-internals.md`。

### 4. 收集結果

orchestrator 以「每行一事件」輸出：

```
START  <spec> <log-path>
RETURN <spec> <log-path> <final-path>
FAIL   <spec> exit_code=<n> log=<log-path> final=<final-path>
ALL_DONE
```

對每個 **RETURN** 事件：

1. 讀取對應的 `<final-path>`（用當前 host 的 file-read 工具：claude 的 `Read`、gemini 的 `read_file`、codex/opencode 的 `read` 等）
2. **檔案為空** → 標記 content-layer 失敗（transport 成功但 agent 實質沒產出），納入報告狀態欄、不進交叉比對
3. **檔案有內容** → 納入步驟 5 整合

**FAIL** 事件直接標失敗原因（exit_code / timeout 124），需要除錯時才讀取 `<log-path>`。

邊界案例（沒收到 ALL_DONE、stream-end 兜底、空 final 的技術原因等）見 `references/orchestrator-internals.md`。

### 5. 整合、驗證、呈現

**5.1 組對照表**

```markdown
# Cross Review 報告

## Reviewer 組成
| Reviewer | 模型 | 狀態 |
|----------|------|------|
| claude | claude-opus-4-6 | ✅ 完成 |
| opencode | gpt-5.4 | ✅ 完成 |
| gemini | gemini-3-pro-preview | ❌ 失敗（timeout） |

## 各 Reviewer 評估
<每個有效 reviewer 一個 section，完整呈現 review 結果>

## 交叉比對
| 問題 | claude | opencode | gemini | 共識 |
|------|--------|----------|--------|------|
| <問題摘要> | Critical/Important/未提及 | ... | ... | 一致/分歧 |

## 共識問題
<最值得優先處理>

## 分歧點
<意見不同之處>

## 共識優點
<多方都認可的設計>
```

**5.2 Coordinator 驗證 Critical / Important findings**

彙整完成後、呈給使用者前，coordinator 先自行驗證中～高嚴重度的 findings：

1. 從報告篩 Critical / Important findings
2. 逐一讀 finding 引用的程式碼確認問題是否真實存在
3. 標記每個 finding：
   - ✅ **確認**：問題存在，附上修正建議與優先度
   - ⚠️ **存疑**：無法確認或情境不明，保留給使用者判斷
   - ❌ **False Positive**：問題不存在或 reviewer 誤讀，說明理由

**原則**：驗證時讀實際程式碼，不靠 reviewer 描述；共識不等於正確，共識問題仍須驗證；低嚴重度直接帶過。

### 6. 使用者決策

用 Question Tool（各 host 內建：claude 的 `AskUserQuestion`、gemini 的 `question`、codex/opencode 的 `ask_user` 等）向使用者確認：

- 哪些建議要採納並修正？
- 哪些可以忽略？
- 是否需要針對特定問題深入討論？

使用者決定後，由主 agent 派 `ddd-developer` 執行修正。

## 前提條件

orchestrator script 已部署（`npm run deploy` 自動處理）、至少安裝一種 reviewer CLI（claude / gemini / opencode / codex，安裝與認證見 `references/cli-adapters.md`）。只剩一個 CLI 可用時 config 仍可跑單方 review，但嚴格講不算 cross review。

## 產出

- Cross Review 對照報告（對話中呈現）
- 使用者確認後的程式碼修正（由 `ddd-developer` 執行）

## 結束條件

使用者確認 review 結果，修正完成（或決定不修正）。

## 進一步閱讀

- `references/orchestrator-internals.md` — 事件語意、timeout、SIGKILL、content-layer 失敗根因、config/aliases、ADR 索引
- `references/cli-adapters.md` — 各 CLI 的安裝、認證、JSON 抽取機制
