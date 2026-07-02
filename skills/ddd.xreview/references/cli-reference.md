# CLI Reference

## 部署前提

由 `npm run deploy` 自動部署 orchestrator script 與 skill 檔案到各 host。CLI 安裝與認證見 `cli-adapters.md`。

## 臨時指定模型清單

在 orchestrator command 的 prompt file 後接位置參數，可覆蓋 config 的 reviewer 清單：

```
... $review_prompt_file opus 5.x pro; ...
```

支援短名（由 `~/.config/ddd-workflow/xreview.json` 的 `aliases` 定義）。`5.4` 保留給 `opencode:github-copilot/gpt-5.4` 等 Copilot fallback 或 legacy 用法。

### Alias 對照

| 短名 | 解析到的 spec | 走的 adapter |
|------|--------------|-------------|
| `opus` | `claude:claude-opus-*` | claude |
| `sonnet` | `claude:claude-sonnet-*` | claude |
| `haiku` | `claude:claude-haiku-*` | claude |
| `5.x` | `codex:gpt-5.x`（或 opencode 對應） | codex / opencode |
| `5-mini` | `codex:gpt-5-mini`（或 opencode 對應） | codex / opencode |
| `pro` | `agy:gemini-3.1-pro` | **agy（Antigravity）** |
| `flash` | `agy:gemini-3.5-flash` | **agy（Antigravity）** |

> sprint 26（ADR-4）起，`pro` / `flash` 改指 **`agy:<model>`**（Antigravity CLI），取代 runtime-availability 已壞掉的 gemini-cli。實際解析值以 `xreview.json` 的 `aliases` 為準。

### 完整 spec 與 `agy:<model>`

任何短名都可用 `<cli>:<model>` 完整 spec 明確指定並繞過 alias，例如：

```
... $review_prompt_file agy:gemini-3.1-pro claude:claude-opus-4-8 codex:gpt-5.5; ...
```

`agy:<model>` 為 pass-through（`resolve_spec` 原樣回傳），model id 用無空白形式（如 `agy:gemini-3.1-pro`、`agy:gemini-3.5-flash`；含空白的人類可讀名稱會 fail regex）。adapter 機制見 `cli-adapters.md` ## Antigravity CLI。

> **gemini deprecation note**：`gemini:<model>`（如 `gemini:gemini-2.5-pro`）仍可解析並 dispatch 到保留的 `gemini.sh` adapter，作為 escape hatch；但不再是預設 reviewer（ADR-4）。

## 雙模式

Monitor mode（Claude Code）與 blocking mode（其他 host）走同一份 event schema、同一批 `.log`／`.final.txt` sidecar。差別只在 caller 是逐行收事件還是結束後一次拿完整 stdout。
