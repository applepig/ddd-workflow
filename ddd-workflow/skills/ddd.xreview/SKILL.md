---
name: ddd.xreview
description: >
  Cross review：派發多個 AI 模型獨立審查程式碼，交叉比對 findings 提升品質。
  以單一 Monitor + shell orchestrator fan-out 所有 reviewer（含 Claude）。
  模型清單由 ~/.config/ddd-workflow/xreview.json 設定，CLI 參數可一次性覆蓋。
  Trigger: "review code", "cross review", "let's review", "check my changes",
  "審查程式碼", "code review", "review 一下", /ddd.xreview。開發完成後、commit 或 push 前使用。
---

# ddd.xreview — Cross Review

使用多種獨立模型交叉審查程式碼變更，所有 reviewer（含 Claude）統一由 orchestrator script fan-out。模型清單由 `~/.config/ddd-workflow/xreview.json` 設定（`npm run deploy` 會帶一份預設）；orchestrator 在 CLI 沒指定 spec 時自動讀取。

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

將步驟 1 確認的範圍資訊組裝為任務 prompt，寫入暫存檔。orchestrator 會把同一份檔案 stdin pipe 給每個 reviewer。

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

Monitor 的 `command` 是一個 shell 字串，整段 string 會成為該 shell 的 argv／process listing 可見內容。**把 prompt 內容內嵌進 Monitor command（heredoc 或 argv）會讓 prompt 出現在 process listing**，違反頂端「嚴格禁令」的第三條（禁在 command line 暴露 prompt 內容）。因此走「步驟 2 Bash mktemp 寫檔 → Monitor 傳檔案路徑 → Monitor command 尾 `rm` 清理」的流程，prompt 檔路徑可曝光、內容不可。

```
Monitor({
  command: "bash ~/.claude/skills/ddd.xreview/scripts/xreview-orchestrator.sh $review_prompt_file; rc=$?; rm -f $review_prompt_file; exit $rc",
  timeout_ms: 3600000,
  persistent: false,
  description: "xreview 平行派 N 個 reviewer"
})
```

**設定要點**：

- `$review_prompt_file` 由步驟 2 的 `mktemp /tmp/xreview-XXXXXX.md` 產生，路徑在 build command 時展開進字串，coordinator 不需要另開 Bash tool call 事後 `rm`（已內嵌在 Monitor command 尾端）
- `; rc=$?; rm -f $review_prompt_file; exit $rc` 保證 orchestrator 的 exit code 透出來給 Monitor 判讀，同時 prompt 檔無論成敗都會被清掉
- `timeout_ms: 3600000`（1 小時）—— Monitor 上限，繞過 Bash 10 分鐘 cap
- `persistent: false` —— orchestrator 自然 exit 即結束 watch
- 要臨時覆蓋模型清單：`... $review_prompt_file claude:claude-opus-4-6 opencode:github-copilot/gpt-5.4; rc=$?; rm -f $review_prompt_file; exit $rc`
- 預設短名共有 7 個：`5.4`、`5-mini`、`haiku`、`sonnet`、`opus`、`pro`、`flash`
- alias 表位置：`~/.config/ddd-workflow/xreview.json` 的 `aliases` 區塊
- 若 config 有 `aliases`，直接用短名：`... $review_prompt_file opus 5.4 pro; ...`。orchestrator 會先 resolve 成完整 spec，再做 validate、事件流與 log 命名
- 注意：若你本機已經有既存的 `~/.config/ddd-workflow/xreview.json`，`npm run deploy` 不會自動覆蓋，所以要自行補上 `aliases` 區塊與短名對應
- 進階用法：orchestrator 在**無位置參數**或**首位為 `-` sentinel** 時會從 stdin 讀 prompt、自己 mktemp + EXIT trap 清理。此路徑僅適合直接在 shell 裡手動呼叫或有獨立 stdin 管道的 runner 使用；**不要透過 Monitor 採用此路徑**——heredoc 會讓 prompt 落在 Monitor command argv 上

