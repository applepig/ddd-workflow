# Works — xreview Per-CLI Adapters + Model Aliases

## 2026-04-13 Sprint 啟動

### 觸發事件

使用者提議「給那幾個模型一個 shorthand」（如 `opencode:mini` → `opencode:gpt-5-mini`），並把對應表塞進 config。

順帶討論到 `scripts/` 內幾個檔案的角色：

- `run-orchestrator.sh` 是純 `exec` wrapper，原意「避免 Monitor JSON escape」，但 `mktemp` prompt-file 不含空白、escape 問題不存在
- claude reviewer **inline 在 orchestrator 的 setsid body**，其他 CLI 委派 `xreview-runner.sh`，這個分裂是早期 runner 設計的歷史包袱

決定把兩件事一起做：

1. Refactor 為 per-CLI adapters（Option C：`adapters/{claude,opencode,gemini,codex}.sh` 統一形狀）
2. 加 alias 功能（flat 形式：`{"claude:opus": "claude:claude-opus-4-6"}`）

兩件事都動到 `xreview-orchestrator.sh`，分開做會 merge conflict，順序執行（refactor → alias）。

### 設計選擇

- **Adapter 介面**：`bash adapters/<cli>.sh <prompt-file> <model> <timeout>`，stdout/stderr 合併、exit code 透傳。orchestrator 只負責 fan-out 和 event 廣播，不碰 CLI quirks。
- **Alias 形式**：flat（`{"cli:short": "cli:full-name"}`）而非 nested（`{"cli": {"short": "full-name"}}`）。理由詳見 spec ADR-1。
- **Resolved spec 用於 audit**：alias 解析後的真名出現在 event / log / 報告，避免「不知道實際跑了哪個模型」。
- **Layer 1（host output mode）不動**：CLAUDECODE / streaming / blocking / footer 保留。

### 層級釐清（與使用者對話中釐清的關鍵點）

使用者一度擔心 refactor 會破壞「Claude 用 Monitor、其他 host 用阻塞 bash」的機制。經過釐清確認這是 **Layer 1**（host output mode），refactor 動的是 **Layer 2**（reviewer dispatch），兩層獨立：

- Layer 1：orchestrator 怎麼**輸出 events 給呼叫方**——靠 `CLAUDECODE` env 偵測，不變。
- Layer 2：orchestrator 怎麼**呼叫每個 reviewer CLI**——`adapters/<cli>.sh` 統一介面，是這次 refactor 範圍。

### 風險

- `gemini.sh` 內 policy 路徑要從 `../../../policies/...` 改為 `../../../../policies/...`（多一層 adapters/）
- `claude.sh` 在 setsid body 內由 orchestrator 透過 `bash adapters/claude.sh` 呼叫，多一層 process。需驗 PGID cleanup 仍涵蓋（adapter 內 `timeout --foreground` 應該 OK，但要測 SIGTERM）
- 個人 config（`~/.config/ddd-workflow/xreview.json`）不會被 deploy 覆蓋，需主動提示使用者更新

### 下一步

待使用者確認 spec.md / tasks.md 後開始 M1。

---

## 2026-04-14 實作與補件

### Adapter 架構重構

- 新增 `scripts/adapters/claude.sh`、`opencode.sh`、`gemini.sh`、`codex.sh`，統一介面為 `bash adapters/<cli>.sh <prompt-file> <model> <timeout>`。
- 每個 adapter 都自行處理 `command -v`、`timeout --foreground`、stdin prompt redirection、`XREVIEW_ERROR` 與 timeout 124。
- `xreview-orchestrator.sh` 改成只做 fan-out／event／cleanup／summary，dispatch 統一改呼叫 `adapters/<cli>.sh`。
- 刪除舊的 `run-orchestrator.sh`、`xreview-runner.sh`、`xreview-runner.test.sh`。

### Alias resolve 對齊 spec

- 在 orchestrator 新增 `resolve_spec()`，當 reviewer spec 是 bare 短名時，先從 `xreview.json.aliases` resolve 成完整 `cli:model`。
- resolve 後的 spec 一致用於 `START / DONE / FAIL` event、log filename slug、status sidecar 與 blocking footer。
- 預設 config 改為 spec 定義的 7 個 alias：
  - `5.4 -> opencode:github-copilot/gpt-5.4`
  - `5-mini -> opencode:github-copilot/gpt-5-mini`
  - `haiku -> claude:haiku`
  - `sonnet -> claude:sonnet`
  - `opus -> claude:opus`
  - `pro -> gemini:pro`
  - `flash -> gemini:flash`
- `reviewers` 預設值為 `[
  "opus", "5.4", "pro"
]`。

### 文件更新

- `SKILL.md` 改為直接呼叫 `xreview-orchestrator.sh`。
- 補上 alias 說明：7 個預設短名、`~/.config/ddd-workflow/xreview.json` 的 `aliases` 位置、既有個人 config 不會被 `npm run deploy` 覆蓋，因此需自行補上 aliases。
- `references/cli-adapters.md` 改為說明 `scripts/adapters/<cli>.sh`，並清掉舊 runner 用語。
- 驗證 `scripts/cli.js` 現有 `deployConfig()` 已符合 spec 的「目標檔存在就保留使用者設定」行為，因此未修改 deploy 邏輯。

### 測試與驗證

