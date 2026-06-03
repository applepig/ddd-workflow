---
name: agent-browser
description: >
  Use when you need to interact with a web page in a browser — navigating URLs,
  clicking elements, filling forms, taking screenshots, reading page content,
  or running E2E-style smoke tests. Trigger phrases: "open the browser",
  "check the website", "take a screenshot", "test the UI", "browse to",
  "click the button", "fill the form", "snapshot the page".
---

# agent-browser — 瀏覽器自動化

透過 `agent-browser` CLI 操控 headless Chromium，用於頁面檢查、UI 測試、截圖等。

## 基本用法

所有指令都透過 Bash tool 執行 `agent-browser <command>`。

### 開啟頁面

```bash
agent-browser open <url>
```

- 本地自簽憑證網站加 `--ignore-https-errors`
- 需要看到瀏覽器視窗加 `--headed`

### 取得頁面結構（AI 最常用）

```bash
agent-browser snapshot          # 完整 accessibility tree（含 @ref）
agent-browser snapshot -i       # 只顯示可互動元素
agent-browser snapshot -c       # 精簡模式，移除空結構
agent-browser snapshot -i -c    # 精簡 + 只互動元素（推薦）
```

snapshot 會輸出帶有 `@ref`（如 `@e1`、`@e2`）的元素樹，後續指令可用 `@ref` 定位元素。

### 互動操作

```bash
agent-browser click @e2                    # 點擊（用 snapshot 的 ref）
agent-browser click "button.submit"        # 點擊（用 CSS selector）
agent-browser dblclick @e5                 # 雙擊
agent-browser type @e3 "Hello world"       # 在元素中輸入文字（追加）
agent-browser fill @e3 "Hello world"       # 清空後填入文字
agent-browser press Enter                  # 按鍵（Enter、Tab、Escape、Control+a）
agent-browser hover @e4                    # 滑鼠懸停
agent-browser check @e6                    # 勾選 checkbox
agent-browser uncheck @e6                  # 取消勾選
agent-browser select @e7 "option-value"    # 選擇下拉選項
agent-browser drag @e1 @e2                 # 拖放
agent-browser upload @e8 /path/to/file     # 上傳檔案
agent-browser scroll down 500              # 捲動（up/down/left/right + 像素）
agent-browser scrollintoview @e10          # 捲動到元素可見
```

### 取得資訊

```bash
agent-browser get text @e1       # 取得元素文字內容
agent-browser get html @e1       # 取得元素 HTML
agent-browser get value @e3      # 取得 input 的值
agent-browser get attr href @e2  # 取得屬性值
agent-browser get title          # 取得頁面標題
agent-browser get url            # 取得目前 URL
agent-browser get count "li"     # 計算符合 selector 的元素數量
```

### 檢查狀態

```bash
agent-browser is visible @e1     # 元素是否可見
agent-browser is enabled @e2     # 元素是否啟用
agent-browser is checked @e3     # checkbox 是否勾選
```

### 截圖與 PDF

```bash
agent-browser screenshot                   # 截圖（輸出路徑）
agent-browser screenshot /tmp/page.png     # 截圖到指定路徑
agent-browser screenshot --full            # 全頁截圖
agent-browser pdf /tmp/page.pdf            # 存成 PDF
```

截圖後可用 Read tool 查看圖片。

### 等待

```bash
agent-browser wait @e1           # 等待元素出現
agent-browser wait 2000          # 等待 2 秒
```

### 導航

```bash
agent-browser back               # 上一頁
agent-browser forward            # 下一頁
agent-browser reload             # 重新載入
```

### 找元素（用語意定位）

```bash
agent-browser find role button click --name "Submit"     # 找 role=button 且名為 Submit，然後點擊
agent-browser find text "Welcome" click                  # 找包含 "Welcome" 的文字，然後點擊
agent-browser find label "Email" fill "test@example.com" # 找 label 為 Email 的 input，填入值
agent-browser find placeholder "Search..." type "query"  # 找 placeholder 為 Search 的 input
```

### 分頁管理

```bash
agent-browser tab list           # 列出所有分頁
agent-browser tab new            # 開新分頁
agent-browser tab 2              # 切到第 2 個分頁
agent-browser tab close          # 關閉目前分頁
```

### 網路攔截

```bash
agent-browser network requests                    # 檢視網路請求
agent-browser network requests --filter "api"     # 篩選含 "api" 的請求
agent-browser network route "*/api/*" --abort      # 攔截並中斷特定請求
agent-browser network route "*/api/*" --body '{}' # 攔截並回傳假資料
agent-browser network unroute                      # 移除所有攔截
```

### Console 與錯誤

```bash
agent-browser console            # 檢視 console log
agent-browser errors             # 檢視頁面錯誤
```

### 瀏覽器設定

```bash
agent-browser set viewport 1280 720          # 設定視窗大小
agent-browser set device "iPhone 14"         # 模擬裝置
agent-browser set media dark                 # 深色模式
agent-browser set media light                # 淺色模式
agent-browser set offline on                 # 離線模式
```

### 執行 JavaScript

```bash
agent-browser eval "document.title"                          # 取得頁面標題
agent-browser eval "document.querySelectorAll('a').length"   # 計算連結數量
```

## 常用工作流

### 檢查頁面狀態

```bash
agent-browser open <url> --ignore-https-errors
agent-browser snapshot -i -c
# 閱讀 snapshot 輸出，了解頁面結構
agent-browser screenshot /tmp/check.png
# 用 Read tool 查看截圖
```

### 填寫表單並提交

```bash
agent-browser open <url> --ignore-https-errors
agent-browser snapshot -i -c
agent-browser fill @e3 "input value"
agent-browser click @e5                    # 點擊提交按鈕
agent-browser wait 2000
agent-browser snapshot -i -c               # 確認結果
```

### 測試 AI Chat 介面

```bash
agent-browser open https://aistudio.toybox.local/ --ignore-https-errors
agent-browser snapshot -i -c
agent-browser fill "<chat-input-selector>" "Hello, test message"
agent-browser press Enter
agent-browser wait 3000
agent-browser snapshot -c                  # 查看回應
```

## Session 管理

```bash
agent-browser --session mytest open <url>  # 用指定 session 名稱
agent-browser --session mytest snapshot    # 同 session 內操作
agent-browser session list                 # 列出所有 session
agent-browser close                        # 關閉瀏覽器
```

不同 session 之間完全隔離（各有獨立的 browser instance）。

## 注意事項

- 本專案使用自簽憑證，**一律加 `--ignore-https-errors`**
- 預設 headless 模式，不需要顯示器
- snapshot 的 `@ref` 會隨頁面變化，每次操作後建議重新 snapshot
- 截圖存到 `/tmp/` 後用 Read tool 查看
- 長時間不操作 browser 可能會被回收，需要重新 open
