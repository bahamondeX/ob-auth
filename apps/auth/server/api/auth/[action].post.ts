import { z } from 'zod'
import { digest } from '../../utils/crypto'
import { clearCookie, cookie, csrf, httpError, json, rate, requireSession, safeError, sessionFor } from '../../utils/http'
import { challenge, directoryAction, linkIdentity, newPassword, signIn } from '../../utils/native'
import { approve, backchannel, logoutDestination } from '../../utils/relying-party'
import { runtime } from '../../utils/runtime'
import { changePassword, globalLogout, revokeSession } from '../../utils/session'
import { keys } from '../../utils/state'

export default defineEventHandler(async event => {
  const action = getRouterParam(event, 'action')
  try {
    if (action === 'ticket' || action === 'introspect' || action === 'end-grant') {
      return await backchannel(event, await runtime(), action)
    }
    csrf(event)
    const rt = await runtime()
    switch (action) {
      case 'signup': case 'confirm': case 'resend': case 'forgot': case 'reset':
        return await directoryAction(event, rt, action)
      case 'signin': return await signIn(event, rt)
      case 'challenge': return await challenge(event, rt)
      case 'link': return await linkIdentity(event, rt, await requireSession(event, rt))
      case 'approve':
        await rate(event, rt, action, 45, 300)
        return await approve(event, rt)
      case 'logout': {
        await rate(event, rt, action, 30, 300)
        const row = await sessionFor(event, rt)
        const federated = !!(row && row.user.provider !== 'password' && rt.config.COGNITO_DOMAIN)
        const destination = await logoutDestination(event, rt, !federated)
        if (row) await globalLogout(rt, row.username, row.sessionOwner)
        for (const name of ['sid', 'intent', 'flow', 'oauth'] as const) {
          const token = cookie(event, name)
          if (token && name !== 'sid') await rt.store.delete(keys[name](token))
          clearCookie(event, name)
        }
        if (federated) {
          const url = new URL('/logout', rt.config.COGNITO_DOMAIN)
          url.search = new URLSearchParams({
            client_id: rt.cognito.clientId,
            logout_uri: rt.config.AUTH_DOMAIN + '/api/auth/signed-out'
          }).toString()
          return { next: url.href }
        }
        return { next: destination?.url }
      }
      case 'revoke': {
        const row = await requireSession(event, rt)
        await rate(event, rt, action, 25, 300, row.sessionOwner)
        const { id } = await json(event, z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{43}$/) }))
        const target = await rt.store.activeSession('session#' + id)
        if (!target || target.sessionOwner !== row.sessionOwner) throw httpError(404, 'Session unavailable')
        if (target.pk === row.pk) clearCookie(event, 'sid')
        await revokeSession(rt, target)
        return { ok: true }
      }
      case 'password': {
        const row = await requireSession(event, rt)
        await rate(event, rt, action, 15, 300, row.sessionOwner)
        const body = await json(event, z.object({ oldPassword: z.string().min(1).max(256), password: newPassword }))
        await changePassword(rt, row, body.oldPassword, body.password)
        clearCookie(event, 'sid')
        return { ok: true }
      }
      case 'cancel': {
        for (const [name, prefix] of [['intent', keys.intent], ['logout', (value: string) => 'logout#' + digest(value)]] as const) {
          const value = cookie(event, name)
          if (value) await rt.store.delete(prefix(value))
          clearCookie(event, name)
        }
        return { ok: true }
      }
      default: throw httpError(404, 'Action unavailable')
    }
  } catch (error) {
    throw safeError(error)
  }
})
