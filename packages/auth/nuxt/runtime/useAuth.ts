import { computed } from 'vue'
import { useAsyncData, useRequestFetch, useResponseHeader } from '#imports'
import { AuthRequiredError, createAuthClient, parseSession, type AuthSession, type LogoutOptions } from '@oscarbahamonde/auth/core'

export function useAuth() {
  if (import.meta.server) useResponseHeader('cache-control').value = 'private, no-store'
  const request = useRequestFetch()
  const client = createAuthClient()

  async function getSession() {
    const response = await request<{ session: AuthSession | null }>('/auth/session')
    return response.session === null ? null : parseSession(response.session)
  }

  const { data, pending, error, refresh, clear } = useAsyncData('ob-auth-session', async () => ({ session: await getSession() }))
  const session = computed(() => data.value?.session ?? null)

  async function logout(options?: LogoutOptions) {
    await client.logout(options)
    if (!options?.everywhere) clear()
  }

  return {
    session, pending, error, refresh,
    user: computed(() => session.value?.user ?? null),
    isAuthenticated: computed(() => session.value !== null),
    login: client.login, logout, getSession,
    async getUser() { return (await getSession())?.user ?? null },
    async requireAuth() {
      const current = await getSession()
      if (!current) throw new AuthRequiredError()
      return current
    },
  }
}