### 4. 收集事件流

Monitor 期間，orchestrator 會以「每行一事件」形式回傳：

```
START claude:claude-sonnet-4-6 /tmp/xreview-<runid>-claude_claude-sonnet-4-6.log
START opencode:github-copilot/gpt-5.4 /tmp/xreview-<runid>-opencode_github-copilot_gpt-5.4.log
START gemini:gemini-3-pro-preview /tmp/xreview-<runid>-gemini_gemini-3-pro-preview.log
RETURN claude:claude-sonnet-4-6 /tmp/xreview-<runid>-claude_claude-sonnet-4-6.log /tmp/xreview-<runid>-claude_claude-sonnet-4-6.final.txt
FAIL gemini:gemini-3-pro-preview exit_code=124 log=/tmp/xreview-<runid>-gemini_gemini-3-pro-preview.log final=/tmp/xreview-<runid>-gemini_gemini-3-pro-preview.final.txt
RETURN opencode:github-copilot/gpt-5.4 /tmp/xreview-<runid>-opencode_github-copilot_gpt-5.4.log /tmp/xreview-<runid>-opencode_github-copilot_gpt-5.4.final.txt
ALL_DONE
```

每個事件以 task notification 送達。START 只帶 `<log-path>`（final 此時尚未產生）；RETURN / FAIL 則同時帶 `<log-path>` 與 `<final-path>`。兩檔語意分工（ADR-11）：

- **`.log`**：verbose trace——adapter stderr、CLI debug、envelope echo、orchestrator meta header 全進這裡。主要用途是除錯。
- **`.final.txt`**：agent 最終訊息——adapter 用各自的 JSON 抽取機制（詳見 `references/cli-adapters.md`）過濾雜訊後寫入。**這是 coordinator 整合報告時 Read 的主要入口**。

orchestrator 會在派工前 pre-create 空 `.final.txt`，所以不論 adapter 是否寫成功，coordinator 都能安全 Read。記錄每個 RETURN / FAIL 事件對應的 `<spec>`、`<log-path>` 與 `<final-path>`，等收到 `ALL_DONE` 即可進入下一步。

**事件語意（ADR-7 + ADR-11）**：

- **RETURN**：transport 層成功（CLI exit 0）。**不保證 `.final.txt` 內容是真 review**——agent 可能因 sandbox 限制、rate limit、context 超載等原因 CLI 正常退出但 final 被寫成空字串（JSON 無 `.result` / `.response` 欄位時 `jq -r` 輸出空）。需要 coordinator 在步驟 7 主動 Read `.final.txt` 判斷內容是否有效。
- **FAIL**：transport 層失敗（exit code 非零 / timeout 124 / unknown CLI）。`.log` 與 `.final.txt` 仍可讀，但 final 多半為空；log 可能含部分輸出或錯誤訊息供除錯。
- **ALL_DONE**：fan-out 完成（orchestrator 跑到 reviewer loop 末尾）。

**事件收集與 fallback 處理**：

採用 events_map 追蹤每個 reviewer 狀態：

```pseudo
events = {}              # spec -> { status, log_path, final_path?, exit_code? }
seen_all_done = false

for each notification line in Monitor stream:
  if line starts with "START <spec> <log-path>":
    events[spec] = { status: "running", log_path: <log-path> }
  elif line starts with "RETURN <spec> <log-path> <final-path>":
    events[spec] = { status: "returned", log_path: <log-path>, final_path: <final-path> }   # transport OK, content TBD
  elif line starts with "FAIL <spec> exit_code=<n> log=<log-path> final=<final-path>":
    events[spec] = { status: "fail", exit_code: <n>, log_path: <log-path>, final_path: <final-path> }
  elif line == "ALL_DONE":
    seen_all_done = true
    break

# Fallback：若 stream 因 timeout / 異常結束（收到 stream-end notification
# 但尚未看到 ALL_DONE），仍以已收到的 events_map 為準。
#   - 沒收到 START 的 reviewer → status = "unknown"
#   - 已 START 但無 RETURN/FAIL → status = "incomplete"

for spec where events[spec].status == "returned":
  Read events[spec].final_path  # 整合到報告（在步驟 7 進一步驗證內容是否有效）
for spec where events[spec].status in ["fail", "incomplete", "unknown"]:
  在報告中標明失敗原因（exit_code / timeout / 未啟動），需要除錯時再 Read log_path
```

