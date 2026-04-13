---
name: ddd.xreview2
description: >
  Cross review v2（測試版）：單一 Monitor 入口派發所有 reviewer，繞過 Bash tool 10 分鐘 hard cap。
  與 ddd.xreview 並存中，僅在使用者明確輸入 /ddd.xreview2 時觸發，驗證穩定後扶正。
  Trigger: ONLY /ddd.xreview2 — DO NOT trigger on generic "review", "cross review" etc.
  （那些 trigger 仍歸 ddd.xreview）。
---

# ddd.xreview2 — Cross Review (Monitor + Orchestrator 版)

⚠️ **這是 ddd.xreview 的測試 fork**。設計目的：以單一 Monitor + shell orchestrator 取代多個 Bash + run_in_background 呼叫，繞過 Claude Code Bash tool 的 10 分鐘 hard cap。穩定後將取代 ddd.xreview。

使用多種獨立模型交叉審查程式碼變更，所有 reviewer（含 Claude）統一由 orchestrator script fan-out。具體模型清單見 AGENTS.md 的「Cross Review 模型設定」。

## 嚴格禁令 (Never Do)

- **嚴禁自動修改程式碼**：review 的目的是產出建議，不是直接改 code。所有修改必須由使用者確認後才執行。
- **嚴禁省略任一 reviewer 的意見**：即使結論相似，仍須完整呈現各方觀點。
- **嚴禁在 command line 暴露 prompt 內容**：orchestrator 一律從暫存檔讀取，stdin pipe 傳給各 CLI。

## 執行步驟

### 1. 確認 Review 範圍

確認要 review 什麼：

- **Sprint 文件路徑**：當前 sprint 的 `spec.md`、`tasks.md` 位置
- **變更範圍**：是 uncommitted changes（`git diff HEAD`）還是 branch diff（`git diff main...HEAD`）

不需要將完整內容傳給各個 reviewer，每個 reviewer 會自行蒐集。

### 2. 組裝任務 Prompt 並寫入暫存檔

將步驟 1 確認的範圍資訊組裝為任務 prompt，寫入暫存檔。orchestrator 會將同一份檔案 stdin 給每個 reviewer。

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

審查方法論由各 reviewer 的 `ddd-reviewer` agent 定義自帶，任務 prompt 只需指定範圍。

### 3. 派出 Reviewer（單一 Monitor）

從 AGENTS.md「Cross Review 模型設定」表格讀取模型清單，組裝為 specs。Claude reviewer 統一以 `claude:<model>` 加入清單，與外部 CLI 平權。

```
Monitor({
  command: "bash ~/.claude/skills/ddd.xreview2/scripts/xreview-orchestrator.sh \"$review_prompt_file\" claude:claude-sonnet-4-6 opencode:github-copilot/gpt-5.4 gemini:gemini-3-pro-preview",
  timeout_ms: 3600000,
  persistent: false,
  description: "xreview2 平行派 N 個 reviewer"
})
```

**設定要點**：

- `timeout_ms: 3600000`（1 小時）—— Monitor 上限，繞過 Bash 10 分鐘 cap
- `persistent: false` —— orchestrator 自然 exit 即結束 watch
- Claude 端用 `claude:<model>`，`<model>` 從 AGENTS.md 設定（預設 `claude-sonnet-4-6`，可調整）

### 4. 收集事件流

Monitor 期間，orchestrator 會以「每行一事件」形式回傳：

```
START claude:claude-sonnet-4-6
START opencode:github-copilot/gpt-5.4
START gemini:gemini-3-pro-preview
DONE claude:claude-sonnet-4-6 /tmp/xreview-<runid>-claude_claude-sonnet-4-6.log
FAIL gemini:gemini-3-pro-preview exit_code=124 log=/tmp/xreview-<runid>-gemini_gemini-3-pro-preview.log
DONE opencode:github-copilot/gpt-5.4 /tmp/xreview-<runid>-opencode_github-copilot_gpt-5.4.log
ALL_DONE
```

每個事件以 task notification 送達。記錄每個 DONE / FAIL 事件對應的 `<spec>` 與 `<log-path>`，等收到 `ALL_DONE` 即可進入下一步。

### 5. 失敗處理

