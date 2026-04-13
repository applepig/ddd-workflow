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

---

## 2026-04-13（晚段）M4 Dogfood + Cross Review

### M4 第一輪實戰：用 ddd.xreview2 review 自己

派出三個 reviewer 對 commit `ed80973` 跑 cross review（含 orchestrator + sprint 08 docs + ddd.xreview2 fork）：

- `claude:claude-haiku-4-5-20251001`（透過 `claude -p --agent ddd-reviewer`）
- `opencode:github-copilot/gpt-5-mini`
- `gemini:gemini-3-flash-preview`

**事件流順序**（< 3 分鐘完成）：

```
START × 3 → DONE gpt-5-mini → DONE gemini-3-flash → DONE claude-haiku → ALL_DONE
```

✅ **架構驗證通過**：fan-out / 事件流 / log 隔離 / Monitor 收斂全部正常。

### Cross Review 共識 Findings

| 嚴重度 | Finding | 共識度 | Coordinator 判定 |
|--------|---------|--------|-----------------|
| 🔴 必修 | `cleanup()` 用 `kill -TERM "$pid"` 只殺 subshell，不殺 process group。Comment 誤導實作 | 3/3 | ✅ 確認（看 orchestrator.sh:48-54） |
| 🔴 必修 | SIGKILL 不可 trap，Monitor timeout 強制 kill 時 cleanup 不會跑 | 2/3 | ✅ 確認（需 setsid 隔離 PGID 緩解） |
| 🟡 必修 | 缺少 cleanup / signal 整合測試（單元測試只覆蓋 happy path） | 3/3 | ✅ 確認 |
| 🟡 應修 | SKILL.md 的 Monitor JSON 內 quoting 易 copy-paste 錯誤 | gpt-5-mini | ✅ 確認，改用 wrapper script 包裝 |
| 🟡 應修 | SKILL.md 沒寫「沒收到 ALL_DONE 怎麼辦」的 fallback | Claude + gpt-5-mini | ✅ 確認 |
| 🟢 可選 | runid `$$+timestamp` 理論碰撞風險 | gpt-5-mini + gemini-3-flash | ⚠️ 加 `${RANDOM}` trivial |
| 🟢 可選 | cli/model 缺少 regex 防禦驗證 | gpt-5-mini | ⚠️ 來源是 AGENTS.md 內部信任，攻擊面小 |
| ❌ 駁回 | log path 含空格會破裂事件流 | Claude haiku | ❌ False Positive — 當前 slug 與 runid 不可能產生空格 |

### Pre-existing 問題（非本 sprint 但被抓到）

`opencode` 的 `xreview-runner.sh` 使用 `--agent ddd.xreviewer`，但 build.js 部署到 opencode 的 agent 名稱是 `ddd-reviewer`，導致 fallback 到 default agent：

```
agent "ddd.xreviewer" not found. Falling back to default agent
```

review 仍能完成（fallback 後靠 prompt 內容引導），但 reviewer 沒套到正確的 system prompt + permission 限制。

### 使用者決策（2026-04-13）

修正範圍：**全部 P1-P4 + opencode runner agent 名修正**。

`opencode` 修法傾向：在 `scripts/build.js` 的 `AGENT_OVERRIDES['ddd-reviewer'].opencode` 加上 `name: 'ddd.xreviewer'`（並對應改 file output naming），讓 build 輸出與 runner 引用的名字對齊；不改 runner，避免日後 opencode 端的 dot convention 又分歧。

---

## 2026-04-13（夜段）M4.5 修正完成

### 派工策略

三條工作線並行派 `ddd-developer`，三組檔案無重疊：
- 工作線 A：`xreview-orchestrator.sh` + 測試（P1+P2+P4）
- 工作線 B：`SKILL.md` + 新 wrapper（P3）
- 工作線 C：`scripts/build.js` + test（Pre-existing）

### 結果

| 工作線 | 改動 | 測試 |
|--------|------|------|
| A (P1+P2+P4) | setsid 隔離 PGID、cleanup 改 PGID kill + 2s grace + KILL、runid 加 RANDOM、cli/model regex 驗證 | orchestrator test 36/36（原 24 + 新 12） |
| B (P3) | 新增 `run-orchestrator.sh` wrapper、SKILL.md 步驟 3 用 wrapper、步驟 4 加 events_map pseudo-code + ALL_DONE fallback、注意事項補 SIGKILL 限制 | npm test 全平台、deploy 11 skills + 2 agents OK |
| C (Pre-existing) | `AGENT_OVERRIDES['ddd-reviewer'].opencode.name = 'ddd.xreviewer'` + 檔名覆蓋邏輯 | vitest 174/174、`~/.config/opencode/agents/ddd.xreviewer.md` 已部署 |

