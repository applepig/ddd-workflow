---
name: ddd.work
description: >
  TDD 開發執行：以 Red → Green → Refactor 循環實作 spec.md Milestones 或 tasks.md 中的任務。
  遇到 🔀 平行工作線時自動切換 coordinator 模式，派發 opencode worker 平行開發。
  Trigger: "start implementing", "begin development", "let's code", "do TDD",
  "開始實作", "開始寫", "動工", /ddd.work。
  spec.md 已確認、且必要的 tasks.md（若有）也確認後，準備寫程式碼時使用。
---

# ddd.work — 開發執行

開發執行階段。以 TDD 循環逐一完成任務來源中的 milestone。任務來源優先使用 `tasks.md`（若存在且已確認），否則使用 `spec.md` 的 Milestones。

不指定 milestone 編號時，從第一個未完成的 milestone 開始。

## 模式判定

讀取當前 milestone 時，根據任務來源結構判定執行模式：

- **序列模式**：milestone 內沒有 `🔀 可平行工作線` → 主行程逐一執行 TDD 循環
- **平行模式**：milestone 內有 `🔀 可平行工作線` → 切換為 coordinator，派發 opencode worker

---

## Host Routing 與預設 worker

進入平行模式時，已經代表 milestone 要派 agent；此處的決策點不是「要不要派 subagent」，而是依目前 host 能力選擇派工路徑。

在 Claude Code host（Monitor 可用）中，coordinator 透過 `work-orchestrator.sh --jobs-file <jsonl> --cwd <project-root>` 一次外包多條 OpenCode worker。`work-orchestrator.sh` 是 shared `agent-runner.sh` 的 skill-local symlink entrypoint；底層透過 `opencode-worker.sh` 跑 `opencode:openai/gpt-5.5`，並以 `--agent ddd-developer` 載入 worker 的 primary prompt。worker 在獨立的 git worktree 中工作，worker lifecycle 事件寫入各自 job log；runner stdout 只輸出 job-level `START / RETURN / FAIL / ALL_DONE` event stream 給 coordinator 解析。

OpenCode worker 內部若需要再拆更小的任務，可依 OpenCode 自身的 agent/subagent 能力派工；這屬於 worker 的自主執行策略，不由 coordinator 再選一次 agent。

## 序列模式：TDD 開發循環

適用於一般的線性 milestone。

### 每個 Milestone 的循環

1. **鎖定範圍**
   - 讀取任務來源（spec.md Milestones 或 tasks.md），確認當前 milestone 的所有 task
   - 讀取 spec.md 中對應的驗收條件

2. **TDD 開發循環（Red → Green → Refactor）**
   - **Red**：根據驗收條件撰寫測試案例（Vitest / Playwright）
   - **Green**：撰寫程式碼直到測試通過
   - **Refactor**：最佳化程式碼結構，確保測試維持通過

3. **Simplify**
   - 呼叫 `/simplify`（Claude Code 內建 skill，非 DDD skill）審查本次 git diff
   - 它會平行啟動 code reuse / code quality / efficiency 三個 review agent 並直接修正問題

4. **自我驗收**
   - 執行所有相關測試，確認全部通過
   - 執行 E2E 驗證（若任務來源有標註驗證方式，依其步驟執行）
   - 檢查是否符合 spec 中的驗收條件

5. **更新文件**
   - 任務來源：勾選已完成的 task（`- [x]`）
   - `works.md`：記錄本次 milestone 的技術決策與問題解決

6. **回報使用者**
   - 展示完成的功能與測試結果
   - **等待使用者確認後才 commit**
   - 嚴禁自動提交，測試通過不等於提交授權

7. **提交**
   - 使用者同意後，執行 git commit（Conventional Commits 格式）
   - 繼續下一個 milestone，或全部完成時結束

---

## 平行模式：Coordinator 派發

適用於 milestone 內包含 `🔀 可平行工作線` 的情境。主行程作為 coordinator，將每條工作線依 host routing 派發給獨立 worker agent。

### Phase 1: 準備派發

1. **解析工作線**
   - 從 tasks.md 讀取所有 `[A]`、`[B]`… 工作線（平行模式必須使用獨立 tasks.md）
   - 確認每條線的範圍（檔案路徑）、依賴、驗證方式

