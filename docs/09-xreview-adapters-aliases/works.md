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
