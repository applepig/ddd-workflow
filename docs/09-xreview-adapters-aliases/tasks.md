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
- [x] Task 4.7: 手動端到端——對當前 sprint 的 git diff 派一次 real xreview（3 個 reviewer）；驗證 (a) 3 個都收到 `RETURN`（M5.2 改名）、(b) event stream 顯示 resolved 真名如 `START claude:opus`、(c) 報告引用的 log filename 含真名 slug。於 M5.5 端到端驗證一併達成
- [x] Task 4.8: Self check：所有 spec 驗收條件逐條確認 ✓；若有遺漏補 task 回歸處理（M5.5.3 合併處理）

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

- [x] Task 5.1.1 (Red)：於 `xreview-orchestrator.test.sh` 新增測試：mock adapter 故意 sleep 超過 `timeout_val`，預期 orchestrator raise `FAIL ... exit_code=124 ...`
- [x] Task 5.1.2 (Red)：於 `adapters.test.sh` 刪除原有的 timeout 124 測試（4 個 adapter 各一個），改為 assert「adapter 不處理 timeout，rc 純透傳」
- [x] Task 5.1.3 (Green)：`xreview-orchestrator.sh` setsid body 改為 `timeout --foreground "$timeout_val" bash "$adapter" ...`；同時加 `XREVIEW_TIMEOUT_SEC` env var 讓測試能注入小 timeout
- [x] Task 5.1.4 (Green)：`adapters/claude.sh` 移除 `timeout --foreground "$timeout_sec"` 與 `rc == 124 → XREVIEW_ERROR: timed out` 區塊，保留 `command -v` 與 `exec 2>&1`
- [x] Task 5.1.5 (Green)：`adapters/opencode.sh` 同上
- [x] Task 5.1.6 (Green)：`adapters/gemini.sh` 同上
- [x] Task 5.1.7 (Green)：`adapters/codex.sh` 同上
- [x] Task 5.1.8 (Refactor)：adapter 3rd arg 保留但 header 註為「accepted but ignored, ADR-6: timeout is enforced by orchestrator」，orchestrator 呼叫端簽名不變
- [x] Task 5.1.9：跑 `bash adapters.test.sh` + `bash xreview-orchestrator.test.sh` 全綠（58 + 107 passed）

### M5.2 事件命名：DONE → RETURN（ADR-7）

- [x] Task 5.2.1 (Red)：`xreview-orchestrator.test.sh` 全域把 assert 裡的 `DONE` 改為 `RETURN`（搜 `DONE[^_]` 避免動到 `ALL_DONE`）；footer row 字串從 `[DONE]      ` 改為 `[RETURN]    `；summary 文字從 `N done` 改為 `N returned`
- [x] Task 5.2.2 (Green)：`xreview-orchestrator.sh` 的 `echo "DONE $spec $log"` 改為 `echo "RETURN $spec $log"`；footer 同步改用 `[RETURN]` 與 `returned` 字樣
- [x] Task 5.2.3：跑 test 驗證全綠（107 passed）
- [x] Task 5.2.4：`SKILL.md` 步驟 4 事件範例與 events_map pseudo 改用 `RETURN`，新增「事件語意」段落說明 RETURN/FAIL/ALL_DONE 三層
- [x] Task 5.2.5：`SKILL.md` 步驟 5 失敗處理改用 RETURN 並補「content-layer 失敗由步驟 7 peek 過濾」
- [x] Task 5.2.6：`SKILL.md` 步驟 7 前置加上「7.1 Content layer 過濾」子段，定義 `tail -n 10` peek 協議與 4 類判斷規則（`FAIL:` / `XREVIEW_ERROR:` / 自陳失敗 / 空 log）
- [x] Task 5.2.7：`ddd-reviewer` agent 的 `DONE:` 收尾是 content-layer 語意（agent 自陳成功），與 orchestrator transport 層 `RETURN` 正交，保留不動

### M5.3 Worktree 路徑約定（ADR-8）

- [x] Task 5.3.1：`ddd-workflow/references/AGENTS.md` 於 Git 段落下加 `### Worktree 路徑約定`，說明 `$PROJECT_ROOT/.worktrees/<branch>/` 與與 Claude Code `.claude/worktree/*` 的區別
- [x] Task 5.3.2：`ddd-workflow/skills/ddd.work/SKILL.md` 的 Phase 2 派發段落加入 blockquote 呼應 AGENTS.md 的 convention
- [x] Task 5.3.3：根目錄 `.gitignore` 加入 `/.worktrees/`

