# xreview Per-CLI Adapters + Model Aliases

## 目標

兩件事一起做，因為都動到 `xreview-orchestrator.sh`：

1. **Refactor**：把 reviewer dispatch 拆成 per-CLI adapter，移除 Claude 的 inline 特例和無作用的 `run-orchestrator.sh` wrapper，讓 4 個 CLI 形狀一致。
2. **Feature**：加入 model alias 支援，讓 reviewer spec 可以用 `claude:opus`、`opencode:mini` 這種短名稱，避開冗長的完整 model 名。

## 背景

### Refactor 動機

目前 `scripts/` 有 3 個重疊／可疑的入口：

- `run-orchestrator.sh` — 純 `exec bash xreview-orchestrator.sh "$@"`，原意是「避免 Monitor command JSON 字串內的 escape」，但實測 `mktemp` 出來的 prompt-file 不含空白，wrapper 解決不存在的問題。
- `xreview-orchestrator.sh` — 主 orchestrator。Claude reviewer **inline 在 setsid body** 直接呼叫 `claude -p`，其他 CLI 透過 `xreview-runner.sh` 委派。
- `xreview-runner.sh` — opencode/gemini/codex 的 per-CLI dispatch（單檔用 `case` 分支處理三個 CLI）。

這個分裂 ad-hoc：claude 沒進 runner 因為早期 runner 只設計給「外部 CLI」，後來 claude 也進 orchestrator 時就直接 inline 了。結果是新增 CLI 要動兩個地方（runner 的 case 分支 + 可能的 orchestrator inline 邏輯），而且 claude 不適用「runner 形狀」這個事實要從 SKILL.md 註解才看得出來。

### Alias 動機

完整 reviewer spec 例：

- `claude:claude-opus-4-6`
- `opencode:github-copilot/gpt-5.4`
- `gemini:gemini-3-pro-preview`

CLI 參數臨時覆蓋時要打全名很累，config 檔也難讀。Alias 讓常用組合短化為單一 token：`opus` / `5.4` / `pro`。

### 上游 CLI 原生 alias 調查

調查結果決定 alias 的 value 端要寫多細：

| CLI | 原生 alias | 來源 |
|-----|-----------|------|
| **claude** | ✅ `haiku` / `sonnet` / `opus` 自動對應到最新版 | `claude --help` 明文支援 |
| **gemini** | ✅ `auto` / `pro` / `flash` / `flash-lite` | DeepWiki 查證 `google-gemini/gemini-cli` 的 `resolveModel`，自動跟著 preview 旗標升 |
| **opencode** | ❌ 一律 `provider/model_id` 全名 | DeepWiki 查證 `sst/opencode`，無 alias |

結論：claude / gemini 的 alias value 直接寫短名（`claude:haiku`、`gemini:pro`），上游升版自動跟。opencode 的 value 必須寫完整路徑（`opencode:github-copilot/gpt-5.4`）。

## 非目標

- **不動 Layer 1（host output mode）**：`CLAUDECODE` env detection、streaming vs blocking、footer 機制完全保留。這層是「呼叫 orchestrator 的 host 是誰」，與 reviewer dispatch 無關。
- **不改 reviewer agent 定義**：`ddd-reviewer.md`、`ddd.xreviewer.md` 不動。
- **不改 cleanup trap / setsid / PGID 機制**：signal handling 不動。
- **不引入外部 alias 解析工具**：jq 已經是必備依賴，繼續用。
- **不重寫 cli-adapters.md 內容**：只更新檔案路徑引用。

## User Story

作為 coordinator，

1. 我新增第五個 reviewer CLI 時，只需要在 `adapters/` 加一個檔案，不用同時動 orchestrator 的 case 分支和 runner，新檔案的形狀和現有 4 個一致。
2. 我臨時覆蓋模型清單時，可以打 `opencode:mini` 而不是 `opencode:github-copilot/gpt-5-mini`，config 檔讀起來也清爽。

### 驗收條件

**Refactor**

- [ ] `scripts/adapters/` 資料夾成立，內含 `claude.sh` / `opencode.sh` / `gemini.sh` / `codex.sh`，全部遵循統一介面 `bash <adapter> <prompt-file> <model> <timeout>`
- [ ] Orchestrator dispatch 縮為單一 line：`bash "$adapters_dir/$cli.sh" "$prompt_file" "$model" "$per_reviewer_timeout"`，原 case 分支移除
- [ ] `run-orchestrator.sh` 刪除，SKILL.md 的 Monitor command 改為直接呼叫 `xreview-orchestrator.sh`
- [ ] `xreview-runner.sh` 刪除
- [ ] `xreview-runner.test.sh` 刪除，改為 `adapters.test.sh`（涵蓋 4 個 adapter 的 dispatch / model 傳遞 / CLI not found / prompt missing）
- [ ] `xreview-orchestrator.test.sh` 既有 24 個測試全數 pass（不能因 dispatch 重構壞掉）
- [ ] Layer 1（CLAUDECODE / streaming-blocking）行為不變——既有測試覆蓋這層，pass 即視為驗證

**Alias**

