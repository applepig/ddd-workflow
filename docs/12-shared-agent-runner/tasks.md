# Tasks — Shared Agent Runner

## M1：文件與測試先行

> 預期結果：共用 runner 的公開行為、symlink layout、deploy/test 驗證方式被測試固定。
> 驗證方式：新增測試先紅，既有 xreview / adapter tests 保持可執行。

- [x] Task 1.1：新增 runner symlink layout 測試，驗證 `ddd.xreview/scripts/xreview-orchestrator.sh`、`ddd.work/scripts/work-orchestrator.sh`、`ddd.work/scripts/opencode-worker.sh` 皆為 symlink，且指向 repo 內預期實體檔。（Red）
- [x] Task 1.2：新增 `agent-runner` mode dispatch 測試：以 `xreview-orchestrator.sh` 名稱呼叫時進 xreview mode，以 `work-orchestrator.sh` 名稱呼叫時進 work mode，以 `agent-runner.sh --mode` 可明確指定。（Red）
- [x] Task 1.3：補上 deploy/test 驗證案例，確保 `npm test` 能檢查 skill-local script symlink 不斷鏈。（Red）
- [x] Task 1.4：確認既有 `xreview-orchestrator.test.sh` 與 adapter tests 作為 regression suite，記錄目前 baseline。

---

## M2：建立共用 runner 實體檔與 symlink entrypoints

> 預期結果：xreview entrypoint 與 work entrypoint 在 fs 層級 symlink 到同一個 runner，OpenCode worker entrypoint symlink 到共用 opencode adapter。
> 驗證方式：M1 symlink 測試轉綠。

- [x] Task 2.1：新增 `ddd-workflow/scripts/agent-runner.sh` 實體檔，先包住現有 xreview 行為，支援 invocation name / `--mode` 解析。
- [x] Task 2.2：將 `ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.sh` 改為 symlink，指向 `../../../scripts/agent-runner.sh`。
- [x] Task 2.3：新增 `ddd-workflow/skills/ddd.work/scripts/work-orchestrator.sh` symlink，指向 `../../../scripts/agent-runner.sh`。
- [x] Task 2.4：新增 `ddd-workflow/skills/ddd.work/scripts/opencode-worker.sh` symlink，指向 `../../ddd.xreview/scripts/adapters/opencode.sh` 或共用 adapters 實體位置。
- [x] Task 2.5：跑 symlink layout 測試，確認部署前 source tree 形狀正確。

---

## M3：抽共用 fan-out helper，保持 xreview 行為相容

> 預期結果：`xreview` mode 行為與現有 orchestrator 相容，但 process 管理 helper 已可供 `work` mode 複用。
> 驗證方式：既有 xreview orchestrator tests 全綠。

- [x] Task 3.1：從現有 `xreview-orchestrator.sh` 抽出共用 helper：`slug_of`、tmp prompt cleanup、mode detection、timeout、PGID cleanup、event emit、blocking footer 基礎資料收集。
- [x] Task 3.2：保留 xreview-specific prepare：`xreview.json` 讀取、alias resolve、dedup、adapter dir、`.final.txt` 語意。
- [x] Task 3.3：確保 xreview mode 的 stdout event stream 不混入非事件行。
- [x] Task 3.4：跑 `bash ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.test.sh`，修正因 symlink path 造成的 fixture 路徑問題。
- [x] Task 3.5：跑 adapter tests，確認 `opencode.sh` reviewer mode 沒被 worker symlink 影響。

---

## M4：實作 ddd.work work orchestrator mode

> 預期結果：`work-orchestrator.sh` 可一次派多條 OpenCode worker，產生每條 worker 的 log/result 路徑與完成事件。
> 驗證方式：新增 mock opencode worker 測試全綠。

