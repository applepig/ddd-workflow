# CLI Adapters — per-CLI adapter shell

`/ddd.xreview` 透過 `scripts/adapters/<cli>.sh` 呼叫外部 CLI 執行 review。本文件說明各 CLI 的呼叫方式、read-only 機制、final 抽取與注意事項。

## 總覽

| CLI | Read-Only / Enforcement 機制 | 呼叫方式 | model 指定 |
|-----|---------------|---------|-----------|
| Claude | `--permission-mode default` + adapter 內建 `--allowedTools` 清單 + `--agent ddd-reviewer` | `claude -p --agent ddd-reviewer --model "$model" --permission-mode default --allowedTools "$reviewer_allowed_tools" < prompt.md` | `--model` flag |
| OpenCode | Agent 定義檔中設定 `edit: deny` + `bash` 白名單 | `opencode run --agent ddd-reviewer --model "$model" < prompt.md` | `--model` flag |
| Antigravity CLI（agy） | `os-write-confinement`：`bwrap --ro-bind / /` 把整個 FS（含真實 repo 與 `.git`）掛唯讀，唯一可寫處是拋棄式 isolated HOME | bwrap 包住 `agy --add-dir "$REPO_DIR" --model "$model" --effort high --print "$prompt"`（見下方章節） | `--model` + `--effort` flag |
| Codex CLI | `--sandbox read-only`（預設值，明確指定更清楚） | `codex exec --sandbox read-only --ephemeral --model "$model" - < prompt.md` | `--model` / `-m` flag |
| Gemini CLI（DEPRECATED） | `--approval-mode=plan`（Plan Mode，禁止寫入專案檔案） | `gemini --approval-mode=plan -m "$model" < prompt.md` | `-m` / `--model` flag |

## Final 抽取（ADR-11 雙輸出）

每個 adapter 第 3 arg 為 `<final-out-file>`。orchestrator 預先 touch 成空檔，adapter 把 CLI 最終訊息抽乾淨寫進去；verbose trace 走 stderr 進 `.log`。以下是各 CLI 的抽取策略：

| CLI | Final 抽取 | Verbose 去處 |
|-----|-----------|--------------|
| claude | `--output-format json`（stdout 多為 JSON array of envelopes，舊版可能回單一 object） → jq filter 兼容兩種形態抽 `.result`（array 情況取 `type=="result"` 最後一筆）寫入 `$final_out`；另用 `--debug-file <tmp>` 接 verbose，adapter 結束前 `cat` 該 tmp 到 stderr 後刪除 | stderr（含 debug-file 被重播的內容）|
| codex | `-o "$final_out"` 讓 CLI 直接把純 text 寫入 final；ADR-12 流程會先用 python3 + tomllib 讀 `ddd-reviewer.toml` 的 `developer_instructions`，prepend 到一份 mktemp effective prompt 再 pipe 進 `codex exec` | stderr（CLI 進度輸出）|
| gemini | `--output-format json` → `jq -r '.response // empty' > $final_out` | stderr（CLI log）|
| opencode | `--format json` 吐 ndjson event stream → `tee /dev/stderr` 把原始 ndjson 複製到 stderr 供除錯，再 `jq -rs 'map(select(.type=="text")) \| map(.part.text) \| join("")' > $final_out` 抽出所有 text part | stderr（tee 複製的 ndjson）|

共通約定：

- 所有 adapter 都先 `: > "$final_out"` 清空，確保 early exit（例如 prompt 檔不存在、CLI 未安裝）時 final 仍可讀但為空——coordinator 的 step 7.1 peek 會判定為 content-layer 失敗。
- `set +o pipefail` 包住 `CLI | jq` 的 pipeline，用 `PIPESTATUS[0]` 保留 CLI 自己的 exit code，避免被 `jq` 的成功 / 失敗遮蓋。
- jq 失敗時（CLI 輸出非預期 JSON）final_out 可能為空，但 adapter 仍忠實回報 CLI 的 rc，讓 orchestrator 依 rc 發 RETURN / FAIL 事件。
- 用到 jq 的 adapter（claude / gemini / opencode）在頭部用 `command -v jq` guard，若缺失立即 `exit 1` 並印 `XREVIEW_ERROR: jq not found ...`，避免 silent empty final 被誤判為 content failure。codex adapter 走 `-o` 直寫不需要 jq。

