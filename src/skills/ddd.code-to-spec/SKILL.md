---
name: DDD.CodeToSpec
description: >
  從既有程式碼反向萃取細粒度功能規格——追蹤每條流程的輸入、驗證、邏輯分支、副作用、權限，
  標註原始碼位置，產出可作為遷移驗收依據的規格文件。
  Use when the user says "code to spec", "reverse engineer spec", "extract spec from code",
  "document legacy behavior", "what does this code do", "trace the flow",
  "migrate this module", "I need to rewrite this", or invokes "/DDD.code-to-spec".
  Also use when a codebase lacks documentation and needs behavioral specification
  before refactoring or migration.
---

# DDD:CodeToSpec — 程式碼反向規格萃取

從既有程式碼中萃取出「它實際上做了什麼」的細粒度功能規格。
產出物是一份可驗證的規格文件，可直接作為遷移、重構或重寫的驗收依據。

## 核心理念

這份 skill 借鑑 Michael Feathers 的 Characterization Testing 精神：

> 當規格文件與實際行為不一致時，**以實際行為為準**——因為使用者依賴的是程式碼真正做的事，不是文件上寫的。

目標不是寫出「理想的規格」，而是忠實記錄「現在的行為」，包括那些看起來像 bug 但可能已經有人依賴的行為。

### 雙軌萃取

萃取時要同時從**技術面**和**功能面**下手，只做其中一邊會有盲點：

- **技術面**（靜態分析）：逐行追蹤控制流、資料流、副作用
- **功能面**（行為觀察）：從 UI 和 API 的角度，記錄「使用者做了 X，系統做了 Y」

兩邊的結果交叉比對，不一致的地方就是規格中最有價值的發現。

## 嚴格禁令 (Never Do)

- **嚴禁修改原始碼**：這是觀察階段，不是修復階段。你的工作是記錄行為，不是改善行為。即使看到明顯的 bug，也只能標註在規格中，不能動程式碼。
- **嚴禁腦補規格**：每一條規格都必須指向對應的原始碼位置。無法從程式碼中驗證的行為不可以寫進規格。
- **嚴禁省略「醜陋的行為」**：那些看起來像 bug 的特殊處理、硬編碼的值、不一致的回傳格式——這些往往是遷移時最容易踩到的坑，必須如實記錄。

## 執行步驟

### 1. 確認萃取範圍

用 AskUserQuestion 確認：

- **目標程式碼**：哪些檔案、模組、或功能需要萃取？
- **萃取目的**：遷移到新框架？重構？補文件？（影響規格的詳細程度）
- **已知資訊**：有現成的 API 文件、測試案例、或 PRD 嗎？（可作為交叉比對的參考，但不是真相來源）

### 2. 程式碼考古（Code Archaeology）

系統性地閱讀目標程式碼，逐一追蹤每條執行路徑。

#### 追蹤清單

對每個函式 / 端點 / 元件，記錄以下面向：

| 面向 | 要記錄的內容 |
|------|-------------|
| **進入點** | 函式簽名、路由定義、事件綁定 |
| **輸入** | 參數型別、必填/選填、預設值 |
| **驗證** | 輸入驗證規則、錯誤訊息、驗證順序 |
| **權限** | 認證檢查、角色限制、資源所有權驗證 |
| **正常流程** | 主要邏輯步驟、轉換規則、計算公式 |
| **分支邏輯** | 條件判斷、switch/case、feature flag |
| **副作用** | 資料庫寫入、檔案操作、外部 API 呼叫、事件發送、快取操作 |
| **錯誤處理** | try/catch、錯誤回傳格式、重試邏輯、fallback 行為 |
| **輸出** | 回傳值型別、HTTP status code、回應格式 |
| **邊界行為** | 空值處理、極端數值、併發問題、逾時設定 |

#### 追蹤技巧

```
# 從進入點開始，逐層深入
1. 找到所有進入點（路由、事件監聽、匯出函式）
2. 對每個進入點，追蹤完整的呼叫鏈
3. 在每個分支點記錄條件和兩側的行為
4. 特別注意 middleware、decorator、interceptor 這類隱式行為
5. 檢查錯誤處理——catch 區塊裡通常藏著重要的業務邏輯
```

#### 交叉驗證來源

如果有以下資源，拿來和程式碼行為交叉比對：

- **既有測試案例**：測試在驗證什麼行為？有沒有 skip 掉的測試？
- **API 文件**：文件描述和實際行為是否一致？不一致的地方特別標註
- **Git 歷史**：`git log` 和 `git blame` 可以揭示為什麼某段程式碼長這樣
- **注釋和 TODO**：開發者留下的線索，可能解釋看似奇怪的設計

### 3. 撰寫 code-spec.md

用以下模板結構化你的發現。每一條行為描述都必須附上原始碼位置。