2. **組裝 worker prompt**

   每個 worker 的 prompt 必須讓 worker **不需要自行探索就能理解任務**——worker 無法回問 coordinator。
   Coordinator 負責提供摘要和關鍵片段，不是 raw dump 整個檔案。Worker 有 tool access 可以讀取完整檔案來執行實作，但不應需要靠探索來理解「要做什麼」。

   prompt 包含：

   ```
   ## 整體目標
   （從 spec.md 摘要本 milestone 的目標）

   ## 你的工作線：[X] <標題>
   （從 tasks.md 複製該工作線的完整內容，含所有 task）

   ## 檔案範圍
   （列出本工作線涉及的所有檔案/目錄路徑）

   ## 介面契約
   （從 tasks.md 的 blockquote 複製介面定義）

   ## 關鍵上下文
   （Coordinator 摘要的關鍵程式碼片段：函式簽名、型別定義、相關邏輯。
     不要 raw dump 整個檔案——貼介面定義和關鍵片段就好。
     涉及的完整檔案路徑列在「參考檔案」供 worker 按需讀取。）

   ## 參考檔案
   （列出 worker 實作時可能需要讀取的完整檔案路徑，作為 fallback。
     Worker 可用 Read tool 按需讀取，不必全部事先貼入。）
   - `docs/<編號>-<名稱>/spec.md`
   - `docs/<編號>-<名稱>/tasks.md`（若存在）
   - （其他相關的 source files）

   ## 專案慣例
   - 語言/框架：（從 TECHSTACK.md 或 AGENTS.md 摘要）
   - 命名慣例：（從 AGENTS.md Coding Style 摘要）
   - 測試框架：（Vitest / Playwright）

   ## E2E 驗證食譜
   （若工作線有標註驗證方式，複製過來；否則寫「僅 unit test」）

   ## Worker 完成協議
   完成實作後，依序執行：
   1. **Unit test** — 執行測試套件，**輸出完整執行結果**（如 `Tests: 19, Assertions: 130`）
   2. **測試全過** → 繼續下一步
   3. **測試失敗** → 嘗試修復（最多 3 次），仍失敗則輸出 `FAIL: <失敗的測試 + 原因>`
   4. **E2E 驗證** — 依上方食譜執行端對端驗證；標註「僅 unit test」則跳過
   5. **回報（不 commit）** — 在最後一則訊息輸出：`DONE: <一句話摘要>（測試結果：X passed, Y failed）`；若失敗則輸出 `FAIL: <原因>`
      - 你的最後一則訊息會被 worker runner 寫入 `RESULT_FILE`，coordinator 從這裡解析 DONE / FAIL
      - **沒有測試執行結果的 DONE 會被 coordinator 退回**
      - **Worker 不得自行 commit**——commit 由 coordinator merge 後、經使用者確認才執行
   ```

3. **確認派發計畫**
   - 向使用者展示即將派發的工作線清單與 worker 數量
   - 使用 `AskUserQuestion` 確認是否開始派發

### Phase 2: 派發 Worker

收到使用者確認後，用一個 jobs-file JSONL 描述所有工作線，並用單一 `work-orchestrator.sh` Monitor 一次派發多條 worker：

1. 把組裝好的 worker prompt 寫進 mktemp 暫存檔（一條工作線一份），避免 shell escape 問題：

   ```bash
   prompt_file_a=$(mktemp /tmp/ddd-worker-A-XXXXXX.md)
   cat > "$prompt_file_a" << 'WORKER_EOF'
   <上面組裝好的 worker prompt>
   WORKER_EOF
   ```

