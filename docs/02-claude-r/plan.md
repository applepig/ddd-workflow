# claude-r：Claude Code Remote Session 生命週期管理器

## 背景

在 iPad（Terminus）透過 SSH 使用 Claude Code 時，斷線會導致 process 死亡。
需要一個工具在 tmux 背景啟動 Claude Code session，搭配 Remote Control 從瀏覽器操控。
但 Remote Control 不支援 `/exit`，需要從 host 端管理 session 生命週期。

## 目標

提供一個簡單的 CLI 工具管理 tmux 背景中的 Claude Code remote session。

## 非目標

- 不做 systemd service（保持簡單）
- 不做 auto-restart / health check（過度工程）
- 不管 Claude Code 內部狀態（只管 tmux 層）

## 架構

```
~/.local/bin/claude-r    # 單一 bash script
```

- 放在 `~/.local/bin/`，已在 PATH
- 單檔，不需額外依賴（只需 tmux）
- tmux session 命名規則：`claude-{safe_dir_name}-{timestamp}`

## Subcommands

### `claude-r` / `claude-r start`

在當前目錄啟動一個 Claude Code remote session。

```bash
claude-r              # 等同 claude-r start
claude-r start        # 明確寫法
```

行為：
1. 取得當前目錄名稱，escape 不安全字元（`.` `/` → `_`）
2. 產生 session 名稱：`claude-{safe_name}-{timestamp}`
3. `tmux new -d` 建立 detached session，設定工作目錄為 `$PWD`
4. 在 tmux 內執行 `claude --dangerously-skip-permissions --name "{dir_name}"`
5. 輸出 session 名稱供後續操作

### `claude-r ls`

列出所有 `claude-` 開頭的 tmux session。

```bash
claude-r ls
```

輸出格式：
```
SESSION NAME                        CREATED              STATUS
claude-my-project-1774118695        2026-03-22 02:45     running
claude-api-server-1774118800        2026-03-22 02:46     running
```

### `claude-r kill <name|all>`

砍掉指定或全部 claude remote session。

```bash
claude-r kill claude-my-project-1774118695   # 砍指定
claude-r kill all                            # 砍全部
```

### `claude-r attach <name>`

接上 tmux session（除錯用）。

```bash
claude-r attach claude-my-project-1774118695
```

接上後用 `Ctrl+B D` detach 離開。

## 實作細節

- 所有 session 用 `claude-` prefix，方便 `tmux ls | grep` 過濾
- `kill all` 只砍 `claude-` 開頭的 session，不影響其他 tmux session
- `ls` 如果沒有 tmux server 在跑，顯示 "No sessions." 而非 error
- 不合法的 subcommand 顯示 usage 說明
