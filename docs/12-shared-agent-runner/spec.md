# Shared Agent Runner

## 目標

將 `ddd.xreview` 的 `xreview-orchestrator.sh` 與 `ddd.work` 的 opencode worker 派發流程整合到同一套可維護的 runner 架構，降低 shell process 管理、timeout、log/result 檔、event stream 的重複維護成本。

核心方向：

1. 保留每個 skill 自己 namespace 底下的 `scripts/` entrypoint，符合 Agent Skills 支援檔案 colocate 慣例。
2. 讓多個 entrypoint 在 fs 層級 symlink 到同一個實體 runner 檔案，由 symlink invocation name 決定 mode。
3. 不新增 `~/.config/opencode/skills/` 外部的共用 scripts namespace，避免打破 skill-local package 形狀。
4. 明確區分 `npm run build` 與 `npm run deploy`：`build.js` 只轉換 agents 到 `dist/`；skills 仍直接 symlink `ddd-workflow/skills` source tree。

## 非目標

- 不重寫成 TypeScript 或 ACP runner；`docs/10-xreview-typescript/` 是另一條較大演進線。
- 不改 `xreview.json` 的 reviewer / aliases 格式。
- 不改 reviewer / worker 的公開 prompt 協議：`ddd-reviewer` 的 final review、`ddd-developer` worker 的 `DONE:` / `FAIL:` 回報維持相容。
- 不讓 `ddd.work` 自動 merge worker 分支；merge 與驗收仍由 coordinator 逐一執行。
- 不把 shared runner 安裝到全域 `~/.config/ddd-workflow/scripts` 作為主要入口；可以做為未來 packaging 延伸，但本 sprint 不做。

## 背景

目前 repo 中有兩套相近但分散的機制：

- `ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.sh`：負責多 reviewer fan-out、`setsid`、timeout、cleanup、`START / RETURN / FAIL / ALL_DONE` event stream、`.log` / `.final.txt`。
- `ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.sh`：已用 symlink invocation name 支援兩種 mode，`opencode.sh` 為 reviewer adapter，`opencode-worker.sh` 為 `ddd.work` worker runner。
- `ddd-workflow/skills/ddd.work/SKILL.md` 已引用 `<skill-dir>/scripts/opencode-worker.sh`，但 source tree 目前沒有 `ddd.work/scripts/opencode-worker.sh` 這個 skill-local entrypoint。

部署面需特別注意：

- `npm run build` 只產生 `dist/{gemini,opencode,codex}/agents`，不產生 `dist/skills`。
- `npm run deploy` 對四個平台的 skills 都直接 symlink `ddd-workflow/skills` 到目標 config 目錄。
- 因此 skill 內部的 relative symlink 可以指回 repo source tree 的共用實體檔；部署後仍可解析。

## User Story

### Story 1：Skill maintainer 減少 shell 維護成本

作為 skill maintainer，
我想讓 xreview reviewer fan-out 和 ddd.work worker fan-out 共用 runner 的 process 管理能力，
以便 timeout、cleanup、event stream、log/result 檔格式修正時只需要改一處。

### Story 2：Coordinator 保持 skill-local script 路徑

作為 coordinator，
我想在 skill 文件中仍呼叫 `${CLAUDE_SKILL_DIR}/scripts/...` 或 `<skill-dir>/scripts/...`，
以便符合 Agent Skills colocate 慣例，也避免要求使用者記住全域共用 script 路徑。

### Story 3：Deploy maintainer 清楚區分 build 與 deploy

作為 deploy maintainer，
我想讓 `npm run deploy` 驗證 skill-local symlink 結構，
以便在 symlink 斷裂或 dist/source 行為不一致時及早發現。

## 驗收條件

- [ ] `ddd-workflow/scripts/agent-runner.sh` 成為 fan-out runner 的實體檔，支援以 symlink basename 決定 `xreview` / `work` mode。
- [ ] `ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.sh` 是 symlink，指向共用 runner 實體檔。
- [ ] `ddd-workflow/skills/ddd.work/scripts/work-orchestrator.sh` 是 symlink，指向同一個共用 runner 實體檔。
- [ ] `ddd-workflow/skills/ddd.work/scripts/opencode-worker.sh` 是 symlink，指向共用 opencode adapter / worker 實體檔。
- [ ] `xreview` mode 保持現有公開介面相容：`bash xreview-orchestrator.sh <prompt-file|-> [spec ...]`、event stream、blocking/streaming mode、`.log` / `.final.txt` 路徑語意不變。
- [ ] `work` mode 可接收多個 worker job，並以相同事件模型輸出每條 worker 的 `START / RETURN / FAIL / ALL_DONE`，每條 worker 產生獨立 log/result 檔。
- [ ] `opencode-worker.sh` worker mode 行為維持相容：worktree isolation、`LOG_FILE` / `RESULT_FILE`、`DONE exit=<N>`、`DONE:` / `FAIL:` result 解析協議不變。
- [ ] `npm run deploy` 後，Claude / Gemini / Codex / OpenCode 的 skill 目錄仍各自只有 `ddd.*` skill namespace；不新增全域 shared script namespace 作為主要入口。
- [ ] `npm test` 或新增測試能驗證 skill-local symlink 不斷鏈，且指向本 repo 內共用實體檔。
- [ ] 既有 `xreview-orchestrator.test.sh`、adapter tests 全數通過。

## 相關檔案

### 新增

- `ddd-workflow/scripts/agent-runner.sh`：共用 fan-out runner 實體檔。
- `ddd-workflow/skills/ddd.work/scripts/work-orchestrator.sh`：symlink entrypoint。
- `ddd-workflow/skills/ddd.work/scripts/opencode-worker.sh`：symlink entrypoint。
- `ddd-workflow/scripts/agent-runner.test.sh` 或對應測試：runner mode dispatch 與 symlink 驗證。

