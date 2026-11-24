import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import {
  createError, deleteCookie, getCookie, getHeader, getQuery, readBody, sendNoContent, sendRedirect,
  setCookie, setResponseHeaders, type H3Event,
} from 'h3'
import { EncryptJWT, jwtDecrypt, type JWTPayload } from 'jose'
import { parseSession, type AuthSession } from '../core/index.ts'

export interface ServerAuthOptions {
  domain: string
  clientId: string
  clientSecret: string
  appOrigin: string
  sessionKey: string
  logoutUri?: string
}

const HOST_COOKIE = '--ob_auth'

function origin(value: string) {
  const url = new URL(value)
  if (url.origin !== value) throw new Error('Use a canonical origin with no path or trailing slash')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('HTTPS is required for non-loopback authentication')
  }
  return url
}

export function safeReturnPath(input: unknown, appOrigin: URL): string {
  if (typeof input !== 'string' || !input.startsWith('/') || input.startsWith('//') || input.length > 2048
    || /[\\\u0000-\u0020\u007f]/.test(input)) return '/'
  const resolved = new URL(input, appOrigin)
  if (resolved.origin !== appOrigin.origin || resolved.pathname.startsWith('//')
    || /^\/auth(?:\/|$)/.test(resolved.pathname)) return '/'
  return resolved.pathname + resolved.search + resolved.hash
}

