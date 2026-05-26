# Custom Statusline Usage Pipeline Refactor

## 提案狀態

這是第二版提案，取代前一版「只把 Claude Bash statusline 與 OpenCode usage status 搬進 `custom-statusline`」的方向。

保留已討論過的 source namespace：`ddd-workflow/custom-statusline/`。

新的核心判斷：Claude statusline、OpenCode Codex usage status、`session-trigger.mjs` 做的是同一類事情，只是最後輸出不同。

```text
蒐集資料 -> 正規化 -> 快取 / 記錄 -> format -> 顯示或 retry 決策
```

因此本 sprint 仍建立 `ddd-workflow/custom-statusline/`，但它不只是 UI 檔案集合，而是 statusline / usage display 相關的資料管線。Claude statusline 與 OpenCode TUI 是 presenter；`session-trigger.mjs` 仍是 trigger script，但應重用同一套 usage collector / store / formatter。

## 目前觀察

### Claude Code logger 觀察

目前 `ddd-workflow/scripts/statusline.sh` 已新增兩種 logger：

- `STATUSLINE_INPUT_LOG` 預設為 `/tmp/claude/statusline-input.jsonl`。
- `logStatuslineInput()` 嘗試用 `jq --argjson payload "$input"` 寫入 `{ ts, payload }`。
- 實際檢查結果：`/tmp/claude/statusline-input.jsonl` 目前是 0 bytes。
- `STATUSLINE_INVOCATION_LOG` 預設為 `/tmp/claude/statusline-invocations.log`，目前有持續寫入。

結論：`statusline-input.jsonl` 這條 raw input logger 的假設是錯的，不能拿它代表 Claude Code 給了什麼 JSON。至少 invocation log 是有效的，它證明 statusline 有持續被呼叫，也提供已解析後的 model、project、usage、reset_at 等欄位。

近期 invocation log 顯示的欄位包括：

- `mode=full`、`cols=168`。
- `model=codex,gpt-5.5-xhigh`、`model=claude-sonnet-4-6`、`model=claude-opus-4-6`。
- `project=/home/applepig/Dropbox/projects/AGENTS`。
- `usage=42`、`reset_at=1779440400`。

這個觀察很重要：雖然還沒有可靠 raw StatusJSON，但已解析後的 invocation log 顯示 Claude Code statusline 的 `model` 不一定只會是 `claude-*`，也可能承載 `codex,gpt-5.5-xhigh` 這類 provider / model 組合。因此新的資料模型不能把「Claude Code harness」直接等同於「Anthropic provider」。Milestone 1 應先建立正確的 raw StatusJSON capture / fixture，而不是沿用目前錯誤的 `statusline-input` logger。

### 目前 log / cache 分散狀態

| 來源 | 現況路徑 | 類型 | 問題 |
| --- | --- | --- | --- |
| Claude statusline input | `/tmp/claude/statusline-input.jsonl` | raw debug log | 目前空檔，這條 logger 假設錯誤；不能當作 Claude StatusJSON 來源。 |
| Claude statusline invocation | `/tmp/claude/statusline-invocations.log` | invocation log | TSV ad hoc 格式，只服務 statusline。 |
| Claude OAuth Usage API cache | `/tmp/claude/statusline-usage-cache.json` | provider usage cache | 這是 Anthropic provider data，不應綁在 Claude statusline Bash 路徑。 |
| Claude OAuth throttle | `/tmp/claude/statusline-usage.throttle` | runtime throttle | 與 cache 同樣散在 `/tmp/claude`。 |
| OpenCode Codex usage | `${XDG_CONFIG_HOME}/ddd-workflow/opencode-codex-usage/codex-usage.json` | latest usage snapshot | mutable runtime state 放在 config namespace。 |
| OpenCode debug response | `${XDG_CONFIG_HOME}/ddd-workflow/opencode-codex-usage/openai-response-debug.ndjson` | provider debug log | 與 OpenCode plugin 綁死，不利於 session-trigger / Codex CLI 共用。 |
| Session trigger log | `~/.session-trigger/session-trigger.log` | trigger result log | 放在隔離 HOME，與 usage cache / statusline log 分離。 |
| Codex CLI session file | `~/.codex/sessions/.../*.jsonl` | external harness log | 只能讀取，不能搬移；但 parser 應納入同一套 collector。 |

### 現有資料流