- [ ] `config/xreview.json` schema 增加 `aliases` 物件（bare key → `cli:model` value），含 7 個預設 alias
- [ ] `config/xreview.json` 的 `reviewers` 預設值改用短名（`["opus", "5.4", "pro"]`）
- [ ] `~/.config/ddd-workflow/xreview.json` 既存檔案不被 deploy 覆蓋（`scripts/cli.js` 已具此行為，僅驗證）
- [ ] Orchestrator 增加 `resolve_spec()`：spec 在 `aliases` 表內就替換為 value、不在就原樣回傳
- [ ] 套用時機：在 `specs` array 收完後（CLI args + config 兩條來源都套用）、validate 之前
- [ ] Event stream / log filename / 報告全用 **resolved spec**（避免「看不出實際跑了哪個模型」）
- [ ] Alias 的 unit test：(a) hit alias → resolve、(b) miss alias → 原樣、(c) config 沒 aliases 區塊 → 全部原樣、(d) CLI 參數也吃 alias、(e) reviewers 預設短名能正常 resolve 並 dispatch

**整合**

- [ ] `npm test` 通過（symlink 完整性）
- [ ] `bash xreview-orchestrator.test.sh` 24 + 新增 alias tests 全 pass
- [ ] `bash adapters.test.sh` 全 pass
- [ ] SKILL.md 更新：Monitor command 段落、alias 用法簡述
- [ ] `references/cli-adapters.md` 更新檔案路徑引用（`xreview-runner.sh` → `adapters/<cli>.sh`）

**M5 驗收（timeout / 事件命名 / worktree / sandbox）**

Timeout 簡化（ADR-6）

- [ ] `xreview-orchestrator.sh` setsid body 改為 `timeout --foreground "$timeout_val" bash "$adapter" ...`
- [ ] 4 個 adapter 移除 `timeout --foreground` 呼叫與 `rc == 124 → XREVIEW_ERROR: timed out` 區塊
- [ ] `adapters.test.sh` 的 timeout 124 測試遷至 `xreview-orchestrator.test.sh`；adapter 層測試改驗「純透傳 rc」
- [ ] 新增測試：orchestrator timeout 觸發後，log 最後一行含 `XREVIEW_ERROR: orchestrator timeout` 之類的標記

事件命名分層（ADR-7）

- [ ] orchestrator 事件流：`DONE` 改名 `RETURN`；`FAIL` / `ALL_DONE` 不變
- [ ] 所有 test fixture（`xreview-orchestrator.test.sh`）assert 字串對齊
- [ ] SKILL.md 步驟 4（事件收集）、步驟 5（失敗處理）、步驟 6（整合與呈現）、步驟 7（Coordinator 驗證）全改用新命名
- [ ] SKILL.md 步驟 7 新增一條：「即使收到 `RETURN`，仍需 peek log 尾 10 行；出現 `FAIL:` / `XREVIEW_ERROR:` 字樣歸類為 content-layer 失敗，不列為有效 review」

Worktree 路徑約定（ADR-8）

- [ ] 在 `ddd-workflow/references/AGENTS.md` 適當位置加「手動 `git worktree add` 時建議放在 `$PROJECT_ROOT/.worktree/<branch>/`，避免 opencode / gemini workspace sandbox 擋路」
- [ ] `ddd-workflow/skills/ddd.work/SKILL.md` 在 Phase 2 派發段落呼應這個約定（若有提到 worktree）

Adapter sandbox 放行（ADR-9）

- [ ] `adapters/opencode.sh`：呼叫改為 `OPENCODE_PERMISSION='{"external_directory":{"/tmp/**":"allow","~/.config/ddd-workflow/**":"allow"}}' opencode run ...`（env var inline JSON，無暫存檔、無 trap）
- [ ] `adapters/gemini.sh`：呼叫加上 `--include-directories /tmp,$HOME/.config`
- [ ] 測試：opencode adapter 測試 mock 側錄 `OPENCODE_PERMISSION` env var 並驗 JSON 內含正確 pattern；gemini adapter 測試 assert `--include-directories` flag 傳遞正確
- [ ] 驗證 codex adapter 是否需要同樣放行（實跑一次 codex reviewer 確認）；需要則補上，不需要則在 works.md 記錄為「已驗證不需要」

端到端驗收

- [ ] 清理今天實跑殘留 log（`/tmp/xreview-340389-*`，可忽略）與暫存檔
- [ ] M5 實作完成後，重跑 Task 4.7：對 sprint diff 派 3 reviewer real xreview，驗 3 個都 `RETURN` 且 log 尾都是有效 review 內容（非 `FAIL:`）
- [ ] Self check：所有 M5 驗收條件逐條打勾

**M7 驗收（adapter JSON schema 雙輸出）**

背景：M5.5 端到端後發現 codex reviewer 的單一 log 可達 5329 行 / 356KB，coordinator 無法按 SKILL.md 步驟 7.1 的 peek/Read 協議處理。2026-04-14 smoke test 揭露根因：4 個 adapter 統一用 `exec 2>&1` 把 stderr 合併進 stdout，orchestrator 再 redirect 成單一 log——把原本天然分離的 verbose trace（stderr）和 final message（stdout）攪成一鍋。同時各家 CLI 都有 JSON output flag，final message 可獨立抽取。M7 同時處理「雙輸出分流」+「codex 的 agent 套用」兩件連動的事。