### 修改

- `ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.sh`：改為 symlink 到共用 runner。
- `ddd-workflow/skills/ddd.xreview/scripts/adapters/opencode.sh`：若需要，調整 worker mode 文件與相對路徑假設。
- `ddd-workflow/skills/ddd.work/SKILL.md`：派發方式從單條 `opencode-worker.sh` Monitor 調整為共用 work orchestrator，或保留單條 worker entrypoint 並補 symlink 說明。
- `ddd-workflow/skills/ddd.xreview/SKILL.md`：補充共用 runner / symlink entrypoint 說明，公開呼叫方式維持不變。
- `scripts/cli.js`：deploy/test 驗證 skill-local script symlink 狀態。
- `scripts/build.js`：只在註解或測試中釐清 `dist/` 不處理 skills；若無必要不改邏輯。

## 介面設計

### Symlink invocation mode

`agent-runner.sh` 透過 `basename "${BASH_SOURCE[0]}"` 或 `$0` 判斷 mode：

| Invocation name | Mode | 用途 |
| --- | --- | --- |
| `xreview-orchestrator.sh` | `xreview` | Cross review reviewer fan-out |
| `work-orchestrator.sh` | `work` | ddd.work worker fan-out |
| `agent-runner.sh` | explicit | 允許測試用 `--mode <mode>` 明確指定 |

`agent name` 只作為 runner 參數，不作為 mode 判斷依據。原因是 `ddd-reviewer` / `ddd-developer` 描述 persona，但不能完整表達 readonly/write permission、worktree、config alias、final/result 判讀等執行策略。

### xreview mode

維持現有公開介面：

```bash
bash <skill-dir>/scripts/xreview-orchestrator.sh <prompt-file|-> [spec ...]
```

行為要求：

- 不改 `XREVIEW_MODE`、`XREVIEW_TIMEOUT_SEC`、`xreview.json` 的語意。
- 不改 `START / RETURN / FAIL / ALL_DONE` event stream。
- 不改 `.final.txt` 作為 clean final message 的主要讀取入口。

### work mode

`work-orchestrator.sh` 負責一次派多條 worker job。最小介面可採用 job file，避免 shell quoting 問題：

```bash
bash <skill-dir>/scripts/work-orchestrator.sh --jobs-file <jsonl> --cwd <project-root>
```

每行 JSON 表示一條 worker：

```json
{"id":"A","description":"[A] Backend API","prompt_file":"/tmp/ddd-worker-A.md","agent":"ddd-developer","model":"openai/gpt-5.5","isolation":"worktree"}
```

事件流建議：

```text
START A <log-path> <result-path>
RETURN A <log-path> <result-path>
FAIL A exit_code=<n> log=<log-path> result=<result-path>
ALL_DONE
```

`work` mode 只負責 fan-out 與結果檔，worker 分支 merge、每次 merge 後測試、文件勾選仍由 coordinator 在主線執行。

## 邊界案例

### Case 1：Symlink 在 source tree 中斷裂

處理：`npm test` 應明確指出哪個 skill-local script 斷鏈，並標示期望 target。

### Case 2：透過真實檔名直接呼叫 `agent-runner.sh`

處理：要求帶 `--mode xreview|work`；未帶 mode 時輸出 usage 並 exit 2。

### Case 3：xreview mode 行為回歸

處理：保留既有 `xreview-orchestrator.test.sh` 作為 regression suite；重構期間先讓測試紅，再搬移邏輯。

### Case 4：work mode 某條 worker timeout

處理：該 worker emit `FAIL ... exit_code=124`，其他 worker 繼續等待；orchestrator 最後 emit `ALL_DONE`。

### Case 5：OpenCode worker result file 空白

處理：視為 worker content-layer fail；coordinator 不可只看 process exit 0，必須讀 `RESULT_FILE` 並解析 `DONE:` / `FAIL:`。

## ADR

### ADR-1：用 fs symlink，而不是 shell alias 或文件 alias

**決策**：skill-local entrypoint 檔案以 symlink 指向同一個實體 runner。

**原因**：

- 使用者與 skill 文件看到的仍是各自 namespace 底下的 `scripts/`。
- 實體程式碼只有一份，維護成本最低。
- `npm run deploy` 目前直接 symlink source `skills/`，可保留 symlink 解析能力。

**替代方案**：

- 全域 shared script 目錄：路徑穩定，但違反 skill-local package 直覺，也讓 `~/.config/opencode/skills` 外多一個必須理解的 namespace。
- copy 多份 script：最符合 package 獨立性，但維護成本回到多份同步。

### ADR-2：Mode 由 invocation name 判斷，不由 agent name 判斷

**決策**：`xreview-orchestrator.sh` / `work-orchestrator.sh` 的 basename 決定 mode；agent name 是 mode 內的參數。

**原因**：agent name 只描述 persona，不足以描述執行環境與安全策略。

### ADR-3：保留兩個 prepare 入口，共用 runner 核心

**決策**：`xreview` 與 `work` mode 可在同一實體檔內保留各自 prepare 函式，但共用 process fan-out、timeout、cleanup、event emit helper。

**原因**：兩者 prepare 差異明顯：xreview 有 config / alias / dedup；work 有 job list / worktree / result protocol。硬合併會讓 runner 變成難懂的萬用參數解析器。

### ADR-4：本 sprint 不改 build.js 產物模型

**決策**：不新增 `dist/skills`。skills 維持由 `cli.js` 直接 symlink source tree。

**原因**：目前跨平台 skill 格式一致，不需要 build 轉換；新增 `dist/skills` 會擴大 deploy 行為與測試範圍。