```text
Claude Code statusline:
  StatusJSON stdin
  + Anthropic OAuth Usage API cache
  + git metadata
  -> Bash parsing / formatting / rendering
  -> stdout ANSI statusline

OpenCode Codex usage status:
  OpenCode server plugin intercepts chatgpt.com Codex response headers
  -> writes codex-usage.json
  -> TUI plugin reads JSON
  -> formatter columns
  -> home_prompt_right / session_prompt_right

session-trigger.mjs:
  runs Claude / Codex / OpenCode pings
  -> parses resetsAt from three different places
  -> logs result
  -> retry / skip decision
```

三者的差異在 collector 和 presenter / decider，不在核心資料處理。

## 目標

- 建立 `ddd-workflow/custom-statusline/` 作為 statusline / usage display 相關 source 的唯一主要位置。
- 在 `custom-statusline/shared/` 定義 provider / harness / model / limit window / context usage 的 canonical contract。
- 將 Claude statusline 與 OpenCode Codex usage status 的 rate limit parsing、快取、格式化收斂到同一套 module。
- 讓 `ddd-workflow/scripts/session-trigger.mjs` 使用 `custom-statusline/shared` 的 parser / store / formatter，避免 trigger 再維護第三套 resetsAt 邏輯。
- 將本專案管理的 runtime log、latest snapshot、短期 cache 放進同一個 `ddd-workflow/custom-statusline` state/cache namespace，而不是散在 `/tmp/claude`、`~/.session-trigger`、`~/.config/ddd-workflow/opencode-codex-usage`。
- 讓 display 層只負責 render：Claude statusline render ANSI；OpenCode TUI render slot；session-trigger 只做 trigger log / retry 決策。
- 修正 raw StatusJSON logger 的設計：debug opt-in、stream-safe、可產生測試 fixture，但不預設長期記錄完整 raw payload。

## 非目標

- 不新增 daemon、dashboard、通知系統或長期 quota analytics。
- 不改 Claude statusline 既有畫面語意：full / compact mode 的欄位與 fallback 規則先維持。
- 不改 OpenCode TUI 插槽位置：仍掛在 `home_prompt_right` 與 `session_prompt_right`。
- 不搬移第三方擁有的資料來源，例如 `~/.codex/sessions/`、`~/.claude/.credentials.json`。
- 不把 token 或 credentials 寫入 custom statusline store。
- 不把 `session-trigger.mjs` 變成 statusline presenter；它只是共用 usage 資料管線。
- 不在本 sprint 支援 Gemini rolling window；Gemini 仍不是現有需求。

## User Story

作為 DDD workflow runtime maintainer，我想要把 Claude Code、OpenCode、Codex CLI 相關的 session usage 資料蒐集、快取、格式化與驗證邏輯集中在 `custom-statusline` 這個子系統，讓 statusline、TUI usage status、session trigger 不再各自維護 provider-specific parsing、路徑、log 與 fallback 規則。

## 驗收條件

- [ ] `ddd-workflow/custom-statusline/` 成為本專案管理的 statusline / usage display source location。
- [ ] Claude Code StatusJSON parser 能解析目前 statusline 使用的欄位：model、cwd / project_dir、context usage、context window size、five-hour used percent、five-hour reset time。
- [ ] Claude StatusJSON 的 raw debug log 改為 opt-in，且寫入方式不使用 `jq --argjson <large raw payload>` 這種 argv-based 寫法。
- [ ] Provider 與 harness 在資料模型中分離：例如 `harness=claude-code` 可以搭配 `provider=anthropic` 或 `provider=openai` / `unknown`。
- [ ] Anthropic OAuth Usage API、OpenCode Codex response headers、Codex CLI token_count event 都正規化成同一種 usage limit contract。
- [ ] Claude statusline 與 OpenCode TUI usage status 共用 limit formatting 規則，包含 percent clamp / round、elapsed reset fallback、unknown placeholder、remaining time format。
- [ ] `session-trigger.mjs` 使用 `custom-statusline/shared` parser / store / formatter 取得 reset time 與記錄 trigger 結果，不再手寫三套互不相干的 resetsAt 解析。
- [ ] 本專案產生的 latest snapshot、debug log、trigger log、短期 cache 使用同一個 `ddd-workflow/custom-statusline` namespace，並支援測試用 env override。
- [ ] 舊資料檔不需要 migration；因為它們是 cache / debug log，可從新 collector 重新建立。
- [ ] `scripts/cli.js` 的 deploy、undeploy、test 改用新 source path，並清理舊 statusline / OpenCode usage plugin symlink。
- [ ] `npm test`、`npm run test:unit`、Claude statusline entrypoint smoke test、session-trigger parser tests 通過。

