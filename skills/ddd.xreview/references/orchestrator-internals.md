# Orchestrator Internals

供除錯或需要深究 xreview 行為時參考。日常跑 review **不需要**讀這份——SKILL.md 的主流程涵蓋一般情境。

## 事件流 Schema

`xreview-orchestrator.sh` 以「每行一事件」輸出 event stream：

```
START <spec> <log-path>
RETURN <spec> <log-path> <final-path>
FAIL <spec> exit_code=<n> log=<log-path> final=<final-path>
ALL_DONE
```

- **Monitor host**：事件以 task notification 逐行送達
- **Blocking host**（`XREVIEW_MODE=blocking`）：事件在 shell 結束後一次出現在 stdout；`ALL_DONE` 後會附 human-readable summary footer，event parser 只吃 `ALL_DONE` 之前的行

### 事件語意

- **RETURN**：transport 層成功（CLI exit 0）。**不保證 `.final.txt` 內容是真 review**——agent 可能因 sandbox 限制、rate limit、context 超載等原因 CLI 正常退出但 final 被寫成空字串（JSON 無 `.result` / `.response` 欄位時 `jq -r` 輸出空）
- **FAIL**：transport 失敗（exit code 非零 / timeout 124 / unknown CLI）。`.log` 與 `.final.txt` 仍可讀但 final 多半為空
- **ALL_DONE**：fan-out 完成（orchestrator 跑到 reviewer loop 末尾）

### Events map 追蹤

```pseudo
events = {}
seen_all_done = false

for each notification line:
  if line starts with "START <spec> <log-path>":
    events[spec] = { status: "running", log_path }
  elif line starts with "RETURN <spec> <log-path> <final-path>":
    events[spec] = { status: "returned", log_path, final_path }
  elif line starts with "FAIL <spec> exit_code=<n> log=<log-path> final=<final-path>":
    events[spec] = { status: "fail", exit_code, log_path, final_path }
  elif line == "ALL_DONE":
    seen_all_done = true
    break
```

### 沒收到 ALL_DONE 的兜底

- Monitor `timeout_ms` 達到（1 小時）→ orchestrator 被 SIGKILL、cleanup trap 來不及執行
- Blocking shell 被 host timeout / 使用者中斷 / shell crash 提前終止
- 系統異常（OOM、shell crash）

以 stream-end notification 收斂，不阻塞流程：

- 沒收到 START 的 reviewer → status = `unknown`
- 已 START 但無 RETURN/FAIL → status = `incomplete`

兩者在報告中標失敗原因，交使用者決定是否重跑。

## 雙檔（`.log` / `.final.txt`）分工

ADR-11 定義：

- **`.log`**：verbose trace。adapter stderr、CLI debug、envelope echo、orchestrator meta header 全進這裡。**僅供除錯**
- **`.final.txt`**：agent 最終訊息。adapter 用各自的 JSON 抽取機制（詳見 `cli-adapters.md`）過濾雜訊後寫入。**Coordinator 整合報告的主要入口**

Orchestrator 在派工前 pre-create 空 `.final.txt`，所以讀檔一定成功，不會噴 file-not-found。

## Content-Layer 失敗

`RETURN` 只代表 CLI transport 成功，不代表 `.final.txt` 內容是真 review。Agent 可能因 workspace sandbox 擋路、rate limit 429、context 超載等原因 CLI 正常退出但最終訊息是空字串——adapter 從 JSON `.result` / `.response` 抽取時 `jq -r` 輸出空字串，`.final.txt` 因此為空。

這類情境 orchestrator 無從偵測（transport 層是成功的），必須由 coordinator 在 SKILL.md 步驟 4 主動判斷「空 final → content-layer 失敗」。

M2 之前舊流程靠 `tail -n 10 <log>` + 關鍵字做 4 類判斷，現已由 adapter 的 JSON 抽取取代——transport-level 錯誤訊息（`XREVIEW_ERROR:` 等）現在只進 `.log`，不污染 `.final.txt`，所以 final peek 只需看「空 / 非空」。

## Timeout 單層制（ADR-6）