### 意外發現：`timeout` 與 setsid 衝突

工作線 A 除錯時發現的 root cause：

> GNU coreutils `timeout` 預設會 `setpgid()` 把 child 放新 PGID（為了它自己 timeout 時 `kill -- -$pgid` 殺乾淨子孫）。這跟上層 setsid 衝突——上層的 `kill -TERM -- -$setsid_pgid` 只殺得到 setsid leader bash，殺不到 timeout 及其子孫。

`--foreground` flag 表面語意是「保留 controlling TTY」，但副作用是不做 setpgid——這才是真正修復點。`xreview-runner.sh` 早就用了 `--foreground`（為 OpenCode stderr-TTY 問題），但 orchestrator 的 claude branch 漏了。這也解釋為什麼第一輪實測 cleanup 不徹底——不只是 SIGTERM 沒送到 PGID，是 PGID 結構本身就被 timeout 切斷。

修正後實測：mock children 在 SIGTERM 後 2 秒 grace 內全部消失。

### 未盡事項

- M4.5 最後一項「重跑一次 cross review 確認不再 fallback」留待下次自然 cross review 時驗證，不專為此 dispatch
- M5 扶正（覆蓋 ddd.xreview）依使用者決策時機進行

---

## 2026-04-13（深夜）第二輪 Cross Review 與修正

### 第二輪 Cross Review

對 commit `24751b2` 派 `claude-sonnet-4-6` + `gemini-3-pro-preview`。

- sonnet：✅ 完成，產出 2 Important + 4 Nit findings
- gemini-3-pro：❌ FAIL（`429 No capacity available for model gemini-3.1-pro-preview on the server`，Google 端限流，重試 10 次仍失敗，非本 commit 問題）

### 共識 Findings（單方 sonnet，但 coordinator 驗證確認）

| 嚴重度 | Finding | 判定 |
|--------|---------|------|
| 🟡 Important | `cleanup()` 無謂 `sleep 2` + trap EXIT/INT/TERM 三重重入 | ✅ 確認（正常 happy path 多等 2 秒、SIGTERM 路徑 cleanup 跑兩次 + 誤 emit ALL_DONE） |
| 🟡 Important | 測試用 `sleep 2` 等 mock PID 檔，CI 高負載 flaky | ✅ 確認（改 poll ≤ 5s） |
| 🟢 Nit N1 | 外層 `slug_of()` 是 dead code | ✅ 確認（順帶解決） |
| 🟢 Nit N2 | model regex 不允許 `@`，未來 `model@version` 可能撞 | ⏸️ 延後（無立即需求） |
| 🟢 Nit N3 | invalid spec 的 `log=invalid_spec_format` 不是有效路徑，與 SKILL.md 「log 欄位仍然可讀」矛盾 | ⏸️ 延後（語意小問題） |
| 🟢 Nit N4 | `"${pids[@]:-}"` 空陣列仍 iterate 一次，可用 length guard 更清晰 | ✅ 部分解決（cleanup 重寫時順手加了 `[[ -z "$pid" ]] && continue`） |

### 使用者提案（同批修正）

START 事件加 log path：`START <spec> <log-path>`——讓 main agent 在 review 進行中就能即時 peek log，不用等 DONE。

對立意見（DONE 時 cat 整份內容）被 coordinator 否決，理由：Monitor 文件明確警告「Never pipe raw logs」，會塞爆 main agent context、觸發 Monitor 過量保護。現行「DONE + log path → main Read」才是 Monitor 設計鼓勵的 pattern。

### 修正結果

派 `ddd-developer` 單線執行：

- `xreview-orchestrator.sh`：
  - cleanup 加 `_cleanup_ran` 重入 guard、`[[ ${#pgids[@]} -gt 0 ]]` 包 sleep + SIGKILL
  - trap 改為 `INT: cleanup; exit 130` / `TERM: cleanup; exit 143` / `EXIT: cleanup`（INT/TERM 直接 exit 避開 ALL_DONE 誤 emit）
  - slug + log path 移到主 shell，START event 含 log path，setsid body 不再重算
  - `slug_of()` 從 dead code 變為真正被使用
- `xreview-orchestrator.test.sh`：
  - 新增 `wait_for_pid_file_lines()` helper（poll 最多 5s，0.1s interval）
  - SIGTERM/SIGINT 測試改用 poll
  - 新增 START log path assertion
- `SKILL.md`：事件流範例 + events_map pseudo-code 同步 START 新格式

**測試**：37/37（原 36 + 1 新 assertion）、npm test 全平台通過。