## 目標架構

### 資料管線

```text
Collectors
  Claude Code StatusJSON stdin
  Anthropic OAuth Usage API
  OpenCode Codex response headers
  Codex CLI session JSONL
  session-trigger command results
        |
        v
Normalizers
  UsageLimitSnapshot
  SessionContextSnapshot
  TriggerResultSnapshot
        |
        v
Store
  latest snapshots
  JSONL event logs
  short-lived cache / throttle
        |
        v
Formatters
  percent / reset / elapsed / unknown
  compact columns
  ANSI-safe labels
        |
        v
Presenters / Deciders
  Claude statusline stdout
  OpenCode TUI slots
  session-trigger retry / skip log
```

### 目標檔案結構

```text
ddd-workflow/custom-statusline/
├── README.md
├── shared/
│   ├── types.ts
│   ├── paths.ts
│   ├── normalize-limit.ts
│   ├── format-limit.ts
│   ├── store.ts
│   ├── parse-jsonl.ts
│   └── *.test.ts
├── collectors/
│   ├── parse-claude-status-json.ts
│   ├── fetch-anthropic-usage.ts
│   ├── parse-codex-session-file.ts
│   ├── parse-opencode-codex-headers.js
│   └── *.test.ts
├── claude/
│   ├── statusline.ts
│   ├── statusline.sh
│   ├── render-statusline.ts
│   ├── read-git-status.ts
│   └── *.test.ts
├── opencode/
│   ├── codex-usage-capture.js
│   ├── codex-usage-status.tsx
│   ├── render-codex-usage.ts
│   └── *.test.ts
└── fixtures/
    ├── claude-status-json.minimal.json
    ├── anthropic-usage.json
    ├── opencode-codex-headers.json
    └── codex-token-count-event.json
```

`ddd-workflow/scripts/session-trigger.mjs` 先保留在現有位置，避免把 cron / deploy contract 與 statusline 重構綁得太死。它可以從 `custom-statusline/shared` 與 `custom-statusline/collectors` import parser / store，但 trigger 本體仍屬於 `scripts/`。

### Canonical Contract 草案

```ts
export type UsageHarness = "claude-code" | "opencode" | "codex-cli" | "session-trigger"
export type UsageProvider = "anthropic" | "openai" | "unknown"
export type UsageWindow = "context" | "five_hour" | "weekly" | "monthly_extra"
export type UsageStatus = "active" | "elapsed" | "unknown"

export interface UsageLimitSnapshot {
  harness: UsageHarness
  provider: UsageProvider
  model?: string
  window: UsageWindow
  label: string
  used_percent?: number
  reset_at?: number
  status: UsageStatus
  observed_at: string
  source: string
}

export interface SessionContextSnapshot {
  harness: UsageHarness
  provider: UsageProvider
  model?: string
  project_dir?: string
  cwd?: string
  current_tokens?: number
  window_tokens?: number
  observed_at: string
  source: string
}

export interface TriggerResultSnapshot {
  harness: UsageHarness
  provider: UsageProvider
  model?: string
  ok: boolean
  reset_at?: number
  reply?: string
  observed_at: string
  source: string
}
```

重點不是先把 schema 做大，而是先把 provider / harness / model 分開，避免日後把 `claude-code`、`anthropic`、`claude-* model` 混成同一個概念。

## Storage Contract

使用 XDG 語意，但統一 `custom-statusline` namespace：

```text
${CUSTOM_STATUSLINE_STATE_DIR:-${XDG_STATE_HOME:-~/.local/state}/ddd-workflow/custom-statusline}/
├── current/
│   ├── claude-code.json
│   ├── anthropic-oauth.json
│   ├── opencode-codex.json
│   ├── codex-cli.json
│   └── session-trigger.json
└── logs/
    ├── observations.jsonl
    ├── session-trigger.log
    ├── claude-statusline-invocations.jsonl
    └── debug-status-json.jsonl       # opt-in

${CUSTOM_STATUSLINE_CACHE_DIR:-${XDG_CACHE_HOME:-~/.cache}/ddd-workflow/custom-statusline}/
├── anthropic-oauth-usage.json
├── anthropic-oauth-usage.throttle
└── opencode-codex-usage.json
```

規則：