2. 建立 jobs-file JSONL。每行一個 worker job，欄位如下：

   | 欄位 | 說明 |
   |------|------|
   | `id` | 工作線 ID，如 `A`、`B` |
   | `description` | 工作線描述，會傳給底層 worker 並用於 worktree slug |
   | `prompt_file` | 該 worker prompt 暫存檔絕對路徑 |
   | `agent` | OpenCode agent name；外層以 `--agent` 載入為 worker primary prompt，預設 `ddd-developer` |
   | `model` | worker model，預設 `openai/gpt-5.5` |
   | `isolation` | 隔離模式；平行工作線一律使用 `worktree` |

   ```bash
   jobs_file=$(mktemp /tmp/ddd-worker-jobs-XXXXXX.jsonl)
   cat > "$jobs_file" << JOBS_EOF
   {"id":"A","description":"[A] Backend API","prompt_file":"$prompt_file_a","agent":"ddd-developer","model":"openai/gpt-5.5","isolation":"worktree"}
   {"id":"B","description":"[B] Frontend Form","prompt_file":"$prompt_file_b","agent":"ddd-developer","model":"openai/gpt-5.5","isolation":"worktree"}
   JOBS_EOF
   ```

3. 開一個 Monitor 執行 work orchestrator：

   ```
   Monitor({
     command: "bash <skill-dir>/scripts/work-orchestrator.sh \
       --jobs-file $jobs_file \
       --cwd $project_root; rc=$?; rm -f $jobs_file $prompt_file_a $prompt_file_b; exit $rc",
     timeout_ms: 7200000,
     persistent: false,
     description: "ddd.work 平行派多條 worker"
   })
   ```

> **Worktree 路徑**：`opencode-worker.sh --isolation worktree` 自動建在 `$PROJECT_ROOT/.worktree/opencode/<slug>/`，分支名為 `opencode/<slug>`，符合 AGENTS.md 的 `.worktree/` 約定。`<slug>` 從 `--description` 衍生。

> **Worker runner 的 lifecycle 事件**：底層 `opencode-worker.sh` 仍會輸出 `[opencode-worker] DESCRIPTION ...`、`SUBAGENT_TYPE ...`、`MODEL ...`、`CWD ...`、`LOG_FILE <path>`、`RESULT_FILE <path>`、（必要時）`WORKTREE_CREATED` / `WORKTREE_REUSED`、`ERROR ...`、`WARN downstream_pipeline_failed ...`、`NDJSON_RAW <path>`，以 `DONE exit=<N>` 收尾；但這些 lifecycle 事件會進入該 worker 的 job log，不直接出現在 orchestrator stdout。

> **Orchestrator event stream**：runner stdout 只輸出 job-level event：`START <id> <log-path> <result-path>`、`RETURN <id> <log-path> <result-path>`、`FAIL <id> exit_code=<n> log=<log-path> result=<result-path>`、`ALL_DONE`。Coordinator 從 `START / RETURN / FAIL` 取得 log/result path；收到 `RETURN` 或 `FAIL` 後讀取 `<result-path>`，解析 worker 最後輸出的 `DONE:` / `FAIL:`。Process exit 0 只代表 transport 成功，若 result path 空白或沒有 `DONE:` / `FAIL:`，一律視為 content-layer fail。

派發完畢後，立即輸出狀態表：

```markdown
| # | 工作線 | 狀態 | 結果 |
|---|--------|------|------|
| A | Backend API | ⏳ 執行中 | — |
| B | Frontend Form | ⏳ 執行中 | — |
```

### Phase 3: 追蹤與匯合

1. **追蹤進度**
   - `work-orchestrator.sh` 會為每條 worker 吐出 `START`，完成時吐 `RETURN` 或 `FAIL`，最後以 `ALL_DONE` 收斂
   - 從 `START / RETURN / FAIL` 事件取得 `<log-path>` 與 `<result-path>`；收到 `RETURN` / `FAIL` 後讀取 result path，取得 worker 最後輸出
   - 解析 worker 文字回報中的 `DONE:` / `FAIL:` 行（含測試結果摘要）
   - 更新狀態表（✅ 完成 / ❌ 失敗）
   - 若 job log 內同時看到 `WARN downstream_pipeline_failed` + `NDJSON_RAW <path>`，代表 worker runner 的下游 pipeline 失敗（schema drift 等），保留下來的 `NDJSON_RAW` 是事後追查用的原始 ndjson；視為 worker 失敗處理

