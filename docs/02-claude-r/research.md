# claude-r 調研筆記

## 背景

claude-r 是用 tmux 管理多個 Claude Code session 的工具，核心功能：
- tmux detached session 管理（add / rm / ls / resume / restart / rename）
- Docker 風格 restart policy（always / on-failure / no）
- systemd daemon 定期 reconcile，自動重建掛掉的 session

## 問題發現（2026-03-28）

### 1. tmux 保活 ≠ session 可用

tmux 保住了 claude process，但 Claude Code 的 remote control 連線是另一回事。
session 跑了 6 天後：
- tmux session 活著、claude process 活著
- 但 remote control polling 連線已斷——claude.ai 顯示綠燈，訊息進不去
- 沒有 bridge-pointer.json 的 session 在 claude.ai 上完全不可見

**結論**：daemon 只看「tmux session 存不存在」不夠，需要檢查 Claude Code 本身的健康狀態。

### 2. daemon 嚴重 process leak

systemd `Restart=always` 不斷 fork 新 daemon，每個新 daemon 是獨立 process（不是取代舊的）。
unit file 被刪除後 orphan process 沒人收——累積到 **88 個 daemon process** 跑了 6 天。
每個 daemon 都在獨立 reconcile，所以 kill tmux session 會被瞬間重建。

**清理方式**：`pkill -f 'claude-r/main.ts daemon'` + `tmux kill-session`

### 3. Docker subnet 與 OpenVPN 衝突

OpenVPN server（Synology RT2600AC VPN Plus）使用 `172.22.0.0` 子網。
Docker 自動分配了 `172.22.0.0/16` 給 `test-final_app-network` bridge。
VPN client 拿到 `172.22.x.x` IP 後，回程封包被 Docker bridge 吃掉，無法到達 VPN tunnel。

**修復**：
1. 移除衝突的 Docker network：`docker network rm test-final_app-network`
2. 設定 `/etc/docker/daemon.json` 限制 Docker 自動分配範圍為 `10.22.0.0/16`（避開內網 `10.0.4.0/24` 和 VPN `172.22.0.0`）
3. 重啟 Docker，驗證所有 container 恢復

另外發現 VPN push 的 DNS 是 `192.168.1.1`（不存在的網段），正確應為 `10.0.4.1`（router），但 SRM UI 上找不到修改入口，API set 也因權限不足（error 114）無法修改。目前 VPN 連線已恢復正常，DNS 問題暫時擱置。

## 競品調研（2026-03-28）

### 同類工具：tmux session 管理器

| 專案 | 特色 |
|------|------|
| [claude-squad](https://github.com/smtg-ai/claude-squad) | 最熱門，支援多種 AI agent |
| [claude-tmux](https://github.com/nielsgroen/claude-tmux) | tmux popup + git worktree + PR 支援 |
| [claunch](https://github.com/0xkaz/claunch) | 按專案目錄管理，概念接近 claude-r |
| [claude-session-driver](https://github.com/obra/claude-session-driver) | 階層式：一個 session 當 PM 派工 |
| [Codeman](https://github.com/Ark0N/Codeman) | Web UI，20 個平行 session，systemd 支援 |
| [nexus-tui](https://github.com/markx3/nexus-tui) | TUI，按專案分組，即時 preview |
| [ccmanager](https://github.com/kbwo/ccmanager) | 支援 8+ 種 coding agent |

### Remote Control 衍生工具

Claude Code 2026/02 推出 Remote Control，2026/03 推出 Channels 和 Dispatch。

| 專案 | 特色 |
|------|------|
| [Claude-Code-Remote](https://github.com/JessyTsui/Claude-Code-Remote) | Email / Discord / Telegram 遠端控制 |
| [claude-conduit](https://github.com/A-Somniatore/claude-conduit) | ⚠️ 已封存。Mac daemon + React Native iOS，區網 WebSocket |
| [CloudeCode](https://github.com/Adoom666/CloudeCode) | Python FastAPI，auto-tunnel + pattern detection |
| [247-claude-code-remote](https://github.com/QuivrHQ/247-claude-code-remote) | Quivr 出品，Next.js + Cloudflare tunnel，PWA |
| [claude-code-desktop-remote](https://github.com/HLE-C0DE/claude-code-desktop-remote) | CDP 控制 Desktop App（非 CLI），PoC |

### claude-r 的差異化

- **宣告式 state + daemon reconcile**：多數工具是互動式管理
- **restart policy**：session 掛掉自動重建，官方和多數工具沒提供
- **systemd 整合**：server-side 無人值守場景

### 待解問題

- 官方 Remote Control / Channels / Dispatch 能否取代 tmux 作為 session 管理層？
- 如何偵測 Claude Code session 的健康狀態（不只是 process 存活）？
- daemon 需要 singleton 保證，避免重複 fork
