import { createError, defineEventHandler, getRequestURL } from 'h3'
import { obAuthServer } from './server.ts'

export default defineEventHandler(async (event) => {
  const route = getRequestURL(event).pathname
  let auth: ReturnType<typeof obAuthServer>
  try {
    auth = obAuthServer(event)
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Application authentication is not configured' })
  }
  switch (route) {
    case '/auth/login': return auth.login(event)
    case '/auth/callback': return auth.callback(event)
    case '/auth/session': return { session: await auth.getSession(event) }
    case '/auth/logout': return auth.logout(event)
    default: throw createError({ statusCode: 404, statusMessage: 'Unknown authentication route' })
  }
})