- [x] Task 4.1（Red）：新增 work mode jobs-file 測試，輸入兩條 JSONL job，預期輸出兩組 `START` 與兩組 `RETURN`，最後 `ALL_DONE`。
- [x] Task 4.2（Red）：新增 work mode failure 測試，mock worker 退出非 0，預期單條 `FAIL` 但其他 job 不受影響。
- [x] Task 4.3（Red）：新增 timeout 測試，mock worker sleep 超過 timeout，預期該 job `FAIL exit_code=124`。
- [x] Task 4.4（Green）：實作 `--jobs-file` 解析，最小依賴 `jq`，job 欄位含 `id`、`description`、`prompt_file`、`agent`、`model`、`isolation`。
- [x] Task 4.5（Green）：用共用 fan-out helper dispatch `opencode-worker.sh`，每條 job 產生獨立 log/result path。
- [x] Task 4.6（Green）：保留 OpenCode worker 原本 lifecycle event 到 worker log，runner stdout 只輸出 coordinator 需要的 job-level event。
- [x] Task 4.7：確認 `RESULT_FILE` 空白或沒有 `DONE:` / `FAIL:` 時，coordinator 文件要求視為 content-layer fail。

---

## M5：Deploy/test 整合

> 預期結果：`npm run deploy` 不新增全域 shared script namespace，`npm test` 能驗證 skill-local symlink 正常。
> 驗證方式：`npm run deploy`、`npm test`。

- [x] Task 5.1：更新 `scripts/cli.js` 的 test 階段，加入 skill-local script symlink 驗證。
- [x] Task 5.2：確認 deploy 階段仍只 symlink skills / agents / statusline，不新增 `~/.config/ddd-workflow/scripts` 主要入口。
- [x] Task 5.3：如需測試 helper，抽成只讀檢查，不覆蓋使用者既有 config。
- [x] Task 5.4：跑 `npm run build`，確認 `dist/` 仍只包含 agents 產物。
- [x] Task 5.5：跑 `npm run deploy`，確認四平台 skills 都能看到各自 namespace 底下的 script entrypoint。
- [x] Task 5.6：跑 `npm test`，確認 symlink + frontmatter +新增 script 驗證全綠。

---

## M6：Skill 文件更新與端到端驗收

> 預期結果：`ddd.xreview` 與 `ddd.work` 文件都指向 skill-local symlink entrypoint，並說明共用 runner 的邊界。
> 驗證方式：文件自查 + 小規模 mock / real smoke test。

- [x] Task 6.1：更新 `ddd.xreview/SKILL.md`，公開呼叫方式維持 `scripts/xreview-orchestrator.sh`，補充此檔為 shared runner symlink。
- [x] Task 6.2：更新 `ddd.work/SKILL.md`，將平行模式派發改為 `work-orchestrator.sh --jobs-file ...`，或明確保留單條 `opencode-worker.sh` 路徑並說明兩者角色。
- [x] Task 6.3：更新 `ddd.xreview/references/orchestrator-internals.md`，補上 shared runner mode 與 symlink layout。
- [x] Task 6.4：跑一次 xreview mock / small real smoke test，確認 `RETURN` 與 `.final.txt` 行為不變。
- [x] Task 6.5：跑一次 work mode mock smoke test，確認兩條 worker job 可並行完成。
- [x] Task 6.6：更新 `works.md`，記錄實作決策、測試結果、任何規格調整。

---

## 平行度決策

| Milestone | 平行度 | 理由 |
| --- | --- | --- |
| M1 | 序列 | 先固定共用介面與 symlink layout，避免後續實作漂移。 |
| M2 | 序列 | 改檔案 layout 與 symlink，需一次性完成避免半斷鏈。 |
| M3 | 序列 | xreview regression 風險高，先穩定既有行為。 |
| M4 | 序列 | 新 work mode 依賴 M3 helper；mock 測試可先紅再實作。 |
| M5 | 序列 | deploy/test 是全域入口，不適合平行改。 |
| M6 | 序列 | 文件需反映最終實作結果。 |

本 sprint 不標記 `🔀 可平行工作線`，因為核心風險在 shared shell entrypoint 與 deploy 行為，平行拆分會增加 symlink / path merge 成本。
