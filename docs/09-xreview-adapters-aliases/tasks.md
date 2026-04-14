# Tasks — xreview Per-CLI Adapters + Model Aliases

## M1: Adapter 測試骨架 + 4 個 adapter 實作（Red → Green）

> 預期結果：`scripts/adapters/` 下 4 個 adapter 建立完成，每個遵循統一介面 `bash <adapter> <prompt-file> <model> <timeout>`，`adapters.test.sh` 全綠。
> 驗證方式：`bash ddd-workflow/skills/ddd.xreview/scripts/adapters.test.sh` 全數通過（mock CLI 檢驗參數傳遞、錯誤路徑、timeout 行為）。

### M1.1 測試骨架（序列，定義介面契約）

- [x] Task 1.1: 建立 `scripts/adapters/` 資料夾
- [x] Task 1.2: 建立 `scripts/adapters.test.sh`，搭 mock CLI / mock PATH / assert helpers 骨架（沿用既有 `xreview-runner.test.sh` 的 mock 模式）(Red)
- [x] Task 1.3: 在 `adapters.test.sh` 寫入 4 組 dispatch 測試（claude / opencode / gemini / codex），驗 mock 被呼叫 + 收到正確 flag 組合 (Red，4 個 adapter 還沒存在，全紅)
- [x] Task 1.4: 在 `adapters.test.sh` 寫入共用錯誤路徑測試：(a) prompt file 不存在 → exit 1 + `XREVIEW_ERROR:` 訊息、(b) CLI not in PATH → exit 1 + `XREVIEW_ERROR:`、(c) timeout → exit 124 (Red)

### M1.2 實作 4 個 adapter

介面契約已由 M1.1 測試固定，4 個 adapter 檔案無重疊、可平行。

#### 🔀 可平行工作線

**[A] adapters/claude.sh** — `isolation: worktree`
> 範圍：`ddd-workflow/skills/ddd.xreview/scripts/adapters/claude.sh`
> 依賴：M1.1 完成（測試骨架定義了介面）
> 介面契約：`bash claude.sh <prompt-file> <model> <timeout-sec>`；呼叫 `claude -p --agent ddd-reviewer --model <model> --no-session-persistence --permission-mode plan --output-format text < <prompt-file> 2>&1`，exit code 透傳，timeout=124
> 驗證方式：`bash adapters.test.sh` 中 claude dispatch + 錯誤路徑測試全過
> 來源參照：現行 `xreview-orchestrator.sh` setsid body 內 `case claude)` 分支邏輯
- [x] Task 1.5.A: 實作 `adapters/claude.sh`（set -uo pipefail、`command -v claude` 解析路徑、`timeout --foreground` 包裝、stdin pipe prompt） (Green)

**[B] adapters/opencode.sh** — `isolation: worktree`
> 範圍：`ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.sh`
> 依賴：M1.1 完成
> 介面契約：`bash opencode.sh <prompt-file> <model> <timeout-sec>`；呼叫 `opencode run --print-logs --log-level ERROR --agent ddd.xreviewer --model <model> < <prompt-file> 2>&1`
> 驗證方式：`bash adapters.test.sh` 中 opencode dispatch 測試全過
> 來源參照：現行 `xreview-runner.sh` 的 `opencode)` case
- [x] Task 1.5.B: 實作 `adapters/opencode.sh`（移除原 runner 的 `cli:model` 字串解析，只收 `model` 參數） (Green)

**[C] adapters/gemini.sh** — `isolation: worktree`
> 範圍：`ddd-workflow/skills/ddd.xreview/scripts/adapters/gemini.sh`
> 依賴：M1.1 完成
> 介面契約：`bash gemini.sh <prompt-file> <model> <timeout-sec>`；呼叫 `gemini --approval-mode=plan --admin-policy=<policy> -m <model> < <prompt-file> 2>&1`；policy 路徑 `../../../../policies/ddd.xreview.toml`（相對 adapter，比 runner 多一層）
> 驗證方式：`bash adapters.test.sh` 中 gemini dispatch 測試全過，policy 路徑解析正確（mock 收到絕對路徑）
> 來源參照：現行 `xreview-runner.sh` 的 `gemini)` case
- [x] Task 1.5.C: 實作 `adapters/gemini.sh`（policy 路徑多一層 `../`） (Green)

