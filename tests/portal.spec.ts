import { expect, test, type Page } from '@playwright/test'

async function openPortal(page: Page) {
  await Promise.all([page.waitForResponse('**/api/auth/session'), page.goto('/')])
}

test('mocked portal preserves theme and language, supports mobile layout, and offers recovery', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: null, providers: [] } }))
  await openPortal(page)
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Continue with GitHub/ })).toBeDisabled()
  expect(await page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true)

  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await page.getByRole('combobox', { name: 'Language' }).selectOption('es')
  await expect(page.getByRole('heading', { name: 'Qué gusto verte' })).toBeVisible()
  await Promise.all([page.waitForResponse('**/api/auth/session'), page.reload()])
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await page.getByRole('combobox', { name: 'Idioma' }).selectOption('en')
  await page.getByRole('button', { name: 'Create an account' }).click()
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible()
})

test('mocked TOTP enrollment supports focus and paste and clears the setup key after sign-in', async ({ page }) => {
  const identity = { sub: 'portal-test', email: 'ui-smoke@example.invalid', emailVerified: true, provider: 'password', mfa: true }
  let user: typeof identity | null = null
  const setupKey = 'UNITTESTONLY'
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user, providers: [] } }))
  await page.route('**/api/auth/signin', route => route.fulfill({
    json: { step: 'enroll', secret: setupKey, otpauth: 'otpauth://totp/OBAuth:test?secret=AAAAAAAAAAAAAAAA&issuer=OBAuth' }
  }))
  await page.route('**/api/auth/challenge', route => {
    if (route.request().postDataJSON().code !== '123456') return route.fulfill({ status: 401, json: {} })
    user = identity
    return route.fulfill({ json: { step: 'authenticated' } })
  })
  await openPortal(page)
  await page.getByLabel('Email address').fill(identity.email)
  await page.getByLabel('Password', { exact: true }).fill('Test-Only-Password123!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Set up an authenticator' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Authenticator setup QR code' })).toBeVisible()
  await expect(page.getByRole('progressbar')).toBeVisible()

  const code = page.getByLabel('Authenticator code')
  await expect(code).toBeFocused()
  await code.fill('111111')
  await page.getByRole('button', { name: 'Verify code' }).click()
  await expect(page.getByRole('alert')).toBeVisible()

  await code.evaluate(input => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', '123 456')
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }))
  })
  await expect(code).toHaveValue('123456')
  await page.getByRole('button', { name: 'Verify code' }).click()
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible()
  await expect(page.getByText(setupKey)).toHaveCount(0)
})