Adapter 雙輸出（ADR-11）

- [ ] 4 個 adapter 移除 `exec 2>&1`，改讓 stdout / stderr 自然分離
- [ ] `adapters/claude.sh`：改用 `--output-format json` + `--debug-file <verbose>`；stdout 為單一 JSON，adapter `jq -r '.result'` 抽 final 寫入第 3 arg `<final-out>`；debug-file 吸走 verbose trace
- [ ] `adapters/codex.sh`：加 `-o <final-out>`（CLI 直寫純 final text）；stderr 保留為 verbose trace；同時 prompt 前 prepend `ddd-reviewer` agent 的 `developer_instructions`（ADR-12）
- [ ] `adapters/gemini.sh`：改用 `--output-format json`；stdout JSON 後 `jq -r '.response'` 寫 `<final-out>`；stderr 自然分離為 verbose
- [ ] `adapters/opencode.sh`：改用 `--format json`；stdout 為 ndjson event stream，adapter `tee <verbose-out> | jq -rs 'map(select(.type=="text")) | map(.part.text) | join("")' > <final-out>` 分流
- [ ] Adapter 介面升級：第 3 arg 從 `<timeout>`（ADR-6 起已 ignored）重新定義為 `<final-out-file>`
- [ ] 每個 adapter 失敗時（rc≠0）：`<final-out>` 可為空；verbose 保留完整 trace 供除錯

Orchestrator（ADR-11 配套）

- [ ] setsid body 為每個 reviewer 計算 `final_file="${log%.log}.final.txt"`，傳給 adapter 第 3 arg
- [ ] Event stream：`RETURN <spec> <log> <final>` 加第三欄 `<final>` 路徑；`FAIL <spec> exit_code=<n> log=<log> final=<final>` 同步帶 final 路徑
- [ ] `.final.txt` 保留供 coordinator 讀取，cleanup trap 不刪（與 `.log` 同生命週期）

Codex prompt prepend（ADR-12）

- [ ] `adapters/codex.sh` 在跑 `codex exec` 前，用 `python3 -c 'import tomllib; ...'` 讀 `${XDG_CONFIG_HOME:-$HOME/.config}/codex/agents/ddd-reviewer.toml`（或 fallback `~/.codex/agents/ddd-reviewer.toml`）的 `developer_instructions`，concat 到原 prompt 前
- [ ] 讀 toml 失敗（檔案不存在 / 解析失敗）時降級為 prompt 原樣，不阻塞 review（warning 寫 stderr）

SKILL.md 步驟 7.1 協議改寫

- [ ] 步驟 7.1 peek 協議從「`tail -n 10 <log>` + 4 類字串判斷」改為「Read `<final.txt>`」
- [ ] 判斷規則簡化：空 `.final.txt` → content-layer 失敗；非空 → 進 findings 驗證（`XREVIEW_ERROR:` 等 transport 層訊息由 FAIL event 已涵蓋，不會進 final.txt）
- [ ] `.log` 保留原角色作為除錯用，不再是 peek 主要來源

測試

- [ ] `adapters.test.sh` 每家 adapter 新增雙輸出 assertion：mock CLI 產 fake JSON（claude/gemini 單 object、codex 寫 `-o` 檔、opencode ndjson）、stderr 另吐 verbose；驗 `<final-out>` 與 verbose 分流正確
- [ ] codex adapter 新測試：mock toml → 驗 prompt 前 prepend 了 `developer_instructions`
- [ ] `xreview-orchestrator.test.sh` 更新 RETURN / FAIL 事件 assertion 含 `<final>` 欄位
- [ ] `xreview-orchestrator.test.sh` 新增：cleanup 不清 `.final.txt`

端到端驗收

- [ ] 派 4 reviewer（claude / opencode / gemini / codex）對 sprint 09 diff 跑一次 real xreview
- [ ] 驗 4 個 `.final.txt` 都短、乾淨、直接 Read 得出 findings（不用 tail/grep）
- [ ] 驗 4 個 `.log` 仍保有完整 verbose trace
- [ ] 驗 codex final 確實套了 ddd-reviewer 角色（review 語氣/結構對齊其他 reviewer）
- [ ] 驗 gemini final 非空且是 `.response` 欄位內容
- [ ] Self check：M7 所有驗收條件逐條打勾

## 相關檔案

**新增**

- `ddd-workflow/skills/ddd.xreview/scripts/adapters/claude.sh`
- `ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.sh`
- `ddd-workflow/skills/ddd.xreview/scripts/adapters/gemini.sh`
- `ddd-workflow/skills/ddd.xreview/scripts/adapters/codex.sh`
- `ddd-workflow/skills/ddd.xreview/scripts/adapters.test.sh`

**修改**