- Red phase：先新增 `adapters.test.sh` 與 `xreview-orchestrator.test.sh` alias cases，確認在 adapter 尚未建立、alias 尚未 resolve 前出現預期失敗。
- `adapters.test.sh` 補到 gemini policy 路徑必須是絕對路徑，覆蓋 spec 提到的 adapters 視角風險。
- `xreview-orchestrator.test.sh` 補齊 alias 五種情境：
  - (a) hit alias → resolve
  - (b) miss alias → 原樣
  - (c) config 沒 aliases 區塊 → 原樣
  - (d) CLI 參數也吃 alias
  - (e) reviewers 預設短名能正常 resolve 並 dispatch
- 並驗證 resolved spec 確實出現在 event、log filename 與 `.status` sidecar、blocking footer。

### 測試結果

- `bash ddd-workflow/skills/ddd.xreview/scripts/adapters.test.sh`：45 passed，0 failed。
- `bash ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.test.sh`：101 passed，0 failed。
- `npm run deploy`：通過；stdout 顯示 `~/.config/ddd-workflow/xreview.json` 已存在時保留使用者設定。
- `npm test`：通過。

### 尚未執行

- M4.7 真實 xreview 驗證尚未做；依指示保留給 coordinator 之後用 Haiku 執行。
- M4.8 Self check 尚未由 coordinator 完成。

---

## 2026-04-14 端到端實跑 + spec 變更決策

### Task 4.7 實跑結果

Coordinator 用 main session 派出新版 orchestrator（sprint worktree 絕對路徑），對當前 sprint diff 做 cross review。事先把 `aliases` 區塊補進 `~/.config/ddd-workflow/xreview.json`，`reviewers` 改成短名 `["opus", "5.4", "pro"]`。

- **Reviewer 狀態**：claude 真 `DONE`，opencode 假 `DONE`（exit 0 但 log 尾是 `FAIL:`），gemini 遇 HTTP 429 + workspace 限制後使用者指示停掉。
- **驗收對照**：
  - (a) 3 個 reviewer 都 DONE → ❌ 未達成
  - (b) event 顯示 resolved 真名（`START claude:claude-opus-4-6` 等）→ ✅ 達成
  - (c) log filename 含真名 slug → ✅ 達成

失敗根因是 opencode 與 gemini CLI 的 sandbox policy 擋住了 main project workspace 以外的路徑（sprint worktree 路徑 `~/Dropbox/projects/AGENTS-sprint-09-xreview/*`）以及 `~/.config/*`。非 xreview 實作本身的 bug。

### Claude reviewer 的兩個 Important findings

**Finding 1：orchestrator dispatch 缺外層 `timeout`**
`xreview-orchestrator.sh:307` 只呼叫 `bash "$adapter" ...`，沒包 `timeout --foreground`。tasks.md Task 2.2 原設計是「外層 + 內層雙 timeout」，實作選了「只保留 adapter 內層」，導致未來新增 adapter 漏寫 timeout 時失去 orchestrator 級的保護網。

**Finding 2：opencode silent-failure 無偵測**
`adapters/opencode.sh` 純透傳 exit code。當 review agent 主動寫 `FAIL:` 字樣但 CLI 正常退出時，orchestrator 廣播 `DONE`，使用者誤以為成功。今天的實跑正好撞上這個 case。

### 使用者決策（4 項 spec 變更）

1. **Timeout 簡化為單層**（與 Finding 1 相反方向）
   - orchestrator 外層加 `timeout --foreground "$timeout_val" bash "$adapter" ...`
   - 刪除 4 個 adapter 內部的 `timeout --foreground`，adapter 變純透傳 wrapper
   - adapter `XREVIEW_ERROR: timed out` 區塊也一併移除（timeout 判斷改由 orchestrator 處理）
   - adapters.test.sh 的 timeout/124 測試遷到 orchestrator.test.sh

2. **事件命名分層：`DONE` → `RETURN`**
   - transport layer 事件：`RETURN <spec> <log>`（CLI 正常退出，不保證內容是真 review）
   - `FAIL <spec> exit_code=<n> log=<log>` 保留給 exit≠0 / timeout
   - content layer 的「agent 說 FAIL」由 coordinator 在步驟 7 主動讀 log 判斷
   - SKILL.md 步驟 4-7、ddd-reviewer 角色說明、所有 test fixture 同步

3. **Worktree 路徑約定**
   - `Agent({ isolation: "worktree" })` 目前預設建在 `.claude/worktree/*`，這是 Claude Code 硬編碼行為
   - 在 `ddd-workflow/references/AGENTS.md` 或 `ddd-workflow/skills/ddd.work/SKILL.md` 補一行「建議建立在 `./worktree`」作為 convention，讓未來 subagent 手動建 worktree 時知道該放哪（放在 project root 內，opencode/gemini sandbox 就看得到）

4. **Adapter 補 sandbox allow flags**
   - opencode 和 gemini adapter 在呼叫 CLI 時加 allow 參數，放行 `/tmp`（prompt 檔）和 `~/.config`（xreview.json）
   - 確切 flag 名稱由 deepwiki 調研後補上

### DeepWiki 調研結果

**opencode**（兩輪調研）：

