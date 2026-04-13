# Works — xreview Monitor Orchestrator

## 2026-04-13 Sprint 啟動

### 觸發事件

又一次 cross review 撞到 Claude Code Bash tool 10 分鐘 hard cap。GPT-5.4 的 review 還在跑，Bash 就被 kill 了。先前的 `run_in_background: true` 對此沒有效果。

### Survey 結果

GitHub issue 追查確認這是 Anthropic 不打算修的限制：

- [#25881](https://github.com/anthropics/claude-code/issues/25881) — 10 分鐘 hard cap，closed as `not planned`
- [#34138](https://github.com/anthropics/claude-code/issues/34138) — `BASH_MAX_TIMEOUT_MS` 環境變數實際無作用
- [#5615](https://github.com/anthropics/claude-code/issues/5615) — 多人嘗試各種 workaround，結論是上限就是 600000ms

可行 workaround：

1. **detach pattern**：`nohup ... &` + 另一個 Bash 呼叫 polling
2. **MCP server**：用 `child_process.spawn` 繞過 Bash tool 的內建 timeout
3. **Monitor tool**（CC 新工具）：`timeout_ms` 上限 3600000ms（1 小時），`persistent: true` 無限制

### 設計選擇

選 Monitor。原因：

- 不需引入 MCP server 的工程成本
- 比 nohup polling 自然——Monitor 本身就是 streaming 事件介面
- 1 小時上限對 review 場景綽綽有餘

### 演進方向

從原本「每個 reviewer 各派一次 Bash」改為「skill 派一次 Monitor → orchestrator → fan-out 子程序」。事件流（START/DONE/FAIL/ALL_DONE）讓 Claude 能即時知道每個 reviewer 的進度。

精神類似輕量化的 MCP（單一入口、抽象多 process），但不是 MCP（沒 protocol、沒 schema）。

### 待決事項

- `claude -p` 的 tool policy 是否支援以非互動方式跑 `ddd-reviewer` system prompt？若可，Claude 端也併入 orchestrator，xreview 統一入口；若不可，Claude 端維持 Agent tool。研究階段（M1）會釐清。
- fallback 邏輯一併移除：實測 `gemini-2.5-pro` 找不出有用的 findings，退化形同浪費。

### M1 POC 結果

**POC #1 — Monitor 跨 10 分鐘**

```
Monitor({ command: "sleep 700 && echo 'slept for 700s'", timeout_ms: 900000, ... })
```

✅ 700 秒後正常 emit `slept for 700s`，stream ended。Monitor 確實不受 Bash 10 分鐘約束。

**POC #2 — `claude -p` 在 Monitor 內可用 + 跨 timeout 雙驗證**

```
echo "===Before: $(date)===" && claude -p "..." \
  && sleep 700 \
  && echo "===After: $(date)===" && claude -p "..." \
  && echo "===CLAUDE_TEST_DONE==="
```

事件流：

```
===Before: 2026-04-13T15:40:00+08:00===
HELLO_RUN_1
===Sleeping 700s===
===After: 2026-04-13T15:51:44+08:00===
HELLO_RUN_2
===CLAUDE_TEST_DONE===
```

✅ 兩次 `claude -p` 都成功回應指定字串
✅ 第二次呼叫發生在 11 分 44 秒之後，遠超 Bash 10 分鐘上限
✅ Monitor 內呼叫 `claude` 沒有被自身 permission 系統擋下

### M1 結論：ADR-4 採 (a) 分支

`claude -p` 從 Monitor 內部呼叫完全可行，因此 orchestrator 可以統一接收 `claude:<model>` 與外部 CLI（opencode / gemini / codex），xreview 真正單一入口。

### M1 補充：claude CLI 參數 survey

`claude --help` 確認以下參數可用於 orchestrator：

| 參數 | 用途 |
|------|------|
| `-p, --print` | 非互動模式，印完即退 |
| `--agent <name>` | 載入既有 agent 定義（含 system prompt + tools），ddd-reviewer 直接套 |
| `--model <id>` | 指定模型，例如 `claude-haiku-4-5-20251001` |
| `--allowedTools` / `--disallowedTools` | tool 白/黑名單，支援 `Bash(git:*)` pattern |
| `--permission-mode plan` | 強制 read-only mode（對齊 gemini 的 `--approval-mode=plan`） |
| `--no-session-persistence` | 不存 session 檔，乾淨呼叫 |
| `--output-format text` | 純文字輸出，方便 tee 到 log |
| `--bare` | ⚠️ 副作用過大，會擋掉 OAuth 導致 `Not logged in` 錯誤——**不要用** |

實測指令（成功）：

```bash
echo "請用一句話告訴我你是誰、你的角色是什麼、你被允許用哪些工具" \
  | claude -p \
      --agent ddd-reviewer \
      --model claude-haiku-4-5-20251001 \
      --no-session-persistence \
      --permission-mode plan \
      --output-format text
```

回應正確自我介紹為 `ddd-reviewer`，列出 `Read / Grep / Glob / Bash` 工具——agent frontmatter 確實生效。

### M1 補充：Monitor graceful exit 機制

| 觸發 | Monitor 動作 | 給 Claude 的事件 |
|------|------------|----------------|
| Script exit | 結束 watch | `stream ended` + exit code |
| `timeout_ms` 達到 | SIGKILL script | `stream ended` + `killed: timeout` |
| `TaskStop({task_id})` | SIGKILL script | `stream ended` + `cancelled` |
| `persistent: true` | 永不自動結束 | 只有 TaskStop / session 結束才停 |

實測 POC 結束後 `TaskList` 顯示 `No tasks found`、OS process list 也無殘留——graceful exit 正常運作。Statusline 偶爾顯示 monitor 殘留是顯示延遲，不影響實際清理。

Orchestrator 端的對應策略：`trap cleanup EXIT INT TERM` 收掉 fork 出去的子程序、exit 0 即使有 reviewer FAIL（FAIL 透過事件流告知）、最後 `echo ALL_DONE` 讓 Claude 明確知道全結束。
