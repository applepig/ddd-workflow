# Tasks — xreview Monitor Orchestrator

## M1 研究與驗證（Research） ✅

- [x] Monitor POC：用 Monitor 跑 `sleep 700 && echo "slept for 700s"`，驗證能撐過 Bash 10 分鐘 hard cap
- [x] Survey `claude -p` 的非互動模式介面：`--system-prompt` / `--allowed-tools` / `--agent` / `--output-format` 等參數行為
- [x] 實測 `claude -p --agent ddd-reviewer`，驗證可載入既有 agent 定義，沒被 permission 擋下
- [x] 整理結論寫進 works.md，ADR-4 採 (a) 分支：Claude 併入 orchestrator

## M2 Orchestrator 腳本 ✅

- [x] 撰寫 `ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.sh` 骨架（參數解析、prompt file 檢查、runid 產生）
- [x] 實作 fan-out 迴圈：對每個 `<cli:model>` fork 一個背景子程序
- [x] 實作事件流輸出：`START` / `DONE` / `FAIL` / `ALL_DONE`，每行一事件
- [x] 每個 reviewer 輸出導到獨立 log file（`/tmp/xreview-<runid>-<slug>.log`）
- [x] 實作 `trap cleanup EXIT INT TERM`：orchestrator 被中斷時清除所有子程序
- [x] 實作 claude:<model> 分支（`claude -p --agent ddd-reviewer --permission-mode plan`）
- [x] 撰寫單元測試 `xreview-orchestrator.test.sh`（24/24 pass）

## M3 Skill 與文件更新（採 fork 並存策略）

- [x] **改用 fork 並存**：複製 `ddd.xreview` → `ddd.xreview2`，新版用新派發，舊版保留
- [x] `ddd.xreview2/SKILL.md`：步驟 3 改為單一 Monitor 呼叫 orchestrator
- [x] `ddd.xreview2/SKILL.md`：description 限定 trigger 為 `/ddd.xreview2`，不搶舊版
- [x] `ddd.xreview2/SKILL.md`：步驟 4–6 對應事件流（DONE/FAIL log path → Read 整合）
- [x] 跨平台部署驗證：`npm run deploy && npm test` 通過（11 個 skills，含 ddd.xreview2）
- [x] `references/AGENTS.md`：Cross Review 模型設定表格移除「退化模型」欄位（M2 期間順手做）
- [x] `ddd.xreview/SKILL.md`：移除 fallback 段落（M2 期間順手做）
- [x] `references/cli-adapters.md`：微調「觸發退化」措辭

## M4 實戰驗證（並存階段）

- [ ] 用 `/ddd.xreview2` 對當前 sprint 變更（含 orchestrator + 文件包）跑一次實際 review
- [ ] 驗證事件流順序、log path 可讀、整合報告正確
- [ ] 驗證 GPT 長 review（目標 >10 分鐘）不再被砍
- [ ] 確認 Claude reviewer 透過 `claude -p --agent` 路徑也能正常產出
- [ ] works.md 記錄實戰結果與遇到的 pitfall

## M5 扶正（Validation 通過後）

- [ ] 將 `ddd.xreview2` 的內容覆蓋 `ddd.xreview`：
  ```bash
  rm -rf ddd-workflow/skills/ddd.xreview
  mv ddd-workflow/skills/ddd.xreview2 ddd-workflow/skills/ddd.xreview
  # 編輯 SKILL.md 把 name / trigger / 標題改回 ddd.xreview
  ```
- [ ] 移除 SKILL.md 開頭的「測試版」警語、恢復完整 trigger phrases
- [ ] `npm run deploy && npm test` 確認 11 個 skill（不再有 ddd.xreview2）
- [ ] works.md 記錄扶正完成

## Commit 計畫

- 階段 1（現在）：M1 + M2 + M3 一起 commit（docs/08 + orchestrator + tests + ddd.xreview2 + 順手清理）
- 階段 2（M4 通過後）：M4 結果寫進 works.md，commit
- 階段 3（M5）：扶正 commit

每個 commit 前由使用者確認。
