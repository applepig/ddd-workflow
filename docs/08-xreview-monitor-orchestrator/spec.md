# xreview Monitor Orchestrator

## 目標

將 `/ddd.xreview` 的外部 reviewer 派發從「多個 Bash + run_in_background 呼叫」改為「單一 Monitor + shell orchestrator」入口，繞過 Claude Code Bash tool 的 10 分鐘 hard timeout。同時評估將 Claude 本身也納入 orchestrator，達成真正的「一次呼叫、全部 reviewer 並行」。

## 背景

多次 cross review 撞到 Claude Code Bash tool 的 10 分鐘上限。根據 GitHub issue 追查：

- [anthropics/claude-code#25881](https://github.com/anthropics/claude-code/issues/25881) — Bash tool 10 分鐘 hard cap，closed as not planned
- [anthropics/claude-code#34138](https://github.com/anthropics/claude-code/issues/34138) — `BASH_MAX_TIMEOUT_MS` 環境變數 non-functional，closed as not planned
- `run_in_background: true` 被同一個 timeout 約束，沒有繞過效果

Claude Code 新推出的 `Monitor` tool 的 `timeout_ms` 上限是 3600000ms（1 小時），`persistent: true` 則無限制。可用於此場景。

## 非目標

- 改寫 `ddd-reviewer` agent 本體（跨平台部署格式維持現狀）
- 重寫 `xreview-runner.sh` 內各 CLI（opencode / gemini / codex）的呼叫慣例
- 保留 fallback / 退化模型邏輯——此 sprint 移除（實測 gemini-2.5-pro 找不出有用問題，退化形同浪費）
- MCP server 化——未來可能演進方向，此次不做

## User Story

作為 coordinator，派發 cross review 時我不用再擔心任一 reviewer 超過 10 分鐘會被強制 kill，也不用為 Bash tool timeout 做額外 workaround，以便複雜變更能可靠地取得多方 review 結果。

### 驗收條件

- [ ] Monitor POC：`sleep 700 && echo "slept for 700s"` 以 Monitor 呼叫能成功完成（證明超過 Bash 10 分鐘上限仍可運作）
- [ ] 新增 `ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.sh`，接收 prompt file + N 個 `<cli:model>` 參數
- [ ] Orchestrator 平行 fork 所有 reviewer，stdout 以 `START / DONE / FAIL / ALL_DONE` 事件流輸出
- [ ] 每個 reviewer 輸出寫到獨立 log file，路徑由 `DONE <model> <log-path>` 事件廣播
- [ ] `ddd.xreview` SKILL.md 改用 Monitor tool 呼叫 orchestrator，`timeout_ms: 3600000`
- [ ] 移除 fallback / 退化模型邏輯：SKILL.md 的 §4 段落刪除、AGENTS.md 「Cross Review 模型設定」表格移除退化模型欄位
- [ ] 若 `claude -p` tool policy 驗證通過，Claude 端也改由 orchestrator 呼叫；否則維持 Agent tool 派 `ddd-reviewer`，在 ADR-4 與 works.md 記錄原因
- [ ] orchestrator 遇 TaskStop 或 Ctrl-C 時，已 fork 的 CLI 子程序一併被清除（trap EXIT）
- [ ] 以實際 sprint 的變更跑一次 xreview，GPT 長 review（>10 分鐘）不再被砍

## 相關檔案

- `ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.sh`（新增）— orchestrator 主腳本
- `ddd-workflow/skills/ddd.xreview/SKILL.md`（修改）— 派發方式從 Bash 改為 Monitor、移除 fallback 段落
- `ddd-workflow/skills/ddd.xreview/scripts/xreview-runner.sh`（可能微調）— 由 orchestrator 呼叫，輸出慣例需對齊
- `ddd-workflow/skills/ddd.xreview/references/cli-adapters.md`（可能新增段落）— 若 `claude -p` 驗證通過，補上 adapter 說明
- `ddd-workflow/references/AGENTS.md`（修改）— 「Cross Review 模型設定」表格移除退化模型欄位

## 介面／資料結構

### Orchestrator 呼叫介面

```
bash xreview-orchestrator.sh <prompt-file> <cli1:model1> [cli2:model2 ...]
```

- `<prompt-file>`：由 skill 步驟 2 產生的任務 prompt 暫存檔
- `<cli:model>`：同 `xreview-runner.sh`，例 `opencode:github-copilot/gpt-5.4`、`gemini:gemini-3-pro-preview`

### 事件流格式（stdout）

每行一個事件，Monitor 將每行視為一則通知：

```
START opencode:github-copilot/gpt-5.4
START gemini:gemini-3-pro-preview
DONE opencode:github-copilot/gpt-5.4 /tmp/xreview-<runid>-gpt-5-4.log
FAIL gemini:gemini-3-pro-preview exit_code=124 (timeout)
ALL_DONE
```

- `START <cli:model>`：reviewer 啟動
- `DONE <cli:model> <log-path>`：reviewer 完成，完整輸出在 log 檔
- `FAIL <cli:model> <reason>`：reviewer 失敗（exit code 非零、或 timeout）
- `ALL_DONE`：所有 reviewer 結束（不論成功失敗），orchestrator 即將 exit

### Log 檔命名

`/tmp/xreview-<runid>-<slug>.log`

- `<runid>`：orchestrator 的 PID 或 mktemp 產生的 id，確保單次執行內 unique
- `<slug>`：`<cli:model>` 去除特殊字元後的 slug，例 `opencode-gpt-5-4`

### Skill 端呼叫

```
Monitor({
  command: "bash ~/.claude/skills/ddd.xreview/scripts/xreview-orchestrator.sh \"$prompt_file\" opencode:github-copilot/gpt-5.4 gemini:gemini-3-pro-preview",
  timeout_ms: 3600000,
  persistent: false,
  description: "xreview 平行派 N 個 reviewer"
})
```

收到 `ALL_DONE` 後，skill 端用 Read 讀取事件流中每個 `DONE` 事件廣播的 log 路徑，整合報告。

## 邊界案例

- **Case 1（只派一個 reviewer）**：orchestrator 照常 fan-out 單一子程序，事件流一樣有 START/DONE/ALL_DONE
- **Case 2（全部 reviewer 失敗）**：emit 所有 FAIL 後才 ALL_DONE，skill 端判斷沒有任何 DONE 時，向使用者警告並結束
- **Case 3（執行中被 TaskStop）**：orchestrator 的 `trap EXIT` 要能將已 fork 的 CLI 子程序 kill 掉（`kill -TERM -<pgid>` 或記錄 pid 逐一 kill）
- **Case 4（prompt file 不存在）**：orchestrator 立刻 exit 非零，不 emit 任何事件
- **Case 5（超過 1 小時）**：Monitor 會自動 kill，skill 取得已 emit 的 DONE 事件，呈現部分結果
- **Case 6（CLI 輸出含 `START` / `DONE` 等關鍵字）**：orchestrator 的事件輸出不能跟 reviewer 的原始輸出混雜——reviewer 原始輸出寫檔、orchestrator 的事件走獨立 stdout

## ADR

### ADR-1：用 Monitor 取代 Bash + run_in_background

- **決策**：skill 改用 Monitor tool 呼叫 orchestrator
- **原因**：Bash tool 10 分鐘 hard cap 不可繞過（issue 25881 / 34138 均 closed as not planned），`run_in_background` 也受同一 timeout 約束。Monitor `timeout_ms` 上限 3600000ms，足以容納複雜 review
- **替代方案**：
  - nohup + polling —— 需 skill 端加 loop，流程複雜
  - MCP server —— 工程成本高，此次不做

### ADR-2：Orchestrator 採 Shell 而非 Node.js

- **決策**：`xreview-orchestrator.sh` 用純 bash + `wait` 實作 fan-out
- **原因**：既有 `xreview-runner.sh` 即 shell，保持一致；process fan-out / wait / trap 是 shell 擅長領域；不想為此引入 Node 相依與額外啟動成本
- **替代方案**：Node.js orchestrator —— 功能豐富但對此任務 overkill

### ADR-3：移除退化模型邏輯

- **決策**：移除 `AGENTS.md`「Cross Review 模型設定」表格的退化模型欄位，skill 的 §4「失敗處理與退化」也一併刪除
- **原因**：實測 `gemini-2.5-pro` 幾乎找不出有價值的 findings，退化到它等於浪費時間；主模型失敗時直接標 FAIL 比假裝完成更誠實；簡化 skill 流程
- **替代方案**：保留退化但改寫邏輯—— 無助於品質

### ADR-4：Claude orchestrator 整合視 `claude -p` tool policy 而定

- **決策**：研究階段先 survey `claude -p` 的 `--allowed-tools` / `--disallowed-tools` / `--system-prompt` 等參數，實測能否以非互動方式跑 `ddd-reviewer` 的 system prompt 並讀檔
- **判定條件**：
  - ✅ 通過（能指定 system prompt 且不被 permission 擋下）：orchestrator 也接 `claude:<model>`，xreview 統一入口
  - ❌ 不通過：orchestrator 只管外部 CLI，Claude 端維持 Agent tool 派 `ddd-reviewer`
- **原因**：統一入口比兩條路好維護，但 `claude -p` 在非互動模式對 tool 權限的處理與 subagent 呼叫不同，可能被自己的 permission check 擋下；未實測前先不過早抽象

## 前提條件

- `/home/dominicwu/Dropbox/projects/AGENTS/docs/06-jsonl-runner/` 的 xreview-runner 設計已上線並穩定
- Claude Code 的 Monitor tool 行為與官方文件一致（timeout_ms 可達 3600000ms）
- POC 驗證通過（sleep 700 能完整跑完）

## 產出

- `xreview-orchestrator.sh` + 對應 SKILL.md 更新
- 實際 cross review 流程：coordinator 對 reviewer 超時焦慮解除
- works.md 記錄 `claude -p` survey 結論（決定 ADR-4 哪個分支）

## 結束條件

- 實戰跑過一次 GPT 長 review（>10 分鐘）成功
- skill 文件、AGENTS.md、cli-adapters.md 都已更新到對齊新流程
- 使用者確認可以 commit