### M5.4 Adapter sandbox 放行（ADR-9）

#### 🔀 可平行工作線

**[A] adapters/opencode.sh** — `isolation: worktree`
> 範圍：`ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.sh` + `adapters.test.sh` 對應測試
> 介面契約：adapter 呼叫時把 `OPENCODE_PERMISSION` env var 設為 inline JSON（放行 `/tmp/**` 和 `~/.config/ddd-workflow/**`），不需要暫存檔、無 trap cleanup
> 驗證：mock opencode 捕捉 `OPENCODE_PERMISSION` env var 字串，驗 JSON 包含正確 pattern
- [x] Task 5.4.A.1 (Red)：`adapters.test.sh` 新增 opencode sandbox 測試（mock 側錄 `OPENCODE_PERMISSION` env 並用 jq assert `external_directory` 含 `/tmp/**` 與 `~/.config/ddd-workflow/**`）
- [x] Task 5.4.A.2 (Green)：實作 opencode adapter 的 `OPENCODE_PERMISSION` env var 機制（單行 inline JSON）

**[B] adapters/gemini.sh** — `isolation: worktree`
> 範圍：`ddd-workflow/skills/ddd.xreview/scripts/adapters/gemini.sh` + `adapters.test.sh` 對應測試
> 介面契約：呼叫加 `--include-directories /tmp,$HOME/.config`
> 驗證：mock gemini assert 收到正確 flag
- [x] Task 5.4.B.1 (Red)：`adapters.test.sh` 新增 gemini sandbox 測試（assert flag 字串存在）
- [x] Task 5.4.B.2 (Green)：實作 gemini adapter 的 `--include-directories` 參數

#### 🔗 匯合點 / codex 驗證

- [ ] Task 5.4.C.1：手動跑一次 codex reviewer（用 sprint diff），觀察是否撞 workspace 限制。**developer 無法在 session 內實跑 codex CLI，轉交 coordinator 於 M5.5 端到端驗證時順便判斷**；若撞限制再補 Task 5.4.C.2。codex.sh header 已標註 sandbox 放行狀態待驗證
- [ ] Task 5.4.C.2（條件式）：視 5.4.C.1 結果補 codex adapter 的 sandbox flag
- [x] Task 5.4.D：跑完整 `bash adapters.test.sh` + `bash xreview-orchestrator.test.sh` 全綠（58 + 107 passed）

### M5.5 端到端重跑 Task 4.7

- [x] Task 5.5.1：`npm run deploy`、`npm test` 全綠（2026-04-14 執行）
- [x] Task 5.5.2：對 M5 uncommitted 變更派 xreview，5 項驗收全達成：
  - (a) 3 個 reviewer 都 `RETURN` ✅
  - (b) 每個 log 尾都是真 review 內容（不含 `FAIL:`）✅
  - (c) event stream 顯示 resolved 真名（`claude:claude-opus-4-6` / `opencode:github-copilot/gpt-5.4` / `gemini:gemini-3-pro-preview`）✅
  - (d) log filename 含真名 slug ✅
  - (e) 步驟 7.1 peek 過濾可正確運作 ✅
- [x] Task 5.5.3 (Self check)：spec M5 驗收條件逐條確認；發現 3 個 post-review findings 轉為 M6（見下）
- [x] Task 5.5.4：勾選 Task 4.7 / Task 4.8

---

## M6: Cross review findings 修復 + orchestrator UX 改善

> 背景：M5.5 端到端 xreview 產生 3 個 findings（F1 process leak、F2 timeout log marker、F3 XDG）；使用者另追加新需求（M6.4）把 prompt tmp file 管理內化到 orchestrator，降低 coordinator 的 tool call 次數。
> 預期結果：4 條改善全部落地、`adapters.test.sh` / `xreview-orchestrator.test.sh` 全綠、重跑一次端到端驗證 F1 修復（mock CLI 真的被 kill）。
> 驗證方式：unit tests + 一次實跑 xreview 觀察 timeout 路徑是否乾淨收尾、coordinator 是否只需單次 Monitor call。

### M6.1 修 F1：timeout 外層化造成 CLI orphan（Critical，claude + opencode 共識）

