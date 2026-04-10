# 進階除錯工具

## 錄製操作過程

```bash
# 開始錄影
agent-browser record start debug-session.webm

# 執行操作...
agent-browser open http://localhost:3000/form
agent-browser snapshot -i
agent-browser fill @e1 "test"
agent-browser click @e3

# 停止錄影
agent-browser record stop
```

## Playwright Trace

```bash
# 開始 trace（記錄每一步的 DOM 快照、網路請求、console）
agent-browser trace start

# 執行操作...

# 停止並儲存
agent-browser trace stop debug-trace.zip

# 用 Playwright Trace Viewer 分析
npx playwright show-trace debug-trace.zip
```

## 效能分析

```bash
agent-browser profiler start
# 執行操作...
agent-browser profiler stop profile.json
```

## 元素高亮（headed 模式）

```bash
# 用視覺化方式確認元素位置
agent-browser --headed open http://localhost:3000/page
agent-browser snapshot -i
agent-browser highlight @e3
```
