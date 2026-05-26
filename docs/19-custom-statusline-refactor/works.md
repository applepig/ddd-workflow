# Works: Custom Statusline Refactor

## 2026-05-22

- 建立 `docs/19-custom-statusline-refactor/` 作為本次重構 SSOT，避免覆寫已完成的 `docs/04-custom-statusline/` 歷史規格。
- 探索現有檔案：`ddd-workflow/scripts/statusline.sh`、`ddd-workflow/scripts/opencode-codex-usage-status.tsx`、`ddd-workflow/scripts/opencode-codex-usage-capture.js`、`ddd-workflow/scripts/opencode-codex-usage-format.js`、`scripts/cli.js`、`ddd-workflow/config/opencode-tui.json`。
- 使用者修正需求：一開始的重點就是要 refactor 成 TypeScript；前版 spec 過度保守，錯誤地保留 Claude Bash 主體。
- 更新決策草案：採用 TypeScript-first 的 `ddd-workflow/custom-statusline/{shared,claude,opencode}` 子系統；Claude statusline 的 parsing、usage/cache、formatting、rendering 都應從 Bash 移到 TypeScript，Bash 只可作為極薄 wrapper 或移除。
- 注意事項：工作樹在規劃前已存在 `ddd-workflow/scripts/statusline.sh` 未提交變更，內容為新增 input log；後續實作需保留該變更並遷移到新路徑。
- 使用者否決前一版方向，指出 Claude statusline、OpenCode usage status、`session-trigger.mjs` 都近似「蒐集資料 → format → 顯示 / 決策」，且不同 provider / harness 的 log 與 cache 不應四散。
- 重新檢查 logger：`/tmp/claude/statusline-input.jsonl` 目前為 0 bytes；`/tmp/claude/statusline-invocations.log` 仍有 2026-05-22 新 invocation。使用者修正判斷：`statusline-input` 這條 raw logger 假設搞錯了，不能拿它代表 Claude Code 給了什麼 JSON；至少 invocation log 有效，能作為目前的觀察來源。
- 觀察 invocation log：同一個 Claude Code statusline harness 內出現 `model=codex,gpt-5.5-xhigh`、`model=claude-sonnet-4-6`、`model=claude-opus-4-6`。這確認資料模型必須拆分 `harness` 與 `provider/model`，不能把 Claude Code 直接等同 Anthropic。
- 第二版提案初稿曾改為 `ddd-workflow/session-usage/` 子系統：統一 collectors、normalizers、store、formatters、renderers / triggers；Claude statusline、OpenCode TUI、session-trigger 都是同一資料管線的不同 consumer。
- 使用者提醒前面已定下 `ddd-workflow/custom-statusline/` namespace，因此修正第二版提案：保留 `custom-statusline`，但內部採 shared usage pipeline；`session-trigger.mjs` 維持 `ddd-workflow/scripts/` entrypoint，只共用 `custom-statusline/shared` 與 collectors。
