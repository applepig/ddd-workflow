---
name: DDD.AgentBrowser
description: >
  E2E 除錯指南：用 agent-browser CLI 在 DDD 工作流中系統性除錯前端問題。
  Trigger: "debug E2E", "check the page", "why is the test failing",
  "open the browser", "take a screenshot", "inspect the DOM",
  "E2E 失敗", "測試壞了", "檢查頁面", /DDD.agent-browser。
  E2E 測試失敗、需要視覺驗證 UI 行為、或追蹤前端問題時使用。
---

# DDD:AgentBrowser — E2E 除錯說明書

在 DDD 工作流的開發階段（`/DDD.work`），當 Playwright E2E 測試失敗或需要視覺驗證時，
用 `agent-browser` CLI 直接操作瀏覽器來定位問題。

**與 `/DDD.e2e` 的分工**：`/DDD.e2e` 規劃與撰寫 E2E 測試案例；本 skill 是測試失敗後的除錯工具。
測試跑不過 → 先用本 skill 除錯定位原因；需要新增或修改測試 → 用 `/DDD.e2e`。

這份說明書不是瀏覽器自動化教學，而是**除錯流程指南**——幫你從「測試掛了」走到「找到根因」。

## 核心除錯循環

```
測試失敗 → 重現場景 → 觀察狀態 → 定位根因 → 修正 → 驗證
```

每一步都有對應的 agent-browser 指令，按順序走就對了。

## Step 1：重現場景

先把瀏覽器帶到測試失敗的那個畫面。

```bash
# 開啟目標頁面
agent-browser open http://localhost:3000/target-page

# 等頁面完全載入（別急著操作）
agent-browser wait --load networkidle

# 拿到互動元素的 ref
agent-browser snapshot -i
```

如果測試需要登入狀態，用 session 持久化避免重複登入：

```bash
# 首次登入並儲存狀態
agent-browser open http://localhost:3000/login
agent-browser snapshot -i
agent-browser fill @e1 "test@example.com"
agent-browser fill @e2 "password"
agent-browser click @e3
agent-browser wait --url "**/dashboard"

# 之後的除錯直接載入狀態
agent-browser --session-name debug open http://localhost:3000/target-page
```

## Step 2：觀察狀態

根據失敗類型選擇觀察方式。

### 2a. DOM 結構不符預期

```bash
# 互動元素快照（最常用）
agent-browser snapshot -i

# 限定範圍——只看特定區塊
agent-browser snapshot -s "#form-container"

# 取得特定元素的文字內容
agent-browser get text @e1

# 取得元素的 HTML
agent-browser get html @e1

# 檢查元素狀態
agent-browser is visible @e1
agent-browser is enabled @e2
agent-browser is checked @e3
```

### 2b. 視覺呈現有問題

```bash
# 截圖——快速確認畫面長什麼樣
agent-browser screenshot

# 整頁截圖（含捲動區域）
agent-browser screenshot --full

# 標註互動元素的截圖——看元素位置和佈局
agent-browser screenshot --annotate

# 比對兩個 URL 的畫面差異
agent-browser diff url http://localhost:3000/page http://staging.example.com/page
```

### 2c. JavaScript 錯誤

```bash
# 查看 console 訊息（log, error, warn, info）
agent-browser console

# 只看未捕獲的 JS 例外
agent-browser errors

# 在瀏覽器中執行 JS 檢查狀態
agent-browser eval 'document.querySelectorAll(".error-message").length'

# 複雜的 JS 用 stdin 避免 shell 跳脫問題
agent-browser eval --stdin <<'EVALEOF'
JSON.stringify({
  url: location.href,
  errors: document.querySelectorAll(".error").length,
  formData: Object.fromEntries(new FormData(document.querySelector("form")))
})
EVALEOF
```

### 2d. 網路請求問題

```bash
# 列出所有網路請求
agent-browser network requests

# 過濾特定 API 請求
agent-browser network requests --filter "/api/"

# 攔截請求（模擬 API 失敗）
agent-browser network route "/api/submit" --abort
agent-browser network route "/api/data" --body '{"error": "mocked failure"}'

# 移除攔截
agent-browser network unroute "/api/submit"
```

## Step 3：互動重現

模擬使用者操作來重現失敗路徑。

```bash
# 填表單
agent-browser fill @e1 "test input"
agent-browser select @e2 "option-value"
agent-browser check @e3

# 按鍵操作
agent-browser press Tab
agent-browser press Enter
agent-browser keyboard type "search query"

# 點擊並等待結果
agent-browser click @e5
agent-browser wait --load networkidle

# 重要：操作後一定要重新拿 snapshot
agent-browser snapshot -i
```