- **Monitor host**：orchestrator 整體上限 3600000ms（1 小時），由 Monitor `timeout_ms` 強制
- **Blocking host**：用 host shell 能支援的最長 blocking timeout 跑同一支 orchestrator；host 做不到時明確回報 capability 缺失
- **每 reviewer safety net**：預設 3000 秒（50 分鐘），由 orchestrator 外層的 `timeout --foreground` 強制。Adapter 本身不做 timeout。測試可用 `XREVIEW_TIMEOUT_SEC` env var 注入短 timeout 觸發 124 路徑

Timeout 觸發時：

1. Orchestrator sweep 自己 pgid 殺掉 CLI orphan（M6.1 F1）
2. Sweep 結束後 append `XREVIEW_ERROR: orchestrator timeout after Ns` 到 log 尾（M6.2 F2 / M6 cross review F4）
3. CLI rc = 124 → 發 `FAIL exit_code=124` 事件
4. 步驟 4 的 final peek 看到空 `.final.txt` 標為失敗，不會誤判

## SIGKILL 與殘留

- Monitor 強制 kill 或外部 `kill -9` 時，orchestrator 的 cleanup trap 不會執行
- 子 reviewer process 由各自 PGID 隔離，依賴 OS 在 session 結束時收尾
- 一般不會殘留；若 `ps` 顯示子程序殘留，手動 `pkill -f xreview-orchestrator`
- Claude Code 專屬：Statusline 在 Monitor 結束後偶爾顯示 task 殘留，是 UI 顯示延遲，不影響實際清理

## Prompt 安全機制

**嚴禁在 command line 暴露 prompt 內容**（違反點：Monitor command 字串會成為 shell argv、process listing 可見）。

實作：

1. Coordinator 用 Bash `mktemp` 先 materialize 單一 prompt file
2. Monitor command / blocking shell command 傳「檔案路徑」而非內容
3. Orchestrator 對外部 CLI 一律 stdin pipe
4. Monitor command 尾巴內嵌 `rm -f $prompt_file` 清理

**進階路徑**：orchestrator 在**無位置參數**或**首位為 `-` sentinel** 時會從 stdin 讀 prompt、自己 mktemp + EXIT trap 清理。此路徑僅適合直接在 shell 裡手動呼叫或有獨立 stdin 管道的 runner 使用；**不要透過 Monitor 採用此路徑**——heredoc 會讓 prompt 落在 Monitor command argv 上。

## 暫存檔清理策略

- **Prompt 檔**（`/tmp/xreview-XXXXXX.md`）：Monitor command 尾巴內嵌 `rm` 自動清掉。若 orchestrator 被 SIGKILL 或使用者直接中斷可能殘留
- **Reviewer 產出**（`/tmp/xreview-<runid>-*.{log,final.txt}`）：**保留**以便事後 peek／驗證。`.final.txt` 是 coordinator 讀檔的主要入口，`.log` 是除錯 fallback。兩者都需要保留直到系統清理

## 退化策略（None）

不做退化重試，也不以單方 self-review 取代 cross review。實測退化模型（gemini-2.5-pro）品質不足，徒增等待。

- 所有 reviewer 都 transport 失敗 → 直接告知使用者
- 所有 reviewer `.final.txt` 都空 → 同上（content-layer 全失敗 ≡ 沒有有效 review）

## Config 與 Aliases

- 位置：`~/.config/ddd-workflow/xreview.json`
- 由 `npm run deploy` 部署預設值；既有 config 不會被覆蓋
- 預設短名 7 個：`5.4`、`5-mini`、`haiku`、`sonnet`、`opus`、`pro`、`flash`
- 使用者既有的 config 需自行補 `aliases` 區塊才能用短名
- Orchestrator 在 CLI 沒指定 spec 時自動讀 config 的 `reviewers` 清單
- CLI 位置參數可一次性覆蓋：`... $prompt_file opus 5.4 pro`（alias 在 orchestrator 內 resolve 成完整 spec）

## 相關 ADR

- ADR-6：Timeout 單層制
- ADR-7：事件語意（RETURN / FAIL / ALL_DONE）
- ADR-11：雙檔（`.log` / `.final.txt`）分工

細節見 sprint 09 的 spec.md。