export function createServerAuth(options: ServerAuthOptions, fetcher: typeof fetch = fetch) {
  const portal = origin(options.domain)
  const app = origin(options.appOrigin)
  if (portal.origin === app.origin) throw new Error('Use a distinct application and portal origin')
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(options.clientId) || !/^[a-zA-Z0-9_-]{32,256}$/.test(options.clientSecret)) {
    throw new Error('OB Auth client ID or secret is invalid')
  }
  const key = Buffer.from(options.sessionKey, 'base64url')
  if (key.length !== 32 || key.toString('base64url') !== options.sessionKey) {
    throw new Error('OB Auth session key must be 32 base64url-encoded random bytes')
  }
  const redirectUri = new URL('/auth/callback', app).href
  const logoutUri = options.logoutUri || app.origin
  const logoutDestination = new URL(logoutUri)
  if (logoutDestination.origin !== app.origin || logoutDestination.username || logoutDestination.password || logoutDestination.hash) {
    throw new Error('Logout destination must use the application origin without credentials or a fragment')
  }
  const cookieOptions = { path: '/', httpOnly: true, secure: app.protocol === 'https:', sameSite: 'lax' as const }
  const prefix = cookieOptions.secure ? '__Host-' : ''
  const cookieBase = `${prefix}${options.clientId}${HOST_COOKIE}`
  const stateCookie = cookieBase + '-state'
  const localCookie = cookieBase + '-session'
  const credentials = Buffer.from(`${options.clientId}:${options.clientSecret}`).toString('base64')

  async function seal(payload: JWTPayload, audience: string, expiresAt: number) {
    return await new EncryptJWT(payload)
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: 'ob-auth+jwt' })
      .setIssuer(options.clientId).setAudience(audience).setExpirationTime(expiresAt)
      .encrypt(key)
  }

  async function unseal(event: H3Event, cookie: string, audience: string) {
    const value = getCookie(event, cookie)
    if (!value) return null
    try {
      const { payload } = await jwtDecrypt(value, key, {
        issuer: options.clientId, audience, typ: 'ob-auth+jwt', keyManagementAlgorithms: ['dir'],
        contentEncryptionAlgorithms: ['A256GCM'], requiredClaims: ['exp'],
      })
      return payload
    } catch {
      return null
    }
  }

  async function call(endpoint: string, payload: Record<string, string>) {
    let response: Response
    try {
      response = await fetcher(new URL('/api/auth/' + endpoint, portal), {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(7000),
        headers: { Authorization: 'Basic ' + credentials, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      throw createError({ statusCode: 503, statusMessage: 'Identity service unavailable' })
    }
    return response
  }

  function privacy(event: H3Event) {
    setResponseHeaders(event, {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      ...(cookieOptions.secure ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
    })
  }

  async function readGrant(event: H3Event): Promise<string | null> {
    const sealed = await unseal(event, localCookie, 'session')
    return typeof sealed?.grant === 'string' ? sealed.grant : null
  }

  async function getSession(event: H3Event): Promise<AuthSession | null> {
    privacy(event)
    const grant = await readGrant(event)
    if (!grant) return null
    const response = await call('introspect', { grant })
    if (response.status === 401) {
      deleteCookie(event, localCookie, cookieOptions)
      return null
    }
    if (!response.ok) throw createError({ statusCode: 503, statusMessage: 'Unable to validate session' })
    const session = await readSession(response)
    return session.expiresAt > unix() ? session : null
  }

  async function requireAuth(event: H3Event) {
    const session = await getSession(event)
    if (!session) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
    return session
  }

  async function login(event: H3Event) {
    privacy(event)
    const state = randomBytes(32).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const returnTo = safeReturnPath(getQuery(event).returnTo, app)
    const maxAge = 600
    const sealed = await seal({ state, verifier, returnTo }, 'state', unix() + maxAge)
    setCookie(event, stateCookie, sealed, { ...cookieOptions, maxAge })
    const url = new URL('/authorize', portal)
    url.search = new URLSearchParams({
      client_id: options.clientId, redirect_uri: redirectUri, state,
      code_challenge: challenge, code_challenge_method: 'S256',
    }).toString()
    return sendRedirect(event, url.href, 303)
  }

  async function callback(event: H3Event) {
    privacy(event)
    const stored = await unseal(event, stateCookie, 'state')
    const { code, state } = getQuery(event)
    if (typeof state !== 'string' || typeof stored?.state !== 'string' || !equalState(state, stored.state)
      || typeof stored.verifier !== 'string') {
      throw createError({ statusCode: 400, statusMessage: 'Invalid authentication response' })
    }
    deleteCookie(event, stateCookie, cookieOptions)
    if (typeof code !== 'string' || !/^[a-zA-Z0-9_-]{32,256}$/.test(code)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid authentication response' })
    }
    const response = await call('ticket', { code, redirectUri, verifier: stored.verifier })
    if (!response.ok) throw createError({
      statusCode: response.status < 500 ? 401 : 503, statusMessage: 'Unable to establish a session',
    })
    const payload: unknown = await response.json().catch(() => null)
    const grant = payload && typeof payload === 'object' && 'grant' in payload ? payload.grant : undefined
    if (typeof grant !== 'string' || !grant) throw createError({ statusCode: 502, statusMessage: 'Invalid session response' })
    const { expiresAt } = validateSession(payload)
    const maxAge = expiresAt - unix()
    if (maxAge <= 0) throw createError({ statusCode: 401, statusMessage: 'Session expired' })
    const oldGrant = await readGrant(event)
    if (oldGrant && oldGrant !== grant) await endGrant(oldGrant)
    const sealed = await seal({ grant }, 'session', expiresAt)
    setCookie(event, localCookie, sealed, { ...cookieOptions, maxAge })
    return sendRedirect(event, safeReturnPath(stored.returnTo, app), 303)
  }

  async function endGrant(grant: string) {
    const response = await call('end-grant', { grant })
    if (!response.ok && response.status !== 401) {
      throw createError({ statusCode: 503, statusMessage: 'Unable to revoke the application session' })
    }
  }

  async function logout(event: H3Event) {
    privacy(event)
    if (getHeader(event, 'origin') !== app.origin || getHeader(event, 'x-ob-auth') !== '1'
      || !/^application\/json(?:;|$)/i.test(getHeader(event, 'content-type') || '')) {
      throw createError({ statusCode: 403, statusMessage: 'Invalid request origin' })
    }
    const body: unknown = await readBody(event)
    if (body && typeof body === 'object' && 'everywhere' in body && body.everywhere === true) {
      const url = new URL('/logout', portal)
      url.search = new URLSearchParams({ client_id: options.clientId, logout_uri: logoutUri }).toString()
      return { location: url.href }
    }
    const grant = await readGrant(event)
    if (grant) await endGrant(grant)
    deleteCookie(event, localCookie, cookieOptions)
    return sendNoContent(event, 204)
  }

  return {
    login, callback, getSession, requireAuth, logout,
    async getUser(event: H3Event) { return (await getSession(event))?.user ?? null },
    async isAuthenticated(event: H3Event) { return (await getSession(event)) !== null },
  }
}

function unix() {
  return Math.floor(Date.now() / 1000)
}

function equalState(left: string, right: string) {
  const actual = Buffer.from(left)
  const expected = Buffer.from(right)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function validateSession(value: unknown): AuthSession {
  try {
    return parseSession(value)
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Invalid session response' })
  }
}

async function readSession(response: Response): Promise<AuthSession> {
  return validateSession(await response.json().catch(() => null))
}