**背景**：`setsid bash → timeout --foreground → bash adapter → CLI binary` 結構下，`timeout(1)` 只 SIGTERM 直接子（bash adapter）；adapter 死後 CLI 成為 orphan，被 init 收養，繼續吃 token quota。cleanup trap 只在使用者 INT/TERM 中斷 orchestrator 時有效，timeout 觸發路徑不會清理 pgid 內 orphan。

**方案 A（推薦）**：adapter 最後一行改 `exec "$cli_path" ... < "$prompt_file"`。被 timeout 監控的就是 CLI 本體，SIGTERM 直達。失去 adapter 的「rc≠0 錯誤轉寫」訊息，但 orchestrator 已 emit `FAIL ... exit_code=N`，重複價值低。

**方案 B（保守）**：orchestrator 加 `--kill-after=5`，setsid 子 shell 收到 124 時 `kill -TERM 0; sleep 1; kill -KILL 0` 清自己 pgid。保留 adapter 後處理區塊。

- [x] Task 6.1.1（決策）：採 Method B（orchestrator pgid sweep），adapter 保留不動；理由：保留 adapter 的 rc 訊息與「可獨立 bash 執行」便利性，F1 的治本方案在 orchestrator 層就能解
- [x] Task 6.1.2 (Red)：`xreview-orchestrator.test.sh` 的 timeout test 用 mock sentinel 寫 `$$` 到 tmp 檔，timeout 觸發後 `kill -0` 驗 mock claude 真的消失
- [x] Task 6.1.3 (Green)：setsid body 內 rc==124 時掃 `pgrep -g $BASHPID` 排除自己後 SIGTERM，sleep 1 再 SIGKILL 殘存
- [x] Task 6.1.4：test 全綠（orchestrator 118 passed）

### M6.2 修 F2：timeout 觸發時 log 沒 marker，違反步驟 7.1 peek 協議（Important，opencode 指出）

**背景**：現在 rc==124 時只 emit event，log 尾是**半截 review 內容**——非空、不含 `FAIL:` / `XREVIEW_ERROR:`，會被步驟 7.1 的 4 類過濾判為**有效 review**，誤導 coordinator。

- [x] Task 6.2.1 (Red)：timeout test 新增 assert：log 含 `XREVIEW_ERROR: orchestrator timeout` 字樣
- [x] Task 6.2.2 (Green)：orchestrator rc==124 時 `echo "XREVIEW_ERROR: orchestrator timeout after ${timeout_val}s" >> "$log"`（在 pgid sweep 前先 append）
- [x] Task 6.2.3：test 全綠（合併在 M6.1 一起驗）

### M6.3 修 F3：XDG_CONFIG_HOME 硬編碼（claude 指出，低優先）

**背景**：`opencode.sh` 的 `~/.config/ddd-workflow/**` 與 `gemini.sh` 的 `$HOME/.config` 寫死，不 honor `XDG_CONFIG_HOME`。orchestrator 本身有正確用 `${XDG_CONFIG_HOME:-$HOME/.config}`，adapter 沒對齊。

- [x] Task 6.3.1（opencode）：`config_dir="${XDG_CONFIG_HOME:-$HOME/.config}"` + `jq -nc --arg cfg_glob ...` 組 OPENCODE_PERMISSION JSON
- [x] Task 6.3.2（gemini）：`--include-directories "/tmp,$config_dir"`
- [x] Task 6.3.3：adapters.test.sh 新增兩條 XDG override test（opencode JSON 含 `/xdg/override/ddd-workflow/**`；gemini argv 含 `/xdg/override`）。既有 `~/.config/...` key assertion 改為絕對路徑 `${HOME}/.config/...`

### M6.4 新需求：orchestrator 內化 prompt 檔管理

**背景（使用者 2026-04-14 追加）**：目前 SKILL.md 步驟 2 要求 coordinator 用 Bash tool 跑 `mktemp` + heredoc write，步驟 6 後另外 `rm`。這迫使 coordinator 多兩次 Bash tool call，也讓 prompt 路徑在 Monitor command 裡曝光。orchestrator 內化可以：

- 讓 coordinator 只需單一 Monitor call，prompt 內容經由 stdin（或 argv `--prompt-string`）傳入
- orchestrator 自己 `mktemp` + `trap EXIT cleanup` 管理暫存檔
- prompt 內容不出現在 Monitor command line（更安全）

