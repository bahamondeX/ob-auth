import { useCallback, useEffect, useRef, useState } from 'react'
import { createAuthClient, type AuthClient, type AuthSession, type LogoutOptions } from '../core/index.ts'

const defaultClient = createAuthClient()

export function useAuth(client: AuthClient = defaultClient, initialSession: AuthSession | null = null) {
  const [session, setSession] = useState(initialSession)
  const [pending, setPending] = useState(initialSession === null)
  const [error, setError] = useState<unknown>(null)
  const revision = useRef(0)

  const load = useCallback(async (signal?: AbortSignal) => {
    const request = ++revision.current
    const currentRequest = () => request === revision.current && !signal?.aborted
    setPending(true)
    setError(null)
    try {
      const current = await client.getSession()
      if (currentRequest()) setSession(current)
    } catch (cause) {
      if (currentRequest()) {
        setSession(null)
        setError(cause)
      }
    } finally {
      if (currentRequest()) setPending(false)
    }
  }, [client])

  const refresh = useCallback(() => load(), [load])
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const logout = useCallback(async (options?: LogoutOptions) => {
    await client.logout(options)
    if (!options?.everywhere) {
      revision.current++
      setSession(null)
      setPending(false)
      setError(null)
    }
  }, [client])

  return {
    session, pending, error, user: session?.user ?? null, isAuthenticated: session !== null,
    login: client.login, logout, refresh, getSession: client.getSession,
    getUser: client.getUser, requireAuth: client.requireAuth,
  }
}
