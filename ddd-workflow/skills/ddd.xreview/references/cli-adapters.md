# CLI Adapters — per-CLI adapter shell

`/ddd.xreview` 透過 `scripts/adapters/<cli>.sh` 呼叫外部 CLI 執行 review。本文件說明各 CLI 的呼叫方式、read-only 機制、final 抽取與注意事項。

## 總覽

| CLI | Read-Only 機制 | 呼叫方式 | model 指定 |
|-----|---------------|---------|-----------|
| Claude | `--permission-mode plan` + `--agent ddd-reviewer` | `claude -p --agent ddd-reviewer --model "$model" --permission-mode plan < prompt.md` | `--model` flag |
| OpenCode | Agent 定義檔中設定 `edit: deny` + `bash` 白名單 | `opencode run --agent ddd.xreviewer --model "$model" < prompt.md` | `--model` flag |
| Gemini CLI | `--approval-mode=plan`（Plan Mode，禁止寫入專案檔案） | `gemini --approval-mode=plan -m "$model" < prompt.md` | `-m` / `--model` flag |
| Codex CLI | `--sandbox read-only`（預設值，明確指定更清楚） | `codex exec --sandbox read-only --ephemeral --model "$model" - < prompt.md` | `--model` / `-m` flag |

## Final 抽取（ADR-11 雙輸出）

每個 adapter 第 3 arg 為 `<final-out-file>`。orchestrator 預先 touch 成空檔，adapter 把 CLI 最終訊息抽乾淨寫進去；verbose trace 走 stderr 進 `.log`。以下是各 CLI 的抽取策略：

| CLI | Final 抽取 | Verbose 去處 |
|-----|-----------|--------------|
| claude | `--output-format json`（stdout 為單一 JSON object） → `jq -r '.result // empty' > $final_out`；另用 `--debug-file <tmp>` 接 verbose，adapter 結束前 `cat` 該 tmp 到 stderr 後刪除 | stderr（含 debug-file 被重播的內容）|
| codex | `-o "$final_out"` 讓 CLI 直接把純 text 寫入 final；ADR-12 流程會先用 python3 + tomllib 讀 `ddd-reviewer.toml` 的 `developer_instructions`，prepend 到一份 mktemp effective prompt 再 pipe 進 `codex exec` | stderr（CLI 進度輸出）|
| gemini | `--output-format json` → `jq -r '.response // empty' > $final_out` | stderr（CLI log）|
| opencode | `--format json` 吐 ndjson event stream → `tee /dev/stderr` 把原始 ndjson 複製到 stderr 供除錯，再 `jq -rs 'map(select(.type=="text")) \| map(.part.text) \| join("")' > $final_out` 抽出所有 text part | stderr（tee 複製的 ndjson）|

共通約定：

- 所有 adapter 都先 `: > "$final_out"` 清空，確保 early exit（例如 prompt 檔不存在、CLI 未安裝）時 final 仍可讀但為空——coordinator 的 step 7.1 peek 會判定為 content-layer 失敗。
- `set +o pipefail` 包住 `CLI | jq` 的 pipeline，用 `PIPESTATUS[0]` 保留 CLI 自己的 exit code，避免被 `jq` 的成功 / 失敗遮蓋。
- jq 失敗時（CLI 輸出非預期 JSON）final_out 可能為空，但 adapter 仍忠實回報 CLI 的 rc，讓 orchestrator 依 rc 發 RETURN / FAIL 事件。

## OpenCode

Agent 定義檔位於 `ddd-workflow/opencode/agents/ddd.xreviewer.md`，透過 `npm run deploy` 自動 symlink 到 `~/.config/opencode/agents/ddd.xreviewer.md`。

### 使用方式

```bash
# 透過 adapter 呼叫（推薦，含 raw error passthrough；timeout 由 orchestrator 外層 `timeout --foreground` 負責）
bash ~/.claude/skills/ddd.xreview/scripts/adapters/opencode.sh /tmp/prompt.md openai/gpt-5.4 /tmp/xreview-demo.final.txt

# 直接呼叫（不含 adapter error wrapping）
echo "$prompt" | opencode run --agent ddd.xreviewer --model openai/gpt-5.4
```

`adapters/opencode.sh` 是刻意保持精簡的 proxy shell：

