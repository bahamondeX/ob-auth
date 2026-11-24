import { defineNuxtRouteMiddleware, navigateTo, useRequestFetch, useResponseHeader } from '#imports'
import { loginPath, type AuthSession } from '@oscarbahamonde/auth/core'

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) useResponseHeader('cache-control').value = 'private, no-store'
  const result = await useRequestFetch()<{ session: AuthSession | null }>('/auth/session')
  if (!result.session) return navigateTo(loginPath(to.fullPath), { external: true })
})
