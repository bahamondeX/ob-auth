import { expect, test, type Page } from '@playwright/test'

const enabled = process.env.OB_AUTH_SSO_LIVE === '1'
const nuxt = process.env.OB_AUTH_NUXT_EXAMPLE_URL ?? 'http://localhost:3101'
const react = process.env.OB_AUTH_REACT_EXAMPLE_URL ?? 'http://localhost:3102'
const portal = process.env.OB_AUTH_E2E_PORTAL_URL ?? 'http://localhost:3000'

// The live test enters credentials and carries authorization tickets in redirects.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

const approvalText = 'Continue using your signed-in OB Auth account.'

async function finishAuthorization(page: Page, expectedUrl: string) {
  const consent = page.getByText(approvalText)
  await expect(consent.or(page.getByRole('heading', { name: /SSO example/ }))).toBeVisible()
  if (await consent.isVisible()) await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(expectedUrl)
}

test('live Cognito-backed SSO spans Nuxt and React and honors grant revocation', async ({ page, context }) => {
  test.skip(!enabled, 'Set OB_AUTH_SSO_LIVE=1 with two registered example apps and a real Cognito test account')
  test.setTimeout(90_000)
  const email = process.env.OB_AUTH_E2E_EMAIL
  const password = process.env.OB_AUTH_E2E_PASSWORD
  if (!email || !password) throw new Error('Provide the dedicated Cognito test account credentials')

  await page.goto(nuxt)
  await page.getByRole('button', { name: 'Sign in with OB Auth' }).click()
  await expect.poll(() => new URL(page.url()).origin).toBe(portal)
  await page.getByLabel('Email address', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  const totp = page.getByLabel('Authenticator code', { exact: true })
  await expect(totp.or(page.getByText(approvalText)).or(page.getByRole('heading', { name: 'Nuxt SSO example' }))).toBeVisible()
  if (await totp.isVisible()) {
    const code = process.env.OB_AUTH_E2E_TOTP_CODE
    if (!code || !/^\d{6}$/.test(code)) throw new Error('Provide a current code for the enrolled test account')
    await totp.fill(code)
    await page.getByRole('button', { name: 'Verify code', exact: true }).click()
  }
  await finishAuthorization(page, nuxt + '/protected')
  await expect(page.getByRole('heading', { name: 'Protected page' })).toBeVisible()
  const original = await context.request.get(nuxt + '/api/protected')
  expect(original.status()).toBe(200)
  const { sub } = await original.json()
  expect(sub).toBeTruthy()

  await page.goto(react)
  await page.getByRole('button', { name: 'Sign in with OB Auth' }).click()
  await finishAuthorization(page, react + '/')
  await expect(page.getByRole('button', { name: 'Check protected API' })).toBeVisible()
  const shared = await context.request.get(react + '/api/protected')
  expect(shared.status()).toBe(200)
  expect(await shared.json()).toEqual({ sub })

  await page.getByRole('button', { name: 'Sign out of this app' }).click()
  await expect(page.getByRole('button', { name: 'Sign in with OB Auth' })).toBeVisible()
  expect((await context.request.get(react + '/api/protected')).status()).toBe(401)
  expect((await context.request.get(nuxt + '/api/protected')).status()).toBe(200)

  await page.getByRole('button', { name: 'Sign in with OB Auth' }).click()
  await finishAuthorization(page, react + '/')
  await page.getByRole('button', { name: 'Sign out everywhere' }).click()
  await expect.poll(() => new URL(page.url()).origin).toBe(portal)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect.poll(async () => (await context.request.get(nuxt + '/api/protected')).status()).toBe(401)
  expect((await context.request.get(react + '/api/protected')).status()).toBe(401)
})