### Adapter stdout/stderr contract

ADR-11 雙輸出設計對 adapter 的 stdout / stderr 行為有隱性契約，這裡明文化以避免後續 adapter 作者誤觸發：

- **stdout：必須為空。** 所有 final review 內容經各家 JSON flag + jq（claude / gemini / opencode）或 `-o` 旗標（codex）寫入第 3 個 arg 指定的 `$final_out` 檔。orchestrator 的 adapter call 是 `bash "$adapter" ... "$final" >> "$log" 2>&1`，若 adapter 實作讓 final 溢出到 stdout，會被 append 到 log 造成（a）log 膨脹、（b）final 在 log 與 final.txt 重複、（c）使用者看到 log 時誤以為 transport 出問題。
- **stderr：自然傳遞。** CLI 的 debug trace、adapter 自訂的 `XREVIEW_INFO` / `XREVIEW_WARN` / `XREVIEW_ERROR` 都走 stderr。orchestrator 把 stderr 併入 log 作為 verbose trace，使用者除錯時直接看 log 即可，不需另外收集。
- **exit code：透傳 CLI rc。** adapter 只在「必要工具缺失」（如 jq、prompt file、CLI 本身）時提前 `exit 1`；其餘情況用 `PIPESTATUS[0]` 或 `$?` 回傳 CLI 自己的 rc，讓 orchestrator 依 rc 發 RETURN / FAIL 事件。

每個 adapter 檔頭 comment 都會帶一行 `stdout contract: must be empty (...)` 提醒；CI 的 `adapters.test.sh` 會 grep 該標記與本段標題作 static check，文件與實作不同步會立刻紅。

## Antigravity CLI

`agy`（Antigravity CLI）是 `/ddd.xreview` 的**預設 `pro` / `flash` reviewer**（ADR-4），取代 runtime-availability 已壞掉的 gemini-cli。adapter 為 `adapters/agy.sh`。

### model / effort 分離（agy 1.1+）

agy 1.1 把 reasoning effort 從 model id 拆出：`--model` 只收 base id（如 `gemini-3.1-pro`），effort 改由獨立 `--effort <low|medium|high>` 指定。舊的合併形式 `gemini-3.1-pro-high` 會回 `"no longer available"`，而只給 base id 又會回 `requires --effort`。`agy models` 目前仍印出過時的合併名稱，故 source config（base 名）與舊部署 config（帶 `-high`）都可能傳進 adapter。adapter 因此在 argv 前防禦性剝除尾端 `-low|-medium|-high` 後綴，並固定帶 `--effort high`——xreview 一律要最強的審查 pass。

### Enforcement level：`os-write-confinement`（bwrap 唯讀真 repo）

agy 的寫入邊界是 **OS 級別、由 bwrap（bubblewrap）施加**，不是 permission mode。誠實標示：enforcement level = **`os-write-confinement`**。機制：

- **`bwrap --ro-bind / /`**：把整個 FS（含**真實 repo 與其 `.git`**）對 agy 掛**唯讀**。agy 以**真實 repo 為 cwd 與 workspace** 跑（`--chdir "$REPO_DIR"` + agy 端 `--add-dir "$REPO_DIR"`），但任何寫嘗試（terminal 工具的 `echo > file`、file 工具的 `write_to_file`、相對或絕對路徑）都會收到 `read-only file system`、優雅回報、不 hang。連 `git config core.hooksPath` 注入 / `git commit` / object 注入這類寫入攻擊都被物理擋住，因為 `.git` 也是唯讀。
- **唯一可寫處 = per-invocation 拋棄式 isolated HOME**（`--bind "$ISO_HOME"`）+ 私有 `/dev`（`--dev /dev`）、私有 `/dev/shm`（`--tmpfs /dev/shm`）。review 結束清掉。
- **不物化 repo、不複製、不另建隔離目錄**：沒有 staging dir、stash / archive 物化、diff 物化、dirty-check canary——這些是 pre-bwrap 時代的邊界遺留物，bwrap ro-bind 已使其多餘，全數移除（ADR-7）。真實 repo 由 ro-bind 物理保護，不需 canary。