- `ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.sh` — dispatch 簡化、加 `resolve_spec()`、外層 timeout、事件名 `RETURN`
- `ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.test.sh` — 加 alias resolve tests、timeout 測試、`RETURN` 字串對齊
- `ddd-workflow/skills/ddd.xreview/scripts/adapters.test.sh` — 刪除 adapter 層 timeout 測試（遷至 orchestrator）、改驗透傳 rc
- `ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.sh` — 移除內層 timeout、加 `OPENCODE_CONFIG` 機制
- `ddd-workflow/skills/ddd.xreview/scripts/adapters/gemini.sh` — 移除內層 timeout、加 `--include-directories`
- `ddd-workflow/skills/ddd.xreview/scripts/adapters/claude.sh` — 移除內層 timeout
- `ddd-workflow/skills/ddd.xreview/scripts/adapters/codex.sh` — 移除內層 timeout（sandbox flag 視驗證結果）
- `ddd-workflow/skills/ddd.xreview/SKILL.md` — Monitor command、alias 用法、`RETURN` 語意、步驟 7 log peek
- `ddd-workflow/skills/ddd.xreview/references/cli-adapters.md` — 路徑引用更新、各 adapter sandbox 機制說明
- `ddd-workflow/config/xreview.json` — 加 `aliases` 預設範例
- `ddd-workflow/references/AGENTS.md` — 補 worktree 路徑約定
- `ddd-workflow/skills/ddd.work/SKILL.md` — 呼應 worktree 約定

**刪除**

- `ddd-workflow/skills/ddd.xreview/scripts/run-orchestrator.sh`
- `ddd-workflow/skills/ddd.xreview/scripts/xreview-runner.sh`
- `ddd-workflow/skills/ddd.xreview/scripts/xreview-runner.test.sh`

## 介面／資料結構

### Adapter 統一介面

```bash
bash adapters/<cli>.sh <prompt-file> <model> <timeout-seconds>
# stdin:  unused (read prompt-file directly)
# stdout: CLI output (stderr merged via 2>&1 inside adapter)
# exit:   CLI's own rc; 124 = timeout (per timeout(1) convention)
```

每個 adapter 內部負責：

1. 用 `command -v` 找出 CLI 絕對路徑（`timeout` 不展開 `~`，必須絕對路徑）
2. 用 `timeout --foreground "$timeout_sec"` 包住 CLI 呼叫（`--foreground` 確保 setsid pgid 不被打散）
3. CLI 自己的語法 / flag（claude 用 `--agent ddd-reviewer --permission-mode plan` 等；opencode 用 `--agent ddd.xreviewer` 等）
4. stdin pipe prompt-file，merge 2>&1

Adapter **不**做：事件輸出（START/DONE/FAIL 由 orchestrator 處理）、log 寫入（orchestrator redirect）、status sidecar（orchestrator 寫）。

### Config schema（含 alias）

```json
{
  "reviewers": ["opus", "5.4", "pro"],
  "aliases": {
    "5.4":     "opencode:github-copilot/gpt-5.4",
    "5-mini":  "opencode:github-copilot/gpt-5-mini",
    "haiku":   "claude:haiku",
    "sonnet":  "claude:sonnet",
    "opus":    "claude:opus",
    "pro":     "gemini:pro",
    "flash":   "gemini:flash"
  }
}
```

**Schema 規則**：

- `aliases` key 是 **bare 短名**（無 `cli:` 前綴），全域唯一
- `aliases` value 是完整 `cli:model` 規格
- value 端對 claude / gemini 可以再用 CLI 自己的原生 alias（`claude:haiku`、`gemini:pro`）；對 opencode 必須寫完整 `provider/model_id`
- `aliases` 為選用欄位，缺省時 alias 功能等於關閉，spec 必須打全名
- `reviewers` 可混用短名（吃 alias）和 `cli:model` 全名（不吃 alias）

### resolve_spec 行為

```
resolve_spec("opus")    → "claude:opus"                      # alias hit (bare key)
resolve_spec("5.4")     → "opencode:github-copilot/gpt-5.4"  # alias hit
resolve_spec("claude:sonnet")  → "claude:sonnet"             # 已含 cli prefix，原樣
resolve_spec("nonexistent")    → "nonexistent"               # miss，原樣（會在後續 validate 階段被擋）
```

CLI 參數和 config reviewers 兩條來源都套用同一個 `resolve_spec`。

## ADR

### ADR-1：alias key 用 bare 短名，value 用完整 `cli:model`

決策：`{"opus": "claude:opus", "5.4": "opencode:github-copilot/gpt-5.4"}`，alias key 不帶 `cli:` 前綴。

考慮過 3 個方案：

- (a) Nested：`{"claude": {"opus": "claude-opus-4-6"}}`——層次清晰但 jq lookup 兩層、人讀時要切視角
- (b) Flat with cli prefix：`{"claude:opus": "claude:claude-opus-4-6"}`——key 和 reviewer 格式一致，但 key 端冗長
- (c) **Flat bare key**（採用）：`{"opus": "claude:opus"}`——key 最短、value 自帶 cli 資訊

理由：