**效能量測**（mock claude）：
- 1 reviewer happy path：~2.07s → **0.035s**（-2.04s）
- 3 reviewers happy path：~2.07s → **0.089s**（-1.98s）

cleanup 重入 guard + conditional sleep 的效果精準對齊預期。

---

## 2026-04-13（凌晨）第三輪 Cross Review 與修正

### 第三輪 Cross Review

對 uncommitted 第二輪修正派 `claude-opus-4-6` + `opencode:github-copilot/gpt-5.4`。

- opus：✅ 完成，3 Important + 3 Nit
- gpt-5.4：⚠️ 標為 FAIL exit_code=1 但 **log 實際含完整 review**（根因：runner error grep heuristic false positive——review 正文討論 `ERROR handling` / `**Error:**` 被誤判）

### 共識 Findings 與處理

| Finding | 兩方判定 | 共識 | 處理 |
|---------|----------|------|------|
| START 廣播 log path 時檔案尚未存在（race） | opus I3 Important / gpt I1 Important | 2/2 | ✅ parent 預建 log 寫 meta header，setsid body 改 `>>` |
| Invalid spec 的 START 與 FAIL log path 不一致 | gpt 進階觀察 | 1/2 | ✅ invalid 走同路徑，log 檔含錯誤訊息 |
| 測試 poll `\|\| true` 掩蓋失敗 | gpt I2 Important / opus N1 | 2/2 | ✅ 移除 `\|\| true`，assert mock count 精確 |
| `XREVIEW_PER_TIMEOUT` 對外部 CLI 無效 | opus I1 Important | opus only | ✅ 改寫死 3000s，orchestrator 傳 runner，移除 env var |
| External CLI dispatch 測試 0 覆蓋 | opus I2 Important / gpt N1 | 2/2 | ✅ 新增 opencode + gemini happy path（+7 asserts） |
| AGENTS.md 舊敘事「Claude subagent 固定使用」 | gpt N1 | gpt only | ✅ 文案更新為 orchestrator 統一派發 |
| FAIL 事件對外部 CLI 資訊薄 | opus N3 / gpt 部分 | 1.5/2 | ⏸️ 延後（需 runner 改造） |

**意外發現：gpt-5.4 FAIL 的真實根因**

gpt-5.4 實際成功產出完整 review（log 完整可讀），但被 runner 在 line 103 的 grep heuristic 誤判——review 正文大量討論「error handling / Error:」被當成 CLI 錯誤。

使用者決定：**移除整個 heuristic**（信任 exit code）。理由：
- 該 heuristic 試圖守護的情境（API 失敗 + exit 0）實務少見
- 現存 timeout 124 + `rc != 0` 已涵蓋真失敗
- 誤報代價（完整 review 被標 FAIL）比漏報更惱人

副作用：runner.sh 同時清理相關 code（`mktemp` + `tee` + `trap` 都不需要），程式碼變更簡潔。

### 使用者設計決策

1. **START 寫 meta info 進 log 檔**（非僅 truncate-create 空檔）：真實有用的改進——main agent 即時 peek 也能看到 meta，而非空白檔案
2. **Timeout 直接寫死 3000s**：拒絕 env var 的認知負擔，簡化契約
3. **外部測試用實際模型名**（`opencode:gpt-5-mini`、`gemini:gemini-3-flash`）：讓測試更貼近真實使用情境（即便是 mock）
4. **opencode error heuristic 移除**：上述意外發現的根治

### 修正結果

派 `ddd-developer` 單線執行六項修正：
- `xreview-orchestrator.sh`：parent shell 預建 log + valid/invalid 二路、setsid body 改 append、timeout 寫死 3000
- `xreview-runner.sh`：timeout default 改 3000、移除 error grep heuristic（連帶清掉 mktemp/tee/trap）
- `xreview-orchestrator.test.sh`：新增 opencode + gemini dispatch 測試、poll 失敗真 FAIL、meta header 驗證
- `SKILL.md`：Timeout 注意事項更新
- `AGENTS.md`：Cross Review 模型設定段落文案（使用者自行合併了 Claude Reviewer 表格列）

**測試**：orchestrator 37 → **52/52**（淨增 15），runner 21/21，npm test 全平台綠。

**手動 sanity**：
- Valid spec：log 頂部有 `[xreview] START <spec> at <iso-date>` / `[xreview] log=<path>` / `[xreview] ---` 三行 meta header，setsid body 正確 append 在 `---` 之後
- Invalid spec：START 與 FAIL log path 完全一致，檔案含 `XREVIEW_ERROR: invalid spec format` 明確錯誤訊息