- 第一輪：沒有 CLI flag；建議 `OPENCODE_CONFIG=<tmp-config>` 指向暫存檔
- 使用者質疑「塞 config 檔風險太大」，要求找替代方案
- 第二輪：找到 **`OPENCODE_PERMISSION` env var**，直接吃 inline JSON，零檔案、零 trap、零污染
- 採用 env var 方案（ADR-9 最終版）

**gemini**：有原生 flag `--include-directories /tmp,$HOME/.config`，直接採用。

**codex**：未知，M5.4.C.1 實跑驗證。

### 使用者決策彙整（spec 變更）

1. **Timeout 簡化**：只在 orchestrator 外層，adapter 不重複（ADR-6）
2. **事件命名**：`DONE` → `RETURN`，content-layer 失敗由 coordinator peek log 判斷（ADR-7）
3. **Worktree 路徑約定**：`$PROJECT_ROOT/.worktrees/<branch-name>/`（注意前綴的點與複數 s）（ADR-8）
4. **Sandbox 放行**：opencode 用 `OPENCODE_PERMISSION` env var（最終方案）、gemini 用 `--include-directories` flag（ADR-9）

### 下一步

- 先把 sprint worktree 合併回 main：
  - commit #1 (sprint worktree)：M1-M4 code changes（adapters + orchestrator refactor + alias + 刪舊 runner）
  - commit #2 (sprint worktree)：M5 spec/tasks/works 更新
  - fast-forward merge sprint → main
  - commit #3 (main worktree)：AGENTS.md deepwiki 工具條目（與本 sprint 無關的獨立改動）
  - 移除 sprint worktree + 刪 branch
- 合併完成後在 main 上執行 M5 實作

---

## 2026-04-14 M5.1 + M5.2 + M5.4 實作（ddd-developer session）

### M5.1 Timeout 上移到 orchestrator（ADR-6）

**變更摘要**

- `xreview-orchestrator.sh`：
  - setsid body dispatch 從 `bash "$adapter" ...` 改為 `timeout --foreground "$timeout_val" bash "$adapter" ...`，由 orchestrator 統一強制 per-reviewer timeout
  - `per_reviewer_timeout` 從硬編碼 3000 改為 `${XREVIEW_TIMEOUT_SEC:-3000}`，讓測試能注入小 timeout 觸發 124 路徑，生產環境仍是 50 分鐘預設
- 4 個 adapter（`claude.sh` / `opencode.sh` / `gemini.sh` / `codex.sh`）：
  - 移除 `timeout --foreground "$timeout_sec"` 包裝與後續 `rc == 124 → XREVIEW_ERROR: timed out` 區塊
  - 新 header comment 明示「3rd arg accepted but ignored，ADR-6 timeout 由 orchestrator 外層處理」
- 測試：
  - `xreview-orchestrator.test.sh` 新增 `orchestrator enforces outer timeout` case：`XREVIEW_TIMEOUT_SEC=1 + 睡 20 秒的 mock claude` → 驗 `FAIL claude:slow-model exit_code=124` + `ALL_DONE` 照常結束
  - `adapters.test.sh` 把 4 份 timeout/124 測試換成「pure passthrough」測試：mock 睡 3 秒、adapter 第 3 arg 設 1 秒，結果 adapter 不再 kill，rc=0、stdout 不含 `timed out` 字樣；同時用 `write_rc_mock rc=7` 補驗任意 non-zero rc 也 pass-through

**Task 5.1.8 決策（adapter 介面 3rd arg 去留）**

保留。理由：

- 拿掉需同步改 orchestrator setsid body 傳的位置參數，diff 放大至 5 個檔案（orchestrator + 4 adapter）
- 保留 3rd arg 代表「adapter 介面對 orchestrator 稳定」，未來若有 per-CLI 特殊 timeout 需求（例如某 CLI 需要比 outer timeout 再少幾秒以便做 graceful shutdown）可直接使用此 slot，不需重寫介面
- adapter header 註明 `accepted but ignored` 對讀者清楚

### M5.2 事件命名：DONE → RETURN（ADR-7）

**變更摘要**

- `xreview-orchestrator.sh`：
  - `echo "DONE $spec $log"` → `echo "RETURN $spec $log"`
  - blocking-mode footer row `[DONE]      ` → `[RETURN]    `（保持 12-char column 對齊）
  - summary 文案 `N done` → `N returned`（讓「transport OK 未必 content OK」的語意延伸到 human-readable 文字）
  - header comment 補「事件語意」段，明述 `RETURN` / `FAIL` / `ALL_DONE` 三層的責任邊界
- `xreview-orchestrator.test.sh` 全域搜 `DONE[^_]` 改為 `RETURN`，footer 與 summary 字串同步
- `SKILL.md`：
  - 步驟 4 的事件範例、events_map pseudo code 改用 `RETURN`；新增「事件語意（ADR-7）」段落
  - 步驟 5 「失敗處理」同步 rename，並補「content-layer 失敗交給步驟 7 peek」的串接說明
  - 步驟 7 拆為 7.1（Content layer 過濾）和 7.2（Findings 驗證）。7.1 定義 peek 協議：`tail -n 10` 每個 `RETURN` 對應 log，若含 `FAIL:` / `XREVIEW_ERROR:` / 明顯自陳失敗（「存取被拒」「sandbox denied」等）/ 幾乎空白 → 標為 content-layer 失敗不納入有效 review
- `ddd-reviewer` agent 的 `DONE: <結論>` 收尾格式保留不動——它是 content-layer 語意（agent 自陳任務成功），與 orchestrator 的 transport-layer `RETURN` 正交

