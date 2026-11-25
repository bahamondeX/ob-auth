import type { H3Event } from 'h3'
import { useRuntimeConfig } from '#imports'
import { createServerAuth, type ServerAuthOptions } from '@oscarbahamonde/ob-auth/server'

export function obAuthServer(event: H3Event) {
  return createServerAuth(useRuntimeConfig(event).obAuth as ServerAuthOptions)
}

export async function requireObAuth(event: H3Event) {
  return obAuthServer(event).requireAuth(event)
}