2. **處理失敗**
   - 若 worker 失敗、退出碼非 0、result path 空白、或 result path 沒有 `DONE:` / `FAIL:`，顯示失敗原因（含 result path 摘要、必要時附 log path）
   - 使用 `AskUserQuestion` 詢問使用者：重試 / 手動修復 / 跳過

3. **匯合（🔗 匯合點）**

   所有 worker 完成後，在主線**逐一**執行匯合：

   - **逐一 merge**：每次合併一條 worker 的 worktree 分支（`opencode/<slug>`）到主分支
   - **每次 merge 後跑測試**：確認合併沒有破壞既有功能，發現問題立即修復再繼續下一條
   - 解決合併衝突（若有）
   - 全部 merge 完成後，執行 `🔗 匯合點` 中的整合測試 task（依標準 TDD 循環）
   - 呼叫 `/simplify` 審查合併後的完整變更

4. **更新文件**
   - `tasks.md`：勾選所有已完成的 task（含各工作線 + 匯合點）
   - `works.md`：記錄平行派發的決策、各 worker 結果、合併過程

5. **回報與提交**
   - 展示最終狀態表與測試結果
   - 等待使用者確認後 commit

---

## 核心防呆限制 (Agentic Constraints)

這些限制的存在是因為 AI agent 在開發過程中容易走捷徑——每一條都是從實際失敗經驗中提煉出來的防線：

* **Red State Check**：寫完測試後必須先執行，**確認看到預期的測試失敗（Fail）**，才准進入實作階段。這能確保測試確實在驗證目標行為，而非寫了一個永遠通過的空殼測試。
* **No Logic Leaks**：嚴禁在撰寫測試的階段（Red）偷寫任何業務邏輯。測試階段只產出測試檔案。
* **No Test Modification**：在實作階段（Green），**絕對禁止修改測試檔案**來讓測試通過。如果測試寫錯了，回到 Red 階段修正。
* **Refactor Guard**：若重構導致原本通過的測試失敗，必須立即 **Undo（撤回）**，禁止在錯誤的基礎上疊加修補（打地鼠）。
* **Atomic Validation**：遇到測試報錯時，必須分析錯誤訊息，嚴禁盲目重試或猜測。
* **規格同步**：若發現規格有誤或需要變更，立即暫停開發，回到 `/ddd.spec` 更新規格。若變更影響獨立 tasks.md，也必須同步更新並確認。確認後，回到本 skill 從當前 milestone 重新鎖定範圍繼續。
* **日誌更新**：`works.md` 必須記錄技術決策，不可事後敷衍。
* **Worker 隔離**：所有派出的 worker 一律帶 `--isolation worktree`。Worker 在獨立的 worktree（`$PROJECT_ROOT/.worktree/opencode/<slug>/`）中工作、測試，但不得自行 commit；commit 由 coordinator merge 後、經使用者確認才執行，確保不會互相干擾或汙染主線。
* **Worker 自足性**：Worker prompt 必須符合上方 template 的自足性要求——「理解任務」的上下文在 prompt 中，「執行實作」的檔案透過 tool access 按需讀取。
* **Worker 測試紀律**：違反「Worker 完成協議」中的測試要求（未貼測試輸出、隱瞞失敗、跳過環境問題）一律視為 FAIL，coordinator 退回重做。
* **測試失敗透明化**：即使 worker 判斷失敗「不是本次變更造成的」，仍必須在回報中明確標註哪些測試失敗、失敗原因、以及為什麼認為與本次無關。Coordinator 會驗證這個判斷。
* **環境問題不是藉口**：測試環境有問題時（如 `ref is not defined`、容器未啟動），worker 必須嘗試修復或明確報 FAIL 說明環境障礙，不能跳過測試直接交卷。
* **Coordinator 驗收必跑測試**：每條 worker 分支 merge 回主線後，coordinator 必須立即執行該工作線的測試套件驗收，確認合併沒有破壞東西。不能只看 worker 的自述，也不能等全部 merge 完才一次驗證。

## 產出

- 通過測試的程式碼
- 更新後的任務來源（`spec.md` Milestones 或 `tasks.md`，勾選進度）
- 更新後的 `works.md`（開發日誌）
- Git commits

## 結束條件

所有 milestone 完成後，引導使用者執行 `/ddd.xreview`。