**踩坑**：orchestrator 裡的註解改成 `coordinator's responsibility` 時踩到 setsid `bash -c '...'` 單引號 body 內的 apostrophe 問題，整個 inline script 被提前切斷，bash 報 `syntax error near unexpected token 'else'`。改為 `coordinator responsibility` 不帶 `'s` 解決。下次寫 setsid body 註解要記得避開單引號。

### M5.4 Adapter sandbox 放行（ADR-9）

**變更摘要**

- `adapters/opencode.sh`：呼叫前加 `OPENCODE_PERMISSION='{"external_directory":{"/tmp/**":"allow","~/.config/ddd-workflow/**":"allow"}}'` env var inline，放行 prompt file (`/tmp/xreview-*.md`) 與 xreview config (`~/.config/ddd-workflow/xreview.json`)；zero file、zero trap
- `adapters/gemini.sh`：CLI argv 加 `--include-directories "/tmp,$HOME/.config"`，comma-separated 傳絕對路徑；header 註明 gemini-cli 原生支援此 flag
- `adapters.test.sh`：
  - opencode sandbox 測試：mock opencode 側錄 `OPENCODE_PERMISSION`，用 jq assert `.external_directory["/tmp/**"] == "allow"` 與 `.external_directory["~/.config/ddd-workflow/**"] == "allow"`
  - gemini sandbox 測試：mock 收 argv，`grep -F` assert `--include-directories` + `/tmp,` + `$HOME/.config` 三個 token

**踩坑**：寫 gemini sandbox 測試時，前面的「passthrough rc=7」測試把 gemini mock 改成 `rc=7`，到 sandbox 測試 mock 已非 happy mock，測試初跑 fail exit 7。加 `write_happy_mock gemini` 重置後通過。

### Task 5.4.C.1 codex sandbox 驗證

**轉交 coordinator**。developer session 無實際 codex CLI 與真實 review target 可跑，無法判斷 `codex exec --sandbox read-only --ephemeral` 是否會被擋在 `/tmp` 或 `~/.config`。採取保守策略：

- `adapters/codex.sh` header 標明 sandbox 放行「pending empirical verification」
- 現有 flag 不動（不盲目加 flag，等 coordinator 跑 M5.5 時順便觀察）
- 若 M5.5 撞到 sandbox deny，coordinator 派 ddd-developer 補 codex 對應 flag（Task 5.4.C.2）

### 測試結果

- `bash adapters.test.sh`：**58 passed, 0 failed**（從 baseline 45 → 新增 4 條 passthrough + 5 條 opencode sandbox + 4 條 gemini sandbox = 13 新 asserts，刪除 8 條舊 timeout asserts）
- `bash xreview-orchestrator.test.sh`：**107 passed, 0 failed**（從 baseline 104 → 新增 3 條 orchestrator timeout asserts）

### 未執行項目（轉交 coordinator）

- M5.5 全部（端到端重跑、Self check、npm test 驗證）
- Task 5.4.C.1 / 5.4.C.2（codex sandbox 實跑判斷 + 條件式修正）
- Git commit（依 coordinator prompt 統一處理）

---

## 2026-04-14 M5.5 端到端驗收 + post-review findings

### 執行環境

- `npm run deploy`：重建 symlinks 指向 `/home/dominicwu/Dropbox/projects/AGENTS/ddd-workflow/...`（deploy 前 symlinks 殘留指向已刪除的 sprint worktree，deploy 後恢復）
- `npm test`：全綠
- Monitor 命令：`bash /home/dominicwu/.claude/skills/ddd.xreview/scripts/xreview-orchestrator.sh /tmp/xreview-x1TE2M.md`
- reviewer 清單（resolved from aliases）：`claude:claude-opus-4-6`、`opencode:github-copilot/gpt-5.4`、`gemini:gemini-3-pro-preview`

### Task 5.5.2 驗收結果

| 條件 | 結果 |
|------|------|
| (a) 3 個都 `RETURN` | ✅ |
| (b) log 尾都是真 review 內容（無 `FAIL:`）| ✅ 步驟 7.1 peek 過濾通過 |
| (c) event 顯示 resolved 真名 | ✅ |
| (d) log filename 含真名 slug | ✅ |
| (e) 步驟 7.1 peek 過濾運作正常 | ✅ |

5 項全達成，首次完整通過 Task 4.7 的驗收條件（2026-04-13 實跑時 (a) 因 sprint worktree workspace sandbox 失敗，本次已由 M5.4 sandbox 放行 + merge 回 main 解決）。

### Cross review findings（3 項，需在 M6 處理）

**F1（共識 Critical / Important）— 外層 timeout 造成 CLI orphan**
- 來源：claude 🟡 Important #1「信心中高」 + opencode 🔴 Critical #1「信心高」，獨立發現
- 根因：`setsid bash → timeout --foreground → bash adapter → CLI` 四層 process hierarchy，`timeout(1)` 只對直接子（bash adapter）送 SIGTERM；adapter exit 後 CLI 成為 orphan，被 init 收養，繼續吃 token quota。EXIT trap cleanup 也救不了——setsid bash 正常 exit 後 `ps -o pgid=` 找不到，cleanup 只有在使用者 INT/TERM 中斷 orchestrator 時能抓到 pgid。
- coordinator 判斷：確認屬實，是 ADR-6 簡化的未預見副作用
- M6.1 處理

