# CLI Reference

## 部署前提

由 `npm run deploy` 自動部署 orchestrator script 與 skill 檔案到各 host。CLI 安裝與認證見 `cli-adapters.md`。

## 臨時指定模型清單

用 `--models` flag 覆蓋 config 的 reviewer 清單——逗號分隔、可重複，每個 spec 是短名或完整 `<cli>:<model>`：

```
--models opus,5.x,pro $review_prompt_file
--models g:pro,g:flash -            # prompt 從 stdin
```

`--models` 省略時改用 `~/.config/ddd-workflow/xreview.json` 的 `reviewers`。短名由該檔 `aliases` 定義；**alias key 不得含冒號**（`:` 是 `cli:model` 的保留分隔符，含冒號的 token 會被當成完整 spec 直接 passthrough 而非查表，例如 key 應用 `g-pro` 而非 `g:pro`）。`5.4` 保留給 `opencode:github-copilot/gpt-5.4` 等 Copilot fallback 或 legacy 用法。

完整 `<cli:model>` spec 會原樣傳給對應 adapter；短名只是捷徑，不是能力邊界。要針對特定 harness／模型測試時，直接傳完整 spec，例如 `opencode:openai/gpt-5.5` 與 `codex:gpt-5.5` 是不同 harness。

> prompt file 是唯一的位置參數（`-` 或省略＝從 stdin 讀）。舊的「prompt 後接一串位置 specs」形式仍相容，但 `--models` 較直覺、且同時給時 `--models` 優先。

查最新 model id 時先問各 harness CLI，再把查到的 model id 組成 `<cli:model>`：

| Harness | 查詢命令 | 傳給 runner 的格式 |
|---|---|---|
| Claude Code | `claude --help` | `claude:<model-or-alias>`，例如 `claude:opus` |
| Codex CLI | `codex debug models` | `codex:<model>`，例如 `codex:gpt-5.5` |
| OpenCode | `opencode models --refresh`，或 `opencode models openai --refresh` | `opencode:<provider/model>`，例如 `opencode:openai/gpt-5.5` |
| Antigravity | `agy models` | `agy:<model>`，例如 `agy:gemini-3.1-pro` |
| Gemini CLI | 無可靠查詢入口，且本 workflow 已 deprecated | 優先改用 `agy:<model>` |

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
--models agy:gemini-3.1-pro,claude:claude-opus-4-8,codex:gpt-5.5 $review_prompt_file
```

`agy:<model>` 為 pass-through（`resolve_spec` 原樣回傳），model id 用無空白形式（如 `agy:gemini-3.1-pro`、`agy:gemini-3.5-flash`；含空白的人類可讀名稱會 fail regex）。adapter 機制見 `cli-adapters.md` ## Antigravity CLI。

> **gemini deprecation note**：`gemini:<model>`（如 `gemini:gemini-2.5-pro`）仍可解析並 dispatch 到保留的 `gemini.sh` adapter，作為 escape hatch；但不再是預設 reviewer（ADR-4）。

## 冒煙測試單一 reviewer

要驗證某個 model／adapter 還活著（例如 CLI 改版、換模型、debug auth），**不必**組正式 review prompt。給 orchestrator 一個 trivial prompt 加 `--models <單一 spec>` 即可——給了 `--models` 就繞過 config，只跑那一個 reviewer：

```bash
echo "回覆恰好一行：SMOKE_OK" | XREVIEW_MODE=blocking \
  bash ~/.claude/skills/ddd.xreview/scripts/xreview-orchestrator.sh --models g-pro -
```

- `--models` 收短名（`g-pro`）或完整 `<cli>:<model>`（`agy:gemini-3.1-pro`）；prompt 用 `-`（或省略）從 stdin 讀。
- 判準：事件流出現 `RETURN <spec> <log> <final>`（非 `FAIL`）、且 `<final>` 檔非空，即代表該 adapter／model 通。adapter 仍會 prepend `ddd-reviewer` 角色，故輸出未必逐字是 `SMOKE_OK`，看 RETURN 與 final 非空即可。
- 直接呼叫底層 CLI（如 `agy -p`）能測 CLI 本身，但**測不到 adapter 的 sandbox／role-prepend／參數組裝**；要驗整條 xreview 路徑就走上面這條。

## 雙模式

Monitor mode（Claude Code）與 blocking mode（其他 host）走同一份 event schema、同一批 `.log`／`.final.txt` sidecar。差別只在 caller 是逐行收事件還是結束後一次拿完整 stdout。
