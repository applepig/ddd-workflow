# Works — Shared Agent Runner

## 2026-05-07

### 規劃決策

- 決定採用 fs 層級 symlink，而不是 shell alias 或文件 alias。
- skill-local `scripts/` entrypoint 保留在各自 skill namespace 底下，符合 Agent Skills colocate 慣例。
- 共用 runner 實體檔放在 `ddd-workflow/scripts/agent-runner.sh`，由 `xreview-orchestrator.sh` / `work-orchestrator.sh` symlink 指向。
- mode 由 symlink invocation name 判斷；agent name 只作為參數，不作為 mode 判斷依據。
- 不新增全域 shared script namespace 作為主要入口，避免 `~/.config/opencode/skills/` 外多出另一套使用者需要理解的 script 路徑。
- 確認 `npm run build` 與 `npm run deploy` 分工：`build.js` 只轉換 agents 到 `dist/`；skills 由 `cli.js` 直接 symlink source tree。

### 待驗證

- source tree 內 relative symlink 部署到 Claude / Gemini / Codex / OpenCode 後是否全部可解析。
- `xreview-orchestrator.test.sh` 透過 symlink entrypoint 執行時，`BASH_SOURCE[0]` 對 `script_dir` 與 adapters path 的解析是否符合預期。
- `ddd.work` 是否改成一次呼叫 `work-orchestrator.sh --jobs-file`，或先只補齊 `opencode-worker.sh` skill-local symlink 後再演進 fan-out。

### M1 Red 測試結果

- 新增 `scripts/shared-agent-runner.test.js` 固定 shared runner M1 預期：skill-local symlink layout、`agent-runner.sh` invocation name / `--mode` dispatch、以及 `scripts/cli.js test` 對 skill-local script symlink 斷鏈的驗證。
- Red 驗證：`npx vitest run scripts/shared-agent-runner.test.js` 目前 9 個測試中 8 個失敗、1 個通過；失敗符合預期，原因是 `ddd-workflow/scripts/agent-runner.sh` 尚未建立、`ddd.xreview/scripts/xreview-orchestrator.sh` 尚未改為 symlink、`ddd.work/scripts/work-orchestrator.sh` 與 `ddd.work/scripts/opencode-worker.sh` 尚未建立，且 `scripts/cli.js test` 尚未實作 skill-local script symlink 檢查。
- Regression baseline：`bash ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.test.sh` 通過（148 passed, 0 failed）；`bash ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.test.sh` 通過（55 passed, 0 failed）。
- 現有 deploy/test baseline：`npm test` 通過，表示目前既有安裝/frontmatter 驗證仍維持綠燈；M1 新增的 CLI 驗證案例仍在 Vitest Red suite 中，等待 M5 實作整合進 `scripts/cli.js test`。

### M2 實作與測試結果

- 新增 `ddd-workflow/scripts/agent-runner.sh` 作為 shared runner 實體檔；支援 `xreview-orchestrator.sh` / `work-orchestrator.sh` invocation basename dispatch，以及 `agent-runner.sh --mode xreview|work` 明確指定 mode。
- 將 `ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.sh` 改為 symlink，指向 `../../../scripts/agent-runner.sh`；新增 `ddd-workflow/skills/ddd.work/scripts/work-orchestrator.sh` symlink，指向同一個 runner；新增 `ddd-workflow/skills/ddd.work/scripts/opencode-worker.sh` symlink，指向 `../../ddd.xreview/scripts/adapters/opencode.sh`。
- `xreview` mode 目前以搬移既有 orchestrator 內容的方式保持相容，並改用 shared runner 實體路徑解析 `ddd.xreview/scripts/adapters`，避免 symlink invocation 時 adapter path 解析到錯誤目錄。
- `work` mode 本階段僅完成 `--help` 與明確未實作回報；非 help 呼叫輸出 `FAIL orchestrator work_mode_not_implemented` 並 exit 2，完整 fan-out 留待 M4。
- 驗證：`npx vitest run scripts/shared-agent-runner.test.js` 目前 9 個測試中 8 個通過、1 個失敗；layout / dispatch 已轉綠，剩餘失敗為 `scripts/cli.js test` symlink 驗證尚未實作（M5 範圍）。
- Regression：`bash ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.test.sh` 通過（148 passed, 0 failed）；`bash ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.test.sh` 通過（55 passed, 0 failed）。

### M2 regression 修正

- 修正 `xreview-orchestrator.test.sh` 的 `assert_contains` / `assert_not_contains` helper：原本使用 `echo "$output" | grep -qF ...`，在 `set -o pipefail` 下若 `grep -q` 提早命中並關閉 pipe，`echo` 可能收到 SIGPIPE，導致 pipeline 狀態失敗；因此會出現輸出明明包含 `FAIL unknowncli:model exit_code=1`，assertion 卻判定失敗的假陰性。
- 調整為 `grep -qF ... <<< "$output"`，保持既有事件語意與 unknown CLI 測試內容不變，只修正 assertion 管線本身的不穩定性。
- 驗證：`bash ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.test.sh` 通過（148 passed, 0 failed）。
- 驗證：`npx vitest run scripts/shared-agent-runner.test.js` 維持 M2 預期（8 passed, 1 failed）；唯一失敗仍是 M5 才實作的 `scripts/cli.js test` symlink validation。
- 驗證：`bash ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.test.sh` 通過（55 passed, 0 failed）。