**介面設計選項**：
- (a) stdin：`bash xreview-orchestrator.sh < prompt.md` 或 `echo "..." | bash xreview-orchestrator.sh`——最 unix-y，但需要 Monitor 支援 stdin 傳遞
- (b) argv：新增 `--prompt-string <string>` flag，orchestrator 偵測到就內部 mktemp。保留舊用法 `bash orchestrator.sh <prompt-file>` 相容
- (c) **混合（推薦）**：`bash orchestrator.sh` 無位置參數時讀 stdin，有位置參數時仍當 file path（backward compat）

- [x] Task 6.4.1（spec）：ADR-10 寫入 spec.md，選 (c) 混合介面（stdin + file backward compat，`-` 作 stdin sentinel）
- [x] Task 6.4.2 (Red)：新增 3 組測試——stdin with `-` sentinel + specs、no-args stdin 讀 config reviewers、backward compat positional file
- [x] Task 6.4.3 (Green)：orchestrator 頂部判斷 `$# -eq 0 || $1 == "-"` 進 stdin mode，mktemp + 早期 EXIT trap；主 cleanup() 也包進 `rm -f "$_tmp_prompt_file"`，覆蓋 INT/TERM/正常退出三條路徑
- [x] Task 6.4.4：SKILL.md 步驟 2 改寫——Monitor command 以 heredoc pipe prompt 到 orchestrator stdin，orchestrator 端 `-` 搭配 reviewer spec 位置參數可同時覆蓋清單
- [x] Task 6.4.5：SKILL.md 注意事項「暫存檔清理」bullet 改為說明 orchestrator EXIT trap 自動處理
- [x] Task 6.4.6：unit test 全綠（118 passed）；e2e 驗證在 M6.6

### M6.5 codex sandbox 驗證（延續 M5.4.C）

- [x] Task 6.5.1：手動派一次 codex reviewer（加入 4 個 reviewer 的端到端 xreview），觀察是否撞 workspace 限制——M7.4 e2e 驗得：codex 在 main branch 跑不撞 sandbox / workspace 限制，實際 FAIL 是 `usage limit reached`（2026-04-21 前無法解）；另有 `bubblewrap not found` warning 但用 vendored fallback 可繼續
- [x] Task 6.5.2（條件式）：若撞限制，補 `codex.sh` 的 sandbox 放行機制（flag / env var 視 codex CLI 支援）——**不需要**，未撞 sandbox 限制

### M6.6 端到端驗證

- [x] Task 6.6.1：重跑一次端到端 xreview（4 reviewer 含 codex），驗：併入 M7.4.2 達成
  - (a) 4 個都 RETURN（含 codex）— ❌ 3 RETURN + 1 FAIL（codex usage limit，非實作 bug）
  - (b) log 尾都是真 review 內容 — 部分達成；opencode 實質 findings、gemini findings 寫外部檔（`~/.gemini/tmp/.../plans/`）、haiku log 顯示 `Write tool permission denied`（plan mode 整合問題非 M7 bug）
  - (c) coordinator 不需要任何 Bash call — 🟡 本次仍用 Bash mktemp（SKILL.md 步驟 2 ADR-10 決策維持 file mode 主路徑）
  - (d) 手動觸發 timeout 驗 F1/F2 修復 — defer（unit test 已覆蓋 F1 pgid sweep + F2 marker；手動 e2e 驗證非必要）
- [x] Task 6.6.2：Self check + 勾選所有 task——併入 M7.4.3
- [x] Task 6.6.3：commit M5+M6 變更（checkpoint 10437f8，含 sprint 10 plan 種子；M6.5 / M6.6 未勾項目 roll 進 M7 端到端一起驗）

---

## M7: Adapter JSON schema 雙輸出（ADR-11 + ADR-12）

> 背景：M5.5 端到端時單一 codex reviewer log 可達 5329 行 / 356KB。2026-04-14 smoke test 揭露根因：adapter 的 `exec 2>&1` 把 CLI 原生分離的 stderr（verbose trace）硬 merge 進 stdout（final message），orchestrator 再 redirect 成單檔。拿掉 merge 並用各 CLI 的 JSON output flag 抽 final，一次解決 verbose/final 分離問題。
> 預期結果：4 個 adapter 各自輸出 `.final.txt`（乾淨 agent 最終訊息）+ `.log`（verbose trace 除錯用）；SKILL.md 步驟 7.1 從 tail peek 改為 Read `.final.txt`；codex 正確套用 ddd-reviewer 角色。
> 驗證方式：`bash adapters.test.sh` + `bash xreview-orchestrator.test.sh` 全綠；4 reviewer 端到端，4 個 `.final.txt` 都短乾淨可直接 Read。