bwrap 硬化 flag（ADR-8，純縮攻擊面，不影響 reviewer 能力）：`--dev /dev` + `--tmpfs /dev/shm`（取代會把 host `/dev/shm` 寫入洩漏到 host 的 `--dev-bind /dev /dev`）、`--unshare-pid`（agy 看不到 host 行程）、`--new-session`（杜絕 TIOCSTI terminal 注入）、`--die-with-parent`（orchestrator 死則 agy 收掉）、`--clearenv` + 最小注入（只給 `PATH` / `HOME` / `TMPDIR` / `TERM`，不把 orchestrator env 機密交給 agy）。

### git 能力完整

因為 ro-bind 掛的是真實 repo（含 `.git` 與完整歷史，唯讀但可讀），reviewer 在 sandbox 內可原生跑任意 git：`git log`、`git diff HEAD`、以及**任意 commit range diff**如 `git diff <base>...HEAD`。coordinator 在 xreview prompt 裡照常給 `git diff <range>` 指令即可（與 claude / opencode reviewer 一致），不需 diff 物化或「git 不可用」說明。

### Read 與 network 不封閉（明列殘留風險）

寫入邊界是 OS-hard，但 read 與 network **不在本邊界範圍內**：

- **read 範圍未封閉**：`--ro-bind / /` 讓 agy 能**讀**整個 FS（其他 repo、`~/.ssh`、token 等）。針對的威脅是「reviewer 改檔」（write）；reviewer 本來就要讀使用者程式碼，且 permission mode 同樣救不了 read。縮 read 面（只 ro-bind 必要路徑）列為後續。
- **network 全開**：未 `--unshare-net`（agy 需網路打 Gemini API）。結合 read 開放，理論上「prompt-injection → 讀機密 → 網路外洩」不被本邊界擋；network egress 控制列後續獨立決策。
- **secret leakage（送雲）**：agy 把讀到的 repo 內容送 Google，與其他雲端 reviewer 同級。
- **agy 版本飄移**：行為可能隨版本變動（實測於 agy 1.0.13/1.0.14）；bwrap 邊界本身不隨 agy 版本變動。

> isolated HOME settings.json 注入的 `permissions` 是純 allow-list（`["read_file(*)","write_file(*)","command(*)","mcp(*)"]`，**不含 `unsandboxed(*)`**、無 deny），**不是**安全邊界——它只用來消除 headless trust-prompt / tool-approval hang。邊界是 bwrap。

### ddd-reviewer 角色 prepend

agy 把 agent 檔當純 markdown 讀、不視為 subagent，故 adapter 把 ddd-reviewer 角色正文 **prepend** 到 prompt（不是當 `--agent` 載入）。查找序：`${XDG_CONFIG_HOME:-$HOME/.config}/gemini/agents/ddd-reviewer.md` → `$HOME/.gemini/agents/ddd-reviewer.md`。用 awk 剝除 YAML frontmatter 取正文，組成 `role_body + "\n\n---\n\n" + 原 prompt` 經 `--print` argv 傳入。缺檔 / 空檔降級：stderr 印 `XREVIEW_WARN`、原 prompt 原樣送出、exit code 仍透傳 agy rc。

### Final 抽取與 stdout/stderr/exit 契約

- **final = agy `--print` 的 stdout 直導 `<final-out>`**（第 3 個 arg），純 text 無需 JSON 解析（類 codex `-o`，少一個 jq 失敗點）。`> "$final_out"` 的 fd 在進 bwrap 前由外層 shell 開好，agy 繼承寫入；ro-bind 只擋 namespace 內的新 `open()`，不影響繼承 fd，故 final 落在 `/tmp` 仍寫得進。jq 只用於改寫 isolated HOME settings.json，不解析 agy 輸出。
- **stdout：必須為空**——final 全走第 3 arg，adapter 自身不對 stdout 印任何東西（成功路徑下 `[[ ! -s ]]` 為真）。
- **stderr：自然傳遞**——agy 的 progress / trace 與 adapter 自訂的 `XREVIEW_WARN` / `XREVIEW_ERROR` 都走 stderr，併入 orchestrator log。
- **exit code：透傳 agy rc**——adapter 只在必要工具缺失（prompt file / `agy` / `bwrap` / `jq`）或 REPO_DIR 過大時提前 `exit 1`；其餘透傳 agy 自己的 rc。

### Fail-closed 與失敗區分

