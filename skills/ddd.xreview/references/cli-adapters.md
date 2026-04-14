# CLI Adapters — per-CLI adapter shell

`/ddd.xreview` 透過 `scripts/adapters/<cli>.sh` 呼叫外部 CLI 執行 review。本文件說明各 CLI 的呼叫方式、read-only 機制與注意事項。

## 總覽

| CLI | Read-Only 機制 | 呼叫方式 | model 指定 |
|-----|---------------|---------|-----------|
| OpenCode | Agent 定義檔中設定 `edit: deny` + `bash` 白名單 | `opencode run --agent ddd.xreviewer --model "$model" < prompt.md` | `--model` flag |
| Gemini CLI | `--approval-mode=plan`（Plan Mode，禁止寫入專案檔案） | `gemini --approval-mode=plan -m "$model" < prompt.md` | `-m` / `--model` flag |
| Codex CLI | `--sandbox read-only`（預設值，明確指定更清楚） | `codex exec --sandbox read-only --ephemeral --model "$model" - < prompt.md` | `--model` / `-m` flag |

## OpenCode

Agent 定義檔位於 `ddd-workflow/opencode/agents/ddd.xreviewer.md`，透過 `npm run deploy` 自動 symlink 到 `~/.config/opencode/agents/ddd.xreviewer.md`。

### 使用方式

```bash
# 透過 adapter 呼叫（推薦，含 timeout + raw error passthrough）
bash ~/.claude/skills/ddd.xreview/scripts/adapters/opencode.sh /tmp/prompt.md openai/gpt-5.4 3000

# 直接呼叫（不含 adapter error wrapping）
echo "$prompt" | opencode run --agent ddd.xreviewer --model openai/gpt-5.4
```

`adapters/opencode.sh` 是刻意保持精簡的 proxy shell：

- 不對 reviewer 輸出做內容／品質判斷
- 只包 `timeout --foreground`
- 使用 `--print-logs --log-level ERROR`，讓 OpenCode 自己的錯誤訊息直接出現在 stderr
- 在 timeout 或非零 exit code 時補一行 `XREVIEW_ERROR` summary，方便上層流程辨識失敗

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

支援 `-o json` 輸出 JSON 格式。

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
- 最終結果到 **stdout**

### 互動模式注意事項

在非互動模式（`codex exec`）中，`--ask-for-approval on-request` 會自動降級為 `never`，不會出現互動式 prompt 導致掛住。

### Exit codes

Exit codes 未明確記載於官方文件，需靠 exit code 檢查判斷成功/失敗。