- 不對 reviewer 輸出做內容／品質判斷
- timeout 不在這一層——orchestrator 外層已用 `timeout --foreground` 負責（ADR-6 單層制）
- 使用 `--print-logs --log-level ERROR`，讓 OpenCode 自己的錯誤訊息直接出現在 stderr
- 用 `--format json` 吐 ndjson，以 `tee /dev/stderr` 把原始 ndjson 複製到 stderr 供除錯，同時用 `jq -rs 'map(select(.type=="text")) | map(.part.text) | join("")'` 抽出 text part 寫進 `<final-out>`
- 在非零 exit code 時補一行 `XREVIEW_ERROR` summary，方便上層流程辨識失敗

### 設計說明

#### Permission 完整性（防止 run 模式掛住）

OpenCode `run` 模式下，未列入的 permission 預設為 `"ask"`。但 headless 模式無法回答互動式 prompt，**導致進程永久掛住**（GitHub issues #8203、#3503、#14473）。

因此 **每一個 permission key 都必須明確設定為 `allow` 或 `deny`**，絕對不能遺漏。特別是：

- `external_directory`：預設 `"ask"`，reviewer 嘗試存取工作目錄外的路徑時會掛住。設為 `"*": deny` + `/tmp/*: allow`，只允許讀取 `/tmp/` 下的暫存檔（某些模型會先 `git diff > /tmp/xxx` 再用 Read 讀回）。
- `question: deny`：防止 reviewer 暫停等待使用者回答。

#### 其他設計

- `mode: subagent`：只能透過 `--agent` 呼叫，不會出現在 TUI 的模型選單
- `steps: 50`：限制 agentic 迭代次數，防止 reviewer 因工具失敗而無限重試
- `edit: deny`：技術層面禁止修改任何檔案
- `bash: deny` + 白名單：只允許 git 唯讀指令和檔案檢視指令
- `cat`/`head`/`tail` 白名單：某些模型（特別是 Gemini）偏好用 bash 指令讀取檔案而非 Read tool，不加這些會導致 reviewer 卡住
- Bash pattern 是 glob matching，`git --no-pager*` 涵蓋 `git --no-pager log ...` 等

### 注意事項

- 修改 agent 定義後，執行 `npm run deploy opencode` 重新建立 symlink（或直接生效，因為是 symlink）
- 若 reviewer 仍然卡住，嘗試降低 `steps` 值（如 30）
- 若特定模型有額外的工具需求，在 bash 白名單中加入對應的指令 pattern

### 替代方案：ACP 模式

若 `run` 模式仍不穩定，可考慮改用 `opencode acp`（Agent Client Protocol）：

```bash
# ACP 使用 JSON-RPC over stdio，可精確控制超時
opencode acp --port 0 --cwd /path/to/code << 'EOF'
{"jsonrpc":"2.0","id":1,"method":"message","params":{"text":"review prompt here"}}
EOF
```

優點：IDE 級整合協定、結構化回應、可設定 pipe 級超時。
缺點：需要額外的 JSON-RPC client wrapper。

## Gemini CLI

### 呼叫方式

```bash
cat prompt.md | gemini --approval-mode=plan
```

### Read-Only 機制

`--approval-mode=plan` 啟用 Plan Mode：

- 技術層面**禁止修改專案檔案**
- 僅允許寫入 `~/.gemini/tmp/<project>/<session>/plans/` 下的 .md 檔案
- 不需要 `-y` flag（Plan Mode 自動批准讀取操作）

### Headless 觸發

- stdin 為 non-TTY 時自動進入 headless 模式
- 也可透過 `-p` flag 明確觸發

### model 指定

使用 `-m` / `--model` flag 指定模型（如 `gemini-2.5-pro`、`gemini-3.0-flash-preview`）。未指定時使用 gemini 設定檔中的預設模型。

### 輸出格式

`adapters/gemini.sh` 用 `--output-format json` 讓 CLI 吐出單一 JSON object，內含 `.response` 欄位為 agent 最終訊息。adapter 用 `jq -r '.response // empty' > $final_out` 抽出純 text 寫進 `<final-out>`，stderr 不動（CLI 的 log 自然走 stderr 進 orchestrator `.log`）。