### M7.1 adapter 雙輸出介面升級

介面契約更新：第 3 arg 從 `<timeout-seconds>`（ADR-6 起 ignored）改為 `<final-out-file>`。4 個 adapter 同步升級。

#### 🔀 可平行工作線

**[A] adapters/claude.sh** — `isolation: worktree`
> 範圍：`claude.sh` + `adapters.test.sh` claude 段
> 介面：`bash claude.sh <prompt> <model> <final-out>`；移除 `exec 2>&1`；改用 `--output-format json` + `--debug-file "$log_dir/$base.verbose"`；stdout 單 JSON 物件由 adapter `jq -r '.result' > "$final_out"` 抽純文字
> 驗證：mock claude 吐 `{"result":"REVIEW_TEXT",...}` JSON 到 stdout、吐 verbose 到 --debug-file；assert `<final-out>` 只有 `REVIEW_TEXT`
- [x] Task 7.1.A.1 (Red)：adapters.test.sh claude 段新增雙輸出 assertion（final 內容 + stderr/debug-file 分離）
- [x] Task 7.1.A.2 (Green)：實作 claude.sh 雙輸出（移除 `exec 2>&1`、加 `--output-format json --debug-file`、adapter 內 jq 抽 `.result`）

**[B] adapters/codex.sh** — `isolation: worktree`
> 範圍：`codex.sh` + `adapters.test.sh` codex 段
> 介面：`bash codex.sh <prompt> <model> <final-out>`；移除 `exec 2>&1`；加 `-o "$final_out"`；stderr 自然分離為 verbose
> ADR-12：adapter 先用 `python3 -c 'import tomllib; ...'` 讀 `~/.codex/agents/ddd-reviewer.toml` 的 `developer_instructions`，concat 到 prompt 前；讀取失敗時降級（原 prompt + warning 到 stderr）
> 驗證：mock codex 吐 final 到 `-o` 指定檔、吐 verbose 到 stderr；mock toml 驗 prepend；toml 不存在時驗 graceful degradation
- [x] Task 7.1.B.1 (Red)：adapters.test.sh codex 段新增雙輸出 + prepend + degradation 三組 assertion
- [x] Task 7.1.B.2 (Green)：實作 codex.sh 雙輸出 + developer_instructions prepend

**[C] adapters/gemini.sh** — `isolation: worktree`
> 範圍：`gemini.sh` + `adapters.test.sh` gemini 段
> 介面：`bash gemini.sh <prompt> <model> <final-out>`；移除 `exec 2>&1`；改用 `--output-format json`；adapter `jq -r '.response' > "$final_out"`；stderr 自然分離
> 驗證：mock gemini 吐 `{"session_id":"...","response":"REVIEW",...}` JSON；assert `<final-out>` 只有 `REVIEW`
- [x] Task 7.1.C.1 (Red)：adapters.test.sh gemini 段新增雙輸出 assertion
- [x] Task 7.1.C.2 (Green)：實作 gemini.sh 雙輸出

**[D] adapters/opencode.sh** — `isolation: worktree`
> 範圍：`opencode.sh` + `adapters.test.sh` opencode 段
> 介面：`bash opencode.sh <prompt> <model> <final-out>`；移除 `exec 2>&1`；改用 `--format json`；stdout ndjson 用 `tee "$verbose_side" | jq -rs 'map(select(.type=="text")) | map(.part.text) | join("")' > "$final_out"` 分流
> 驗證：mock opencode 吐 ndjson 含 `{"type":"text","part":{"type":"text","text":"REVIEW"}}`；assert `<final-out>` 是 `REVIEW`，verbose 側保有全 ndjson
- [x] Task 7.1.D.1 (Red)：adapters.test.sh opencode 段新增 ndjson 分流 assertion
- [x] Task 7.1.D.2 (Green)：實作 opencode.sh 雙輸出

#### 🔗 匯合點

- [x] Task 7.1.E：4 adapter 合併後跑完整 `bash adapters.test.sh` 全綠（90 passed；M7.2 後分檔為 common + 4 per-CLI + runner）

### M7.2 Orchestrator 配套

