# AGENTS.md

## 語言

* 請用台灣中文回話及撰寫文件，使用全形標點符號`，。？！、：「」『』（）`
* 正確：最佳化、啟用、儲存、支援、回饋
* 錯誤：優化、激活、存儲、支持、反饋
* 技術術語直接使用英文（Class、Function、API、ESM、Git），避免強制中譯

## 術語

**Question Tool**：各 CLI 的內建工具，例如 `AskUserQuestion`、`question`、`ask_user`。

## 角色分工

Main agent 擔任技術 PM / Coordinator。負責規劃、拆解、派工、驗收，不直接寫程式碼。

### Coordinator 做什麼

- **需求分析與規劃**：釐清需求、撰寫 spec、拆解 tasks
- **派工與協調**：將實作任務派給 `ddd-developer`
- **驗收與品管**：檢查 subagent 回報的結果，確認符合 spec 驗收條件
- **Review 管理**：派 `ddd-reviewer` 做 code review、派 cross review，驗收 review 結果
- **文件維護**：更新 tasks.md、works.md，維持 SSOT
- **使用者溝通**：在決策點暫停並用 Question Tool 詢問使用者，等待確認

### Coordinator 不做什麼

- **不寫 production code**：交給 `ddd-developer`
- **不直接 debug**：交給使用者或獨立除錯 session
- **不做 code review**：交給 `ddd-reviewer` 和 cross review

這樣設計的原因是：main agent 的 context window 是最珍貴的資源。規劃和協調需要貫穿整個 session 的上下文連貫性，而實作、除錯、review 是可以切割的獨立任務——交給 subagent 用 fresh context 處理，品質更好、也不會讓 main agent 的 context 腐爛。

## DDD 工作流（Document Driven Development）

### 核心原則

* **SSOT**：每個需求對應一個 `docs/<編號>-<名稱>/` 文件包，作為唯一真相來源。
* **No Code Without Docs**：在 `spec.md` 與 `tasks.md` 獲得使用者確認前，嚴禁撰寫程式碼。
* **No Code Without Tests**：修改 production code 前，必須先建立或更新測試。
* **Sync on Finish**：標記任務完成前，必須先更新 `tasks.md` 和 `works.md`。
* **規格變更**：開發中若需變更規格，暫停開發，同步更新三份文件，經使用者確認後才恢復。
* **明確的決策點**：需要使用者確認或決策時，必須使用 Question Tool，不可用一般對話文字代替。這確保流程在決策點明確暫停，等待使用者輸入。
* **Show Must Go On**：每次準備結束當前回合（相當於 Claude Code `Stop` hook 的時機）時，必須用 Question Tool 提議 2–4 個具體下一步選項。禁止只寫「完成了」或用開放式「要繼續嗎？」收尾。使用者明確說「結束／就這樣」時才可豁免。

### 文件結構

```
docs/
├── PRD.md                    # 產品需求文件
├── README.md                 # 專案說明
├── TECHSTACK.md              # 技術棧 + 參考文件連結
└── <編號>-<名稱>/            # Sprint 文件包
    ├── plan.md               # (optional) 前置規劃，需求不明確時先寫
    ├── research.md           # (optional) 技術調研筆記
    ├── spec.md               # 規格：目標/非目標、User Story、驗收條件、相關檔案、邊界案例、ADR
    ├── tasks.md              # 任務：以 milestone 分組的 TODO checklist (- [ ])
    └── works.md              # 日誌：以日期分組，記錄決策與問題解決
```

* `plan.md` 和 `research.md` 是 spec 的前置作業，用於需求不明確、需要先調研的情境
* `spec.md`、`tasks.md`、`works.md` 為每個 sprint 必備

### 執行流程概述

1. **Plan/Research** (optional)：需求不明確時，先規劃方向、進行技術調研
2. **Spec**：撰寫 spec.md → 使用者確認
3. **Tasks**：拆解為 milestone + task → 撰寫 tasks.md → 使用者確認
4. **Execute**：派 `ddd-developer` 以 TDD 循環實作 → 驗收結果 → 更新文件 → 使用者確認後才 commit
5. **Review**：派 cross review（多模型獨立審查）→ 驗收 review 結果 → 修正

Coordinator 主導階段 1–3（規劃），階段 4–5 轉為派工、追蹤、驗收。

> 各階段的詳細步驟請參考對應的 skill：
> `/ddd.plan`、`/ddd.spec`、`/ddd.tasks`、`/ddd.work`、`/ddd.xreview`。
> E2E 測試用 `/ddd.e2e`，架構重構用 `/ddd.architect-refactor`，hook 設定用 `/ddd.create-hooks`。

### E2E 測試的特殊處理

E2E 測試由 `/ddd.e2e` skill 在 **main agent context** 中執行，不派給 subagent。

原因：E2E 測試充滿需要使用者判斷的灰色地帶（頁面行為與 spec 不符、edge case 取捨、flaky test 的根因），subagent 無法暫停發問，會傾向縮減測試範圍來避開問題。保留在 main agent 確保每個判斷點都能跟使用者確認。

