import { readFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { TOTP, Secret } from 'otpauth'

const submit = (request: APIRequestContext, origin: string, action: string, data: object) =>
  request.post(origin + '/api/auth/' + action, { headers: { origin }, data })
const random = () => randomBytes(32).toString('base64url')
const digest = (value: string) => createHash('sha256').update(value).digest('base64url')
const now = () => Math.floor(Date.now() / 1000)

async function upcomingCode(totp: TOTP, previous?: string) {
  const remaining = 30_000 - Date.now() % 30_000
  if (remaining < 4_000 || totp.generate() === previous) {
    await new Promise(resolve => setTimeout(resolve, remaining + 1_000))
  }
  return totp.generate()
}

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test('live AWS native sign-in, TOTP, refresh, session expiry and ticket lifecycle', async ({ context, baseURL, playwright }) => {
  test.skip(process.env.OB_AUTH_NATIVE_LIVE !== '1', 'Requires a dedicated confirmed Cognito fixture and local AWS operator access')
  test.setTimeout(100_000)
  const origin = new URL(baseURL!).origin
  const email = process.env.OB_AUTH_E2E_EMAIL
  const password = process.env.OB_AUTH_E2E_PASSWORD
  const table = process.env.SESSION_TABLE
  if (!email || !password || !table || !email.endsWith('@example.invalid') || origin !== 'http://localhost:3000') {
    throw new Error('This test only modifies sessions it creates for an example.invalid fixture through the loopback portal')
  }

  const request = context.request
  const newBrowser = await playwright.request.newContext()
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }))
  const handle = (context: APIRequestContext, action: string, data: object = {}) => submit(context, origin, action, data)
  let centralKey: string | undefined
  try {
    expect((await request.post(origin + '/api/auth/signin', { headers: { origin: 'https://example.invalid' }, data: {} })).status()).toBe(403)
    expect((await request.get(origin + '/api/auth/session')).status()).toBe(200)
    expect((await handle(request, 'link', { provider: 'google', password })).status()).toBe(401)
    const credentials = { email, password }
    const response = await handle(request, 'signin', credentials)
    expect(response.status()).toBe(200)
    const step = await response.json()
    expect(step.step).toBe('enroll')
    expect((await (await request.get(origin + '/api/auth/session')).json()).user).toBeNull()
    const totp = new TOTP({ secret: Secret.fromBase32(step.secret), digits: 6, period: 30, algorithm: 'SHA1' })
    const actual = await upcomingCode(totp)
    const wrong = ((Number(actual) + 1) % 1000000).toString().padStart(6, '0')
    expect([400, 401]).toContain((await handle(request, 'challenge', { code: wrong })).status())
    const enrollmentCode = await upcomingCode(totp)
    const verified = await handle(request, 'challenge', { code: enrollmentCode })
    expect(verified.status()).toBe(200)
    expect((await verified.json()).step).toBe('authenticated')

    const state = await request.storageState()
    const sessionCookie = state.cookies.find(cookie => cookie.name === 'ob_sid')
    expect(!!sessionCookie?.httpOnly).toBe(true)
    expect(sessionCookie?.sameSite).toBe('Lax')
    expect(sessionCookie?.domain).toBe('localhost')
    const key = 'session#' + digest(sessionCookie!.value)
    centralKey = key
    const stored = () => db.send(new GetCommand({ TableName: table, Key: { pk: key }, ConsistentRead: true }))
    const adjust = (attribute: string, value: number) => db.send(new UpdateCommand({
      TableName: table, Key: { pk: key },
      ConditionExpression: 'attribute_exists(pk) AND sessionOwner = :owner',
      UpdateExpression: 'SET #a = :v',
      ExpressionAttributeNames: { '#a': attribute }, ExpressionAttributeValues: { ':v': value, ':owner': before.Item?.sessionOwner }
    }))
    const before = await stored()
    const ciphertext = before.Item?.encrypted
    expect(typeof ciphertext?.data).toBe('string')
    await adjust('tokenExpiresAt', now() - 1)
    expect((await request.get(origin + '/api/auth/session')).status()).toBe(200)
    const refreshed = await stored()
    expect(refreshed.Item?.tokenExpiresAt > now()).toBe(true)
    expect(refreshed.Item?.encrypted?.data !== ciphertext?.data).toBe(true)

    const nextSignIn = await handle(newBrowser, 'signin', credentials)
    expect(nextSignIn.status()).toBe(200)
    expect((await nextSignIn.json()).step).toBe('totp')
    // Cognito rejects reusing the time slot that was consumed by enrollment.
    expect((await handle(newBrowser, 'challenge', { code: await upcomingCode(totp, enrollmentCode) })).status()).toBe(200)
    const otherSession = (await (await newBrowser.get(origin + '/api/auth/session')).json()).user
    expect(otherSession.mfa && otherSession.emailVerified).toBe(true)

    const example = Object.fromEntries(readFileSync('examples/nuxt/.env', 'utf8').trim().split('\n').map(line => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1)]
    }))
    const id = example.NUXT_OB_AUTH_CLIENT_ID
    const secret = example.NUXT_OB_AUTH_CLIENT_SECRET
    const callback = 'http://localhost:3101/auth/callback'
    const ver = random()
    const params = new URLSearchParams({
      client_id: id, redirect_uri: callback, state: random(), code_challenge: digest(ver), code_challenge_method: 'S256'
    })
    const authorization = origin + '/authorize?'
    const badCallback = new URLSearchParams(params)
    badCallback.set('redirect_uri', 'http://localhost:3101/unregistered')
    expect((await request.get(authorization + badCallback, { maxRedirects: 0 })).status()).toBe(400)
    const badClient = new URLSearchParams(params)
    badClient.set('client_id', 'unregistered-test-application')
    expect((await request.get(authorization + badClient, { maxRedirects: 0 })).status()).toBe(400)

    const issue = async (browser = request) => {
      expect((await browser.get(authorization + params, { maxRedirects: 0 })).status()).toBe(303)
      const approval = await handle(browser, 'approve')
      expect(approval.status()).toBe(200)
      const link = new URL((await approval.json()).next)
      expect(link.origin + link.pathname).toBe(callback)
      expect(link.searchParams.get('state') === params.get('state')).toBe(true)
      return link.searchParams.get('code')!
    }
    const backchannel = (action: string, data: object) => request.post(origin + '/api/auth/' + action, {
      headers: { authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64') }, data
    })
    const ticket = await issue()
    const ticketBody = { code: ticket, verifier: ver, redirectUri: callback }
    expect((await backchannel('ticket', { ...ticketBody, verifier: random() })).status()).toBe(401)
    const attempts = await Promise.all([backchannel('ticket', ticketBody), backchannel('ticket', ticketBody)])
    expect(attempts.map(attempt => attempt.status()).sort()).toEqual([200, 401])
    const grant = (await attempts.find(attempt => attempt.ok())!.json()).grant
    expect((await backchannel('introspect', { grant })).status()).toBe(200)
    expect((await backchannel('ticket', ticketBody)).status()).toBe(401)
    const pending = await issue()

    await adjust('idleUntil', now() - 1)
    expect((await (await request.get(origin + '/api/auth/session')).json()).user).toBeNull()
    expect((await backchannel('introspect', { grant })).status()).toBe(401)
    expect((await backchannel('ticket', { ...ticketBody, code: pending })).status()).toBe(401)
    const revoked = await issue(newBrowser)
    expect((await handle(newBrowser, 'logout')).status()).toBe(200)
    expect((await (await newBrowser.get(origin + '/api/auth/session')).json()).user).toBeNull()
    expect((await backchannel('ticket', { ...ticketBody, code: revoked })).status()).toBe(401)

    // The next opt-in Playwright scenario uses this established dedicated factor.
    const fixture = process.env.OB_AUTH_TOTP_FIXTURE
    if (fixture) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(fixture, totp.secret.base32, { mode: 0o600, flag: 'wx' })
    }
  } finally {
    if (centralKey) await db.send(new UpdateCommand({
      TableName: table, Key: { pk: centralKey }, ConditionExpression: 'attribute_exists(pk)',
      UpdateExpression: 'SET revoked = :true REMOVE encrypted', ExpressionAttributeValues: { ':true': true }
    }))
    await newBrowser.dispose()
    db.destroy()
  }
})