- 短名全域唯一是合理約束（model 名稱本來就少有跨家族重名，`opus` / `pro` / `5.4` 無爭議）
- reviewer spec 寫 `"opus"` 比 `"claude:opus"` 短，是 alias 的核心價值
- value 一行就交代「這個短名跑哪家 CLI 哪個模型」，audit 直觀
- jq lookup `.aliases[$spec]` 單層完事
- value 端可疊加上游 CLI 的原生 alias（`claude:haiku` 而非 `claude:claude-haiku-4-5-20251001`），未來模型升版自動跟，config 不用維護版本號

放棄 (a)/(b) 的成本：未來若真出現「同短名跨 CLI」需求（e.g. 想讓 `mini` 在 `claude` 和 `opencode` 對到不同模型），需擴展 schema。目前 7 個預設 alias 沒這問題。

### ADR-2：claude 不再 inline，進 adapters/

決策：移除 orchestrator 內 `case "$cli" in claude)` 分支，新增 `adapters/claude.sh`。

理由：

- inline 是早期 runner 只給「外部 CLI」設計造成的歷史包袱，沒有實質好處
- 4 個 CLI 形狀一致，新增第五個 CLI 只要丟一個檔案
- claude 的特殊參數（`--agent ddd-reviewer --permission-mode plan --output-format text`）封裝在自己的 adapter 裡，跟其他 CLI 的 quirks 對等

### ADR-3：刪除 `run-orchestrator.sh` wrapper

決策：直接呼叫 `xreview-orchestrator.sh`。

理由：原 wrapper 的「避免 escape」rationale 不成立——Monitor 的 `command` 是單一 shell 字串，呼叫 wrapper 還是直接呼叫 orchestrator 對引號的需求完全相同。`mktemp /tmp/xreview-XXXXXX.md` 產出的路徑不含空白，沒有 escape 問題要解。

### ADR-4：刪除 runner 的「無 colon = opencode」backward-compat

決策：refactor 後 adapter 介面不收 `cli:model` 字串，只收 `model`（cli 已經由路徑決定）。原 runner 的「`<model>` without colon → opencode」便利機制隨 runner 一起刪除。

理由：

- 此 backward-compat 只在「直接呼叫 runner」時有意義，orchestrator 永遠傳完整 `cli:model`
- adapter 介面更清晰：cli 由檔名決定（`adapters/opencode.sh`），model 是純參數
- 若使用者要直接呼叫單一 CLI，新介面 `bash adapters/opencode.sh prompt.md gpt-5.4` 比 `bash xreview-runner.sh prompt.md gpt-5.4` 更明確

### ADR-5：resolved spec 用於 event / log / 報告

決策：alias 解析後的真名出現在 event stream、log filename slug、最終報告。

理由：避免「我以為跑了 opus 結果跑了 sonnet」的疑慮——使用者若在 config 改了 alias 對應，下次 review 立刻會在報告看到不同的真名。alias 只是輸入端的便利，不影響 audit trail。

### ADR-6：Timeout 只在 orchestrator 外層，adapter 不重複

決策：`xreview-orchestrator.sh` 在 setsid body 內用 `timeout --foreground "$timeout_val" bash "$adapter" "$prompt_file" "$model"` 包裹 adapter；4 個 adapter 內部移除 `timeout --foreground` 呼叫，變成純透傳 wrapper。adapter 也不再處理 `rc == 124` → `XREVIEW_ERROR: timed out`，因為 timeout 由外層 raise。

考慮過 3 個方案：

- (a) 雙層（orchestrator + adapter 各一層 timeout）：defense-in-depth，但同樣的檢查寫兩次，且 adapter 會和 orchestrator 的 timeout 值重複設定
- (b) 只留 adapter 內層（當前實作）：orchestrator 層無保護網，新增 adapter 漏寫時默默失去保護
- (c) **只留 orchestrator 外層**（採用）：單一責任、adapter 簡潔，新 adapter 自動繼承 timeout

理由：

- Timeout 是「對任意子 process 設上限」的機制，本質上屬於 orchestrator 的責任範圍，而不是個別 CLI 的行為
- 單層寫法讓 adapter 變成「CLI 呼叫的最小包裝」——作者只需要知道 CLI 自己的 flag 語法，不用理解 timeout 慣例
- 未來新增 adapter 不會因為漏寫 `timeout --foreground` 而意外變成無限 hang
- `timeout(1)` 對 pgid 友好（`--foreground` flag），加在外層不會破壞 setsid 的 cleanup
- 只有一層時，timeout 觸發的 exit code 124 語意清晰：一律是 orchestrator 認定逾時，不會和 adapter 自己轉寫的 124 混淆

放棄 (a) 的成本：理論上「adapter 內層被誤用或 binary 被換掉」的雙保險消失。實務上 adapters.test.sh 已驗 exit code 124，且 `timeout` 是 coreutils 基礎 binary，單點失敗機率極低。

### ADR-7：事件命名分層—transport 用 `RETURN`，content 由 coordinator 驗證

決策：orchestrator 事件流從 `DONE <spec> <log>` 改名為 `RETURN <spec> <log>`，`FAIL <spec> exit_code=<n> log=<log>` 與 `ALL_DONE` 保留。

