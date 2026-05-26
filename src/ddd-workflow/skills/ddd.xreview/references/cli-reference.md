# CLI Reference

## 部署前提

由 `npm run deploy` 自動部署 orchestrator script 與 skill 檔案到各 host。CLI 安裝與認證見 `cli-adapters.md`。

## 臨時指定模型清單

在 orchestrator command 的 prompt file 後接位置參數，可覆蓋 config 的 reviewer 清單：

```
... $review_prompt_file opus 5.x pro; ...
```

支援短名（由 `~/.config/ddd-workflow/xreview.json` 的 `aliases` 定義），預設：`opus`、`sonnet`、`haiku`、`5.x`、`5-mini`、`pro`、`flash`。`5.4` 保留給 `opencode:github-copilot/gpt-5.4` 等 Copilot fallback 或 legacy 用法。

## 雙模式

Monitor mode（Claude Code）與 blocking mode（其他 host）走同一份 event schema、同一批 `.log`／`.final.txt` sidecar。差別只在 caller 是逐行收事件還是結束後一次拿完整 stdout。