- `~/.config/ddd-workflow` 只放使用者設定，例如 `xreview.json`，不再放 mutable usage JSON。
- `state/current/*.json` 是跨 process 共享的 latest snapshot，display 與 trigger 都可讀。
- `state/logs/*.jsonl` 是可觀察性與除錯用途；raw payload 預設不開。
- `cache/*` 是短 TTL 或 throttle data，允許刪除後重建。
- 寫入 latest snapshot 必須 atomic，避免 prompt refresh 讀到半截 JSON。

## 邊界案例

- Case 1：Claude StatusJSON raw payload 太大或包含特殊字元。
  - 處理方式：debug logger 以 stdin / file stream 解析後寫 JSONL，不把 raw payload 塞進 shell argv；raw log 預設關閉。
- Case 2：Claude Code harness 回報 `model=codex,gpt-5.5-xhigh`。
  - 處理方式：`harness` 保持 `claude-code`，provider/model 用 parser best-effort 拆出；無法判斷時 provider 為 `unknown`。
- Case 3：OpenCode usage snapshot reset time 已過期。
  - 處理方式：formatter 回傳 `status=elapsed`，顯示 `--% reset --:--`，不得沿用 stale percent。
- Case 4：session-trigger 找不到 opencode usage snapshot 或 snapshot 舊於本次 started_at。
  - 處理方式：使用 shared `readFreshSnapshot()` 的 freshness check，必要時依既有 retry 規則處理。
- Case 5：Codex CLI session file 是第三方資料。
  - 處理方式：collector 只讀取並正規化，不搬移、不寫回。
- Case 6：舊 cache / log 路徑仍存在。
  - 處理方式：不 migration；deploy/test 只需確保新 runtime 不再依賴舊路徑。舊檔可留在磁碟上，不影響新資料流。

## ADR

### ADR-1：保留 `custom-statusline`，但內部採 usage pipeline

**決策**：使用 `ddd-workflow/custom-statusline/{shared,collectors,claude,opencode}`。

**原因**：`custom-statusline` 是前面已討論的 source namespace，且 Claude statusline / OpenCode TUI usage status 都是 display 功能。新的修正是把 `custom-statusline` 內部從「兩套 UI 程式」提升成「usage data pipeline + presenters」。

**替代方案**：改名為 `session-usage`。這能更精確描述資料管線，但會偏離已定下來的 `custom-statusline` namespace，也會讓本 sprint 看起來像在重命名整個 runtime usage 系統。

### ADR-2：Provider 與 harness 必須分離

**決策**：canonical contract 同時記錄 `harness` 與 `provider`。

**原因**：實際 invocation log 顯示 Claude Code statusline 可能出現 `codex,gpt-5.5-xhigh`。Claude Code 是 harness，不等於 Anthropic provider；OpenCode 是 harness，也不等於 OpenAI provider。若資料模型不分離，session-trigger 與 display 很快會在 model bucket 判斷上重複踩雷。

### ADR-3：集中到 XDG state/cache namespace

**決策**：使用 `~/.local/state/ddd-workflow/custom-statusline` 與 `~/.cache/ddd-workflow/custom-statusline`，並支援 `CUSTOM_STATUSLINE_STATE_DIR` / `CUSTOM_STATUSLINE_CACHE_DIR` 測試覆蓋。

**原因**：`~/.config` 不適合 mutable runtime state；`/tmp/claude` 太 provider / UI-specific；`~/.session-trigger` 是 trigger 的 isolated HOME，不適合作為 usage display / trigger 共用 store。XDG state/cache 能把「使用者設定」與「runtime usage data」分開，同時維持同一 namespace。

### ADR-4：session-trigger 共用資料管線，但 source path 暫不移入 custom-statusline

**決策**：`ddd-workflow/scripts/session-trigger.mjs` 保持現有位置，但使用 `custom-statusline/shared` 與 `custom-statusline/collectors`。

**原因**：trigger 的核心驗證就是 rate limit reset time；這和 statusline / TUI 顯示是同一筆資料，應共用 parser/store。但 `session-trigger.mjs` 本身不是 presenter，且 crontab / deploy 已指向現有 scripts path，沒有必要在本 sprint 同時移動它的 entrypoint。

### ADR-5：Raw payload log 是 debug tool，不是預設資料來源

**決策**：raw Claude StatusJSON 與 OpenCode response debug 預設關閉，只在除錯或建立 fixture 時啟用。