- **DONE**：reviewer 成功，log 檔含完整 review 報告
- **FAIL**：reviewer 失敗（exit code 非零 / timeout / unknown CLI）。`log` 欄位仍然可讀，可能含部分輸出或錯誤訊息
- **沒收到任何 DONE**：所有 reviewer 都失敗——直接告知使用者，不嘗試退化

不做退化重試。實測退化模型（gemini-2.5-pro）品質不足，徒增等待。

### 6. 整合與呈現

對每個 DONE 事件廣播的 `<log-path>` 用 Read tool 讀取完整輸出，整合成交叉比對報告：

```markdown
# Cross Review 報告

## Reviewer 組成
| Reviewer | 模型 | 狀態 |
|----------|------|------|
| Claude | claude-sonnet-4-6 | ✅ 完成 |
| 外部 A | gpt-5.4 | ✅ 完成 |
| 外部 B | gemini-3-pro-preview | ❌ 失敗 (timeout) |

---

## 各 Reviewer 評估
<每個 DONE reviewer 各一個 section，完整呈現 review 結果>

---

## 交叉比對
| 問題 | Claude | gpt-5.4 | ... | 共識 |
|------|--------|---------|-----|------|
| <問題摘要> | Critical/Important/未提及 | ... | ... | 一致/分歧 |

## 共識問題（多數 reviewer 都指出）
<最值得優先處理的問題>

## 分歧點
<列出意見不同的地方>

## 共識優點
<多方都認可的設計>
```

### 7. Coordinator 驗證與評估

報告彙整完成後，main agent 在呈現給使用者前，先自行驗證中～高嚴重度的 findings：

1. 從交叉比對報告中篩出 Critical / Important 等級的 findings
2. 逐一讀取 finding 引用的程式碼，確認問題是否真實存在
3. 對每個 finding 標記：
   - ✅ **確認**：問題存在，附上 coordinator 的修正建議與優先度
   - ⚠️ **存疑**：無法確認或情境不明，保留給使用者判斷
   - ❌ **False Positive**：問題不存在或 reviewer 誤讀，說明理由

**評估原則**：

- 只驗證中～高嚴重度，低嚴重度直接帶過
- 驗證時讀實際程式碼，不靠 reviewer 描述
- 共識問題仍須驗證——共識不等於正確

### 8. 使用者決策

用 AskUserQuestion 向使用者確認：

- 哪些建議要採納並修正？
- 哪些可以忽略？
- 是否需要針對特定問題深入討論？

使用者決定後，由主 agent 派 ddd-developer 執行修正。

## 注意事項

- 審查方法論由 `ddd-reviewer` agent 定義自帶（已部署在 ~/.claude/agents/），orchestrator 用 `claude -p --agent ddd-reviewer` 自動載入
- Reviewer 自己有能力讀檔案、跑 git 指令，不需在 prompt 中重複說明
- **Timeout**：
  - Monitor 上限 3600000ms（1 小時）—— orchestrator 整體
  - orchestrator 內部對每個 reviewer 預設 1500 秒（25 分鐘）safety net，可用 `XREVIEW_PER_TIMEOUT` env var 調整
- **安全性**：orchestrator 對外部 CLI 一律 stdin pipe，prompt 內容不出現在 command line
- 若變更範圍太大，考慮按 milestone 拆分 review
- **暫存檔清理**：所有 reviewer 完成後，執行 `rm -f "$review_prompt_file"`；log 檔保留在 `/tmp/xreview-*` 直到系統清理
- **Statusline 殘留**：Monitor 結束後 statusline 偶爾顯示 task 殘留，是 UI 顯示延遲，不影響實際清理

## 前提條件

- **claude CLI**：用於 Claude reviewer，預設可用
- **外部 CLI**：至少安裝一種（AGENTS.md 表格列出的），並設定好認證。詳見 `references/cli-adapters.md`
- 若所有外部 CLI 均未安裝，orchestrator 仍可派 claude reviewer 跑單方 review

## 產出

- Cross Review 對照報告（在對話中呈現）
- 使用者確認後的程式碼修正（由 ddd-developer 執行）

## 結束條件

使用者確認 review 結果，修正完成（或決定不修正）。