**[D] adapters/codex.sh** — `isolation: worktree`
> 範圍：`ddd-workflow/skills/ddd.xreview/scripts/adapters/codex.sh`
> 依賴：M1.1 完成
> 介面契約：`bash codex.sh <prompt-file> <model> <timeout-sec>`；呼叫 `codex exec --sandbox read-only --ephemeral --model <model> - < <prompt-file> 2>&1`
> 驗證方式：`bash adapters.test.sh` 中 codex dispatch 測試全過
> 來源參照：現行 `xreview-runner.sh` 的 `codex)` case
- [x] Task 1.5.D: 實作 `adapters/codex.sh` (Green)

#### 🔗 匯合點

- [x] Task 1.6: 4 條工作線合併後，於主 branch 跑 `bash adapters.test.sh` 全綠
- [x] Task 1.7: 檢查 4 個 adapter 的 shell 共同模板對齊（set -uo pipefail、`command -v` 檢查、`timeout --foreground` 用法、錯誤訊息格式一致）

---

## M2: Orchestrator dispatch 重構 + 舊檔清理

> 預期結果：`xreview-orchestrator.sh` 不再有 claude inline 分支、不再引用 `xreview-runner.sh`；舊 wrapper 和 runner 檔案刪除；既有 24 個 orchestrator 測試仍全綠。
> 驗證方式：`bash xreview-orchestrator.test.sh` 既有 24 測試全過；`ls scripts/` 確認無 run-orchestrator.sh / xreview-runner.sh / xreview-runner.test.sh。

- [x] Task 2.1: 於 `xreview-orchestrator.sh` 加入 `adapters_dir="$script_dir/adapters"` 宣告，移除 `runner="$script_dir/xreview-runner.sh"`
- [x] Task 2.2: 重寫 setsid body 內 dispatch 邏輯——移除 `case "$cli" in claude) ... opencode|gemini|codex) ... esac`，改為單一呼叫 `timeout --foreground "$timeout_val" bash "$adapters_dir/$cli.sh" "$prompt_file" "$model" "$timeout_val" >> "$log" 2>&1`（內層 `timeout --foreground` 保留 defense-in-depth）
- [x] Task 2.3: 將「unknown cli」fallback 從 case 分支移至 adapter 檔案不存在檢查——`[[ ! -f "$adapters_dir/$cli.sh" ]]` 時輸出 `XREVIEW_ERROR: unknown cli` 並退 rc=1
- [x] Task 2.4: 跑 `bash xreview-orchestrator.test.sh` 驗既有 24 測試全過（Layer 1 streaming/blocking、PGID cleanup、SIGTERM/SIGINT trap 等行為不變）
- [x] Task 2.5: 檢查 `xreview-orchestrator.test.sh` 對 claude 的 mock assertion——mock 仍由 PATH 注入、收到的 flag 應與 refactor 前一致（因為 adapter 原樣傳同一組 flag），若有 fail 表示有隱性耦合需修正 assertion
- [x] Task 2.6: 刪除 `scripts/run-orchestrator.sh`
- [x] Task 2.7: 刪除 `scripts/xreview-runner.sh`
- [x] Task 2.8: 刪除 `scripts/xreview-runner.test.sh`

---

## M3: Alias 解析功能

> 預期結果：`resolve_spec()` 函數能從 `~/.config/ddd-workflow/xreview.json` 的 `aliases` 區塊 resolve bare 短名；event stream / log filename / report 全使用 resolved spec；5 個 alias 單元測試全綠。
> 驗證方式：`bash xreview-orchestrator.test.sh` 新增 5 個 alias 測試全過；手動用 `echo opus | orchestrator` 觀察 event 輸出 `START claude:opus ...`。

### M3.1 測試先行（Red）

- [x] Task 3.1: 於 `xreview-orchestrator.test.sh` 新增 alias 測試區塊——mock `~/.config/ddd-workflow/xreview.json`（透過 env 或 CLI 參數指向 tmp config），寫入 test aliases
- [x] Task 3.2: 寫測試 (a) **hit alias**：CLI 參數 `opus`，config alias `{"opus": "claude:opus"}`，預期 event stream 出現 `START claude:opus <log>` (Red)
- [x] Task 3.3: 寫測試 (b) **miss alias**：CLI 參數 `unknown-short`，無 alias 命中，預期 event 出現 `START unknown-short <log>`（後續 validate 會擋，測試這裡只驗 resolve 行為）(Red)
- [x] Task 3.4: 寫測試 (c) **config 沒 aliases 區塊**：config 只有 `reviewers`，預期所有 spec 原樣傳遞、無錯誤 (Red)
- [x] Task 3.5: 寫測試 (d) **CLI 參數覆蓋也吃 alias**：orchestrator 被呼叫時直接傳 `opus`，預期 resolve 為 `claude:opus` (Red)
- [x] Task 3.6: 寫測試 (e) **reviewers 預設短名**：config 含 `"reviewers": ["opus", "5.4"]` + 完整 aliases，不傳 CLI 參數，預期 2 個 reviewer 都被 resolve 並 dispatch (Red)

