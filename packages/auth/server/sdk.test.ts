import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServerAuth, safeReturnPath } from './index.ts'

const clientId = 'example-test'
const clientSecret = randomBytes(32).toString('base64url')
const sessionKey = randomBytes(32).toString('base64url')
const code = randomBytes(32).toString('base64url')
const grant = randomBytes(32).toString('base64url')
const domain = 'https://identity.example.test'
const user = { sub: 'unit-user', email: 'unit-user@example.test', emailVerified: true, provider: 'native', mfa: true }

let server: Server
let appOrigin: string
let validGrant: boolean
let backend: ReturnType<typeof vi.fn<typeof fetch>>

beforeEach(async () => {
  validGrant = true
  backend = vi.fn<typeof fetch>()
  backend.mockImplementation(async (input, init) => {
    expect(init?.redirect).toBe('error')
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
    )
    const body = JSON.parse(String(init?.body))
    const path = new URL(input.toString()).pathname
    const session = { user, expiresAt: Math.floor(Date.now() / 1000) + 1800 }
    switch (path) {
      case '/api/auth/ticket': {
        expect(body.code).toBe(code)
        expect(body.redirectUri).toBe(appOrigin + '/auth/callback')
        return Response.json({ ...session, grant })
      }
      case '/api/auth/introspect':
        expect(body.grant).toBe(grant)
        return validGrant ? Response.json(session) : new Response(null, { status: 401 })
      case '/api/auth/end-grant':
        expect(body.grant).toBe(grant)
        validGrant = false
        return Response.json({ ok: true })
      default:
        throw new Error('Unexpected identity service call')
    }
  })
  server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  appOrigin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
  const auth = createServerAuth({ domain, appOrigin, clientId, clientSecret, sessionKey }, backend)
  const router = createRouter()
  router.get('/auth/login', defineEventHandler(auth.login))
  router.get('/auth/callback', defineEventHandler(auth.callback))
  router.get('/auth/session', defineEventHandler(async (event) => ({ session: await auth.getSession(event) })))
  router.post('/auth/logout', defineEventHandler(auth.logout))
  router.get('/api/protected', defineEventHandler(auth.requireAuth))
  server.on('request', toNodeListener(createApp({ debug: false }).use(router)))
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

function cookieValue(response: Response, suffix: string) {
  const cookie = response.headers.getSetCookie().find((header) => header.includes('--ob_auth-' + suffix + '='))
  if (!cookie) throw new Error('Expected cookie')
  return cookie.split(';')[0]!
}

async function begin() {
  const response = await fetch(appOrigin + '/auth/login?returnTo=%2Fprotected%3Fx%3D1', { redirect: 'manual' })
  expect(response.status).toBe(303)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.getSetCookie()[0]).toContain('HttpOnly')
  expect(response.headers.getSetCookie()[0]).toContain('SameSite=Lax')
  expect(response.headers.getSetCookie()[0]).not.toContain('Domain=')
  const authority = new URL(response.headers.get('location')!)
  expect(authority.origin).toBe(domain)
  expect(authority.searchParams.get('code_challenge_method')).toBe('S256')
  expect(authority.searchParams.get('redirect_uri')).toBe(appOrigin + '/auth/callback')
  return { authority, cookie: cookieValue(response, 'state') }
}

async function authenticate() {
  const { authority, cookie } = await begin()
  const callback = await fetch(appOrigin + '/auth/callback?' + new URLSearchParams({
    state: authority.searchParams.get('state')!, code,
  }), { headers: { Cookie: cookie }, redirect: 'manual' })
  expect(callback.status).toBe(303)
  expect(callback.headers.get('location')).toBe('/protected?x=1')
  const body = JSON.parse(String(backend.mock.calls[0]?.[1]?.body))
  expect(createHash('sha256').update(body.verifier).digest('base64url'))
    .toBe(authority.searchParams.get('code_challenge'))
  const localCookie = cookieValue(callback, 'session')
  expect(localCookie).not.toContain(grant)
  return localCookie
}

describe('relying-party session routes, against a controlled portal fixture', () => {
  it('exchanges a state-bound PKCE ticket and validates the app session at the portal', async () => {
    expect((await fetch(appOrigin + '/api/protected')).status).toBe(401)
    const cookie = await authenticate()
    const profile = await fetch(appOrigin + '/api/protected', { headers: { Cookie: cookie } })
    expect(profile.status).toBe(200)
    expect((await profile.json()).user).toEqual(user)
  })

  it('rejects mismatched callback state before exchanging a ticket', async () => {
    const { cookie } = await begin()
    const response = await fetch(appOrigin + '/auth/callback?' + new URLSearchParams({ code, state: 'unexpected' }), {
      headers: { Cookie: cookie }, redirect: 'manual',
    })
    expect(response.status).toBe(400)
    expect(backend).not.toHaveBeenCalled()
  })

  it('checks cookie integrity locally before sending a grant to the portal', async () => {
    const cookie = await authenticate()
    const [name, sealed] = cookie.split('=')
    const segments = sealed!.split('.')
    segments[3] = (segments[3]![0] === 'A' ? 'B' : 'A') + segments[3]!.slice(1)
    backend.mockClear()
    const response = await fetch(appOrigin + '/auth/session', { headers: { Cookie: `${name}=${segments.join('.')}` } })
    expect(await response.json()).toEqual({ session: null })
    expect(backend).not.toHaveBeenCalled()
  })

  it('rejects cross-origin logout and revokes a legitimate local session', async () => {
    const cookie = await authenticate()
    const headers = { Cookie: cookie, 'Content-Type': 'application/json', 'X-OB-Auth': '1' }
    const post = (origin: string) => fetch(appOrigin + '/auth/logout', {
      method: 'POST', headers: { ...headers, Origin: origin }, body: '{}',
    })
    expect((await post('https://other.example.test')).status).toBe(403)
    expect(validGrant).toBe(true)
    expect((await post(appOrigin)).status).toBe(204)
    expect(validGrant).toBe(false)
    const result = await fetch(appOrigin + '/auth/session', { headers: { Cookie: cookie } })
    expect(await result.json()).toEqual({ session: null })
  })

  it('offers central logout confirmation and rejects centrally revoked sessions', async () => {
    const cookie = await authenticate()
    const response = await fetch(appOrigin + '/auth/logout', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-OB-Auth': '1', Origin: appOrigin },
      body: JSON.stringify({ everywhere: true }),
    })
    const logout = new URL((await response.json()).location)
    expect(logout.href).toBe(domain + '/logout?' + new URLSearchParams({ client_id: clientId, logout_uri: appOrigin }))
    expect(validGrant).toBe(true)
    validGrant = false
    expect((await fetch(appOrigin + '/api/protected', { headers: { Cookie: cookie } })).status).toBe(401)
  })
})

it('keeps the return path on the application origin', () => {
  const base = new URL('https://app.example.test')
  expect(safeReturnPath('/team?view=x#today', base)).toBe('/team?view=x#today')
  for (const input of ['https://external.example.test', '//external.example.test', '/x/..//external.example.test', '/auth/login']) {
    expect(safeReturnPath(input, base)).toBe('/')
  }
})