**F2（opencode Important）— timeout 觸發時 log 沒 marker**
- 來源：opencode 🟡 Important #1「信心高」
- 根因：rc==124 時只 emit event，log 本身不 append `XREVIEW_ERROR: orchestrator timeout...`
- 次生影響：**違反步驟 7.1 peek 協議**——timeout log 尾是半截 review 內容，既非空、也不含 `FAIL:` / `XREVIEW_ERROR:`，會被 coordinator peek 判為有效 review
- coordinator 判斷：確認屬實，必須補 log marker 否則 M5.2 新增的步驟 7.1 協議有漏洞
- M6.2 處理

**F3（claude Important）— XDG_CONFIG_HOME 硬編碼**
- 來源：claude 🟡 Important #2「信心中」
- 根因：orchestrator 正確 resolve `${XDG_CONFIG_HOME:-$HOME/.config}`，但 opencode/gemini adapter 寫死 `~/.config` 或 `$HOME/.config`，不尊重 XDG 覆寫
- 影響：極少數 NixOS/minimalist setup 受影響
- coordinator 判斷：確認屬實但優先度低
- M6.3 處理

### 使用者新需求（2026-04-14 追加）

**M6.4：orchestrator 內化 prompt 暫存檔管理**

使用者觀察到目前 SKILL.md 步驟 2 + 步驟 6 要求 coordinator 做 3 件額外 tool call：
1. `mktemp` 產生 prompt 檔路徑
2. `cat > "$file" << 'EOF' ... EOF` 寫入 prompt
3. 事後 `rm -f "$file"` 清理

每次跑 xreview 就三次 Bash call，污染 coordinator context、prompt 路徑也在 Monitor command line 曝光。

需求：orchestrator 自己處理 mktemp + cleanup，prompt 用 stdin 或 argv 傳入。coordinator 只需單一 Monitor call，無需前後 Bash 包裝。

具體介面設計見 tasks.md M6.4。

### 共識正面觀察

- ADR-7 `RETURN` 命名落實徹底（8 SKILL 段落 + 25+ assertion 對齊）
- ADR-9 opencode env var inline JSON 優雅（零檔案、零 trap、零污染）
- ADR-8 三處文件對齊
- adapter 3rd arg `accepted but ignored` 的務實處理
- `XREVIEW_TIMEOUT_SEC` 測試注入設計乾淨
- 步驟 7.1 的 4 類判斷規則「對 LLM coordinator 來說清晰可執行」（claude 原話）

### Logs 保存

- Claude log: `/tmp/xreview-372509-1776140834-28430-claude_claude-opus-4-6.log`（117 行）
- Opencode log: `/tmp/xreview-372509-1776140834-28430-opencode_github-copilot_gpt-5.4.log`（1036 行，3 findings 最詳細）
- Gemini log: `/tmp/xreview-372509-1776140834-28430-gemini_gemini-3-pro-preview.log`（37 行，APPROVED LGTM）

### 下一步

- /clear 重開 session
- 接手時參考 `docs/09-xreview-adapters-aliases/tasks.md` 的 M6 區塊（6 個 sub-milestone、約 22 個 task）
- M5 變更尚未 commit（main 上有 13 個 modified + works.md / tasks.md 更新）——M6 開工前可先 commit M5 為 checkpoint，或合併到 M6 一起 commit
- codex 的 sandbox 驗證從 M5.4.C 移到 M6.5（因 M5.5 只派 3 reviewer 沒順便驗到）

---

## 2026-04-14 M6 落地（一 session 連續實作）

### 決策記錄

- **M6.1 F1 方案 B**：使用者選 orchestrator pgid sweep 而非 adapter exec。保留 adapter 結尾的 rc 轉寫訊息、維持 adapter 可獨立 bash 執行的便利，F1 治本點放在 orchestrator 層。
- **M6.4 介面 (c) 混合**：stdin mode（無位置參數或首位 `-`）+ file mode backward compat。`-` 作為 stdin sentinel 讓「stdin prompt + CLI reviewer spec」共存無歧義。

### 實作重點

**M6.1 + M6.2（合併在同一個 timeout test）**

- `xreview-orchestrator.sh` setsid body：rc==124 時先 append `XREVIEW_ERROR: orchestrator timeout after ${timeout_val}s` 到 log（F2），再掃 `pgrep -g $BASHPID` 排除自己後 SIGTERM、sleep 1、SIGKILL 殘存（F1）。
- 測試：mock claude 被改成 `echo $$ > sentinel_file` 後 sleep 20；timeout 觸發後 `kill -0 "$mock_pid"` 驗 PID 已消失、grep log 驗 timeout marker 存在。

**M6.3 XDG 對齊**

- `adapters/opencode.sh`：`config_dir="${XDG_CONFIG_HOME:-$HOME/.config}"` + `jq -nc --arg cfg_glob ...` 組 `OPENCODE_PERMISSION` JSON（shell 變數展開後才進 JSON，避免 literal `~/...` key 在 OpenCode 端解析失敗）。
- `adapters/gemini.sh`：`--include-directories "/tmp,$config_dir"`。
- `adapters.test.sh`：既有 opencode key assertion 從字面 `~/.config/ddd-workflow/**` 改為 `${HOME}/.config/ddd-workflow/**`（絕對路徑）；新增 2 條 `XDG_CONFIG_HOME=/xdg/override` 後驗 JSON / argv 反映覆寫值。