### Ref 失效規則

`@e1`、`@e2` 這些 ref 在頁面變動後會失效。以下操作後**必須重新 snapshot**：

- 點擊連結或按鈕觸發導航
- 表單送出
- 動態內容載入（下拉選單、Modal、AJAX 更新）

```bash
agent-browser click @e5           # 觸發頁面變動
agent-browser snapshot -i         # 必須重新拿 ref
agent-browser click @e1           # 用新的 ref
```

## Step 4：進階除錯工具

錄影（`record`）、Playwright Trace（`trace`）、效能分析（`profiler`）、元素高亮（`highlight`）等進階工具詳見 `references/agent-browser-advanced.md`。

## Step 5：語義定位器（備用方案）

當 snapshot ref 不穩定或元素沒有好的選擇器時，用語義定位：

```bash
agent-browser find text "送出" click
agent-browser find label "電子郵件" fill "test@example.com"
agent-browser find role button click --name "Submit"
agent-browser find placeholder "搜尋" type "query"
agent-browser find testid "submit-btn" click
```

## 常見除錯場景速查

### 場景 A：元素找不到（selector timeout）

```bash
# 1. 確認頁面載入完成
agent-browser wait --load networkidle

# 2. 用 snapshot 檢查元素是否存在
agent-browser snapshot -i

# 3. 如果不在互動快照中，看完整 DOM
agent-browser snapshot

# 4. 可能在 iframe 或 shadow DOM 中
agent-browser eval 'document.querySelectorAll("iframe").length'

# 5. 可能被 CSS 隱藏
agent-browser is visible "your-selector"
```

### 場景 B：點擊沒反應

```bash
# 1. 確認元素可見且可用
agent-browser is visible @e1
agent-browser is enabled @e1

# 2. 捲動到元素位置
agent-browser scrollintoview @e1

# 3. 檢查是否有覆蓋層擋住
agent-browser screenshot --annotate

# 4. 試用語義定位器
agent-browser find role button click --name "Submit"
```

### 場景 C：表單驗證失敗

```bash
# 1. 填完表單後截圖看驗證訊息
agent-browser screenshot

# 2. 檢查錯誤訊息元素
agent-browser eval --stdin <<'EVALEOF'
JSON.stringify(
  Array.from(document.querySelectorAll("[class*='error'], [class*='invalid'], .field-error"))
    .map(el => ({ text: el.textContent.trim(), visible: el.offsetParent !== null }))
)
EVALEOF

# 3. 檢查表單欄位的 validity 狀態
agent-browser eval --stdin <<'EVALEOF'
JSON.stringify(
  Array.from(document.querySelectorAll("input, select, textarea"))
    .map(el => ({ name: el.name, valid: el.validity.valid, message: el.validationMessage }))
)
EVALEOF
```

### 場景 D：API 回應異常

```bash
# 1. 列出 API 請求
agent-browser network requests --filter "/api/"

# 2. 模擬不同的 API 回應來驗證前端處理
agent-browser network route "/api/data" --body '{"items": []}'

# 3. 模擬網路錯誤
agent-browser network route "/api/data" --abort

# 4. 清除攔截後恢復正常
agent-browser network unroute
```

### 場景 E：RWD / 不同裝置

```bash
# 設定 viewport
agent-browser set viewport 375 812

# 模擬裝置
agent-browser set device "iPhone 14"

# 截圖比對
agent-browser screenshot mobile.png

# 恢復桌面尺寸
agent-browser set viewport 1920 1080
```

### 場景 F：Auth / Session 狀態問題

```bash
# 1. 檢查 cookies
agent-browser cookies

# 2. 檢查 localStorage
agent-browser storage local

# 3. 驗證 token
agent-browser eval "localStorage.getItem('token')"

# 4. 檢查 sessionStorage
agent-browser storage session

# 5. 清除登入狀態重新測試
agent-browser cookies clear
agent-browser eval "localStorage.clear()"
```

## 與 DDD 工作流的整合

### 在 `/DDD.work` TDD 循環中使用

1. **Red 階段**：E2E 測試失敗時，用 agent-browser 確認預期行為和實際行為的差異
2. **Green 階段**：實作後用 agent-browser 手動驗證，再跑測試確認
3. **Refactor 階段**：重構後用截圖比對確認視覺沒有退化

### 除錯紀律（繼承 CLAUDE.md）

- 先分析測試錯誤訊息，提出假設
- 用 agent-browser 驗證假設，不要盲目猜測
- 連續 3 次假設被推翻，暫停並向使用者報告
- 每次除錯 session 的發現記錄到 `works.md`
