---
name: 派工要 atomic + 依序
description: Sub-agent 派工時把工作切得 atomic 一點，依序完成而非一口氣大包派
type: feedback
originSessionId: c86afa16-07c7-44b8-90f0-59b3eae019ee
---
派工給 sub-agent 時，把任務切小、讓 agent 依序完成一個再開下一個，而不是一個 prompt 塞整批 milestone。

**Why**：2026-04-14 派 ddd-developer 一次包 M7.1 + M7.2 + M7.3（4 adapter 雙輸出 + orchestrator 重構 + 2 份 docs）後在中途 token 被吃光、任務中斷留下半完成狀態（90/90 tests + 116/121 tests + 文件未動 + cruft 檔）。大包派工的失敗 blast radius 遠大於原子任務。

**How to apply**：
- 一個 sub-agent 一次只做一個 milestone 或一個可獨立驗收的 chunk
- Chunk 劃界參考：測試能否全綠收尾、文件是否獨立、是否只動一組檔案
- 派工前先評估 context 需求，超過中等尺寸就拆
- 每個 chunk 結束 coordinator 驗收一次再派下一個，避免錯誤累積
