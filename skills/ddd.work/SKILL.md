---
name: ddd.work
description: >
  TDD 開發執行：coordinator 逐 milestone 派 ddd-developer 以 Red → Green → Refactor 循環實作並驗收；
  遇到 🔀 平行工作線時同時派發多個 worker 分工。
  spec.md 已確認、準備寫程式碼時使用。
  Trigger: "start implementing", "begin development", "let's code", "do TDD",
  "開始實作", "開始寫", "動工", /ddd.work。
---

# ddd.work — 開發執行

開發執行階段。以 TDD 循環逐一完成 `spec.md` Milestones；不指定編號時，從第一個未完成的 milestone 開始。依 AGENTS.md「角色分工」，實作由 `ddd-developer` 執行；TDD 紀律與測試設計判準由 worker 的 agent definition 自帶，不在派工 prompt 重述。

## 派工 pipeline

每個 milestone 走同一條 pipeline，一次一個 milestone、驗收通過才派下一個——小包依序派工，worker context 才不會中途耗盡。唯一的變數是 worker 數量 **N**：milestone 沒有 `🔀 可平行工作線` 時 N=1；有 `🔀` 時 N=工作線數。

### 1. 鎖定範圍

- 讀 `spec.md`，確認當前 milestone 的範圍與驗收條件。
- N>1 的前置檢查：各工作線互不修改同一檔案、介面契約已在分線前確定。不滿足時併線改 N=1，或先用一個序列 task 確立介面。
- 工作線之間存在介面契約時，分線前的序列 task 要一併產出**可執行契約測試**（介面簽名＋spec 範例值的雙側斷言）：契約測試檔屬前置 task 的產出，不算入任何一線的檔案範圍，各線上下文卡片的「驗證」欄都含「契約測試綠」——接縫在兩線各自 DONE 之前就有人看守，而不是等匯合點才發現不一致。

### 2. 組 worker prompt

每個 worker prompt 要讓 worker 不需自行探索就能理解任務：coordinator 提供摘要與關鍵片段，完整檔案路徑列在「參考檔案」供按需讀取。N=1 時用不到的段落（工作線、介面契約）省略。

```markdown
## 整體目標
（從 spec.md 摘要本 milestone 的目標）

## 你的工作線：[X] <標題>
（複製該工作線的完整內容，含所有 task）

## 檔案範圍
（本工作線涉及的檔案/目錄路徑）

## 介面契約
（從工作線上下文卡片複製介面定義）

## 關鍵預期值
（從 spec 的 AC 範例值複製本任務相關的輸入→輸出範例；worker 斷言以此為準，不自行另訂）

## 關鍵上下文
（介面定義、函式簽名、型別定義與關鍵邏輯片段；不 raw dump 整個檔案）

## 參考檔案
- `docs/<編號>-<名稱>/spec.md`
- （其他相關 source files）

## 回報協議
依 ddd-developer 定義的完成協議回報：開工先列 deliverable checklist；完成後首行
`<STATUS>: <一句話摘要>（測試結果）`，附 Deliverable 對帳與未驗證清單。
```

**工作線上下文卡片（格式 SSOT）**：spec.md 內每條 `🔀` 工作線標題下的 blockquote 是 worker 的上下文卡片，coordinator 直接擷取它組裝 prompt。欄位：**範圍**（檔案／目錄路徑）、**依賴**（前置 task 或外部依賴）、**介面契約**（N>1 時必填）、**驗證**（完成後的驗證方式）。

### 3. 派發 1..N

- N>1 時，先為每條工作線自當前分支建立專屬分支，worktree 建在 `$PROJECT_ROOT/.worktree/<工作線分支名>/`（`.worktree` 加進 `.gitignore`；host 以 `Agent({ isolation: "worktree" })` 自建在 `.claude/worktree/*` 時視為可接受例外）——git 不允許同一分支同時 checkout 到兩個 worktree。worker 只在自己的 worktree 內工作，完成後以分支保留、由 coordinator 合併。host 不支援平行派發或 worktree 時，改 N=1 依序派發並明講。
- 派發是例行下一步，不是決策點；只有派發計畫會改變 scope、或存在未決風險時，才用 Question Tool 確認。派發後在**同一輪的最終訊息**回報派發內容（哪些工作線、各自範圍）——工具呼叫前的中間文字使用者看不到，不做「先展示、再派發」的兩段式。
- host 支援 worker 雙向溝通（如 team SendMessage）時，worker 對介面契約或預期值的提問是例行協作，即時回覆釘值；釘下的值同步回填 spec 的 AC 範例，維持 SSOT。釘值若等同新增或改變驗收條件、介面契約的實質決策，依 AGENTS.md「規格變更」暫停並請使用者決策。