- **bwrap 缺席 → fail-closed**：PATH 無 `bwrap` 時 adapter 在跑 agy 前 fail-fast（`XREVIEW_ERROR: agy requires bwrap ...` + 非零 exit），**絕不**退回無封裝直接跑 agy。
- **三種失敗可區分**：adapter 用 `--json-status-fd` 讀 bwrap 的 `{"exit-code": N}` 判別。判別順序與訊息：
  1. **有 `exit-code` 行** → bwrap 成功建 namespace 並 exec agy，rc 是 agy 自己的失敗 → `XREVIEW_ERROR: agy exited with code N`
  2. **無該行且 rc > 128** → 外部 signal（orchestrator timeout、使用者中斷、OOM kill）在 bwrap 寫出狀態前就殺掉它 → `XREVIEW_ERROR: agy terminated by signal N (SIGxxx) ...`。此判斷必須排在 sandbox 失敗之前：signal 死亡與 namespace 建立失敗同樣表現為「缺 `exit-code` 行」，不先分辨就會把每次外部 kill 誤報成 sandbox 失敗
  3. **無該行且 rc ≤ 128** → namespace 建立失敗，agy 從未執行 → `XREVIEW_ERROR: agy bwrap sandbox setup failed (rc=N) ...`（wrapper 失敗）

  三條路徑都會先印一行 `XREVIEW_INFO: agy bwrap json-status raw: <原始內容或 <empty>>`，讓未被上述分支涵蓋的狀態仍可從 log 直接判讀，不必靠猜。
- **REPO_DIR 過大 → fail-fast**：推導後拒絕 `/` 與 `$HOME`（`XREVIEW_ERROR: agy REPO_DIR refuses overly-broad path: ...` + exit 1），避免把過多內容交給 agy 當 workspace / trust grant。

## OpenCode

Agent 定義來自 `agents/ddd-reviewer.md`（共用 SSOT）。authoring repo 端用 `pnpm deploy:dry-run` 或 `pnpm deploy` 先建置 publish checkout，再以 copy-based deploy 安裝；public package 端先執行 `npm run agents:build` 產生 `dist/opencode/agents/ddd-reviewer.md`，再執行 `npm run agents:deploy -- opencode` 複製到 `~/.config/opencode/agents/ddd-reviewer.md`。OpenCode agent 使用 `mode: all`，並由專屬 permission 設定維持 read-only review 行為。Agent 命名規則：skills 用 dot 分隔（`ddd.xreview`），agents 用 dash 分隔（`ddd-reviewer`）。

### 使用方式

```bash
# 透過 adapter 呼叫（推薦，含 raw error passthrough；timeout 由 orchestrator 外層 `timeout --foreground` 負責）
bash ~/.claude/skills/ddd.xreview/scripts/adapters/opencode.sh /tmp/prompt.md openai/gpt-5.5 /tmp/xreview-demo.final.txt

# 直接呼叫（不含 adapter error wrapping）
echo "$prompt" | opencode run --agent ddd-reviewer --model openai/gpt-5.5
```

OpenCode adapter 仍可用完整 spec（例如 `opencode:openai/gpt-5.5`）明確指定；預設 GPT 5 系列 reviewer alias 則由 `xreview.json` 決定，可能指向 Codex 或其他 CLI。

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

- `mode: all`：可透過 `--agent ddd-reviewer` 在 `opencode run` 載入 reviewer agent（xreview adapter 用法）
- `steps: 50`：限制 agentic 迭代次數，防止 reviewer 因工具失敗而無限重試
- `edit: deny`：技術層面禁止修改任何檔案
- `bash: deny` + 白名單：只允許 git 唯讀指令和檔案檢視指令
- `cat`/`head`/`tail` 白名單：某些模型（特別是 Gemini）偏好用 bash 指令讀取檔案而非 Read tool，不加這些會導致 reviewer 卡住
- Bash pattern 是 glob matching，`git --no-pager*` 涵蓋 `git --no-pager log ...` 等

### 注意事項

- 修改 agent 定義後，authoring 端執行 `pnpm deploy:dry-run` 檢查、`pnpm deploy` 安裝；public package 端執行 `npm run agents:build` 後再執行 `npm run agents:deploy -- opencode`
- **升級時若 agent 重新命名或 `mode` 變更**（例如 `ddd-reviewer` 統一 dash 命名且 OpenCode 使用 `mode: all`），必須重跑 copy-based deploy，否則 OpenCode 可能仍讀到舊檔或回 `agent not found`
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

