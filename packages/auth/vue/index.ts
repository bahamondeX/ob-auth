import { computed, onMounted, readonly, shallowRef } from 'vue'
import { createAuthClient, type AuthClient, type AuthSession, type LogoutOptions } from '../core/index.ts'

export function useAuth(client: AuthClient = createAuthClient(), initialSession: AuthSession | null = null) {
  const session = shallowRef<AuthSession | null>(initialSession)
  const pending = shallowRef(initialSession === null)
  const error = shallowRef<unknown>(null)
  let revision = 0

  async function refresh() {
    const request = ++revision
    pending.value = true
    error.value = null
    try {
      const current = await client.getSession()
      if (request === revision) session.value = current
    } catch (cause) {
      if (request === revision) {
        session.value = null
        error.value = cause
      }
    } finally {
      if (request === revision) pending.value = false
    }
  }

  async function logout(options?: LogoutOptions) {
    await client.logout(options)
    if (!options?.everywhere) {
      revision++
      session.value = null
      pending.value = false
      error.value = null
    }
  }

  onMounted(refresh)

  return {
    session: readonly(session), pending: readonly(pending), error: readonly(error),
    user: computed(() => session.value?.user ?? null),
    isAuthenticated: computed(() => session.value !== null),
    login: client.login, logout, refresh, getSession: client.getSession,
    getUser: client.getUser, requireAuth: client.requireAuth,
  }
}