**原因**：raw payload 可能很大，也可能包含路徑、session metadata 或其他隱私資訊。正常狀態只需要 normalized snapshot；raw log 應作為短期 debug 工具。

## Milestones

### Milestone 1：補齊觀察與 fixture，定義 shared contract

> 預期結果：確認 Claude StatusJSON logger 為什麼沒有寫入，建立 sanitized fixtures，並以測試固定 canonical contract。
> 驗證方式：`npm run test:unit -- ddd-workflow/custom-statusline/shared ddd-workflow/custom-statusline/collectors`。

- [ ] 以測試先覆蓋正確 raw JSON capture；明確淘汰目前空檔的 `statusline-input` logger 假設。
- [ ] 建立 `types.ts`、`paths.ts`、`normalize-limit.ts`、`format-limit.ts` 與測試。
- [ ] 建立 Claude StatusJSON、Anthropic OAuth usage、OpenCode Codex headers、Codex token_count 的 fixture。
- [ ] 更新 `works.md` 記錄 logger 實際觀察：raw input log 目前為空、invocation log 已證明 provider/harness 混用風險。

### Milestone 2：建立 store 與集中化路徑

> 預期結果：latest snapshot、event log、cache/throttle 有一致讀寫 API 與 env override。
> 驗證方式：temp dir integration tests。

- [ ] 實作 atomic snapshot write / readFreshSnapshot。
- [ ] 實作 JSONL append helper。
- [ ] 實作 state/cache path resolution，不再把 mutable usage data 預設放進 `~/.config` 或 `/tmp/claude`。

### Milestone 3：遷移 Claude statusline presenter

> 預期結果：Claude statusline 仍輸出既有 full / compact 畫面，但資料蒐集、usage cache、formatting 改用 `custom-statusline` shared modules。
> 驗證方式：Claude statusline fixture/golden tests + entrypoint smoke test。

- [ ] 以現有 `test-statusline.sh` 行為建立 Vitest fixture / golden output 測試。
- [ ] 實作 Claude StatusJSON collector、Anthropic OAuth usage collector、git/context helper。
- [ ] 實作 render-only 的 Claude statusline presenter。
- [ ] Bash wrapper 僅作 entrypoint，不保留 parsing / API / formatting business logic。

### Milestone 4：遷移 OpenCode Codex usage presenter

> 預期結果：OpenCode capture plugin 寫入 normalized snapshot，TUI plugin 讀 shared store 並使用 shared formatter。
> 驗證方式：OpenCode formatter tests + plugin path deploy tests。

- [ ] 將 response header parser 抽成 collector，保留 OpenCode plugin 只負責 intercept fetch。
- [ ] TUI plugin 改讀 `custom-statusline` current snapshot。
- [ ] 保留 `home_prompt_right` / `session_prompt_right` 行為與 placeholder 規則。

### Milestone 5：讓 session-trigger 使用 shared usage modules

> 預期結果：session-trigger 的 Claude / Codex / OpenCode reset parsing 走 `custom-statusline` shared collectors/store，trigger log 進集中 namespace。
> 驗證方式：`npm run test:unit -- ddd-workflow/scripts/session-trigger.test.js ddd-workflow/custom-statusline/collectors`。

- [ ] 將 `parseClaudeResult`、`parseCodexResult`、`parseOpencodeResult` 改成使用 shared normalizer。
- [ ] 將 opencode fresh usage check 改為 shared `readFreshSnapshot()`。
- [ ] 將 trigger result 寫入 `state/current/session-trigger.json` 與 `state/logs/session-trigger.log`。
- [ ] 保留 one-shot cron 行為、現有 scripts entrypoint 與既有 retry tolerance。

### Milestone 6：部署、清理與文件收斂

> 預期結果：deploy/test 指向新 source path；舊 `ddd-workflow/scripts/statusline.sh` 與 `opencode-codex-usage-*` 不再是 source of truth。
> 驗證方式：`npm test`、`npm run test:unit`、stale symlink tests、entrypoint smoke tests。

- [ ] 更新 `scripts/cli.js` Claude / OpenCode source path；session-trigger path 保持但內部依賴 shared modules。
- [ ] 更新 `vitest.config.js` include。
- [ ] 清理或降級舊 `ddd-workflow/scripts/statusline.sh` 與 OpenCode usage plugin source 為 wrapper / legacy shim。
- [ ] 更新 README / docs 註記 `custom-statusline` 是 statusline / usage display 的 runtime SSOT。
