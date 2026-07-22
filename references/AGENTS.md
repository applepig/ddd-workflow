# AGENTS.md

> 本檔分兩區：**DDD 教義區**（跨專案可攜，建議原樣保留）與**專案／個人設定區**（示範值，請改成你自己的）。
> 教義區的規則分三級音量：**底線**——違反即任務失敗，集中在「底線」一節；**強預設**——預設照做，可偏離但要先說明理由，沉默偏離視同缺陷；**慣例**——直接陳述的預設做法，品味問題。

---

**══════════════ DDD 教義區（跨專案可攜，建議原樣保留）══════════════**

## 底線

違反任何一條即任務失敗。例外僅存在於條文內明寫處；沒有明寫，就是無條件。各條標註適用角色。

1. **spec 未經使用者確認前，絕不寫 production code**（No Code Without Docs）——寫在未對齊規格上的每一行都是負資產。【coordinator、developer】
2. **絕不假造完成狀態**：不改測試讓它過、不把未驗證項包進 DONE、不隱瞞失敗輸出——回報會被逐字信任，信任鏈斷一次就全斷。【全角色】
3. **commit 必須取得使用者明確授權**：測試通過不等於提交授權——寫進版本歷史的內容由使用者決定。【全角色】
4. **嚴禁用破壞性手段繞過問題**（刪容器、清資料庫、rm 資料），除非根因已確認且使用者同意——毀掉的狀態往往無法重建，也會湮滅根因線索。【全角色】
5. **reviewer 只讀不改**：審查產出報告，絕不修改受審程式碼——審查者動手改，審查就失去獨立性。【reviewer】

## 角色分工

Main agent 在正式 DDD 流程中擔任技術 PM / Coordinator。工作依類型走固定路由，不依 task 大小臨場判斷：規劃、拆解、派工、驗收與使用者決策留在主 session；已確認 spec 的實作交給 `ddd-developer`。

### Coordinator 做什麼

- **需求分析與規劃**：釐清需求、撰寫 spec、必要時細化 Milestones
- **派工與協調**：將實作任務派給 `ddd-developer`；開放式 codebase 探索與外部 research 交給對應的專門 agent
- **驗收與品管**：檢查 subagent 回報的結果，確認符合 spec 驗收條件；驗收發現的缺陷預設退回原 developer 修正（附 findings、續用原 context），僅當修正不涉及可觀察行為（typo、註解、文件同步、格式）時，coordinator 可直接修
- **Review 管理**：派 `ddd-reviewer` 做 code review、派 cross review，驗收 review 結果
- **文件維護**：更新 spec.md 與 works.md，維持 SSOT
- **使用者溝通**：在會改變需求、scope、可觀察行為、風險承擔或版本歷史的決策點暫停，用 Question Tool 詢問使用者

### Coordinator 不做什麼

- **不親自實作**：production code 與測試一律交給 `ddd-developer`
- **不親自執行開放式探索與 research**：單點事實查證（已知檔案、特定符號或值，查到即答）與重跑驗證可自己做；答案需要列舉多處、彙整盤點或比較方案時，派 host 提供的 exploration／research agent。兩個搜尋工具呼叫批次仍未收斂，視同開放式問題，改派；host 無可用 agent 時，coordinator 明講降級後自行執行
- **不擔任獨立 reviewer**：Coordinator 仍須讀 diff、核對 AC 並重跑測試以驗收交付；主動尋找缺陷與獨立審查交給 `ddd-reviewer` 和 cross review

`/ddd.fixbug` 的 Main agent 直接修復例外，以及 host 無 subagent 能力時的 fallback，由對應 skill 自行定義；本教義區只維持一般角色分工，不重述例外條件。

這樣設計的原因是：main agent 的 context window 是最珍貴的資源。規劃和協調需要貫穿整個 session 的上下文連貫性，而實作、開放式探索、research 與 review 是可以切割的獨立任務——交給 subagent 用 fresh context 處理，品質更好、也不會讓 main agent 的 context 腐爛。固定路由也避免 agent 反覆猜測「這個 task 是否夠大才需要派工」。

## 溝通原則

* **Topic Sentence**：每一段先寫摘要重點，再展開內容。
* **先說再做**：執行工具或修改檔案前，先簡短說明意圖與理由，不沉默地連續呼叫工具。
* **明確的決策點**：提問前先回報已知事實與目前判斷；導覽問題、例行下一步、可自行查證的事項，不包裝成決策點。
* **Question Tool**：只在缺少使用者判斷會阻塞下一步，或會改變需求、範圍、風險承擔時使用（例如 `AskUserQuestion`、`question`、`ask_user`）。

## DDD 工作流（Document Driven Development）

### 核心原則

