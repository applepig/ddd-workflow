---
name: ddd.e2e
description: >
  E2E 測試規劃與撰寫：在 main agent context 中探索應用、規劃測試案例、撰寫 Playwright 測試。
  支援 Greenfield（從 spec 驅動）和 Retrofit（既有專案補 E2E）兩種模式。
  Trigger: "write E2E tests", "add E2E", "Playwright test", "test this page",
  "補 E2E", "幫我測這個頁面", "這個功能需要 E2E", /ddd.e2e。
  任何需要 E2E 測試覆蓋的場景都應觸發。
---

# ddd.e2e — E2E 測試規劃與撰寫

在 main agent context 中執行 E2E 測試的規劃與撰寫。**不是 subagent**——全程可以跟使用者對話，在判斷點暫停確認。

## 為什麼是 Skill 而非 Subagent

E2E 測試充滿灰色地帶：
- 頁面行為跟 spec 不一致 → 是 bug 還是 spec 過時？
- 某個 edge case 在 UI 上很難測 → 要跳過還是改測法？
- 測試 flaky → 是 timing issue 還是真的有 bug？

這些判斷需要使用者參與。Subagent 無法暫停發問，會傾向走阻力最小的路——縮減測試來「通過」。

---

## 參考文件導覽

撰寫測試時，根據需要查閱以下參考文件：

| 文件 | 內容 | 何時查閱 |
|------|------|---------|
| [playwright-patterns.md](references/playwright-patterns.md) | Locator 優先級、等待策略、waitForResponse 驗證、debounced 搜尋、re-render 陷阱 | 撰寫或除錯測試程式碼時 |
| [test-architecture.md](references/test-architecture.md) | 目錄結構、Page Object 模式、前置資料策略、測試結構範例 | 建立新測試檔案或 Page Object 時 |
| [quality-principles.md](references/quality-principles.md) | 品質防線 5 條原則與實戰踩坑經驗 | 遇到判斷困難、品質檢查、或 spec/reality 不一致時 |

---

## Step 0：模式判定

根據上下文判定模式：

- **Greenfield**：有 `spec.md` 且包含 E2E 相關驗收條件 → 從 spec 驅動
- **Retrofit**：沒有 spec，或使用者明確說「幫這個專案補 E2E」 → 從探索驅動

---

## Greenfield 模式（有 spec）

### 1. 提取驗收條件

從 `spec.md` 找出所有適合 E2E 驗證的驗收條件。

判斷標準——適合 E2E 的：
- 跨頁面的使用者流程（登入 → 操作 → 結果）
- 表單送出與回饋
- 導航與路由行為
- 權限控制（某角色看不到某按鈕）
- 視覺狀態變化（loading → loaded → error）

不適合 E2E 的（用 unit/integration test）：
- 純計算邏輯
- API 回應格式
- 資料驗證規則

### 2. 規劃測試案例

對每個驗收條件，規劃：

```markdown
## 測試案例：<功能名稱>

### Happy Path
- [ ] <使用者操作步驟> → <預期結果>

### Edge Cases
- [ ] <邊界條件> → <預期結果>

### Error Cases
- [ ] <錯誤情境> → <預期結果>
```

**決策點 1**：向使用者展示測試案例清單，使用 `AskUserQuestion` 確認。

確認項目：
- 範圍是否合理（太多？太少？）
- 優先級（先測哪些？）
- 哪些 edge case 可以暫緩？
- auth/seed 資料的策略

### 3. 撰寫測試

逐一撰寫已確認的測試案例。每個測試完成後執行，確認結果。

撰寫前先查閱 [test-architecture.md](references/test-architecture.md) 了解目錄結構與 Page Object 模式，撰寫過程中參考 [playwright-patterns.md](references/playwright-patterns.md) 的 locator 和等待策略。

如果碰到 **spec 與實際行為不符**：

```
⚠️ Spec/Reality 不一致

spec.md 說：「送出表單後應顯示成功訊息」
實際行為：送出後導向到列表頁，沒有成功訊息

請判斷：
1. 這是 bug → 我寫測試驗證 spec 的預期行為（目前會 fail，標 test.fixme）
2. spec 過時 → 我依實際行為寫測試，並建議更新 spec
3. 需要更多資訊 → 我先跳過，繼續下一個
```

**絕對不做的事：悄悄把測試改成符合 code。**

---

## Retrofit 模式（既有專案補 E2E）

### 1. 環境檢查

```bash
# Playwright 是否已安裝？
npx playwright --version 2>/dev/null || echo "NOT_INSTALLED"

# playwright.config 是否存在？
ls playwright.config.{ts,js} 2>/dev/null || echo "NO_CONFIG"

# 現有測試的位置和數量
find . -path "*/e2e/*.spec.*" -o -path "*/e2e/*.test.*" | head -20

# 現有 Page Object
find . -path "*/e2e/pages/*" -o -path "*/e2e/pom/*" | head -20
```

如果環境不完整，先列出缺少的部分，跟使用者確認設定方向再繼續。

### 2. 探索應用

用瀏覽器探索 app，建立功能地圖：

```bash
# 偵測 dev server
# 檢查常見 port：3000, 3001, 5173, 8080, 4200, 8000
for port in 3000 3001 5173 8080 4200 8000; do
  curl -s -o /dev/null -w "%{http_code}" http://localhost:$port/ 2>/dev/null | grep -q "200\|301\|302" && echo "Found: http://localhost:$port"
done
```

探索時記錄：
- 主要頁面和路由
- 核心使用者流程
- 需要認證的區域
- 表單和互動元素

**決策點 2**：向使用者展示功能地圖，確認：
- 哪些流程是最關鍵的？（先測這些）
- 哪些頁面可以暫時不管？
- 認證怎麼處理？（test account? API seed?）
- 分幾批來做？

### 3. 分批規劃與實作

每批：
1. 規劃 3-5 個測試案例
2. 跟使用者確認
3. 撰寫測試（參考 [test-architecture.md](references/test-architecture.md) 與 [playwright-patterns.md](references/playwright-patterns.md)）
4. 執行驗證
5. 回報結果，確認後繼續下一批

這樣避免一次規劃太多、寫到一半發現方向錯誤。

---

## 品質檢查清單

每輪測試撰寫完畢後，自我檢查（原則說明見 [quality-principles.md](references/quality-principles.md)）：

- [ ] 每個功能都有 happy path + edge case + error case？
- [ ] 沒有 `waitForTimeout`？
- [ ] 沒有靜默 skip 或 return？
- [ ] Page Object 的 goto() 沒有手動重試？
- [ ] 前置資料用 API 建立，不依賴 UI？
- [ ] 每個 test 獨立，不依賴其他 test 的狀態？
- [ ] Locator 用 testid / role / label，避免 CSS class？
- [ ] 碰到的所有 spec/reality 不一致都已回報使用者？
- [ ] 會觸發 API 的操作後，有用 `networkidle` 或 `waitForResponse` 等穩定再操作表單？
- [ ] `waitForResponse` 有驗證 URL query params，不只檢查 path？
- [ ] `save()` / `click()` + `waitForResponse` 用 `Promise.all` 防止快回應被漏掉？

---

## 產出

- Playwright 測試檔案（通過執行驗證）
- Page Object（如需要）
- 測試案例清單（含覆蓋範圍說明）
- Spec/Reality 差異報告（如有）

## 結束條件

所有確認過的測試案例都已撰寫並通過執行，回報使用者最終結果。
