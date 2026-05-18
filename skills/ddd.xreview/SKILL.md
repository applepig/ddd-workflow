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

- **Sprint 文件**：當前 sprint 的 `spec.md` 路徑，以及 `tasks.md` 路徑（若存在）。
- **變更範圍**——依優先順序判斷，**勿硬套 `main`**：
  1. **使用者明確指定** → 直接採用（如「review changes from dev」→ `git diff dev...HEAD`）
  2. **使用者未指定** → 自動偵測上游：先查 tracking branch（`git rev-parse --abbrev-ref @{upstream}`），無則依序找 `dev`、`main`、`master`。偵測後用 Question Tool 確認：
     - 有未提交變更 → 確認要 review uncommitted 還是整個 branch diff
     - 在 feature branch 且無未提交變更 → 確認 `git diff <upstream>...HEAD`
     - 在 main/dev 上且無未提交變更 → 詢問要 review 什麼

各 reviewer 會自己讀檔案與跑 git，不需把完整內容塞進 prompt。

### 2. 組 Prompt 暫存檔

```bash
review_prompt_file=$(mktemp /tmp/xreview-XXXXXX.md) && cat > "$review_prompt_file" << 'XREVIEW_EOF'
請依照 ddd-reviewer 角色定義執行獨立 code review。

審查範圍：
- Sprint 規格：<spec.md 路徑>
- 任務來源：<spec.md Milestones 或 tasks.md 路徑>
- 變更：請執行 `<git diff 指令>` 取得

先讀取 sprint 文件理解目標、驗收條件與任務來源，再檢視程式碼變更。
XREVIEW_EOF
echo "$review_prompt_file"
```

審查方法論由各 reviewer 的 `ddd-reviewer` agent 定義自帶，prompt 只指定範圍即可。

### 3. 派 Orchestrator

公開入口維持 skill-local script：`scripts/xreview-orchestrator.sh`。此檔案是 shared `agent-runner.sh` 的 symlink entrypoint；runner 會依 invocation basename 進入 `xreview` mode。Coordinator 不需也不應直接呼叫 shared runner 實體路徑。

**Claude Code**（Monitor 可用）：

```
Monitor({
  command: "bash ~/.claude/skills/ddd.xreview/scripts/xreview-orchestrator.sh $review_prompt_file; rc=$?; rm -f $review_prompt_file; exit $rc",
  timeout_ms: 3600000,
  persistent: false,
  description: "xreview 平行派 N 個 reviewer"
})
```

**其他 host**（Gemini / Codex / OpenCode，走 blocking mode）：

```bash
XREVIEW_MODE=blocking bash <skill-dir>/scripts/xreview-orchestrator.sh "$review_prompt_file"; rc=$?; rm -f "$review_prompt_file"; exit "$rc"
```

模型覆蓋、短名等用法見 `references/cli-reference.md`。

### 4. 收集結果

orchestrator 輸出 `RETURN <spec> <log> <final>` 和 `FAIL <spec> ...` 事件，以 `ALL_DONE` 收尾。讀取各 RETURN 的 `<final-path>`，空檔標失敗。

事件格式與邊界案例見 `references/orchestrator-internals.md`。

### 5. 整合、驗證、呈現

**5.1 組對照表**

```markdown
# Cross Review 報告

## Reviewer 組成
| Reviewer | 模型 | 狀態 |
|----------|------|------|
| claude | claude-opus-4-7 | ✅ 完成 |
| opencode | gpt-5.x | ✅ 完成 |
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

### 6. 逐條決策

對步驟 5.2 標記為 ✅ 確認 或 ⚠️ 存疑 的每個 issue，用 Question Tool 逐條詢問使用者修正方向。

**批次策略**：Question Tool 每次最多 4 題，盡量一次問完。issues 超過 4 個時分批，每批一次 Question Tool call。

**每個 issue 一題**，格式：

- `header`：`"Issue #N"`
- `question`：一句話說明問題
- `preview`：引用的問題程式碼片段（含檔案路徑與行號）
- `options`：根據 reviewer 意見與 coordinator 驗證結果，列出具體可行的修法方案（各方案在 description 簡述怎麼改），加上「不修，跳過」。使用者可透過自動附加的 Other 給自訂指示

收集完所有決策後，彙整要修正的 issues 與對應方向，一次派 `ddd-developer` 執行。

## 產出

- Cross Review 對照報告（對話中呈現）
- 使用者確認後的程式碼修正（由 `ddd-developer` 執行）

## 結束條件

使用者確認 review 結果，修正完成（或決定不修正）。

## 進一步閱讀

- `references/cli-reference.md` — 模型覆蓋、短名、部署前提
- `references/orchestrator-internals.md` — 事件語意、timeout、content-layer 失敗、config
- `references/cli-adapters.md` — 各 CLI 的安裝、認證、JSON 抽取機制