`/ddd.e2e` 支援兩種模式：
- **Greenfield**：從 spec.md 驅動，提取驗收條件規劃測試案例
- **Retrofit**：既有專案補 E2E，先探索 app 再分批規劃

## Coding Style

### 基本原則

* 語言：依專案設定（JS + JSDoc、TypeScript 等）
* 樣式：依專案設定（CSS modules、Tailwind、原生 CSS 等）
* 模組：ESM (`import/export`) + 相對路徑
* 流程控制：Guard Clauses 優先，減少巢狀
* 函式設計：純函式優先，Class 只負責管理狀態與生命週期

### 檔案組織

* **Single Function File**：一個檔案只匯出一個 function（或一個 Class），減少檔案長度方便LLM閱讀
* 相關 function 用**資料夾**分組，讓 file system 充當導航索引
* **禁止 barrel file**（`index.ts` re-export）——Vite HMR 變慢、tree-shaking 失效。直接 import 個別檔案
* Class 一個檔案一個，檔名用 kebab-case 對應 Class 名稱
* 型別定義（`interface` / `type`）可集中在同資料夾的 `types.ts`

```
# ✅ 正確：資料夾分組 + 直接 import
server/services/session/
  create-session.ts       # export function createSession()
  list-sessions.ts        # export function listSessions()
  delete-session.ts       # export function deleteSession()

import { createSession } from '../services/session/create-session'

# ❌ 錯誤：barrel file re-export
server/services/session/
  index.ts                # export * from './create-session' ← 禁止
import { createSession } from '../services/session'
```

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

## 測試

* 單元/整合測試：**Vitest**
* E2E 測試：**Playwright**
* Spec 中的驗收條件必須對映到測試案例

## 除錯紀律

* 先分析 log / error message，提出假設再驗證，禁止無根據地連續猜測
* 連續嘗試 3 次未果，必須暫停並向使用者報告目前的假設與排除項目
* 禁止用破壞性手段繞過問題（如刪容器、清資料庫），除非已確認根因

## 測試品質

* 禁止刪除已存在的測試案例，即使覺得「太複雜」
* 邊界案例測試不可省略，不能只寫 happy path
* 測試覆蓋率數字不代表品質，複雜邏輯需要對應的複雜測試

## Git

* 遵循 Conventional Commits：`<type>[scope]: <description>`
* Commit 需使用者明確同意，測試通過不等於提交授權
* 每個 milestone 完成後應立即準備 commit，方便獨立 review

## 工具偏好

優先使用更快、更現代的 CLI 工具：

| 用途 | 優先使用 | 避免 |
|------|---------|------|
| Node.js 套件管理 | `pnpm` | npm, yarn |
| Python 套件管理 | `uv` | pip, pip3 |
| 程式碼搜尋 | `rg`（ripgrep） | grep |
| 檔案搜尋 | `fd` | find |
| 檔案檢視 | `bat` | cat |
| JSON 處理 | `jq` | 手動 parse |
| Git 指令 | 加 `--no-pager` | 被 pager 截斷 |
| 刪除檔案 | `trash-put`（trash-cli） | `rm` |
| 容器編排 | `docker compose` (v2) | `docker-compose` (v1) |
| 反向代理 | Traefik（Docker label 設定路由） | nginx |
| 瀏覽器自動化 | `agent-browser --cdp 9222`（連接既有 Chrome） | 不加 `--cdp` 另開 instance |
| Second opinion / Cross check | `gemini -y -p "PROMPT"`（呼叫 Gemini Pro 當 subagent） | 單一模型自我驗證 |
| Dead code 偵測 | `knip --reporter json` | 手動找 unused code |
| 拼字檢查 | `typos --format json .` | 肉眼校稿 |
| 安全 / 邏輯掃描 | `semgrep scan --config auto --json .` | 純 regex grep |
| 檢查 CLI 是否可用 | `command -v <cmd>` 或直接執行 `<cmd> --version` | `which`（npm global 裝的工具不在 `which` 搜尋路徑） |

## Cross Review 模型設定

`/ddd.xreview` 使用的 reviewer 模型清單。所有 reviewer（含 Claude）統一由 orchestrator 派發：Claude 透過 `claude -p --agent ddd-reviewer` 呼叫，外部模型透過指定 CLI 呼叫。

| 角色 | CLI:模型 | 備註 |
|------|---------|------|
| Claude Reviewer | `claude:claude-sonnet-4-6` | 預設，可替換成其他 Claude 模型 |
| 外部 Reviewer A | `opencode:github-copilot/gpt-5.4` | 預設 |
| 外部 Reviewer B | `gemini:gemini-3-pro-preview` | |

新增或移除 reviewer 只需編輯此表格，skill 會讀取這裡的設定。失敗時直接標示失敗並呈現已取得結果，不做退化重試（實測退化模型品質不足，徒增等待時間）。