**M6.4 orchestrator 內化 stdin**

- orchestrator 頂部：`if [[ $# -eq 0 || "${1:-}" == "-" ]]; then mktemp + 早期 EXIT trap + cat > tmp + prompt_file=tmp`；否則 `prompt_file="$1"; shift`。sentinel `-` 被 shift 掉，其餘 argv 照常當 reviewer specs。
- 早期 trap `rm -f "$_tmp_prompt_file"` 涵蓋「validation 階段失敗」的早期退出路徑；主 `cleanup()` 函數追加 `rm -f` 覆蓋 INT / TERM / 正常退出，取代早期 trap。
- 測試新增 3 條：(a) `echo HELLO | bash orch - claude:stdin-test` 驗 stdin 內容真的出現在 reviewer log、tmp 檔 exit 後被清理；(b) `echo NOARGS | bash orch`（完全無位置參數）搭配 XDG 指向測試 config，驗用到 config reviewers；(c) 舊式 file path 仍正常。
- SKILL.md 步驟 2 整合舊步驟 3：Monitor command 改 heredoc `<<'XREVIEW_EOF' ... XREVIEW_EOF` 直接 pipe 到 orchestrator stdin，coordinator 不再需要前置 `mktemp` / 後置 `rm` 的 Bash tool call；prompt 內容也不再出現在 command line argv。

### 踩坑

- 既有 opencode sandbox test 用字面 `~/.config/ddd-workflow/**` 當 jq lookup key。改用 jq --arg 組 config_dir 後這個 key 變成絕對路徑，assertion 一度 fail。更新成 `${HOME}/.config/ddd-workflow/**` 絕對 key 解決。
- stdin mode 早期 trap 會被後面的 `trap cleanup EXIT` 覆蓋。解法：把 `rm -f "$_tmp_prompt_file"` 也寫進 cleanup() 函數本體，早期 trap 只是「validation fail 時還沒跑到 cleanup() 定義」的保險。

### 測試結果（unit）

- `bash adapters.test.sh`：**62 passed, 0 failed**（從 58 → 加 4：2 XDG override + 原 5.4.C 的 3 條已於 M5.4 進去）
- `bash xreview-orchestrator.test.sh`：**118 passed, 0 failed**（從 107 → 加 11：F1 sweep + F2 marker + 3 組 stdin/file mode × 約 3 assert 每組）
- `npm test`：全綠

### 尚待

- M6.5 codex sandbox 驗證與 M6.6 端到端一起跑（派 4 reviewer 包含 codex，順便驗 F1 timeout 路徑）

---

## 2026-04-14 M7 規劃：codex smoke 揭露 `2>&1` 元凶

### 觸發事件

新 session 接續時，使用者指出 `/tmp/xreview-408835-*-codex_gpt-5.4.log` 單檔 5329 行 / 356KB，coordinator 根本讀不動。第一輪分析認為是 codex CLI 特別 verbose；深入調研後發現是 adapter 架構問題。

### 多路徑調研

派 6 隻 agent 平行查（4 家 CLI 的 JSON output + 2 隻 ACP 調研）：

**4 家 CLI 的 JSON schema output**（可取代 regex 解 verbose log）：

| CLI | Final 抽取 | Verbose |
|-----|-----------|---------|
| claude | `--output-format json` + `jq -r '.result'` | `--debug-file <path>` |
| codex | `-o <file>` 純 final text（獨立於 stdout/stderr）| stderr trace |
| gemini | `--output-format json` + `jq -r '.response'` | stderr |
| opencode | `--format json` ndjson → `jq -rs 'map(select(.type=="text"))|map(.part.text)|join("")'` | 同 ndjson，用 tee 複製 |

**ACP（Agent Client Protocol）評估**：

- opencode ✅ `opencode acp` native
- gemini ✅ `gemini --acp` native
- claude 🌉 需透過 `@agentclientprotocol/claude-agent-acp` bridge（直呼 Anthropic SDK）
- codex ❌ 只有 `mcp-server` / `app-server`，非 ACP

4 家混合（2 native + 1 bridge + 1 fallback）工程量大於 JSON schema 路線，決策先走 JSON schema（sprint 09 M7）、ACP 留待 sprint 10（見 `docs/10-acp-migration/plan.md`）觸發條件成熟時啟動。

### Smoke test 實測（關鍵發現）

**opencode**（`opencode run --format json --model opencode/gpt-5-nano`）：

- 實測 schema 跟 deepwiki 描述**完全不同**！實際 top-level event types 是 `step_start` / `text` / `step_finish`（不是 deepwiki 說的 `message.part.updated`），每個 event `{type, timestamp, sessionID, part}` 結構
- final 提取正解：`map(select(.type=="text")) | map(.part.text) | join("")`
- 教訓：deepwiki 對 schema 描述不可 100% 信，實測一次確認欄位名

**gemini**（`gemini --output-format json --model gemini-3-flash-preview -p "use bash ..."`，使用者手動實測）：