原 `DONE` 語意混淆：它表達的是「CLI 正常退出」（transport 成功），但使用者以為是「review 有內容」（content 成功）。當 reviewer agent 在 workspace sandbox 受限、rate limit、或 context 超載時，agent 會以「我做不到」的內容回覆但 CLI 正常退出（exit 0）。orchestrator 當下無從判斷 log 內容是真 review 還是失敗訊息。

改名後：

- `RETURN`：transport 層成功（CLI exit 0）。**不保證內容是真 review。**
- `FAIL`：transport 層失敗（exit code 非零 / timeout 124）。
- `ALL_DONE`：fan-out 全部結束。

Coordinator 在 SKILL.md 步驟 7（整合與呈現之前）需主動 peek 每個 `RETURN` 對應的 log 尾，若出現 `FAIL:` / `XREVIEW_ERROR:` / agent-declared failure 字樣，歸類為「content layer 失敗」並在報告中標明，不當作有效 review。

理由：

- 「transport OK ≠ content OK」是跨 CLI 通用事實，不適合在 orchestrator 層用 grep marker 硬偵測（marker 形式各家不同）
- 保留給 coordinator 的 LLM 判斷比 regex 更有彈性
- `RETURN` 字面意思就是「CLI 回來了」，不帶任何成功含義，語意乾淨

### ADR-8：Worktree 路徑約定 `./worktree`

決策：建議所有 git worktree 建立在 `$PROJECT_ROOT/.worktree/<branch-name>/`，而非專案目錄外的路徑。

背景：Claude Code `Agent({ isolation: "worktree" })` 目前硬編碼建在 `.claude/worktree/*`，但手動 `git worktree add` 的情況（例如 sprint worktree）沒有約定，使用者或 agent 可能建在任意位置。

問題：opencode 和 gemini CLI 的 workspace sandbox 預設只允許「當前 project root 之下」的路徑。worktree 若建在 project 外（例如 `~/Dropbox/projects/AGENTS-sprint-XX`），CLI 讀不到 spec / tasks / source files，review 直接失敗。

方案：

- (a) 讓每個 CLI 各自加 `--include-directories` / `OPENCODE_CONFIG` 放行 worktree 絕對路徑——需動態偵測路徑，複雜
- (b) **約定 worktree 建在 `$PROJECT_ROOT/.worktree/`**（採用）：worktree 天然在 sandbox 內，所有 CLI 無須特別設定

理由：

- 約定比動態放行簡單，只要一行文字寫進 `ddd-workflow/references/AGENTS.md` / `ddd-workflow/skills/ddd.work/SKILL.md`
- 對 `Agent({ isolation: "worktree" })` 的硬編碼行為不衝突（不強制改，只是 convention）
- 相容既有 `.gitignore` 實務（在 `.gitignore` 加 `/worktree` 即可）
- 不影響 Claude Code 的 `.claude/worktree/*` 行為——那是 harness 自動行為，本約定指的是「手動建 worktree 時的建議位置」

### ADR-10：Orchestrator stdin mode（次要路徑）＋ Monitor command 內嵌 rm（主要路徑）

最終決策：orchestrator 支援兩種 prompt 輸入，但**主要使用路徑**（coordinator + Monitor）採用後者，stdin mode 只供直接 shell 呼叫或未來 Monitor 支援真正 stdin 時使用：

- **File mode + Monitor command 內嵌 rm（主要）**：coordinator 先用 Bash tool `mktemp` 產生 prompt 檔並寫入，然後 Monitor command 以 `bash orchestrator.sh $path; rc=$?; rm -f $path; exit $rc` 形式傳檔案路徑。prompt 檔路徑會出現在 Monitor argv，但 prompt **內容**不會。
- **Stdin mode（次要）**：無位置參數或首位 `-` sentinel 時 orchestrator 自己 mktemp + 讀 stdin + EXIT trap 清理。

**設計沿革**（M6.4 + M6 cross review F5）：

原 M6.4 只引入 stdin mode 並把 SKILL.md 範例改成 Monitor heredoc，期望省掉 coordinator 的 `mktemp` Bash call 且把 prompt 完全隔離於 command line。cross review（opencode 信心高）指出：**heredoc 仍屬 Monitor 的 `command` shell 字串**，該字串整段會成為 Monitor spawn 的 bash 之 argv／process listing 可見內容，因此 prompt 實際上還是曝光在 command line——與 SKILL.md 明文「嚴禁在 command line 暴露 prompt 內容」衝突。

Monitor tool 的 schema 檢查（fields 僅 `command / description / timeout_ms / persistent`）確認 Monitor 無獨立 stdin 參數。因此：

- Monitor 主要路徑必須走 file mode：prompt 寫檔、command 傳路徑、尾端 `rm` 清理
- `rc=$?; rm -f $path; exit $rc` 保證 orchestrator 的 exit code 透出給 Monitor 判讀、prompt 檔無論成敗都清
- Stdin mode 保留作為直接 shell 呼叫的便利（`echo ... | bash orch.sh`）及未來 Monitor 支援真 stdin 時的升級通路
- SKILL.md 明確禁止在 Monitor 場景使用 stdin 路徑

