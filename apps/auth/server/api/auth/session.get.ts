import { epoch } from '../../utils/crypto'
import { safeError, sessionFor } from '../../utils/http'
import { application, logoutDestination } from '../../utils/relying-party'
import { runtime } from '../../utils/runtime'
import { currentTokens, touch } from '../../utils/session'

export default defineEventHandler(async event => {
  try {
    const rt = await runtime()
    const [row, destination, logout] = await Promise.all([
      sessionFor(event, rt), application(event, rt), logoutDestination(event, rt)
    ])
    if (!row) return { user: null, providers: rt.config.providers, application: logout?.application ?? destination, logout: !!logout }
    if (row.tokenExpiresAt <= epoch() + 30) await currentTokens(rt, row)
    await touch(rt, row)
    const sessions = (await rt.store.sessions(row.sessionOwner))
      .filter(session => !session.revoked && session.generation === row.generation && session.ttl > epoch() && session.idleUntil > epoch())
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map(session => ({ id: session.pk.slice('session#'.length), current: session.pk === row.pk, createdAt: session.createdAt, lastSeen: session.lastSeen }))
    return { user: row.user, providers: rt.config.providers, application: logout?.application ?? destination, sessions, logout: !!logout }
  } catch (error) {
    throw safeError(error)
  }
})
