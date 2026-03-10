---
name: DDD.Work
description: >
  以 TDD 循環執行 tasks.md 中的開發任務——Red → Green → Refactor。
  遇到 🔀 平行工作線時，自動切換為 coordinator 模式，派發 Agent 子行程平行開發。
  Use when the user says "start implementing", "begin development", "work on
  the feature", "do TDD", "let's code", "implement this", or invokes "/DDD.work".
  Use after tasks.md is confirmed and it's time to write code.
---

# DDD:work — 開發執行

開發執行階段。以 TDD 循環逐一完成 tasks.md 中的 milestone。

不指定 milestone 編號時，從第一個未完成的 milestone 開始。

## 模式判定

讀取當前 milestone 時，根據結構判定執行模式：

- **序列模式**：milestone 內沒有 `🔀 可平行工作線` → 主行程逐一執行 TDD 循環
- **平行模式**：milestone 內有 `🔀 可平行工作線` → 切換為 coordinator，派發 Agent 子行程

---

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
   - 呼叫 `/simplify` skill 審查本次變更
   - 檢查是否有重複邏輯、過度設計、可簡化的抽象

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

   每個 worker 的 prompt 必須**完全自足**——worker 無法回問 coordinator。prompt 包含：

   ```
   ## 整體目標
   （從 spec.md 摘要本 milestone 的目標）

   ## 你的工作線：[X] <標題>
   （從 tasks.md 複製該工作線的完整內容，含所有 task）

   ## 檔案範圍
   （列出本工作線涉及的所有檔案/目錄路徑）

   ## 介面契約
   （從 tasks.md 的 blockquote 複製介面定義）

   ## 專案慣例
   - 語言/框架：（從 TECHSTACK.md 或 AGENTS.md 摘要）
   - 命名慣例：（從 AGENTS.md Coding Style 摘要）
   - 測試框架：（Vitest / Playwright）

   ## E2E 驗證食譜
   （若工作線有標註驗證方式，複製過來；否則寫「僅 unit test」）

   ## Worker 完成協議
   完成實作後，依序執行：
   1. **Simplify** — 呼叫 `Skill` tool，skill: "simplify"，審查你的變更
   2. **Unit test** — 執行測試套件，失敗則修復
   3. **E2E 驗證** — 依上方食譜執行端對端驗證；標註「僅 unit test」則跳過
   4. **Commit** — 用 Conventional Commits 格式 commit 所有變更
   5. **回報** — 最後一行輸出：`DONE: <一句話摘要>`；若失敗則輸出 `FAIL: <原因>`
   ```

3. **確認派發計畫**
   - 向使用者展示即將派發的工作線清單與 worker 數量
   - 使用 `AskUserQuestion` 確認是否開始派發

### Phase 2: 派發 Worker

收到使用者確認後，**在同一個 message 中**派發所有 worker：

```
對每條工作線 [A], [B], [C]…：
  Agent tool:
    subagent_type: "general-purpose"
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

   所有 worker 完成後，在主線執行匯合：

   - 合併各 worker 的 worktree 分支到主分支
   - 解決合併衝突（若有）
   - 執行 `🔗 匯合點` 中的整合測試 task（依標準 TDD 循環）
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
* **規格同步**：若發現規格有誤或需要變更，立即暫停開發，回到 `/DDD.spec`。
* **日誌更新**：`works.md` 必須記錄技術決策，不可事後敷衍。
* **Worker 自足性**：平行模式下，worker prompt 必須包含所有必要上下文。禁止仰賴 worker「自己去讀檔案找上下文」——coordinator 有責任提供完整資訊。

## 產出

- 通過測試的程式碼
- 更新後的 `tasks.md`（勾選進度）
- 更新後的 `works.md`（開發日誌）
- Git commits

## 結束條件

所有 milestone 完成後，引導使用者執行 `/DDD.xreview`。
