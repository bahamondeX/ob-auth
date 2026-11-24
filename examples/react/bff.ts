import { createApp, createError, createRouter, defineEventHandler } from 'h3'
import { createServerAuth } from '@oscarbahamonde/auth/server'

export function createBff(env: Record<string, string | undefined>) {
  const auth = createServerAuth({
    domain: env.OB_AUTH_DOMAIN || 'http://localhost:3000',
    appOrigin: env.OB_AUTH_APP_ORIGIN || 'http://localhost:3102',
    clientId: env.OB_AUTH_CLIENT_ID || 'example-react',
    clientSecret: env.OB_AUTH_CLIENT_SECRET || '',
    sessionKey: env.OB_AUTH_SESSION_KEY || '',
    logoutUri: env.OB_AUTH_LOGOUT_URI,
  })
  const router = createRouter()
  router.get('/auth/login', defineEventHandler(auth.login))
  router.get('/auth/callback', defineEventHandler(auth.callback))
  router.get('/auth/session', defineEventHandler(async (event) => ({ session: await auth.getSession(event) })))
  router.post('/auth/logout', defineEventHandler(auth.logout))
  router.get('/api/protected', defineEventHandler(async (event) => ({
    sub: (await auth.requireAuth(event)).user.sub,
  })))
  // Keep authentication URLs out of any SPA fallback or static file server.
  router.use('/auth/**', defineEventHandler(() => { throw createError({ statusCode: 404 }) }))
  return createApp().use(router)
}