此 ADR 取代 M6.4 初版設計——stdin mode 程式碼保留（還是有獨立價值），但使用定位改為次要路徑。

介面選項比較：

- (a) 純 stdin（無 backward compat）：最乾淨但打破既有 file-path 用法與測試
- (b) 純 argv `--prompt-string <str>`：避免 stdin 不透明度但 prompt 變成 argv 的一部分（回到 command line 曝光）
- (c) **混合（採用）**：無位置參數或 `-` → stdin mode；有位置參數 → file mode。保留 backward compat，兩條路徑並存

背景：M5.5 端到端結束後使用者觀察到 SKILL.md 步驟 2 / 步驟 6 要求 coordinator 跑三次 Bash tool call（`mktemp` / heredoc write / `rm`）才能派一次 xreview，且 prompt file 路徑會出現在 Monitor command line 的 argv。內化後：

- Coordinator 只需單一 Monitor call，heredoc 直接 pipe prompt 到 orchestrator stdin
- Prompt 路徑不再出現在 command line（argv 只剩 orchestrator 路徑 + 可選 reviewer specs）
- 暫存檔由 orchestrator EXIT trap 清理，不依賴 coordinator 事後 `rm`

介面選項比較：

- (a) 純 stdin（無 backward compat）：最乾淨但打破既有 file-path 用法與測試
- (b) 純 argv `--prompt-string <str>`：避免 stdin 不透明度但 prompt 變成 argv 的一部分（回到 command line 曝光）
- (c) **混合（採用）**：無位置參數或 `-` → stdin mode；有位置參數 → file mode。保留 backward compat，新用法覆蓋主要路徑

理由：

- 混合方案讓既有 `adapters.test.sh` / `xreview-orchestrator.test.sh` 對 file mode 的 assertion 全部繼續有效（零遷移成本）
- `-` 作為 stdin sentinel 讓「stdin + CLI reviewer specs」可共存（`bash orch - claude:opus gemini:pro`），無歧義
- EXIT trap 整合進既有 `cleanup()` 函數，INT / TERM / 正常退出三條路徑都保證清理

### ADR-9：Adapter 放行 sandbox：opencode 用 `OPENCODE_PERMISSION` env var、gemini 用 `--include-directories` flag

決策：opencode 和 gemini adapter 在呼叫 CLI 時主動放行 `/tmp`、`$HOME/.config`、當前 worktree 路徑。

**opencode**：用 `OPENCODE_PERMISSION` 環境變數直接塞 inline JSON，不需要任何暫存檔或 config 檔：

```bash
OPENCODE_PERMISSION='{"external_directory":{"/tmp/**":"allow","~/.config/ddd-workflow/**":"allow"}}' \
  opencode run --print-logs --log-level ERROR --agent ddd.xreviewer --model "$model" < prompt.txt
```

- 支援 `~` / `$HOME` 展開、`*` / `?` / `**` 萬用字元
- Last-match-wins，缺省時走使用者 global config，非 xreview call 不受影響
- env var 僅存在於 child process 生命週期，完全不觸碰使用者 `~/.config/opencode/`

曾考慮過的替代方案：

- (a) `OPENCODE_CONFIG=<tmp-config>` 指向暫存 config 檔——雖然調研證實是 merge 而非 override（不會蓋掉使用者 global config），但仍需管理暫存檔生命週期與 trap cleanup
- (b) per-agent frontmatter（在 `ddd.xreviewer.md` 的 YAML 內寫 `permission`）——最零維護但規則寫死在 agent 定義裡，若未來要依 skill 路徑動態調整白名單就不彈性
- (c) **`OPENCODE_PERMISSION` env var**（採用）——零檔案、零暫存、零污染；規則可在 adapter 層面按情境調整

**gemini**（調研結果：有 flag `--include-directories`）：直接加上 flag，comma-separated 傳絕對路徑：

```bash
gemini \
  --approval-mode=plan \
  --admin-policy=<policy.toml> \
  --include-directories /tmp,$HOME/.config \
  -m <model> < prompt.txt
```

**codex**：待驗證是否有 sandbox 限制。目前 `codex exec --sandbox read-only --ephemeral` 已有 sandbox 限制，但沒證據顯示它會擋 `/tmp` / `~/.config`。Task 5.4.C.1 先驗證再決定是否補 flag。

**claude**：無此問題（主 agent 走 Claude Code 的檔案存取路徑，無外部 sandbox）。

理由：

- 把 sandbox 細節鎖在 adapter 內，orchestrator 和使用者都不用知道各家 CLI 差異
- opencode 用 `OPENCODE_PERMISSION` env var 比任何涉及檔案的方案都乾淨：不 create/delete tmp file、不需要 trap、單行解決
- gemini 的 flag 是原生支援，語意明確
- `$HOME/.config` 必須放行才讀得到 `~/.config/ddd-workflow/xreview.json`（orchestrator 已讀過，但若 agent 自己再讀會撞牆）
- `/tmp` 必須放行才讀得到 prompt file 與 log file