**沒收到 ALL_DONE 的情境**：

- Monitor `timeout_ms` 達到（1 小時）→ orchestrator 被 SIGKILL，cleanup trap 來不及執行
- 系統異常（OOM、shell crash 等）

兩種情境皆以 stream-end notification 兜底，不阻塞流程；仍有部分 reviewer 的 log 可讀就整合上去，其餘標記為不完整交給使用者決定是否重跑。

### 5. 失敗處理

- **RETURN**：CLI transport 成功（exit 0）。`.final.txt` 可能含完整 review 報告，也可能是空字串（agent 自陳失敗、JSON 抽取失敗、CLI 秒退）——需要在步驟 7 Read `.final.txt` 判斷。
- **FAIL**：transport 失敗（exit code 非零 / timeout / unknown CLI）。`log` 與 `final` 欄位仍然可讀；final 多半為空，log 可能含部分輸出或錯誤訊息。
- **沒收到任何 RETURN**：所有 reviewer 都 transport 失敗——直接告知使用者，不嘗試退化。
- **收到 RETURN 但 `.final.txt` 為空**：步驟 7 的 final peek 會把這類標為 content-layer 失敗。若全部 reviewer 都是 content-layer 失敗，等同「沒收到任何有效 review」。

不做退化重試。實測退化模型（gemini-2.5-pro）品質不足，徒增等待。

### 6. 整合與呈現

先執行步驟 7.1 的 final peek 過濾 content-layer 失敗，再對每個**有效** reviewer 的 `<final-path>` 用 Read tool 讀取完整 review，整合成交叉比對報告。若某份 final 內容可疑（例如格式明顯殘缺、疑似被截斷），可回頭 Read 同一 reviewer 的 `<log-path>` 看 verbose trace 確認根因，但這是 fallback，不是主要資料源。