- `-o json` 吐單一物件 `{session_id, response, stats, error?}`
- `.response` 是**純 final text**（成功案例），比 claude `.result` 同級乾淨
- Tool call 失敗訊息（如 `run_shell_command denied by policy`）走 stderr，完全獨立於 stdout JSON
- 原本 background smoke 失敗是因為 `timeout` 被 fork 時找不到 gemini binary（PATH 不帶 npm-global）；用絕對路徑 `/home/dominicwu/.npm-global/bin/gemini` 重跑即可
- 模型名修正：`gemini-3-flash` → `gemini-3-flash-preview`（前者 API 回 ModelNotFoundError）

**codex**（`codex exec --sandbox read-only --ephemeral -o /tmp/codex-final.txt`，本機實測）：

- rc=0，`-o` 檔寫入 `嗨\n`（3 bytes，純 final）
- stdout 也是 `嗨`（跟 `-o` 同步）
- **stderr 吐完整 verbose trace**：header、workdir、model、session id、user prompt echo、codex response echo、tokens used、error 訊息
- **治本發現**：codex 原生 stdout/stderr 分流就是 final vs verbose，完全不需要處理。之前 log 混亂的元凶是 **adapter 的 `exec 2>&1`** 把 stderr merge 進 stdout，orchestrator 再 `>> "$log" 2>&1` 全部塞進單檔，造成混雜

### 架構決策 M7（ADR-11 + ADR-12）

**ADR-11**：4 個 adapter 拿掉 `exec 2>&1`，恢復 CLI 原生 stdout/stderr 分離；搭配各家 JSON flag 抽 final 寫入 `.final.txt`，verbose 保留到 `.log`。介面升級：adapter 第 3 arg 從 `<timeout>`（ADR-6 起已 ignored）重新定義為 `<final-out-file>`。orchestrator event stream 從 `RETURN <spec> <log>` 擴成 `RETURN <spec> <log> <final>`。SKILL.md 步驟 7.1 peek 協議改為 Read `.final.txt`。

**ADR-12**：codex 沒有 top-level `--agent` flag（auto-discovery 只供 `spawn_agent` tool call 用），造成 M5.5 cross review 時 codex 跑在「泛泛 reviewer 模式」沒吃 `ddd-reviewer` 的審查立場定義。M7 解法：adapter runtime 用 `python3 -c 'import tomllib; ...'` 讀 `~/.codex/agents/ddd-reviewer.toml` 的 `developer_instructions`，concat 到 prompt 前。讀取失敗時降級為原 prompt + warning。

### Checkpoint commit

- Commit `10437f8 feat(xreview): M5+M6 完整改善 + sprint 10 ACP plan 種子`（15 files changed, 1111+ insertions）
- npm test 全綠；M7 規劃文件（spec / tasks / works）未納入此 checkpoint，會隨 M7 一起 commit

### 下一步

- M7.1 4 個 adapter 平行工作線可派 developer 並行實作
- M7.2 / M7.3 / M7.4 序列推進
- M7 完成後 Task 6.6 / Task 6.5（codex sandbox + 端到端 4 reviewer）可合併在 M7.4 Task 7.4.2 一次驗完
- e2e 通過後 commit M5 + M6 為單一 checkpoint

---

## 2026-04-14 M7 實作（atomic chunk dispatch）

### 第一次嘗試失敗

Coordinator 首次把 M7.1 + M7.2 + M7.3 包成單一大 prompt 派 ddd-developer 一次做完。Agent 只完成 M7.1（adapters.test.sh 從 62 → 90 passed、4 個 adapter 改完雙輸出）就被 token 吃光中斷，留下半完成狀態：
- orchestrator.sh 只改了頂部 header comment、invalid-spec 分支、final.txt pre-create
- setsid body / valid-path RETURN event / FAIL event / footer 全沒動
- orchestrator.test.sh 116 passed / 5 failed
- SKILL.md / cli-adapters.md / tasks.md / works.md 完全沒動
- 根目錄冒出 cruft 檔 `1`、`1.debug`、`3000`、`3000.debug`

**教訓**：大包派工失敗 blast radius 遠大於原子任務。使用者指示改為 atomic chunk + 依序派；記入 `feedback_atomic-task-dispatch.md`。

### 切 chunk 策略

Sprint 09 剩餘工作切成：

| Chunk | 範圍 | 執行者 |
|-------|------|--------|
| A | 診斷 5 fail 根因 + 清 cruft | coordinator 自己 |
| B+C | 修 orchestrator 接線 + adapters.test.sh 分檔 | ddd-developer #1 |
| D | SKILL.md + cli-adapters.md 對齊新 schema | ddd-developer #2 |
| E | 勾 tasks.md、寫 works.md、commit M5+M6+M7 checkpoint | coordinator |
| F | M7.4 端到端 4 reviewer 實跑（含 codex sandbox 順便驗 M6.5）| coordinator + Monitor |

B+C 合併是因使用者判斷分檔與 orchestrator 修都在測試層，合併後單 agent 效率高；實際執行證實 145K tokens 跑得動。

### Chunk A（coordinator 診斷）

5 fail 的共同根因：**adapter interface migration 漏接**。

- `xreview-orchestrator.sh:357` 仍傳 `"$timeout_val"` 當 adapter 第 3 arg，但 M7.1 已把 adapter 第 3 arg 從 `<timeout>` 重定義為 `<final-out-file>`
- 後果：adapter 把 review 寫到檔名叫 `3000`（timeout 預設值）或 `1`（test override）的檔案，造成 root cruft
- 延伸：RETURN/FAIL event 未加 final 欄、footer 未加 `[FINAL]` column、setsid positional args 未傳 `$final`