### 4. 驗收

- 檢查首行狀態與 Deliverable 對帳，並**實際重跑該範圍的測試**——沒有測試輸出且未說明 `N/A` 理由的 `DONE` 視為未完成，要求補驗證；隱瞞失敗或跳過環境問題的回報，同樣不收。
- 驗收發現缺陷時，修正權限依 AGENTS.md「角色分工」；需要 worker 修正時，優先續用原 worker context 並附 findings，host 不支援續用時，重派 worker 並附原始任務摘要與 findings。
- `DONE_WITH_CONCERNS`：逐項 review 未驗證項與疑慮，決定補做或接受，不當 clean `DONE` 推進。
- `BLOCKED`／`FAIL`：向使用者提供重試、主行程修復、跳過的決策選項。
- 測試設計 gate：抽查 worker 產出的測試是否踩反模式（判準見 `ddd-developer` 定義的反模式表）；驗收條件寫不成行為測試＝spec 的 bug，暫停回 `/ddd.spec` 改 AC，不硬湊測試充數。
- 預期值對帳：斷言值是否對映 spec 的 AC 範例值；回報「未驗證」清單中標註「推導值」的項目逐一核對——推導錯的預期值是自洽但錯的 test+impl 配對，測試重跑抓不到，只有這道對帳抓得到。
- N>1 匯合（`🔗` 匯合點）：逐線整合，每整合一線跑該線相關測試；全部整合後執行匯合點的整合測試 task。

### 5. Simplify

由 main agent 呼叫 `/simplify`（Claude Code 內建 skill，非 DDD skill）審查本次 git diff；worker 沒有 Skill tool，這步留在主迴圈。`/simplify` 會直接套用品質修正，是 AGENTS.md「角色分工」的既定例外——套用後的變更視同待驗收交付：重跑該範圍測試確認不變紅，並在 commit gate 一併展示。host 沒有 `/simplify` 時跳過，不做替代實作。

### 6. 更新文件

- `spec.md`：勾選已完成的 task（含各工作線與匯合點）。
- `works.md`：記錄技術決策與問題解決（格式見下）；N>1 時額外記錄派發決策、各 worker 結果、合併過程。

### 7. 回報與 commit gate

- commit 前跑**完整測試套件**（不只本 milestone 範圍）——worker 收工與驗收重跑的都是範圍內測試，跨模組迴歸只有這一步攔得到；全綠才進 commit gate。
- 展示完成的功能與測試結果，等待使用者確認後才 commit（commit 授權見 AGENTS.md 底線第 3 條）。
- 開發中的規格更新依 AGENTS.md「規格變更」判準；觸及 gate 時暫停，回 `/ddd.spec` 更新並經使用者確認後再繼續。

## Workflow 派工（host 條件敘述）

host 具備 workflow orchestration（如 Claude Code 的 Workflow tool）、且 milestone 有多條 `🔀` 工作線時，coordinator 可把第 3 步改為 workflow 派發：

- 每條線 `agent(prompt, { agentType: 'ddd-developer', isolation: 'worktree', schema })`，schema 讀自本 skill 的 `references/worker-report.schema.json`。
- worker 以 StructuredOutput 回報 schema 同構欄位（status／summary／test_results／deliverables／unverified），語意與文字協議相同，驗收方式不變。
- Question Tool gate、驗收（第 4 步起）、commit 授權留在主迴圈——workflow 在背景執行，其中的 agent 無法與使用者對話。
- host 不具備 workflow orchestration 時，維持第 3 步的逐線派發，行為不變。

## Fallback 鏈

workflow 派發 → 逐線 `ddd-developer` 派發 → host 無 subagent 機制時，由主 agent 依 AGENTS.md 教義（底線＋測試品質）自行執行 TDD 循環。每降一級都明確告知使用者。

## works.md 格式

Sprint works.md 的格式以本節為唯一真相來源，其他 skill 只引用、不重述（`/ddd.fixbug` 的三合一 works.md 是獨立 hotfix 格式，由該 skill 自定）。每完成一個 milestone（或一次修正批次）追加一筆：

```markdown
# Works: <sprint 名稱>

## Milestone N: <名稱>

- **技術決策**：<實作層面的選擇與理由>
- **問題與解法**：<遇到的問題、根因、處理方式>
- **測試結果**：<測試指令與結果摘要>
```

沒有值得記錄的決策或問題時，該欄寫「無」即可，不硬湊。

## 產出

- 通過測試的程式碼
- 更新後的 `spec.md`（勾選進度）
- 更新後的 `works.md`（開發日誌）
- Git commits（使用者確認後）

## 結束條件

所有 milestone 完成後，引導使用者執行 `/ddd.xreview`。
