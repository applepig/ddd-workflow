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

- [x] 用 `/ddd.xreview2` 對當前 sprint 變更跑一次實際 review（haiku/gpt-5-mini/gemini-3-flash，<3 分鐘完成）
- [x] 驗證事件流順序、log path 可讀、整合報告正確
- [x] 確認 Claude reviewer 透過 `claude -p --agent` 路徑也能正常產出
- [ ] 驗證 GPT 長 review（目標 >10 分鐘）不再被砍 — 第一輪用快速模型，未觸發 long review；待後續用 gpt-5.4 等慢模型再驗
- [x] works.md 記錄實戰結果（含 cross review findings）

## M4.5 修正（Cross Review 共識問題）

依使用者決策（2026-04-13）：全部修正 + opencode runner agent 名整合。

### P1 — Cleanup PGID + grace period（必修）

- [x] `ddd.xreview2/scripts/xreview-orchestrator.sh`：spawn 子 shell 改用 `setsid` 隔離 process group
- [x] `cleanup()` 改為：取 pgid → `kill -TERM -- -$pgid` → grace period（~2 秒）→ `kill -KILL -- -$pgid`
- [x] 修正 comment 描述（之前 comment 說「kill process group」但實作是 kill PID，誤導）
- [x] **意外發現並修正**：`timeout` 預設會把 child 放新 PGID，破壞 setsid 隔離；改用 `timeout --foreground` 才能讓 PGID 結構保留

### P2 — Cleanup 整合測試（必修）

- [x] `xreview-orchestrator.test.sh` 新增 case：spawn 長 sleep mock → SIGTERM orchestrator → 用 `pgrep` / `ps` 驗證 mock 已被清除
- [x] 測試 SIGINT（Ctrl-C 模擬）行為
- [x] 文件中說明 SIGKILL 不可 trap 的本質限制（works.md 已記、SKILL.md 補一行、orchestrator/test 檔頭 comment 也標）

### P3 — SKILL.md 改善（應修）

- [x] 新增 `ddd.xreview2/scripts/run-orchestrator.sh` wrapper：接收 prompt file + specs，內部 exec orchestrator
- [x] `SKILL.md` 步驟 3 改為呼叫 wrapper（避免 Monitor JSON 內 quoting）
- [x] `SKILL.md` 步驟 4 補「沒收到 ALL_DONE 怎麼辦」fallback 描述（用 stream-end notification 兜底）
- [x] `SKILL.md` 步驟 4 加事件收集 pseudo-code（events_map → 等 ALL_DONE 或 stream-end → for each DONE Read log）

### P4 — 防禦性小修補（可選但一起做）

- [x] runid 加 `${RANDOM}`：`runid="$$-$(date +%s)-${RANDOM}"`
- [x] cli regex 驗證：`^[a-z0-9_-]+$`，model regex：`^[A-Za-z0-9._/:-]+$`，不符合 emit FAIL

### Pre-existing — opencode runner agent 名整合

- [x] `scripts/build.js`：在 `AGENT_OVERRIDES['ddd-reviewer'].opencode` 加 `name: 'ddd.xreviewer'`
- [x] `scripts/build.js`：file output naming 用 override.name 優先（若有），輸出 `dist/opencode/agents/ddd.xreviewer.md`
- [x] `scripts/build.test.js`：補測 override.name 生效（5 個新 case）
- [x] `npm run build && npm run deploy && npm test` 驗證 opencode agent 名稱對齊
- [ ] 重跑一次 cross review 確認不再出現 `agent "ddd.xreviewer" not found`（留待下次 cross review 自然驗證）

## M4.6 第二輪 + 第三輪 cross review 修正

### 第二輪（commit 後 review 24751b2，sonnet only）

- [x] cleanup re-entry guard（`_cleanup_ran`）+ conditional sleep（pgids 非空才 sleep）
- [x] trap 改 `INT: cleanup; exit 130` / `TERM: cleanup; exit 143` / `EXIT: cleanup`（ALL_DONE 不再誤 emit）
- [x] 測試 poll helper 取代 fixed sleep
- [x] START 事件加 log path
- [x] 移除 dead code slug_of（變為真正被使用）

### 第三輪（review uncommitted 修正，opus + gpt-5.4）

- [x] Parent shell 預建 log 檔寫 meta header（`[xreview] START / log= / ---`），setsid body 改 `>>` append
- [x] Invalid spec 的 START/FAIL log path 一致（同一 /tmp 檔，內容為 `XREVIEW_ERROR: invalid spec format`）
- [x] Timeout 寫死 3000s，移除 `XREVIEW_PER_TIMEOUT` env var；orchestrator 傳給 runner
- [x] 補 external CLI dispatch 測試（opencode + gemini happy path，共 +7 asserts）
- [x] poll 失敗真 FAIL（移除 `|| true`，assert mock_pids count 精確等於 expected）
- [x] 移除 runner.sh 的 error grep heuristic（解決 review 正文含 Error 字樣被誤判為 CLI 失敗）
- [x] AGENTS.md「Cross Review 模型設定」段落更新舊敘事（orchestrator 統一派發 + 新增 Claude Reviewer 表格列）

測試：orchestrator 52/52、runner 21/21、npm test 全平台綠。

## M5 扶正（M4.5 通過後）

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
