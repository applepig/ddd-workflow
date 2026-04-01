# OpenCode ddd.xreviewer Agent 設定

Agent 定義檔位於 `ddd-workflow/opencode/agents/ddd.xreviewer.md`，透過 `npm run deploy` 自動 symlink 到 `~/.config/opencode/agents/ddd.xreviewer.md`。

## 使用方式

```bash
# 透過 xreview-runner.sh 呼叫（推薦，含 timeout + raw error passthrough）
bash ~/.claude/skills/ddd.xreview-3/scripts/xreview-runner.sh /tmp/prompt.md openai/gpt-5.4
bash ~/.claude/skills/ddd.xreview-3/scripts/xreview-runner.sh /tmp/prompt.md google/gemini-3.1-pro-preview

# 直接呼叫（不含 timeout 與 runner summary）
echo "$prompt" | opencode run --agent ddd.xreviewer --model openai/gpt-5.4
```

`xreview-runner.sh` 現在是刻意保持精簡的 proxy shell：

- 不對 reviewer 輸出做內容／品質判斷
- 只包 `timeout`
- 使用 `--print-logs --log-level ERROR`，讓 OpenCode 自己的錯誤訊息直接出現在 stderr
- 若 stderr 出現明確 error marker，轉成非零失敗
- 在 timeout 或非零 exit code 時補一行 `XREVIEW_ERROR` summary，方便上層流程觸發退化

## 設計說明

### Permission 完整性（防止 run 模式掛住）

OpenCode `run` 模式下，未列入的 permission 預設為 `"ask"`。但 headless 模式無法回答互動式 prompt，**導致進程永久掛住**（GitHub issues #8203、#3503、#14473）。

因此 **每一個 permission key 都必須明確設定為 `allow` 或 `deny`**，絕對不能遺漏。特別是：

- `external_directory`：預設 `"ask"`，reviewer 嘗試存取工作目錄外的路徑時會掛住。設為 `"*": deny` + `/tmp/*: allow`，只允許讀取 `/tmp/` 下的暫存檔（某些模型會先 `git diff > /tmp/xxx` 再用 Read 讀回）。
- `question: deny`：防止 reviewer 暫停等待使用者回答。

### 其他設計

- `mode: subagent`：只能透過 `--agent` 呼叫，不會出現在 TUI 的模型選單
- `steps: 50`：限制 agentic 迭代次數，防止 reviewer 因工具失敗而無限重試
- `edit: deny`：技術層面禁止修改任何檔案
- `bash: deny` + 白名單：只允許 git 唯讀指令和檔案檢視指令
- `cat`/`head`/`tail` 白名單：某些模型（特別是 Gemini）偏好用 bash 指令讀取檔案而非 Read tool，不加這些會導致 reviewer 卡住
- Bash pattern 是 glob matching，`git --no-pager*` 涵蓋 `git --no-pager log ...` 等

## 注意事項

- 修改 agent 定義後，執行 `npm run deploy opencode` 重新建立 symlink（或直接生效，因為是 symlink）
- 若 reviewer 仍然卡住，嘗試降低 `steps` 值（如 30）
- 若特定模型有額外的工具需求，在 bash 白名單中加入對應的指令 pattern

## 替代方案：ACP 模式

若 `run` 模式仍不穩定，可考慮改用 `opencode acp`（Agent Client Protocol）：

```bash
# ACP 使用 JSON-RPC over stdio，可精確控制超時
opencode acp --port 0 --cwd /path/to/code << 'EOF'
{"jsonrpc":"2.0","id":1,"method":"message","params":{"text":"review prompt here"}}
EOF
```

優點：IDE 級整合協定、結構化回應、可設定 pipe 級超時。
缺點：需要額外的 JSON-RPC client wrapper。