### Sandbox（ADR-9）

Gemini 的 workspace sandbox 會擋 project root 之外的路徑。adapter 用 `--include-directories "/tmp,$XDG_CONFIG_HOME"`（或 `$HOME/.config` fallback）放行 prompt 檔（`/tmp`）與 xreview config 目錄，並透過 `--admin-policy` 指向 `policies/ddd.xreview.toml` 強化角色設定。

### Exit codes

| Code | 意義 |
|------|------|
| `0` | 成功 |
| `1` | API 錯誤 |
| `42` | 輸入錯誤 |
| `53` | 超過 turn limit |

## Codex CLI

### 呼叫方式

```bash
codex exec --sandbox read-only --ephemeral --model "$model" - < prompt.md
```

- `codex exec`（或 `codex e`）是 non-interactive 子命令
- `-`（dash）明確指定從 stdin 讀取 prompt
- `--ephemeral` 避免保存 session 檔案

### Read-Only 機制

`--sandbox read-only` 是預設值，但明確指定更清楚。在此模式下 Codex 無法修改檔案系統。

### model 指定

使用 `--model` 或 `-m` flag 指定模型。

### 輸出行為

- 進度輸出到 **stderr**
- `adapters/codex.sh` 用 `-o "$final_out"` 讓 CLI 直接把最終訊息（純 text，已去除 thinking / tool trace）寫進 `<final-out>`，不經 jq
- stdout 本身留白，stderr 進 orchestrator `.log` 當 verbose trace

### 角色載入（ADR-12）

`codex` 沒有 top-level `--agent` flag，`~/.codex/agents/ddd-reviewer.toml` 只對 `spawn_agent` 工具生效。adapter 用 python3 + tomllib（Python 3.11+）讀取該 toml 的 `developer_instructions` 欄位，prepend 到一份 mktemp 出來的 effective prompt 檔再 pipe 進 `codex exec`。toml 查找順序：

1. `${XDG_CONFIG_HOME:-$HOME/.config}/codex/agents/ddd-reviewer.toml`
2. `$HOME/.codex/agents/ddd-reviewer.toml`

若 python3 不存在則 fallback 用 awk 的 triple-quoted extractor；若連 toml 都找不到，adapter 會 stderr 印 `XREVIEW_WARN` 後把原始 prompt 原樣送出，不阻塞 review。

### 互動模式注意事項

在非互動模式（`codex exec`）中，`--ask-for-approval on-request` 會自動降級為 `never`，不會出現互動式 prompt 導致掛住。

### Exit codes

Exit codes 未明確記載於官方文件，需靠 exit code 檢查判斷成功/失敗。

## Claude CLI

### 呼叫方式

```bash
claude -p \
  --agent ddd-reviewer \
  --model "$model" \
  --no-session-persistence \
  --permission-mode plan \
  --output-format json \
  --debug-file "$debug_file" \
  < prompt.md
```

- `-p` 進入 non-interactive print mode
- `--agent ddd-reviewer` 套用 `~/.claude/agents/ddd-reviewer.md` 定義的角色（由 `npm run deploy` symlink 部署）
- `--no-session-persistence` 避免把 xreview session 存進本地資料庫

### Read-Only 機制

`--permission-mode plan` 套用 Plan Mode——技術層面禁止修改專案檔案，讀取操作自動批准。

### 輸出格式與 Final 抽取

`adapters/claude.sh` 用 `--output-format json` 讓 stdout 變成單一 JSON object，`.result` 欄位為 agent 最終訊息。adapter 流程：

1. pipeline：`claude ... | jq -r '.result // empty' > $final_out`，用 `PIPESTATUS[0]` 保留 CLI 自己的 rc
2. `--debug-file <tmp>` 把 CLI 的 verbose trace 寫到臨時 sidecar，adapter 結束前 `cat` 這份 sidecar 到 stderr（前綴一行 `=== claude --debug-file content ===`）讓 orchestrator `.log` 仍有完整除錯資訊，然後 `rm -f` 清掉 sidecar
3. stderr 自然流向 orchestrator 的 log，不做 `exec 2>&1` merge

### model 指定

使用 `--model` flag 指定模型（如 `claude-opus-4-6`、`claude-sonnet-4-6`）。
