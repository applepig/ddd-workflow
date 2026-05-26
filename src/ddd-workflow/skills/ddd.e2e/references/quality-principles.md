# 測試品質防線

這些原則來自實際踩坑經驗。理解「為什麼」比死守規則更重要——理解了才能在邊緣情境做出正確判斷。

## 目錄

- [1. 測試反映規格，不反映程式碼](#1-測試反映規格不反映程式碼)
- [2. Edge case 和 error case 跟 happy path 一樣重要](#2-edge-case-和-error-case-跟-happy-path-一樣重要)
- [3. 讓問題被看見，不要藏起來](#3-讓問題被看見不要藏起來)
- [4. 等事件，不等時間](#4-等事件不等時間)
- [5. Spec 與 reality 的落差是最有價值的發現](#5-spec-與-reality-的落差是最有價值的發現)

---

## 1. 測試反映規格，不反映程式碼

測試的職責是驗證「應該發生什麼」，不是描述「目前發生什麼」。當程式碼行為跟 spec 不一致時，如果縮減測試去配合程式碼，等於幫 bug 開了免死金牌——未來沒有人會發現這個落差。

正確做法：暫停，問使用者。是 code 要改還是 spec 要更新？不確定的話，用 `test.fixme` 標記並註明原因，讓差異留下痕跡。

```
情境：按鈕沒有 error state
→ 不要跳過 error case 測試
→ 暫停詢問使用者：這是刻意的設計嗎？還是漏做了？
→ 如果是漏做，用 test.fixme('Error state not implemented yet, see #issue')
```

---

## 2. Edge case 和 error case 跟 happy path 一樣重要

只測 happy path 的 E2E 套件給人虛假的安全感。真正的使用者會按錯按鈕、送出空表單、在網路不穩的時候操作。如果這些情境沒有測到，上線後才會發現。

每個功能的測試案例規劃時，主動思考：
- 空值、邊界值、超長輸入會怎樣？
- 網路斷掉或 API 回 500 時使用者看到什麼？
- 沒有權限的使用者嘗試操作會怎樣？

如果想不到 edge/error case，這本身就是一個該問使用者的決策點。

---

## 3. 讓問題被看見，不要藏起來

`test.skip` 和 early return 會讓 CI 報告顯示綠燈，但測試根本沒跑。這比沒有測試更糟——因為團隊以為有覆蓋。

環境問題（API 沒起來、session 建立失敗）應該讓測試 fail，逼團隊去修環境，而不是悄悄跳過。功能刻意不測的情境用 `test.fixme` 加原因，它會在報告中顯示為待修項目。

```typescript
// 環境不對 → fail，讓問題浮出來
expect(session, 'Session 未建立，auth setup 可能失敗').toBeTruthy()

// 功能尚未實作 → fixme，留下追蹤
test.fixme(true, 'Waiting for #123 to implement error handling')
```

---

## 4. 等事件，不等時間

`waitForTimeout(2000)` 是在猜「2 秒應該夠了吧」。慢機器上不夠就 flaky，快機器上白等浪費時間。更重要的是，它掩蓋了效能問題——如果一個操作真的需要 2 秒，那是 bug，不是測試該容忍的。

每次想寫 `waitForTimeout` 時，問自己：「我在等什麼具體事件？」然後用對應的等待方式。

具體的等待模式請參考 [playwright-patterns.md](playwright-patterns.md) 的等待策略章節。其中「API 觸發的 re-render 陷阱」是最隱蔽的 flaky 來源——表面上 `fill()` 成功但值被 re-render 清掉，務必詳讀。

---

## 5. Spec 與 reality 的落差是最有價值的發現

碰到 spec 與實際行為不一致時，這不是麻煩，而是測試最有價值的產出——它找到了規格和實作之間的裂縫。

暫停，向使用者回報，由使用者決定下一步：
- 寫測試驗證 spec 的預期（code 要改）
- 寫測試驗證實際行為（spec 要更新）
- 暫時標記 fixme，稍後處理

**絕對不做的事：悄悄把測試改成符合 code。**