### M3.2 實作（Green）

- [x] Task 3.7: 於 `xreview-orchestrator.sh` 加入 `resolve_spec()` 函數——接收單一 spec 字串，若 `jq '.aliases[$spec]'` 回非 null 則回傳 value，否則原樣回傳 spec；config 缺 `aliases` 鍵或 jq 查不到時靜默 passthrough
- [x] Task 3.8: 在 specs array 收完之後（CLI args + config 兩來源合併完）、validate 之前，對 `specs[@]` 整批 resolve，寫回同一個 array
- [x] Task 3.9: 確認 event 廣播（`START / DONE / FAIL`）、`slug_of` 產生的 log filename、sidecar `.status` 檔名、blocking-mode footer 全部使用 resolved spec
- [x] Task 3.10: 跑 `bash xreview-orchestrator.test.sh` 驗 M3.1 的 5 個測試全過 + 既有 24 測試不回歸

### M3.3 Config 預設更新

- [x] Task 3.11: 編輯 `ddd-workflow/config/xreview.json`，加入 `aliases` 區塊（7 個預設：`5.4` / `5-mini` / `haiku` / `sonnet` / `opus` / `pro` / `flash`）
- [x] Task 3.12: 將 `reviewers` 預設改為短名 `[
  "opus", "5.4", "pro"
]`
- [x] Task 3.13: 驗證 `scripts/cli.js` 的 deploy 行為——`~/.config/ddd-workflow/xreview.json` 已存在時不覆蓋（讀原始碼確認，不實際跑 deploy 在使用者 config 上）

---

## M4: 文件更新 + 端到端驗證

> 預期結果：SKILL.md 與 cli-adapters.md 的引用與新架構一致；`npm run deploy && npm test` 全綠；實跑一次真實 cross review 端到端驗證。
> 驗證方式：`npm test` 通過；手動派一次 xreview 對當前 sprint 的變更做 review，3 個 reviewer 都 `DONE`。

- [x] Task 4.1: 更新 `ddd-workflow/skills/ddd.xreview/SKILL.md`——Monitor command 從 `bash ~/.claude/skills/ddd.xreview/scripts/run-orchestrator.sh` 改為 `bash ~/.claude/skills/ddd.xreview/scripts/xreview-orchestrator.sh`
- [x] Task 4.2: 更新 SKILL.md——刪除 wrapper 的 rationale 段落（「使用 `run-orchestrator.sh` wrapper（thin exec 到 `xreview-orchestrator.sh`）」bullet）
- [x] Task 4.3: 更新 SKILL.md——在「設定要點」或「前提條件」段落新增 alias 用法說明（7 個預設短名清單、alias 表位置、個人 config 需自行增補的提醒）
- [x] Task 4.4: 更新 `ddd-workflow/skills/ddd.xreview/references/cli-adapters.md`——所有 `xreview-runner.sh` 引用改為 `adapters/<cli>.sh`（檢查檔案開頭、各 CLI 段落、使用範例）
- [x] Task 4.5: 跑 `npm run deploy`，觀察 stdout 無錯誤
- [x] Task 4.6: 跑 `npm test` 驗 symlink 完整性全綠（含 adapters/ 的 symlink 結構）
- [ ] Task 4.7: 手動端到端——對當前 sprint 的 git diff 派一次 real xreview（3 個 reviewer）；驗證 (a) 3 個都收到 `DONE`、(b) event stream 顯示 resolved 真名如 `START claude:opus`、(c) 報告引用的 log filename 含真名 slug
- [ ] Task 4.8: Self check：所有 spec 驗收條件逐條確認 ✓；若有遺漏補 task 回歸處理

---

## 平行度決策摘要