### ADR-11：adapter 雙輸出——stdout/stderr 自然分流 + JSON schema 抽 final

決策：4 個 adapter 拿掉 `exec 2>&1`，改讓 **stdout = agent final message**、**stderr = verbose trace** 自然分離；orchestrator 在呼叫 adapter 時多傳一個 `<final-out-file>` 參數（取代 ADR-6 以來被 ignored 的第 3 arg），adapter 把 final text 寫進該檔。verbose 由 orchestrator 重導到既有的 `.log` 檔。

**根因發現**（2026-04-14 codex smoke test）：codex 原生把 final message 寫到 stdout、verbose trace 寫到 stderr（完全分離）。但現行 adapter 的 `exec 2>&1` 把 stderr merge 進 stdout，orchestrator 再 `>> "$log" 2>&1` 全部塞進單檔，造成 5329 行混雜 log。拿掉 `exec 2>&1` 就恢復 CLI 原生的 stream 分離。

每家 CLI 的 final 抽取路徑（都是原生 flag，零解析成本或單行 jq）：

| CLI | Final 提取 | Verbose 來源 |
|-----|-----------|-------------|
| claude | `--output-format json` → `jq -r '.result'` | `--debug-file <path>` 寫檔 |
| codex | `-o <file>` 直接寫純 final text；stdout 同內容（備份） | stderr |
| gemini | `--output-format json` → `jq -r '.response'` | stderr |
| opencode | `--format json` ndjson → `jq -rs 'map(select(.type=="text")) \| map(.part.text) \| join("")'` | 同一條 ndjson stream，用 tee 複製 |

考慮過的替代方案：

- (a) 維持 `exec 2>&1` + 事後 regex 抽 final：fragile、每家 schema 不同、codex 重複印 final 兩次的行為還是會干擾
- (b) 走 ACP protocol：事件天然分類（`agent_message_chunk` vs `tool_call`），但 codex 沒 native ACP server、只有 3 家可用 → 工程量遠大於本方案 → 已記錄在 `docs/10-acp-migration/plan.md`，待觸發條件成熟再做
- (c) **stdout/stderr 分流 + JSON flag 抽 final**（採用）：零新依賴、沿用現有 bash 架構、每家 CLI 都有原生支援

放棄 (b) 的成本：opencode 仍需 jq filter（沒 `-o` 類的單檔 flag），比其他 3 家多一行。但工程量相較於 ACP Node orchestrator 可忽略。

### ADR-12：codex prompt prepend `developer_instructions`

決策：`adapters/codex.sh` 在把 prompt 餵給 `codex exec` 前，用 `python3 tomllib` 讀 `~/.codex/agents/ddd-reviewer.toml` 的 `developer_instructions` 欄位，concat 到原 prompt 前。

背景：2026-04-14 M5.5 端到端時發現 codex 自陳「`ddd-reviewer` skill 沒出現在 session 可用清單」——調研後確認 codex CLI **沒有 top-level `--agent` flag**，`~/.codex/agents/<name>.toml` 的 auto-discovery 只供 `spawn_agent` tool call 使用，top-level `codex exec` 不會自動套用任何 agent role。結果 cross review 時 codex 是在「泛泛 reviewer 模式」跑，不吃 `ddd-reviewer` 的審查立場／攻擊面／品質門檻定義。

考慮過的替代方案：

- (a) 改用 `-c agents.ddd-reviewer.<field>` 覆寫 config：codex 沒對應 CLI 語法支援 top-level apply
- (b) build 時把 `developer_instructions` 抽出寫獨立 `.md`，adapter 讀 md：SSOT 分裂（toml 和 md 兩份要同步）
- (c) **adapter runtime 讀 toml 解析 + prepend**（採用）：toml 仍是 SSOT，adapter 負責翻譯；相依 `python3 + tomllib`（Python 3.11+，Ubuntu 22.04+ 預設有）

降級規則：讀 toml 失敗（檔案不存在、解析失敗、python3 不可用）時 adapter 不阻塞 review，prompt 原樣送進，warning 寫 stderr。使用者看 `.log` 能看到 warning。

## 風險與邊界

- **個人 config 未自動更新**：`~/.config/ddd-workflow/xreview.json` 已存在不會被 deploy 覆蓋。使用者既存 config 沒有 `aliases` 區塊時，alias 功能形同未啟用，spec 必須打全名。文件需提醒。
- **adapter 路徑解析**：`gemini.sh` 內的 policy file 路徑從 `../../../policies/...`（runner 視角）改為 `../../../../policies/...`（adapters/ 視角，多一層）。需在 test 內驗證解析正確。
- **claude.sh 的 setsid 互動**：原本 `timeout --foreground` 直接在 orchestrator setsid body 內呼叫 claude。改成委派 adapter 後，多一層 `bash adapters/claude.sh`，需確認 PGID 仍被 orchestrator cleanup 涵蓋（adapter 內的 `timeout --foreground` 配 setsid 應該 OK，但要測 SIGTERM 路徑）。