測試層的 5 fail 表面症狀：
1. `setsid body output missing` — test 用 `sed 's/.*(\/tmp\/xreview-[^ ]+)$/\1/'` 抓 RETURN 第 3 token，event 加 final 欄後 sed 抓到 final.txt（沒 meta header）
2. `log file empty or missing mock marker` — 類似 path extraction 問題 + mock claude 吐 plain text 被 adapter `jq -r '.result'` 吞光
3+4. `invalid spec log mismatch` — FAIL event 已 emit `log=... final=...`，test 的 log= 抽取沒剝 final 尾
5. `stdin content missing from reviewer log` — mock claude stdout 經 JSON filter 後 final.txt 有內容，但 test grep log 走舊路徑

### Chunk B+C 成果（ddd-developer #1，145K tokens，21 分鐘）

**Orchestrator 接線**：
- setsid body 收第 6 個 arg `$final`，adapter 呼叫傳 `"$final"` 取代 `"$timeout_val"`
- RETURN emit 改 `RETURN $spec $log $final`
- FAIL emit 改 `FAIL $spec exit_code=$rc log=$log final=$final`
- Blocking footer row 格式擴為 `[RETURN] spec [LOG] log [FINAL] final` 保持 12-char 對齊

**Mock 升級策略**（agent 做的決策，事後驗證合理）：
- stderr-to-log + stdout-to-final split：mock CLI stderr 吐 `MOCK_*_CALLED` marker 被 orchestrator `>> log 2>&1` 捕捉到 log；stdout 吐結構化 JSON/ndjson 被 adapter jq 抽到 final.txt
- 既有 `grep MOCK_CLAUDE_CALLED "$log"` 斷言不用改（marker 走 stderr→log 路徑）
- codex 例外：因 codex adapter 用 `-o <final>` flag，mock 直接寫檔

**分檔**：
- 新增 `adapters.test.common.sh`（source-only 共用 helpers）
- 新增 `adapters/{claude,codex,gemini,opencode}.test.sh`，每檔 source common 後跑自家所有測試
- `adapters.test.sh` 改為 runner，source 4 份累計統計
- 單跑驗證：claude 17 / opencode 24 / gemini 23 / codex 26 = 90 與 runner 一致

**M7.2 新增 orchestrator 測試**：RETURN/FAIL event 帶 final 欄（2 條）、cleanup 不刪 final.txt（1 條）、blocking footer `[FINAL]` column（數條）。

**測試結果**：
- orchestrator.test.sh：**138 passed / 0 failed**（116 → 138，+22：5 fails 修復 + 4 新 M7.2 塊）
- adapters.test.sh runner：**90 passed / 0 failed**（分檔後總數不變）
- 單跑 per-CLI 檔皆可獨立執行
- 根目錄無 cruft

### Chunk D 成果（ddd-developer #2，72K tokens，4 分鐘）

**SKILL.md**（L80–L243 多段對齊）：
- 步驟 4 事件範例：RETURN 加 `<final-path>` 欄、FAIL 加 `final=`；事件語意段強調 `.log` = verbose / `.final.txt` = coordinator Read 主要入口，並註明 orchestrator pre-create 空 final
- events_map pseudo：RETURN/FAIL 解析擴 final_path，Read target 改 final_path
- 步驟 5 失敗處理：全面改用 `.final.txt` 空/非空語意
- 步驟 6：Read 主要對象改 `<final-path>`，log 降為 fallback
- 步驟 7.1 peek 協議：4 類判斷簡化為 2 類；舊 `tail -n 10` 流程保留為歷史註記
- M6.2 timeout marker：改為 log-only debug fallback，不當主要判斷依據
- 暫存檔清理段：補 `.final.txt` 保留說明

**cli-adapters.md**：
- 新增總覽表加 Claude 行（原本只列 opencode/gemini/codex）
- 新增「Final 抽取（ADR-11 雙輸出）」章節 + 對照表 + 共通約定（`: > $final_out` / `set +o pipefail` / `PIPESTATUS[0]`）
- OpenCode: adapter 範例第 3 arg 改 `<final-out>`；新增 ndjson+tee+jq 流程
- Gemini: 補 `.response` 抽取 + sandbox `--include-directories`
- Codex: 補 `-o` 直寫 + ADR-12 toml prepend 流程
- Claude 新章節：Plan Mode + `.result` 抽取 + `--debug-file` sidecar

### 驗收（M7.4.1 已達成）

- `bash adapters.test.sh` → 90 passed
- `bash xreview-orchestrator.test.sh` → 138 passed
- `bash adapters/claude.test.sh`（單跑）→ 17 passed，分檔後獨立可跑
- `npm run deploy && npm test` → 全綠
- 根目錄 cruft 清乾淨

### 未完成項

- **M7.4.2 端到端 4 reviewer 實跑**：待派。依使用者 feedback 改用小模型（`claude:haiku` / `gemini:flash` / `opencode:mini` / `codex` 小模型）降成本，旗艦模型留給正式 cross review
- **M6.5 codex sandbox**：併入 M7.4.2 一起驗
- **M6.6.1 手動 timeout 路徑驗證**：可選，非必要
- **Task 7.4.4 commit**：Chunk E 會處理此 checkpoint