### M2 adapter test helper regression 修正

- 修正 `ddd-workflow/skills/ddd.xreview/scripts/adapters.test.common.sh` 的同型假陰性：`assert_contains` 原本同樣使用 `echo "$output" | grep -qF ...`，在 `set -o pipefail` 下會因 `grep -q` 提早關閉 pipe 造成 SIGPIPE，導致 opencode worker lifecycle output 明明包含 `[opencode-worker] DESCRIPTION test-desc` 仍被判定失敗。
- 同步修正 universal timeout helper 中檢查 `XREVIEW_ERROR: timed out` 的 `echo "$output" | grep -qF ...`，改為 here-string，避免同型 pipefail / SIGPIPE 問題。
- 未修改 production adapter 行為，也未放寬 opencode worker lifecycle 測試；僅修正測試 helper 的輸出包含判斷方式。
- 驗證：`bash ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.test.sh` 通過（55 passed, 0 failed）。
- 驗證：`bash ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.test.sh` 通過（148 passed, 0 failed）。
- 驗證：`npx vitest run scripts/shared-agent-runner.test.js` 維持 M2 預期（8 passed, 1 failed）；唯一失敗仍是 M5 才實作的 `scripts/cli.js test` symlink validation。

### M3 共用 fan-out helper refactor

- 在 `ddd-workflow/scripts/agent-runner.sh` 抽出共用 helper：mode detection 保持既有 `parse_runner_mode` / `infer_mode_from_invocation`；新增 runner / xreview script / adapter dir resolve helper、`make_run_id`、`get_xreview_timeout`、`slug_of`、xreview log/final/status path helper、event emit helper、stdin tmp prompt cleanup helper、以及 process group cleanup helper。
- 保留 xreview-specific prepare 在 `run_xreview` 內：stdin prompt 與 early trap、`xreview.json` reviewers fallback、alias resolve、dedup、adapter dir、`.final.txt` 與 blocking footer 語意都未合併成泛用 job parser，避免在 M4 work mode 前過度抽象。
- `RETURN / FAIL` 的 inline `setsid bash -c` body 仍保留局部 echo，而未改成外層 helper；原因是 subshell body 不會自動繼承 shell function，若改用 `export -f` 或再包一層 shared script 會增加 quoting 與環境相依風險，對 M3 行為相容性不利。
- stdout event stream 維持 `START / RETURN / FAIL / ALL_DONE`；新增 helper 僅封裝原本輸出文字，沒有新增非事件 stdout。blocking footer 仍只在 `ALL_DONE` 後輸出。
- 驗證：`bash ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.test.sh` 通過（148 passed, 0 failed）。
- 驗證：`bash ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.test.sh` 通過（55 passed, 0 failed）。
- 驗證：`npx vitest run scripts/shared-agent-runner.test.js` 維持 M3 預期（8 passed, 1 failed）；唯一失敗仍是 M5 才實作的 `scripts/cli.js test` symlink validation。

### M4 work orchestrator mode 實作

- 新增 `scripts/shared-agent-runner.test.js` 的 work mode mock worker 測試，涵蓋兩條 JSONL jobs 成功 fan-out、單一 worker 非 0 失敗不影響其他 job、以及 `DDD_WORK_TIMEOUT_SEC` 小 timeout 產生 `FAIL exit_code=124`。
- `work-orchestrator.sh --jobs-file <jsonl> --cwd <project-root>` 已實作 JSONL 解析；使用 `jq -c` 逐行讀取 job，支援 `id`、`description`、`prompt_file`、`agent`、`model`、`isolation`，並提供 `agent=ddd-developer`、`model=openai/gpt-5.5`、`isolation=` 預設值。
- 每條 worker job 會先建立 `/tmp/ddd-worker-<runid>-<slug>.log` 與 `/tmp/ddd-worker-<runid>-<slug>.result.txt`，runner stdout 只輸出 `START / RETURN / FAIL / ALL_DONE` job-level event；worker lifecycle stdout/stderr 皆被導入該 job log。
- 派發層使用 `setsid`、`timeout --foreground` 與 background job；單一 job timeout 或非 0 exit 只影響該 job event，主 runner 仍等待其他 job 並輸出 `ALL_DONE`。
- 測試新增 `DDD_AGENT_RUNNER_WORKER_SCRIPT` env override，讓 Vitest 指向 mock worker，避免呼叫真 opencode；production default 仍使用 `ddd-workflow/skills/ddd.work/scripts/opencode-worker.sh`。
- Coordinator result path 會先建立；runner 從 job log 擷取 `[opencode-worker] RESULT_FILE <worker-result>` 後複製內容到 coordinator result path。若 worker result 不存在、未輸出或空白，coordinator result path 仍保持存在且可為空，後續由 coordinator 依 `DONE:` / `FAIL:` content-layer 協議判定。
- Red 驗證：新增測試後先跑 `npx vitest run scripts/shared-agent-runner.test.js`，work mode 三個測試如預期因 `work_mode_not_implemented` 失敗；M5 CLI symlink validation 測試仍維持既有紅燈。
- Green 驗證：實作後 `npx vitest run scripts/shared-agent-runner.test.js` 為 11 passed、1 failed；唯一失敗仍是 M5 才做的 `scripts/cli.js test` symlink validation。
- Regression 驗證：`bash ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.test.sh` 通過（148 passed, 0 failed）；`bash ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.test.sh` 通過（55 passed, 0 failed）；`bash -n ddd-workflow/scripts/agent-runner.sh` 通過。