| Milestone | 平行度 | 理由 |
|-----------|-------|------|
| M1.1 測試骨架 | 序列 | 4 個 adapter 的測試寫在同一個 `adapters.test.sh`，共用 mock 設定，切開反而增加 merge 成本 |
| M1.2 adapter 實作 | 🔀 4 線平行 | 4 個獨立檔案、介面契約已固定、quirks 各自獨立、merge 成本低 |
| M2 dispatch 重構 | 序列 | 集中在 orchestrator 單檔 + 相關測試 + 刪除舊檔，不可平行 |
| M3 alias | 序列 | 先測試後實作，同一個 orchestrator 檔案 |
| M4 docs | 序列 | SKILL.md / cli-adapters.md / 驗證有順序關係（docs 改完才 deploy + 端到端） |
| M5.1 Timeout 上移 | 序列 | orchestrator + 4 adapter + 兩個 test 檔案全部連動 |
| M5.2 事件命名 | 序列 | 純字串 rename 跨 orchestrator / test / SKILL.md，序列較清楚 |
| M5.3 Worktree convention | 序列 | 純文件，不平行 |
| M5.4 Sandbox 放行 | 🔀 2 線可平行 | `opencode.sh` 與 `gemini.sh` 機制不同但檔案獨立；`codex.sh` 先驗證再決定 |
| M5.5 端到端重跑 | 序列 | 依賴前面全部完成 |

M1.2、M5.4 是值得平行的區塊。若 coordinator 判斷 4 個 adapter / M5.4 兩條線工作量太小（extract-and-rename / 單 flag 加法），也可合併序列執行。

---

## M5: 後續調整（timeout 單層、事件分層、worktree 約定、sandbox 放行）

> 預期結果：ADR-6 ~ ADR-9 落地；重跑 Task 4.7 時 3 個 reviewer 都 `RETURN` 且 log 內容是真 review（不是 `FAIL:`）。
> 驗證方式：`bash adapters.test.sh` + `bash xreview-orchestrator.test.sh` 全綠；手動重跑 Task 4.7 通過。

### M5.1 Timeout 上移到 orchestrator（ADR-6）

- [ ] Task 5.1.1 (Red)：於 `xreview-orchestrator.test.sh` 新增測試：mock adapter 故意 sleep 超過 `timeout_val`，預期 orchestrator raise `FAIL ... exit_code=124 ...`
- [ ] Task 5.1.2 (Red)：於 `adapters.test.sh` 刪除原有的 timeout 124 測試（4 個 adapter 各一個），改為 assert「adapter 不處理 timeout，rc 純透傳」
- [ ] Task 5.1.3 (Green)：`xreview-orchestrator.sh:307` 改為 `timeout --foreground "$timeout_val" bash "$adapter" "$prompt_file" "$model" >> "$log" 2>&1`
- [ ] Task 5.1.4 (Green)：`adapters/claude.sh` 移除 `timeout --foreground "$timeout_sec"` 與 `rc == 124 → XREVIEW_ERROR: timed out` 區塊，保留 `command -v` 與 `exec 2>&1`
- [ ] Task 5.1.5 (Green)：`adapters/opencode.sh` 同上
- [ ] Task 5.1.6 (Green)：`adapters/gemini.sh` 同上
- [ ] Task 5.1.7 (Green)：`adapters/codex.sh` 同上
- [ ] Task 5.1.8 (Refactor)：檢查 adapter 介面註解——`timeout-seconds` 參數還要不要收？若保留需加註「目前未用、為未來擴充」；若拿掉則 orchestrator 呼叫端也少傳一個
- [ ] Task 5.1.9：跑 `bash adapters.test.sh` + `bash xreview-orchestrator.test.sh` 全綠

### M5.2 事件命名：DONE → RETURN（ADR-7）

