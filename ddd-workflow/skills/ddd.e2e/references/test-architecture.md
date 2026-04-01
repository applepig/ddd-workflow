# 測試架構與結構

## 目錄

- [目錄結構](#目錄結構)
- [Page Object 模式](#page-object-模式)
- [前置資料](#前置資料)
- [測試結構範例](#測試結構範例)

---

## 目錄結構

```
tests/e2e/
├── fixtures/            # 共用 fixture（auth、seed data）
├── pages/               # Page Object Model
│   └── <page-name>.ts
├── specs/               # 測試檔案
│   └── <feature>.spec.ts
└── setup/               # Global setup（auth.setup.ts）
```

---

## Page Object 模式

```typescript
export class LoginPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
    this.email_input = page.getByLabel('Email')
    this.password_input = page.getByLabel('Password')
    this.submit_button = page.getByRole('button', { name: 'Sign in' })
  }

  async goto() {
    await this.page.goto('/login')
    await expect(this.email_input).toBeVisible()
  }

  async login(email: string, password: string) {
    await this.email_input.fill(email)
    await this.password_input.fill(password)
    const resp = this.page.waitForResponse('**/api/auth/login')
    await this.submit_button.click()
    await resp
  }
}
```

重點：
- `goto()` 用 web-first assertion 確認頁面就緒，不手動重試
- 方法封裝使用者操作的完整流程（包含等待 API 回應）
- Locator 在 constructor 中定義，避免重複

---

## 前置資料

```typescript
// ✅ 用 API 建立（快速、可靠、不依賴 UI）
async function seedUser(request: APIRequestContext) {
  const resp = await request.post('/api/test/seed-user', {
    data: { email: 'test@example.com', role: 'admin' }
  })
  expect(resp.ok(), 'Seed user 建立失敗').toBeTruthy()
  return resp.json()
}

// ❌ 不要透過 UI 建立前置資料
```

原因：透過 UI 建立前置資料又慢又 fragile——UI 改了前置步驟就壞。API 直接操作資料層，只依賴 API 契約，更穩定。

---

## 測試結構範例

```typescript
import { test, expect } from '@playwright/test'
import { LoginPage } from '../pages/login-page'

test.describe('Login Flow', () => {
  let login_page: LoginPage

  test.beforeEach(async ({ page }) => {
    login_page = new LoginPage(page)
    await login_page.goto()
  })

  test('should login with valid credentials', async ({ page }) => {
    await login_page.login('test@example.com', 'password')
    await expect(page).toHaveURL('/dashboard')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test('should show error for invalid password', async ({ page }) => {
    await login_page.login('test@example.com', 'wrong')
    await expect(page.getByText('Invalid credentials')).toBeVisible()
    await expect(page).toHaveURL('/login')  // 不應導航
  })

  test('should show validation for empty fields', async ({ page }) => {
    await login_page.submit_button.click()
    await expect(page.getByText('Email is required')).toBeVisible()
  })
})
```

重點：
- 每個 `test.describe` 有 `beforeEach` 處理導航，確保每個測試獨立
- Happy path + error case + validation 都有涵蓋
- assertion 使用 web-first（`toBeVisible`、`toHaveURL`），自動 retry