### M5 Deploy/test 整合

- `scripts/cli.js test` 新增 installed skill path 的 skill-local script symlink 驗證，涵蓋 `ddd.xreview/scripts/xreview-orchestrator.sh`、`ddd.work/scripts/work-orchestrator.sh` 與 `ddd.work/scripts/opencode-worker.sh`。
- 驗證邏輯為只讀檢查：若 installed skills 目錄不存在、script missing、不是 symlink、或 symlink target 解析後不等於 repo 內預期實體檔，test 會回傳 false 並讓 process exit 1；不會寫入或覆蓋使用者既有 config。
- relative symlink target 以 script 所在實體目錄解析，符合 deploy 將整個 skill 目錄 symlink 到各平台後，lstat installed script path 仍看到 source tree script symlink 的行為。
- `deploy` 行為維持不變：只處理 skills / agents / statusline / config；未新增 `~/.config/ddd-workflow/scripts` 主要入口，且 `npm run deploy` 顯示既有 `~/.config/ddd-workflow/xreview.json` 已存在時會保留使用者設定。
- `scripts/shared-agent-runner.test.js` 更新 M5 測試：fake HOME 缺少 installed skills 目錄會失敗；installed skill namespace 存在但 required scripts missing 也會失敗，避免因 M2 source tree 已完成而讓期待字串過時。
- 驗證：`npx vitest run scripts/shared-agent-runner.test.js` 通過（13 passed）。
- 驗證：`npm run build` 通過；`dist/` 仍只有 `codex/agents`、`gemini/agents`、`opencode/agents`。
- 驗證：`npm run deploy` 通過；四平台 skills namespace 重新 symlink 完成，未新增全域 shared scripts namespace。
- 驗證：`npm test` 通過；Claude / Gemini / Codex / OpenCode 皆看到三個 skill-local script symlink 並解析到預期 target。
- Regression 驗證：`bash ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.test.sh` 通過（148 passed, 0 failed）；`bash ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.test.sh` 通過（55 passed, 0 failed）。

### M6 Skill 文件更新與端到端驗收

- 更新 `ddd-workflow/skills/ddd.xreview/SKILL.md`：公開呼叫方式仍維持 `scripts/xreview-orchestrator.sh`，並補充該檔是 shared `agent-runner.sh` 的 skill-local symlink entrypoint；未修改 xreview event stream 與 `.final.txt` 驗證流程。
- 更新 `ddd-workflow/skills/ddd.work/SKILL.md`：平行模式 Phase 2 改為建立 jobs-file JSONL，透過 `work-orchestrator.sh --jobs-file <jsonl> --cwd <project-root>` 單一 Monitor 一次派多條 worker；補充 JSONL 欄位 `id`、`description`、`prompt_file`、`agent`、`model`、`isolation`。
- 文件明確區分 runner stdout 與 worker lifecycle：`work-orchestrator.sh` stdout 僅輸出 job-level `START / RETURN / FAIL / ALL_DONE`；底層 `opencode-worker.sh` lifecycle 事件進各 job log。Coordinator 從事件取得 log/result path，讀 result path 解析 `DONE:` / `FAIL:`；空白或缺少協議行視為 content-layer fail。
- 保留既有約束：worker 一律 worktree isolation、worker 不 commit、coordinator 逐一 merge worker 分支並在每次 merge 後驗收測試，commit 仍需使用者確認。
- 更新 `ddd-workflow/skills/ddd.xreview/references/orchestrator-internals.md`：補上 shared runner mode、symlink layout，以及 `xreview-orchestrator.sh` / `work-orchestrator.sh` 皆 symlink 到 `ddd-workflow/scripts/agent-runner.sh`，mode 由 invocation basename 或 `--mode` 決定。
- M6 未變更 runner production 行為；只更新 skill 文件與 sprint 文件。
- 驗證：`npx vitest run scripts/shared-agent-runner.test.js` 通過（13 passed）。
- 驗證：`npm test` 通過；Claude / Gemini / Codex / OpenCode skill-local script symlink 驗證全綠。
- 驗證：`bash ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.test.sh` 通過（148 passed, 0 failed），確認 mock xreview `RETURN` 與 `.final.txt` 行為維持不變。
- 驗證：`bash ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.test.sh` 通過（55 passed, 0 failed）。
- 驗證：`bash -n ddd-workflow/scripts/agent-runner.sh` 通過。
