export interface AuthUser {
  sub: string
  email: string
  emailVerified: boolean
  provider: string
  mfa: boolean
}

export interface AuthSession {
  user: AuthUser
  expiresAt: number
}

export interface LogoutOptions {
  everywhere?: boolean
}

export interface AuthClient {
  login(returnTo?: string): void
  logout(options?: LogoutOptions): Promise<void>
  getSession(): Promise<AuthSession | null>
  getUser(): Promise<AuthUser | null>
  requireAuth(): Promise<AuthSession>
  isAuthenticated(): Promise<boolean>
}

export class AuthRequiredError extends Error {
  constructor() {
    super('Authentication required')
    this.name = 'AuthRequiredError'
  }
}

export function loginPath(returnTo = '/') {
  return '/auth/login?' + new URLSearchParams({ returnTo })
}

export function createAuthClient(request: typeof fetch = fetch): AuthClient {
  async function getSession(): Promise<AuthSession | null> {
    const result = await request('/auth/session', {
      credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json' },
    })
    if (!result.ok) throw new Error('Unable to check the application session')
    const session = await result.json()
    return session.session === null ? null : parseSession(session.session)
  }

  return {
    login(returnTo) {
      const location = browserLocation()
      location.assign(loginPath(returnTo ?? location.pathname + location.search))
    },
    async logout({ everywhere = false } = {}) {
      const result = await request('/auth/logout', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'X-OB-Auth': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ everywhere }),
      })
      if (!result.ok) throw new Error('Unable to sign out')
      if (everywhere) {
        const { location } = await result.json()
        browserLocation().assign(location)
      }
    },
    getSession,
    async getUser() {
      return (await getSession())?.user ?? null
    },
    async requireAuth() {
      const session = await getSession()
      if (!session) throw new AuthRequiredError()
      return session
    },
    async isAuthenticated() {
      return (await getSession()) !== null
    },
  }
}

function browserLocation() {
  const { location } = globalThis as typeof globalThis & {
    location?: { pathname: string; search: string; assign(url: string): void }
  }
  if (!location) throw new Error('Authentication navigation requires a browser')
  return location
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseSession(value: unknown): AuthSession {
  if (!isRecord(value) || typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt)
    || !isRecord(value.user)) {
    throw new Error('Invalid session response')
  }
  const { sub, email, emailVerified, provider, mfa } = value.user
  if (typeof sub !== 'string' || !sub || typeof email !== 'string'
    || typeof emailVerified !== 'boolean' || typeof provider !== 'string' || typeof mfa !== 'boolean') {
    throw new Error('Invalid user response')
  }
  return { expiresAt: value.expiresAt, user: { sub, email, emailVerified, provider, mfa } }
}