## Gemini CLI（DEPRECATED）

> **DEPRECATED（sprint 26, ADR-4）。** 預設 `pro` / `flash` reviewer 已改指 `agy:<model>`（見上方 ## Antigravity CLI）。gemini-cli「壞掉」是 **runtime-availability** 問題（CLI / headless auth 在環境中失效），**非 adapter-correctness** 問題——本 adapter 邏輯本身仍正確。`gemini.sh` 與 `gemini:*` alias **保留不移除**，作為 escape hatch：顯式 `gemini:<model>` spec 仍可被 `resolve_spec` 解析並 dispatch 到此 adapter，執行邏輯凍結。

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
  --permission-mode default \
  --allowedTools "$reviewer_allowed_tools" \
  --output-format json \
  --debug-file "$debug_file" \
  < prompt.md
```

- `-p` 進入 non-interactive print mode
- `--agent ddd-reviewer` 套用 `~/.claude/agents/ddd-reviewer.md` 定義的角色（由 `npm run deploy` symlink 部署）
- `--no-session-persistence` 避免把 xreview session 存進本地資料庫

### Read-Only 機制

`--permission-mode default` 搭配 adapter 內建的 `--allowedTools` 清單控管可執行命令。曾短暫採用 `--permission-mode plan`，但 Claude Code plan mode 一律禁 Bash（官方 issue #13067 已知限制），導致 ddd-reviewer 無法跑 `git --no-pager diff` 取變更、final 恆空。

**權限解析是 union，不是取代**（2026-08-05 實測，claude 2.1.222）：headless `-p` 下 `--allowedTools` 與使用者 settings 的 allow rules **聯集**生效——傳入一條無關規則不會讓 settings 授權的命令失效。曾只靠 ambient settings，導致 reviewer 能力隨機器而異：沒有 `glab` 規則的機器不是報錯，而是靜默回空 review。adapter 因此內建 `reviewer_allowed_tools`（逗號分隔，規則含空白故不可用空白分隔），作為每台機器的**能力下限**；使用者 settings 仍可再放寬。

實測補充：headless 有 harmless-command 分類器，`whoami`、`wc` 這類無害本機命令不在 allowlist 也會放行；`glab`、`docker` 這類則必須有明確規則。用前者當探針會誤判成「allowlist 沒生效」。

清單只收唯讀查詢面：forge CLI 僅開 `view` / `list` / `diff` / `checks`，不含 `create`、`merge`，也不含 `api`（`-X` 可寫），維持底線第 5 條 reviewer 只讀不改。`tests/.../adapters/claude.test.sh` 有反向斷言釘住寫入面不得出現。

**完全機器無關為何做不到**：`--setting-sources` 可排除 user settings，但 `~/.claude/agents/` 隨同一來源載入，排掉後 `--agent ddd-reviewer` 會 `not found`、整條 xreview 空回。真要嚴格隔離需改用 `--agents <json>` 明確餵 agent 定義（實測 `tools` 限制有被尊重），屬 adapter 契約級變更，尚未採用。

### 輸出格式與 Final 抽取

`adapters/claude.sh` 用 `--output-format json`，stdout 多為 JSON array of envelopes（舊版可能回單一 object）；agent 最終訊息為 array 中最後一筆 `type=="result"` 元素的 `.result`。adapter 流程：

1. pipeline：jq filter 兼容 array/object 兩種形態抽 `.result` 寫入 `$final_out`，用 `PIPESTATUS[0]` 保留 CLI 自己的 rc
2. `--debug-file <tmp>` 把 CLI 的 verbose trace 寫到臨時 sidecar，adapter 結束前 `cat` 這份 sidecar 到 stderr（前綴一行 `=== claude --debug-file content ===`）讓 orchestrator `.log` 仍有完整除錯資訊，然後 `rm -f` 清掉 sidecar
3. stderr 自然流向 orchestrator 的 log，不做 `exec 2>&1` merge

### model 指定

使用 `--model` flag 指定模型（如 `claude-opus-4-6`、`claude-sonnet-4-6`）。