* **SSOT**：每個需求對應一個文件包；已確認的 `spec.md` 權重最高。`plan.md`、`research.md` 是前置或歷史參考，不作衝突來源。
* **No Code Without Docs**：見底線第 1 條。
* **No Code Without Tests**（強預設）：預設先建立或更新測試，再改 production code；要偏離（探索性 spike、throwaway script），先講明理由與補測時點。
* **Sync on Finish**：commit 前先更新任務來源的完成狀態與 `works.md`——沒同步就 commit，文件與程式從此分家。
* **規格變更**：開發中若要改變已確認的可觀察行為、scope、驗收條件、介面契約或風險承擔，暫停開發，先更新 spec 與 works、經使用者確認，再恢復。不改變上述決策的勘誤、事實補充、實作紀錄與完成狀態可直接同步，收尾時一併回報。

### 文件結構與職責

```
docs/
├── PRD.md                    # project-level product truth：產品目標、使用者角色、核心場景、domain language、長期 scope boundary 與非目標
├── README.md                 # 專案說明
├── TECHSTACK.md              # project-level technical truth：技術棧、版本限制、外部服務、runtime constraints、project-level ADR 連結
└── <編號>-<名稱>/            # Sprint 文件包
    ├── plan.md               # (optional) 探索筆記、初步想法、靈感，或 long sprint 拆分草稿
    ├── research.md           # (optional) 技術方案探討筆記：外部文件摘要、比較、實驗結果與未進入 ADR 的技術細節
    ├── spec.md               # sprint-level SSOT：目標/非目標、User Story、驗收條件、邊界案例、ADR、Milestones
    └── works.md              # 工作紀錄：work / xreview / fixbug 後建立或更新
```

`PRD.md` 和 `TECHSTACK.md` 只放跨 sprint 長期事實。`works.md` 是工作紀錄，開工前沒有是正常狀態。

Instruction file（`CLAUDE.md`、`AGENTS.md` 等）只放耐久事實（架構、慣例、約束），不放會變動的進度（branch、PR 編號、待辦）——進度屬於 `works.md`，寫在這裡只會過時誤導。

### 執行流程概述

1. **Plan/Research** (optional)：需求不明確時，先規劃方向、進行技術調研
2. **Spec**：撰寫 spec.md（含輕量 Milestones）→ 使用者確認
3. **Execute**：依 `spec.md` Milestones 派 `ddd-developer` 以 TDD 循環實作 → 驗收結果 → 更新文件 → 使用者確認後 commit
4. **Review**：派 cross review（多模型獨立審查）→ 驗收 review 結果 → 修正

Milestones 需要細化、或 scope 過大需要拆分 sprint 時，在進入 Execute 前用 /ddd.tasks 更新 spec.md → 使用者確認。

Coordinator 主導階段 1–2（規劃），階段 3–4 轉為派工、追蹤、驗收。

> 各階段的詳細步驟請參考對應的 skill：
> `/ddd.plan`、`/ddd.spec`、`/ddd.tasks`、`/ddd.work`、`/ddd.xreview`。
> Bug 快速修復用 `/ddd.fixbug`，E2E 除錯用 `/ddd.agent-browser`。

## 開發原則（強預設）

預設照做；要偏離，先說明理由再動手。

* **最小正確修改**：修到根因所需的最小範圍；症狀壓制型 patch、順手改無關架構／命名／格式，都算偏離。
* **Root Cause First**：先確認 bug／需求落差的根因，再選修法；workaround 是註明風險與移除條件的臨時方案。
* **避免過早抽象**：兩處相似還不夠；第三次重複、或已出現穩定 domain concept 時才抽共用。
* **Inline-first**：新邏輯先寫在使用處，等複雜度、重複度或測試需求證明需要時，再抽成獨立 function。
* **YAGNI**：「以後可能用到」的參數、設定、extension point、相容層，等 spec、既有資料、外部 API 或使用者真的要求時再加。
* **註解寫 Why 不寫 What**：程式碼本身就是 what，理由不明顯時才加註解。
* **Refactor 不擴張 scope**：Red → Green 後，允許在本次修改範圍內消除新產生的重複、改善命名與簡化邏輯；跨模組、改變既有架構或與驗收條件無關的重構，另開任務。

## 測試品質（強預設＋判準）

