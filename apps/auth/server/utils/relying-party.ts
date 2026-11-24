import { getQuery, getRequestHeader, sendNoContent, sendRedirect, type H3Event } from 'h3'
import { z } from 'zod'
import { digest, epoch, equal, randomToken } from './crypto'
import { clearCookie, cookie, httpError, json, rate, requireSession, setAuthCookie } from './http'
import type { Runtime } from './runtime'
import { currentTokens, touch } from './session'
import { conflict, keys, type Client, type Grant, type Intent, type Session, type Ticket } from './state'

const clientId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const token = z.string().regex(/^[a-zA-Z0-9_-]{43}$/)
const verifier = z.string().regex(/^[a-zA-Z0-9_.~-]{43,128}$/)
const redirect = z.url().max(2048).refine(value => {
  const url = new URL(value)
  return (url.href === value || url.origin === value) && trustedUrl(value) && !['code', 'state', 'error'].some(key => url.searchParams.has(key))
})
const authorization = z.object({
  client_id: clientId, redirect_uri: redirect, state: z.string().regex(/^[a-zA-Z0-9_.~-]{32,256}$/),
  code_challenge: token, code_challenge_method: z.literal('S256')
})
const logoutRequest = z.object({ client_id: clientId, logout_uri: redirect })

type Logout = { pk: string; ttl: number; clientId: string; url: string }
function trustedUrl(value: string) {
  const url = new URL(value)
  return !url.username && !url.password && !url.hash && (url.protocol === 'https:' ||
    (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
}

async function registered(rt: Runtime, id: string) {
  const client = await rt.store.get<Client>(keys.client(id))
  return client?.enabled && client.clientId === id ? client : undefined
}

async function allowDestination(rt: Runtime, id: string, url: string, purpose: 'callbacks' | 'logoutUrls') {
  const client = await registered(rt, id)
  if (!client?.[purpose].includes(url) || !trustedUrl(url)) throw httpError(400, 'Application or destination unavailable')
  return client
}

function allows(client: Client, { user }: Session) {
  const policy = client.policy
  return (!policy.requireMfa || user.mfa) && (!policy.requireVerifiedEmail || user.emailVerified) &&
    (!policy.allowedSubjects.length || policy.allowedSubjects.includes(user.sub))
}

export async function authorize(event: H3Event, rt: Runtime) {
  const result = authorization.safeParse(getQuery(event))
  if (!result.success) throw httpError(400, 'Invalid application request')
  const query = result.data
  await rate(event, rt, 'authorize', 80, 300)
  await allowDestination(rt, query.client_id, query.redirect_uri, 'callbacks')
  const previous = cookie(event, 'intent')
  if (previous) await rt.store.delete(keys.intent(previous))
  const raw = randomToken()
  const lifetime = 900
  await rt.store.put<Intent>({
    pk: keys.intent(raw), ttl: epoch() + lifetime, clientId: query.client_id, redirectUri: query.redirect_uri,
    state: query.state, challenge: query.code_challenge
  })
  setAuthCookie(event, 'intent', raw, lifetime)
  return sendRedirect(event, '/', 303)
}

export async function application(event: H3Event, rt: Runtime) {
  const raw = cookie(event, 'intent')
  if (!raw) return
  const intent = await rt.store.live<Intent>(keys.intent(raw))
  if (!intent) {
    clearCookie(event, 'intent')
    return
  }
  const client = await allowDestination(rt, intent.clientId, intent.redirectUri, 'callbacks')
  return { name: client.name, logo: client.logo }
}

export async function approve(event: H3Event, rt: Runtime) {
  const session = await requireSession(event, rt)
  const raw = cookie(event, 'intent')
  if (!raw) throw httpError(410, 'Application request expired')
  const intent = await rt.store.live<Intent>(keys.intent(raw))
  if (!intent) throw httpError(410, 'Application request expired')
  const client = await allowDestination(rt, intent.clientId, intent.redirectUri, 'callbacks')
  if (!allows(client, session)) throw httpError(403, 'Application sign-in policy not met')
  if (session.tokenExpiresAt <= epoch() + 30) await currentTokens(rt, session)
  await touch(rt, session)
  const code = randomToken()
  await rt.store.issueTicket(session, intent, {
    ...intent, pk: keys.ticket(code), sessionKey: session.pk, ttl: Math.min(session.ttl, epoch() + rt.config.TICKET_SECONDS)
  })
  clearCookie(event, 'intent')
  const next = new URL(intent.redirectUri)
  next.searchParams.set('code', code)
  next.searchParams.set('state', intent.state)
  return { next: next.href }
}

async function authenticateApplication(event: H3Event, rt: Runtime, operation: string) {
  const header = getRequestHeader(event, 'authorization') ?? ''
  if (header.length > 550 || !/^Basic [A-Za-z0-9+/]+={0,2}$/i.test(header)) throw httpError(401, 'Application authentication required')
  const credentials = Buffer.from(header.slice(6), 'base64').toString('utf8')
  const [id, secret, extra] = credentials.split(':')
  if (!clientId.safeParse(id).success || !secret || !/^[a-zA-Z0-9_-]{32,256}$/.test(secret) || extra !== undefined) {
    throw httpError(401, 'Application authentication required')
  }
  const client = await registered(rt, id!)
  const matches = equal(digest(secret), client?.secretDigest ?? digest('unregistered application'))
  if (client?.clientAuth !== 'client_secret_basic' || !matches) throw httpError(401, 'Application authentication required')
  // Polling and protected API requests can share a backend IP.
  if (!await rt.store.rate('client:' + client.clientId + ':' + operation, operation === 'introspect' ? 1200 : 120, 60)) {
    throw httpError(429, 'Try again later')
  }
  return client
}

export async function backchannel(event: H3Event, rt: Runtime, operation: 'ticket' | 'introspect' | 'end-grant') {
  await rate(event, rt, 'backchannel:' + operation, 2400, 60)
  const client = await authenticateApplication(event, rt, operation)
  if (operation !== 'ticket') {
    const { grant } = await json(event, z.object({ grant: token }))
    const row = await rt.store.live<Grant>(keys.grant(grant))
    if (row?.clientId !== client.clientId) throw httpError(401, 'Application session unavailable')
    if (operation === 'end-grant') {
      await rt.store.delete(row.pk)
      return sendNoContent(event, 204)
    }
    const session = await rt.store.activeSession(row.sessionKey)
    if (!session || !allows(client, session)) throw httpError(401, 'Application session unavailable')
    if (session.tokenExpiresAt <= epoch() + 30) await currentTokens(rt, session)
    await touch(rt, session)
    return { user: session.user, expiresAt: row.ttl }
  }
  const input = await json(event, z.object({ code: token, redirectUri: redirect, verifier }))
  const ticket = await rt.store.live<Ticket>(keys.ticket(input.code))
  if (ticket?.clientId !== client.clientId || ticket.redirectUri !== input.redirectUri ||
    !client.callbacks.includes(input.redirectUri) || !equal(digest(input.verifier), ticket.challenge)) {
    throw httpError(401, 'Authorization ticket unavailable')
  }
  const session = await rt.store.activeSession(ticket.sessionKey)
  if (!session || !allows(client, session)) throw httpError(401, 'Authorization ticket unavailable')
  const grant = randomToken()
  const expiresAt = session.ttl
  try {
    await rt.store.exchangeTicket(ticket, session, { pk: keys.grant(grant), clientId: client.clientId, sessionKey: session.pk, ttl: expiresAt })
  } catch (error) {
    if (conflict(error)) throw httpError(401, 'Authorization ticket unavailable')
    throw error
  }
  return { grant, user: session.user, expiresAt }
}

export async function beginLogout(event: H3Event, rt: Runtime) {
  const result = logoutRequest.safeParse(getQuery(event))
  if (!result.success) throw httpError(400, 'Invalid application request')
  await rate(event, rt, 'logout-intent', 45, 300)
  const { client_id: id, logout_uri: url } = result.data
  await allowDestination(rt, id, url, 'logoutUrls')
  const old = cookie(event, 'logout')
  if (old) await rt.store.delete('logout#' + digest(old))
  const raw = randomToken()
  await rt.store.put<Logout>({ pk: 'logout#' + digest(raw), ttl: epoch() + 300, clientId: id, url })
  setAuthCookie(event, 'logout', raw, 300)
  return sendRedirect(event, '/', 303)
}

export async function logoutDestination(event: H3Event, rt: Runtime, consume = false) {
  const raw = cookie(event, 'logout')
  if (!raw) return
  const key = 'logout#' + digest(raw)
  const row = await rt.store.live<Logout>(key)
  if (consume || !row) clearCookie(event, 'logout')
  if (!row) return
  const client = await allowDestination(rt, row.clientId, row.url, 'logoutUrls')
  if (consume) await rt.store.consume<Logout>(key)
  return { url: row.url, application: { name: client.name, logo: client.logo } }
}
