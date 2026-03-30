# Playwright 技術模式

## 目錄

- [Locator 優先級](#locator-優先級)
- [等待策略](#等待策略)
- [waitForResponse 的 URL 驗證](#waitforresponse-的-url-驗證)
- [Debounced 搜尋的等待](#debounced-搜尋的等待)
- [API 觸發的 re-render 陷阱](#api-觸發的-re-render-陷阱networkidle-模式)

---

## Locator 優先級

```typescript
// 1. data-testid（最穩定）
page.getByTestId('submit-button')

// 2. Role-based（語意好、accessible）
page.getByRole('button', { name: '送出' })

// 3. Label / Placeholder（表單元素）
page.getByLabel('電子郵件')
page.getByPlaceholder('搜尋')

// 4. Text（唯一文字）
page.getByText('登入成功')

// 5. CSS selector（最後手段）
page.locator('.submit-btn')
```

---

## 等待策略

```typescript
// ✅ Web-first assertion（auto-retry）
await expect(element).toBeVisible()

// ✅ 等 API 回應——waitForResponse 必須在觸發動作之前設置
const resp = page.waitForResponse('**/api/data')
await button.click()
await resp

// ✅ click + waitForResponse 用 Promise.all 防止快回應被漏掉
await Promise.all([
  page.waitForResponse(r => r.url().includes('/api/data')),
  save_button.click(),
])

// ✅ 等 URL 變化
await page.waitForURL('**/dashboard')

// ✅ Poll 非 DOM 條件
await expect.poll(async () => {
  const res = await page.request.get('/api/status')
  return res.status()
}).toBe(200)

// ✅ 動作觸發 API 後，等 network 穩定再操作表單（見下方「re-render 陷阱」）
await page.waitForLoadState('networkidle')

// ❌ 絕對禁止
await page.waitForTimeout(2000)  // NEVER
```

---

## waitForResponse 的 URL 驗證

`waitForResponse` 只檢查 URL path 是不夠的——它可能捕到錯誤的 response：

```typescript
// ❌ 會誤捕初始載入的 response（沒有 search param）
await page.waitForResponse(r => r.url().includes('/api/v2/user'))

// ✅ 驗證 response 包含預期的 query param
await page.waitForResponse(
  r => r.url().includes('/api/v2/user') && r.url().includes('search=')
)
```

典型場景：頁面載入時觸發初始 API 呼叫（無篩選），接著使用者操作觸發帶篩選的 API 呼叫。如果 `waitForResponse` 不驗證 param，會捕到第一個（錯的）response。

---

## Debounced 搜尋的等待

如果頁面使用 `refDebounced(search, 300)` 做搜尋，**不要按搜尋按鈕**——按鈕呼叫 `refresh()` 時 debounced value 尚未更新，會送出無效查詢：

```typescript
// ❌ 按鈕觸發 refresh() 時 debounce 還沒生效
await search_input.fill(keyword)
await search_button.click()
await page.waitForResponse(...)

// ✅ 讓 debounce 自動觸發 API，等帶 search param 的 response
await search_input.fill(keyword)
await page.waitForResponse(
  r => r.url().includes('/api/data') && r.url().includes('search=')
)
```

---

## API 觸發的 re-render 陷阱（networkidle 模式）

這是最隱蔽的 flaky 來源。症狀：`fill()` 執行成功，但緊接著 `toHaveValue` 失敗——值是空的。

### 根因

UI 操作（如選擇篩選條件）觸發了 API 呼叫。API 回應到達後，Vue 元件 re-render，摧毀並重建 DOM（尤其是 `v-if` 區塊）。如果在 re-render 之前 `fill()` 了一個 input，填入的值會隨著舊 DOM 一起消失。

### 關鍵特徵

- 測試單獨跑通過，full suite 跑就 fail（因為 full suite 時 server 負載高，API 回應慢，拉大了 race condition 的時間窗口）
- `fill()` 不報錯，但值馬上變空
- `toHaveValue` 重試 10 秒都是空——不是「還沒填好」，是「被清掉了」

### 修正模式

在會觸發 API 的操作之後、操作表單之前，用 `networkidle` 確認所有請求完成：

```typescript
// ❌ 選完 status 後馬上填 input——API response 可能 re-render 清掉值
await selectStatus('Close')
await openPanel()
await name_input.fill(value)     // 值被 re-render 清掉

// ✅ 等 API 呼叫全部完成，頁面穩定後再填
await selectStatus('Close')
await openPanel()
await page.waitForLoadState('networkidle')  // 等所有 pending request 完成
await name_input.fill(value)     // 現在安全了
```

### 判斷時機

任何 UI 操作如果會改變 reactive state 且觸發 `useAsyncData`/`useFetch` 的 watcher，都可能引發這個問題。常見場景：
- 篩選條件改變 → watch 觸發重新查詢
- 切換 tab → 不同 tab 的 data fetch
- URL query 改變 → composable watch 觸發 API