```markdown
# Cross Review 報告

## Reviewer 組成
| Reviewer | 模型 | 狀態 |
|----------|------|------|
| Claude | claude-opus-4-6 | ✅ 完成 |
| 外部 A | gpt-5.4 | ✅ 完成 |
| 外部 B | gemini-3-pro-preview | ❌ 失敗 (timeout) |

---

## 各 Reviewer 評估
<每個有效 reviewer 各一個 section，完整呈現 review 結果>

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

**7.1 Content layer 過濾（先做）**

收到 `RETURN` 只代表 CLI transport 成功，**不代表 `.final.txt` 內容是真的 review**。Agent 可能因 workspace sandbox 擋路、rate limit 429、context 超載等原因 CLI 正常退出（exit 0）但最終訊息是空字串或空白——adapter 從 JSON `.result` / `.response` 抽取時 `jq -r` 會輸出空字串，此時 `.final.txt` 為空。這類 case orchestrator 無從偵測（transport 層是成功的），必須由 coordinator 主動過濾。

對每個收到 `RETURN` 的 reviewer：

1. Read 對應 `<final-path>`（orchestrator 已 pre-create，Read 一定會成功，不會噴 file-not-found）
2. 判斷 2 類：
   - **空 `.final.txt`**（檔案大小 0 或僅空白）→ 標記為 **content-layer 失敗**，不納入有效 review；來源 spec 列入報告狀態欄（標「失敗（內容為空）」），但不納入交叉比對
   - **非空 `.final.txt`** → 進步驟 7.2 findings 驗證
3. 若內容判讀可疑（例如 final 非空但疑似被截斷、或 agent 在 final 中自陳失敗），才回頭 Read 同一 reviewer 的 `<log-path>` 看 verbose trace 確認根因

`.log` 作為除錯次要資源：M2 之前的舊流程依賴 `tail -n 10 <log>` + 關鍵字（`FAIL:` / `XREVIEW_ERROR:` / 失敗敘述）做 4 類判斷，現已由 adapter 的 JSON 抽取取代——transport-level 錯誤訊息（`XREVIEW_ERROR:` 等）現在只會進 `.log`，不會污染 `.final.txt`，所以 final peek 只需看「空 / 非空」。

若所有 `RETURN` reviewer 的 `.final.txt` 都為空，等同「沒有有效 review」——直接告知使用者不做退化嘗試。

**7.2 Findings 驗證**

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
- **Timeout**（ADR-6 單層制）：
  - Monitor 上限 3600000ms（1 小時）—— orchestrator 整體
  - 每個 reviewer 預設 3000 秒（50 分鐘）safety net，由 orchestrator 外層的 `timeout --foreground` 強制，adapter 本身不做 timeout；測試可用 `XREVIEW_TIMEOUT_SEC` env var 注入短 timeout 觸發 124 路徑
  - timeout 觸發時 orchestrator 會 sweep 自己 pgid 殺掉 CLI orphan（M6.1 F1），sweep 結束後 append `XREVIEW_ERROR: orchestrator timeout after Ns` 到 log 尾供事後 debug（M6.2 F2 / M6 cross review F4）；該情境 CLI rc 為 124，orchestrator 會發 `FAIL exit_code=124` 事件，步驟 7.1 的 final peek 會看到空 `.final.txt` 把它標為失敗，不會誤判成有效 review
- **安全性**：orchestrator 對外部 CLI 一律 stdin pipe，prompt 內容不出現在 reviewer CLI 的 argv；coordinator 透過 Bash mktemp + Monitor command 傳檔案路徑，prompt 內容也不出現在 Monitor shell 的 argv
- 若變更範圍太大，考慮按 milestone 拆分 review
- **暫存檔清理**：Monitor command 尾巴內嵌 `rm -f $review_prompt_file` 在 orchestrator 結束後自動清掉 prompt；reviewer 產出的 `.log` 與 `.final.txt`（`/tmp/xreview-<runid>-*.{log,final.txt}`）皆保留以便事後 peek / 驗證，直到系統清理。兩者都需要保留——`.final.txt` 是 coordinator 的 Read 主要入口，`.log` 是除錯時的 fallback。若 orchestrator 被 SIGKILL 或使用者直接中斷，暫存 prompt 檔可能殘留於 `/tmp`，非機敏時可忽略；確需即時清理請手動 `rm`
- **Statusline 殘留**：Monitor 結束後 statusline 偶爾顯示 task 殘留，是 UI 顯示延遲，不影響實際清理
- **SIGKILL 限制**：Monitor 強制 kill 或外部 `kill -9` 時，orchestrator 的 cleanup trap 不會執行——子 reviewer process 由各自 PGID 隔離，但需依賴 OS 在 session 結束時收尾。一般不會殘留，但若 statusline 或 `ps` 顯示子程序殘留，請手動 `pkill -f xreview-orchestrator`

## 前提條件

- **claude CLI**：用於 Claude reviewer，預設可用
- **外部 CLI**：至少安裝一種（opencode / gemini / codex），並設定好認證。詳見 `references/cli-adapters.md`
- **config 檔**：`~/.config/ddd-workflow/xreview.json` 由 `npm run deploy` 部署。可同時設定 `reviewers` 與 `aliases`；要客製模型清單直接編輯該檔（不會被 deploy 覆蓋，既有個人 config 需自行補 alias）
- 若所有外部 CLI 均未安裝，可在 config 中只留 claude reviewer 跑單方 review

## 產出

- Cross Review 對照報告（在對話中呈現）
- 使用者確認後的程式碼修正（由 ddd-developer 執行）

## 結束條件

使用者確認 review 結果，修正完成（或決定不修正）。
