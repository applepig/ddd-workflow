# 進階除錯工具

範例同樣省略 `--session <name>`，實際使用時每個指令都要帶。

## 錄製操作過程

需要 `ffmpeg`（`agent-browser doctor` 會檢查）；輸出路徑要帶副檔名（`.webm` 或 `.mp4`）。

```bash
# 先啟動 browser session，再開始錄影（預設 30 fps，--fps 可設 1–60）
agent-browser open http://localhost:3000/form
agent-browser record start ./debug-session.webm --cursor

# 執行操作...
agent-browser snapshot -i
agent-browser fill @e1 "test"
agent-browser click @e3

# 停止錄影
agent-browser record stop
```

`--contact-sheet` 會另存一張帶時間戳的視覺變化摘要 PNG，比整段影片更適合貼進回報。

## Chrome DevTools Trace

```bash
# 開始 trace（記錄每一步的 DOM 快照、網路請求、console）
agent-browser trace start

# 執行操作...

# 停止並儲存
agent-browser trace stop ./debug-trace.json

# 用 Chrome DevTools Performance 或 Perfetto 分析
```

## 效能分析

```bash
agent-browser profiler start
# 執行操作...
agent-browser profiler stop profile.json

# Core Web Vitals（LCP／CLS／TTFB／FCP／INP），任何框架都能用
agent-browser vitals http://localhost:3000/page --json
```

## 無障礙稽核

用 axe-core 跑 WCAG 檢查，列出違規元素的 selector 與修正建議：

```bash
agent-browser a11y
agent-browser a11y --selector "#main" --tags wcag2a,wcag2aa
```

## HAR 錄製

需要完整的 request／response（含 body）時，用 HAR 取代 `network requests`：

```bash
agent-browser network har start
# 執行操作...
agent-browser network har stop ./debug.har
```

HAR 預設內嵌文字 response body，可能含 token 或個資；不要提交進 repo 或貼進對話。

## 元素高亮（headed 模式）

```bash
# 用視覺化方式確認元素位置
agent-browser --headed open http://localhost:3000/page
agent-browser snapshot -i
agent-browser highlight @e3
```