```markdown
# <模組/功能名稱> — 行為規格

> 萃取自：<檔案路徑列表>
> 萃取日期：<日期>
> 萃取目的：<遷移/重構/補文件>

## 概覽

簡述這個模組的職責和在系統中的位置。

## 進入點

### `<函式名/路由/事件>`

**定義位置**：`src/path/file.js:42`

**輸入**
- `param1` (string, 必填) — 說明
- `param2` (number, 選填, 預設: 10) — 說明

**驗證規則**
1. `param1` 不可為空字串 → 回傳 400 `{ error: "name required" }` (`file.js:45`)
2. `param2` 必須 > 0 → 回傳 400 `{ error: "invalid count" }` (`file.js:48`)

**權限**
- 需要 `Authorization` header (`middleware/auth.js:12`)
- 角色限制：`admin` 或 `editor` (`middleware/roles.js:8`)

**正常流程**
1. 從資料庫查詢記錄 (`file.js:52`)
2. 套用轉換規則 X (`file.js:58-65`)
3. 寫入審計日誌 (`file.js:70`) ← 副作用
4. 回傳 200 `{ data: [...], total: N }`

**分支邏輯**
- 若查詢結果為空 → 回傳 200 `{ data: [], total: 0 }`（不是 404）(`file.js:55`)
- 若 `param2 > 100` → 強制設為 100（靜默截斷，不報錯）(`file.js:50`)

**錯誤處理**
- 資料庫連線失敗 → 回傳 503 `{ error: "service unavailable" }` (`file.js:75`)
- 未預期例外 → 回傳 500，錯誤細節寫入 log 但不回傳給客戶端 (`file.js:78`)

**⚠️ 注意事項**
- `param2 > 100` 的靜默截斷行為沒有文件記載，但前端已依賴此行為
- 審計日誌是同步寫入，高流量時可能成為瓶頸

---

## 隱式行為 (Implicit Behaviors)

這些行為不在任何單一函式中，而是由 middleware、框架設定、或全域配置產生：

- 所有請求經過 rate limiter（100 req/min per IP）(`middleware/rate-limit.js:5`)
- CORS 允許 `*.example.com` (`config/cors.js:3`)
- 回應自動加上 `X-Request-Id` header (`middleware/request-id.js:1`)

## 資料依賴

列出這個模組讀寫的資料儲存：

| 儲存 | 操作 | 位置 |
|------|------|------|
| `users` 表 | READ | `file.js:52` |
| `audit_logs` 表 | WRITE | `file.js:70` |
| Redis cache `user:{id}` | READ/WRITE | `file.js:48, 72` |

## 外部依賴

| 服務 | 用途 | 失敗處理 |
|------|------|---------|
| Payment API | 建立付款 | 重試 3 次，間隔 1s (`file.js:90`) |
| Email Service | 寄送通知 | fire-and-forget，失敗只記 log (`file.js:95`) |

## 隱含假設 (Implicit Assumptions)

程式碼中沒有明說、但邏輯依賴的假設——遷移時最容易被忽略的地雷：

- 假設日期格式為 `YYYY-MM-DD`（`file.js:30`）
- 假設查詢結果已按 `created_at` 排序（`file.js:60`）
- 假設 `user.email` 永遠存在且非空（`file.js:44`）

## 與文件/測試的差異

如果發現程式碼行為與既有文件或測試不一致，在此列出：

| 項目 | 文件/測試描述 | 實際行為 | 原始碼位置 |
|------|-------------|---------|-----------|
| 空結果處理 | API 文件寫回傳 404 | 實際回傳 200 + 空陣列 | `file.js:55` |
| 分頁上限 | 無記載 | 靜默截斷為 100 | `file.js:50` |
```

### 4. 產出 Characterization Test 清單（選填）

如果萃取目的是遷移或重寫，額外產出一份測試清單，確保新實作能覆蓋所有已知行為。

#### Characterization Test 的寫法

Characterization Test 不是「測試程式碼是否正確」，而是「鎖定程式碼目前的行為」。
寫法遵循 Michael Feathers 的步驟：

1. 寫一個你**知道會失敗**的 assertion（避免寫出同義反覆的空殼測試）
2. 執行測試，讓失敗訊息告訴你實際的回傳值
3. 把 assertion 改成期望實際回傳值
4. （驗證）故意破壞 SUT，確認測試會失敗，再還原——這證明測試是有效的

#### Golden Master（輸出複雜時的替代方案）

當系統輸出很複雜（PDF、大量 HTML、序列化物件），逐一寫 assertion 不切實際時，
改用 Golden Master 方式：固定輸入 → 記錄完整輸出作為基準 → 之後每次修改都和基準比對。
Golden Master 是快速建立安全網的手段，但長期仍應逐步替換為有意義的 assertion。

#### 測試清單模板

```markdown
## Characterization Tests

這些測試案例描述系統的**現有行為**（不論是否「正確」）。
遷移後的系統必須通過所有案例，除非使用者明確決定變更某個行為。

### <進入點名稱>

- [ ] 正常輸入 → 預期回傳格式和狀態碼
- [ ] 缺少必填參數 → 驗證錯誤訊息和順序
- [ ] param2 = 101 → 靜默截斷為 100
- [ ] 無權限存取 → 403 回應格式
- [ ] 資料庫不可用 → 503 回應 + 不寫審計日誌
- [ ] 空結果 → 200 + 空陣列（不是 404）

### Bug vs Feature 判定

以下行為需要使用者決定是保留還是修正：

| 行為 | 原始碼位置 | 判定 |
|------|-----------|------|
| param2 靜默截斷 | `file.js:50` | ⬜ Bug / ⬜ Feature |
| 空結果回 200 | `file.js:55` | ⬜ Bug / ⬜ Feature |
```

### 5. 交付與確認

1. 將 code-spec.md 呈現給使用者
2. 特別標示「⚠️ 注意事項」和「與文件的差異」，這些是遷移風險最高的區域
3. 詢問使用者：
   - 有沒有遺漏的進入點或流程？
   - 標註的異常行為中，哪些是 bug（遷移時要修）、哪些是 feature（遷移時要保留）？

## 產出

- `docs/<編號>-<名稱>/code-spec.md`
- （選填）`docs/<編號>-<名稱>/characterization-tests.md`

## 結束條件

使用者確認 code-spec.md 後：

- 若目的是**遷移/重寫** → 引導使用者執行 `/DDD.spec`（以 code-spec 為輸入撰寫新系統規格）
- 若目的是**重構** → 引導使用者執行 `/DDD.architect-refactor`
- 若目的是**補文件** → 工作完成