- [x] Task 7.2.1 (Red)：`xreview-orchestrator.test.sh` 新增測試：`RETURN <spec> <log> <final>` 事件格式含第 3 欄；`FAIL` 事件同步帶 `final=<path>`；assert `.final.txt` 與 `.log` 同 slug
- [x] Task 7.2.2 (Red)：新增測試：cleanup trap 不刪 `.final.txt`（與 `.log` 同生命週期）
- [x] Task 7.2.3 (Green)：setsid body 計算 `final_file="${log%.log}.final.txt"` 並傳給 adapter 第 3 arg
- [x] Task 7.2.4 (Green)：Event emit 改為 `RETURN $spec $log $final` / `FAIL $spec exit_code=$rc log=$log final=$final`
- [x] Task 7.2.5 (Green)：blocking-mode footer 加一欄 `[FINAL]` 顯示 `.final.txt` 路徑（保持 12-char 對齊）
- [x] Task 7.2.6：test 全綠（orchestrator 138 passed / adapters 90 passed）

### M7.3 SKILL.md 步驟 7.1 改寫

- [x] Task 7.3.1：步驟 7.1 peek 協議從「`tail -n 10 <log>` + 4 類字串判斷」改為「Read `<final.txt>`」
- [x] Task 7.3.2：判斷規則簡化為 2 類——空 `.final.txt` → content-layer 失敗；非空 → findings 驗證
- [x] Task 7.3.3：步驟 4 事件範例、步驟 6 整合與呈現、步驟 7 Coordinator 驗證段落全對齊新 event schema（`RETURN <spec> <log> <final>`）
- [x] Task 7.3.4：references/cli-adapters.md 更新：記錄每家 CLI 的 JSON flag 與 final 抽取方式（claude `.result` / codex `-o` / gemini `.response` / opencode `jq text parts`）

### M7.4 端到端驗證

- [x] Task 7.4.1：`npm run deploy` + `npm test` 全綠
- [x] Task 7.4.2：派 4 reviewer 實跑 xreview（claude / opencode / gemini / codex）— 實跑 2 輪（第 1 輪抓到 `$final` race bug 57d688e、第 2 輪含 fix）。驗收條件：
  - (a) 4 個都 `RETURN` — ❌ 3 RETURN + 1 FAIL（codex `usage limit reached`，環境問題非實作 bug）
  - (b) 4 個 `.final.txt` 都短乾淨（<2000 tokens，可直接 Read）且含實質 review findings — 🟡 部分：opencode 92 行實質 findings ✅ / gemini 5 行摘要（實 findings 寫到 `~/.gemini/tmp/.../plans/code-review-sprint-09-m7.md` 外部檔）/ haiku 空（plan mode 擋 Write tool，agent 無 fallback）/ codex 空（usage limit FAIL）
  - (c) 4 個 `.log` 保有完整 verbose trace（除錯可追）— ✅
  - (d) codex `.final.txt` 反映 ddd-reviewer 角色語氣 — ❌ 無法驗（usage limit）
  - (e) gemini `.final.txt` 非空（`.response` 有內容）— ✅（5 行，但 findings 寫外部檔）
- [x] Task 7.4.3：Self check：M7 所有驗收條件逐條打勾；spec 中 M7 / ADR-11 / ADR-12 條文同步勾選——本次落地：race fix 57d688e + opencode 3 Important findings 全修（jq guard / codex python stderr surface / adapter stdout contract 文件化）；所有 unit test 全綠（adapters 111 / orchestrator 142 / npm test）；e2e 驗證顯示 transport schema 正確運作、環境失敗項（haiku plan mode / codex usage limit / gemini 外部檔）列入 works.md 供下 sprint 處理
- [x] Task 7.4.4：commit M7 最終 checkpoint — implementation `b5e5c60` + race fix `57d688e` + findings fix `8e5c64c`

---

## 平行度決策摘要（M7 追加）

| Milestone | 平行度 | 理由 |
|-----------|-------|------|
| M7.1 adapter 雙輸出 | 🔀 4 線平行 | 4 個 adapter 檔案獨立、介面契約固定、每家 JSON schema 互不干擾 |
| M7.2 orchestrator | 序列 | 集中在 orchestrator 單檔 + 對應 test |
| M7.3 docs | 序列 | SKILL.md 單檔連動改 |
| M7.4 端到端 | 序列 | 依賴前三個 milestone 完成 |
