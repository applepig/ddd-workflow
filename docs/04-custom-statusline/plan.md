# Plan: Custom Status Line

## 背景 (Background)

目前使用 `ccstatusline`（第三方 npm 套件）作為 Claude Code 的 status line。雖然功能豐富（40+ widgets），但對我們的需求來說過於肥大——我們只需要固定的三行資訊，不需要 TUI 設定介面、不需要動態 widget 系統。

自己寫一個輕量的 Bash script，可以：
- 完全掌控顯示邏輯和色彩配置
- 零依賴（除了 `jq` 和 `git`）
- 啟動零延遲（相比 `npx` 每次下載/啟動 Node.js）
- 維護簡單，一個檔案搞定

## 粗略目標 (High-level Goals)

- 以 Bash + jq 寫一個 status line script，讀取 Claude Code 傳入的 StatusJSON（stdin），輸出 ANSI 格式化的三行文字
- 放在 `ddd-workflow/scripts/` 內，透過 `cli.js` deploy 流程建立 symlink
- 更新 `~/.claude/settings.json` 的 `statusLine.command` 指向新 script

## 三行布局設計

```
 Opus 4.6    ████████████████░░░░░░░░░  160k
 4h 30m      ███████████████░░░░░░░░░░  60%
 AGENTS      master  +12 -5
```

### Line 1：Model + Context Usage Bar

| 欄位 | 來源 | 說明 |
|------|------|------|
| Model | `model.id` | 從 ID 擷取短名（如 `opus-4-6` → `Opus 4.6`） |
| Context Bar | `context_window` | 25 格寬，非線性刻度（見下方） |
| 數值標籤 | 計算 | 顯示目前 token 數（如 `160k`） |

**Context Bar 色彩規則：**
- 0–200k：每格 = 10k，綠色（共 20 格）
- 200k–300k：每格 = 20k，橘色（共 5 格）
- ≥300k：整條 bar 變紅色（25 格全滿）

這是非線性刻度設計——常用區間（0–200k）佔 80% 的 bar 寬度，提供更高的解析度。

### Line 2：Block Reset Timer + Session Usage Bar

| 欄位 | 來源 | 說明 |
|------|------|------|
| Reset Timer | `rate_limits.five_hour.resets_at` | 倒數計時（如 `4h 30m`） |
| Session Bar | `rate_limits.five_hour.used_percentage` | 25 格寬，每格 = 4% |
| 數值標籤 | 同上 | 顯示百分比（如 `60%`） |

### Line 3：Working Dir + Git Branch + Diff Lines

| 欄位 | 來源 | 說明 |
|------|------|------|
| Working Dir | `cwd`（取最後一節） | 如 `/home/user/projects/AGENTS` → `AGENTS` |
| Git Branch | `git branch --show-current` | 目前分支名 |
| Diff Lines | `git diff --shortstat` | `+N -M` 格式 |

### 寬度對齊策略

Line 1 的 model 和 Line 2 的 timer 需要對齊，使後方的 bar 起始位置一致。

方案：兩者都 pad 到固定寬度（如 12 字元），右對齊 bar。Model 名最長為 `Sonnet 4.6`（10 字元），timer 最長為 `4h 59m`（6 字元），12 格綽綽有餘。

## 資料流

```
Claude Code → StatusJSON (stdin) → statusline.sh → parse with jq
                                                  → compute bars
                                                  → run git commands
                                                  → output ANSI text (stdout)
```

## 決策紀錄 (Decisions)

1. **Session usage bar 色彩** → 單色（cyan），讓視覺重心留給 context bar 的分段色彩
2. **Deploy 策略** → 擴充 cli.js，用 symlink 部署 `ddd-workflow/scripts/statusline.sh` → `~/.claude/scripts/statusline.sh`
3. **Bar 字元** → `█`（填滿）+ `░`（空白），經典 progress bar 風格
4. **Diff lines 來源** → `git diff --shortstat`，顯示 `+N -M` 行數 summary（ccstatusline 風格）
5. **settings.json 更新** → `statusLine.command` 改為 `bash ~/.claude/scripts/statusline.sh`

## 下一步 (Next Step)

方向已確認，直接進入 `/DDD.spec` 撰寫完整規格。