- [ ] Task 5.2.1 (Red)：`xreview-orchestrator.test.sh` 全域把 assert 裡的 `DONE` 改為 `RETURN`（搜 `DONE[^_]` 避免動到 `ALL_DONE`）
- [ ] Task 5.2.2 (Green)：`xreview-orchestrator.sh` 的 `echo "DONE $spec $log"` 改為 `echo "RETURN $spec $log"`
- [ ] Task 5.2.3：跑 test 驗證全綠
- [ ] Task 5.2.4：`SKILL.md` 步驟 4（事件收集）把 `DONE` 全部改 `RETURN`、補說明「RETURN = transport OK，未必 content OK」
- [ ] Task 5.2.5：`SKILL.md` 步驟 5（失敗處理）把 `DONE` 改 `RETURN`
- [ ] Task 5.2.6：`SKILL.md` 步驟 7（Coordinator 驗證）在開頭加一條：「先 peek 每個 RETURN 對應的 log 尾 10 行。若含 `FAIL:` / `XREVIEW_ERROR:` / agent 自陳失敗，標為 content-layer 失敗，不納入有效 review。」
- [ ] Task 5.2.7：`ddd-reviewer` agent 若有 `DONE:` 收尾格式的指令，檢查是否需要同步（agent 自己回報的 `DONE:` 是 content-layer 語意，不是 transport，保留不動）

### M5.3 Worktree 路徑約定（ADR-8）

- [ ] Task 5.3.1：`ddd-workflow/references/AGENTS.md` 加一段「worktree 建議路徑」——位置建議放在「角色分工」與「DDD 工作流」之間的合適段落
- [ ] Task 5.3.2：`ddd-workflow/skills/ddd.work/SKILL.md` 的 Phase 2 派發段落若有提到 worktree 位置，呼應本約定；沒提到就補一行
- [ ] Task 5.3.3：根目錄 `.gitignore` 檢查是否已有 `/.worktrees`；沒有就補

### M5.4 Adapter sandbox 放行（ADR-9）

#### 🔀 可平行工作線

**[A] adapters/opencode.sh** — `isolation: worktree`
> 範圍：`ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.sh` + `adapters.test.sh` 對應測試
> 介面契約：adapter 呼叫時把 `OPENCODE_PERMISSION` env var 設為 inline JSON（放行 `/tmp/**` 和 `~/.config/ddd-workflow/**`），不需要暫存檔、無 trap cleanup
> 驗證：mock opencode 捕捉 `OPENCODE_PERMISSION` env var 字串，驗 JSON 包含正確 pattern
- [ ] Task 5.4.A.1 (Red)：`adapters.test.sh` 新增 opencode sandbox 測試（mock 側錄 `OPENCODE_PERMISSION` env 並用 jq assert `external_directory` 含 `/tmp/**` 與 `~/.config/ddd-workflow/**`）
- [ ] Task 5.4.A.2 (Green)：實作 opencode adapter 的 `OPENCODE_PERMISSION` env var 機制（單行 inline JSON）

**[B] adapters/gemini.sh** — `isolation: worktree`
> 範圍：`ddd-workflow/skills/ddd.xreview/scripts/adapters/gemini.sh` + `adapters.test.sh` 對應測試
> 介面契約：呼叫加 `--include-directories /tmp,$HOME/.config`
> 驗證：mock gemini assert 收到正確 flag
- [ ] Task 5.4.B.1 (Red)：`adapters.test.sh` 新增 gemini sandbox 測試（assert flag 字串存在）
- [ ] Task 5.4.B.2 (Green)：實作 gemini adapter 的 `--include-directories` 參數

#### 🔗 匯合點 / codex 驗證

- [ ] Task 5.4.C.1：手動跑一次 codex reviewer（用 sprint diff），觀察是否撞 workspace 限制。若無 → 記在 works.md「已驗證不需要」；若有 → 補 Task 5.4.C.2 實作對應放行
- [ ] Task 5.4.C.2（條件式）：視 5.4.C.1 結果補 codex adapter 的 sandbox flag
- [ ] Task 5.4.D：跑完整 `bash adapters.test.sh` + `bash xreview-orchestrator.test.sh` 全綠

### M5.5 端到端重跑 Task 4.7

- [ ] Task 5.5.1：`npm run deploy`、`npm test` 全綠
- [ ] Task 5.5.2：對 sprint diff（或已 commit 的 M5 變更）重派 xreview，驗：
  - (a) 3 個 reviewer 都 `RETURN`
  - (b) 每個 log 尾都是真 review 內容（不含 `FAIL:`）
  - (c) event stream 顯示 resolved 真名
  - (d) log filename 含真名 slug
  - (e) coordinator 驗證步驟（步驟 7）能正確 peek log 尾、不誤判
- [ ] Task 5.5.3 (Self check)：逐條檢查 spec M5 驗收條件，若有遺漏補 task 回歸
- [ ] Task 5.5.4：勾選 Task 4.7 / Task 4.8 完成狀態（前 sprint 的尾巴）
