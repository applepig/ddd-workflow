---
name: DDD.Work
description: >
  TDD 開發執行：以 Red → Green → Refactor 循環實作 tasks.md 中的任務。
  遇到 🔀 平行工作線時自動切換 coordinator 模式，派發 Agent 子行程平行開發。
  Trigger: "start implementing", "begin development", "let's code", "do TDD",
  "開始實作", "開始寫", "動工", /DDD.work。
  tasks.md 確認後、準備寫程式碼時使用。
---

# DDD:work — 開發執行

開發執行階段。以 TDD 循環逐一完成 tasks.md 中的 milestone。

不指定 milestone 編號時，從第一個未完成的 milestone 開始。

## 模式判定

讀取當前 milestone 時，根據結構判定執行模式：

- **序列模式**：milestone 內沒有 `🔀 可平行工作線` → 主行程逐一執行 TDD 循環
- **平行模式**：milestone 內有 `🔀 可平行工作線` → 切換為 coordinator，派發 Agent 子行程

---

## 模型選擇

派發 `ddd-developer` 時，預設使用 **Sonnet**。只在以下情境升級 **Opus**：
- 複雜的架構性邏輯（多模組交互、狀態機設計）
- 反覆除錯仍無法解決的問題
- 需要深度理解大量既有程式碼的重構

## 序列模式：TDD 開發循環

適用於一般的線性 milestone。

### 每個 Milestone 的循環

1. **鎖定範圍**
   - 讀取 tasks.md，確認當前 milestone 的所有 task
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
   - 執行 E2E 驗證（若 tasks.md 的工作線有標註驗證方式，依其步驟執行）
   - 檢查是否符合 spec 中的驗收條件

5. **更新文件**
   - `tasks.md`：勾選已完成的 task（`- [x]`）
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

適用於 milestone 內包含 `🔀 可平行工作線` 的情境。主行程作為 coordinator，將每條工作線派發給獨立 Agent。

### Phase 1: 準備派發

1. **解析工作線**
   - 從 tasks.md 讀取所有 `[A]`、`[B]`… 工作線
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
   - `docs/<編號>-<名稱>/tasks.md`
   - （其他相關的 source files）

   ## 專案慣例
   - 語言/框架：（從 TECHSTACK.md 或 AGENTS.md 摘要）
   - 命名慣例：（從 AGENTS.md Coding Style 摘要）
   - 測試框架：（Vitest / Playwright）

   ## E2E 驗證食譜
   （若工作線有標註驗證方式，複製過來；否則寫「僅 unit test」）

   ## Worker 完成協議
   完成實作後，依序執行：
   1. **Unit test** — 執行測試套件，**貼出完整執行結果**（如 `Tests: 19, Assertions: 130`）
   2. **測試全過** → 繼續下一步
   3. **測試失敗** → 嘗試修復（最多 3 次），仍失敗則報 `FAIL: <失敗的測試 + 原因>`
   4. **E2E 驗證** — 依上方食譜執行端對端驗證；標註「僅 unit test」則跳過
   5. **Simplify** — 呼叫 `Skill` tool，skill: "simplify"，審查你的變更
   6. **回報（不 commit）** — 最後一行輸出：`DONE: <一句話摘要>（測試結果：X passed, Y failed）`；若失敗則輸出 `FAIL: <原因>`
      - **沒有測試執行結果的 DONE 會被 coordinator 退回**
      - **Worker 不得自行 commit**——commit 由 coordinator merge 後、經使用者確認才執行
   ```

3. **確認派發計畫**
   - 向使用者展示即將派發的工作線清單與 worker 數量
   - 使用 `AskUserQuestion` 確認是否開始派發

### Phase 2: 派發 Worker

收到使用者確認後，**在同一個 message 中**派發所有 worker：

```
對每條工作線 [A], [B], [C]…：
  Agent tool:
    subagent_type: "ddd-developer"
    model: "sonnet"              # 預設用 Sonnet；複雜邏輯或除錯困難時才升級 Opus
    isolation: "worktree"
    run_in_background: true
    prompt: （上面組裝好的 worker prompt）
    description: "[X] <工作線標題>"
```

派發完畢後，立即輸出狀態表：

```markdown
| # | 工作線 | 狀態 | 結果 |
|---|--------|------|------|
| A | Backend API | ⏳ 執行中 | — |
| B | Frontend Form | ⏳ 執行中 | — |
```

### Phase 3: 追蹤與匯合

1. **追蹤進度**
   - 收到 worker 完成通知時，解析結果中的 `DONE:` 或 `FAIL:` 行
   - 更新狀態表（✅ 完成 / ❌ 失敗）

2. **處理失敗**
   - 若 worker 失敗，顯示失敗原因
   - 使用 `AskUserQuestion` 詢問使用者：重試 / 手動修復 / 跳過

3. **匯合（🔗 匯合點）**

   所有 worker 完成後，在主線**逐一**執行匯合：

   - **逐一 merge**：每次合併一條 worker 的 worktree 分支到主分支
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
* **規格同步**：若發現規格有誤或需要變更，立即暫停開發，回到 `/DDD.spec` 更新規格。Spec 更新確認後，回到本 skill 從當前 milestone 重新鎖定範圍繼續。
* **日誌更新**：`works.md` 必須記錄技術決策，不可事後敷衍。
* **Worker 隔離**：所有派出的 worker 一律使用 `isolation: "worktree"`。Worker 在獨立的 worktree 中工作、測試、commit，確保不會互相干擾或汙染主線。
* **Worker 自足性**：Worker prompt 必須符合上方 template 的自足性要求——「理解任務」的上下文在 prompt 中，「執行實作」的檔案透過 tool access 按需讀取。
* **Worker 測試紀律**：違反「Worker 完成協議」中的測試要求（未貼測試輸出、隱瞞失敗、跳過環境問題）一律視為 FAIL，coordinator 退回重做。
* **測試失敗透明化**：即使 worker 判斷失敗「不是本次變更造成的」，仍必須在回報中明確標註哪些測試失敗、失敗原因、以及為什麼認為與本次無關。Coordinator 會驗證這個判斷。
* **環境問題不是藉口**：測試環境有問題時（如 `ref is not defined`、容器未啟動），worker 必須嘗試修復或明確報 FAIL 說明環境障礙，不能跳過測試直接交卷。
* **Coordinator 驗收必跑測試**：每條 worker 分支 merge 回主線後，coordinator 必須立即執行該工作線的測試套件驗收，確認合併沒有破壞東西。不能只看 worker 的自述，也不能等全部 merge 完才一次驗證。

## 產出

- 通過測試的程式碼
- 更新後的 `tasks.md`（勾選進度）
- 更新後的 `works.md`（開發日誌）
- Git commits

## 結束條件

所有 milestone 完成後，引導使用者執行 `/DDD.xreview`。