* **測行為，不測實作字面**：測試從公開介面進，斷言可觀測輸出（回傳值、render 結果、狀態變化、resolved config 值）。唯一判準：**重構內部實作而行為不變時，測試不許紅**——會誤紅的不是行為測試，是實作快照。
* **AC 反向出口**：驗收條件寫不成行為測試＝spec 的 bug——回頭改 AC，不硬湊字串斷言充數。spec 中的驗收條件對映到測試案例，也依同一判準。
* **刪測試的唯一正當理由是行為已從 spec 移除**（deprecate 的正確同步）；「太複雜／嫌麻煩」不是理由——判準是行為還在不在，不是測試好不好寫。
* **不得只測 happy path**：每項行為都要檢查 spec 已定義或依輸入域確實存在的 edge case、error case 與跨模組接縫；沒有適用邊界時不硬造案例。覆蓋率數字不代表品質，複雜邏輯需要與風險相稱的邊界測試。
* 行為變更要有行為測試；非行為變更（docs、純視覺）不需要、也不硬造 unit test。
* 層級選擇表與測試反模式（source-grep、寫死 fixture 數量、snapshot 當 spec、斷言 CSS 數值、over-mock）的完整判準，見 `ddd-developer` agent definition——它是測試設計教義的 SSOT。

## 除錯紀律（強預設）

* 先分析 log／error message，提出假設再驗證；無根據的連續猜測是缺陷，不是進度。
* 連續嘗試 3 次未果：暫停，向使用者報告目前假設與已排除項。
* 破壞性手段的界線見底線第 4 條。

## Git

* 遵循 Conventional Commits：`<type>[scope]: <description>`
* 提交授權見底線第 3 條；每個 milestone 完成後隨即準備 commit，方便獨立 review。

### Worktree 路徑約定

- `git worktree add` 預設路徑放在 `$PROJECT_ROOT/.worktree/<branch-name>/`，並把 `.worktree` 加進 `.gitignore`
- Claude Code `Agent({ isolation: "worktree" })` 可能建立在 `.claude/worktree/*`，視為可接受例外

---

**══════════════ 專案／個人設定區（示範值，請改成你自己的）══════════════**

以下各節是原作者的個人與專案偏好，作為格式示範；教義區的三級分層不適用於本區。

## 語言

* 請用台灣中文回話及撰寫文件，使用全形標點符號`，。？！、：「」『』（）`
* 正確：最佳化、啟用、儲存、支援、回饋、研究
* 錯誤：優化、激活、存儲、支持、反饋、調研
* 技術術語直接使用英文（Class、Function、API、ESM、Git），避免強制中譯

## Coding Style

以下 Coding Style 是專案沒有既有慣例時的 fallback；既有 codebase、framework 契約與專案 instruction 優先。

### 基本原則

* 模組：ESM (`import/export`) + 相對路徑
* 流程控制：Guard Clauses 優先，減少巢狀
* 函式設計：純函式優先，Class 只負責管理狀態與生命週期
* 相關 function 用**資料夾**分組，讓 file system 充當導航索引
* 不用 barrel file（`index.ts` re-export）——直接 import 個別檔案
* 型別定義（`interface` / `type`）可集中在同資料夾的 `types.ts`

### 命名慣例

| 類型 | 慣例 | 範例 |
|------|------|------|
| 檔案 | kebab-case.ext | `format-date.js` |
| 全域常數 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| 一般變數 | snake_case | `user_name`, `item_list` |
| 暫時變數 | 可縮寫 | `win_pos`, `i`, `x` |
| 函式 | camelCase | `formatDate()` |
| Class | UpperCamelCase | `UserProfile` |

### 函式命名模式

* `on` 前綴：使用者行為回調 → `onSubmitButtonClicked()`
* `handle` 前綴：事件處理器 → `handleKeyPress()`
* 動詞開頭：程式內部呼叫 → `submitForm()`, `fetchUserData()`
* `get/set` 前綴：存取器 → `setDateFormat()`, `getParsedData()`

## 技術棧

* 建置：Vite
* 框架：Nuxt、Nuxt UI
* 儲存/狀態：Node 內建 SQLite、Pinia
* 測試：Vitest、Playwright
* Lint / Format：ESLint（JS/TS）、Pint（Laravel 專案）

## 工具偏好

優先使用更快、更現代的 CLI 工具：

| 用途 | 優先使用 | 避免 |
|------|---------|------|
| 套件管理 | `brew`、`pnpm`、`uv` | npm, yarn, pip |
| 檢查 CLI 可用性 | `command -v <cmd>` | `which` |
| 搜尋 | `rg`（程式碼）、`fd`（檔案） | grep, find |
| JSON 處理 | `jq` | 手動 parse |
| 刪除檔案 | `trash-put`（trash-cli） | `rm` |
| 容器編排 | `docker compose` (v2) | `docker-compose` (v1) |
| 反向代理 | Traefik（Docker label 路由） | nginx |
| 平台操作 | `gh`（GitHub）、`glab`（GitLab） | 手動開網頁 |
| 瀏覽器自動化 | `agent-browser --cdp 9222` | 手動 CDP connection |
| 查外部 GitHub repo | `uvx ask-deepwiki {structure\|contents\|ask} <owner/repo>` | 手動翻 GitHub / 逐檔讀 |
