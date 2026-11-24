import { AdminLinkProviderForUserCommand } from '@aws-sdk/client-cognito-identity-provider'
import { getRequestURL, sendRedirect, type H3Event } from 'h3'
import * as oidc from 'openid-client'
import { z } from 'zod'
import type { Provider } from './config'
import { digest, epoch, equal, randomToken } from './crypto'
import { clearCookie, cookie, httpError, rate, requireSession, setAuthCookie } from './http'
import type { Runtime } from './runtime'
import { establish, revokeSession } from './session'
import { conflict, keys, type BaseRow, type Session } from './state'

export const providerName = { google: 'Google', microsoft: 'Microsoft', github: 'GitHub' } as const
const expiry = 480
interface Federation extends BaseRow {
  ttl: number
  mode: 'sign-in' | 'link'
  provider: Provider
  state: string
  nonce: string
  verifier: string
  centralKey?: string
}
const tokenResult = z.object({ access_token: z.string().min(1), id_token: z.string().min(1), refresh_token: z.string().min(1) })

async function createOAuth(event: H3Event, rt: Runtime, mode: Federation['mode'], provider: Provider, centralKey?: string) {
  if (!rt.config.providers.includes(provider)) throw httpError(404, 'Provider unavailable')
  const old = cookie(event, 'oauth')
  if (old) await rt.store.delete(keys.oauth(old))
  const raw = randomToken()
  const row: Federation = {
    pk: keys.oauth(raw), ttl: epoch() + expiry, mode, provider, state: randomToken(),
    nonce: randomToken(), verifier: randomToken(), centralKey
  }
  await rt.store.put(row)
  setAuthCookie(event, 'oauth', raw, expiry)
  return row
}

const callback = (rt: Runtime, mode: Federation['mode']) => rt.config.AUTH_DOMAIN + '/api/auth/' + (mode === 'sign-in' ? 'callback' : 'link-callback')
const params = (row: Federation, rt: Runtime) => ({
  redirect_uri: callback(rt, row.mode), scope: 'openid email profile', state: row.state, nonce: row.nonce,
  code_challenge: digest(row.verifier), code_challenge_method: 'S256', response_type: 'code', prompt: 'login'
})

export async function startFederation(event: H3Event, rt: Runtime, provider: Provider) {
  await rate(event, rt, 'federate', 30, 300)
  const row = await createOAuth(event, rt, 'sign-in', provider)
  const url = new URL('/oauth2/authorize', rt.config.COGNITO_DOMAIN)
  url.search = new URLSearchParams({ ...params(row, rt), client_id: rt.cognito.clientId, identity_provider: providerName[provider] }).toString()
  return { next: url.toString() }
}

async function directProvider(rt: Runtime, provider: Provider) {
  const secret = await rt.provider(provider)
  const issuer = provider === 'google' ? 'https://accounts.google.com' : secret.issuer
  if (!issuer || new URL(issuer).protocol !== 'https:') throw httpError(503, 'Provider unavailable')
  const config = await oidc.discovery(new URL(issuer), secret.clientId, undefined, oidc.ClientSecretPost(secret.clientSecret))
  oidc.enableNonRepudiationChecks(config)
  return config
}

export async function startLink(event: H3Event, rt: Runtime, session: Session, provider: Provider) {
  const config = await directProvider(rt, provider)
  const row = await createOAuth(event, rt, 'link', provider, session.pk)
  return oidc.buildAuthorizationUrl(config, params(row, rt)).toString()
}

async function exchange(event: H3Event, rt: Runtime, mode: Federation['mode']) {
  const raw = cookie(event, 'oauth')
  const state = getRequestURL(event).searchParams.get('state')
  if (!raw || !state) throw httpError(400, 'Sign-in transaction expired')
  const pk = keys.oauth(raw)
  const expected = await rt.store.live<Federation>(pk)
  if (!expected || expected.mode !== mode || !equal(state, expected.state)) throw httpError(400, 'Sign-in transaction expired')
  const row = await rt.store.consume<Federation>(pk)
  clearCookie(event, 'oauth')
  const query = getRequestURL(event).searchParams
  if (query.has('error') || query.getAll('code').length !== 1 || query.getAll('state').length !== 1) throw httpError(401, 'Provider sign-in was not completed')
  return { row, query, code: query.get('code')! }
}

export async function federationCallback(event: H3Event, rt: Runtime) {
  const { row, code } = await exchange(event, rt, 'sign-in')
  const tokenUrl = new URL('/oauth2/token', rt.config.COGNITO_DOMAIN)
  const response = await fetch(tokenUrl, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: {
      authorization: 'Basic ' + Buffer.from(rt.cognito.clientId + ':' + rt.cognito.secret).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: callback(rt, row.mode), code_verifier: row.verifier
    })
  })
  if (!response.ok) throw httpError(401, 'Provider sign-in could not be verified')
  const tokens = tokenResult.parse(await response.json())
  const identity = await rt.cognito.identity({ AccessToken: tokens.access_token, IdToken: tokens.id_token, RefreshToken: tokens.refresh_token }, row.provider, false, row.nonce)
  const old = cookie(event, 'sid')
  const previous = old && await rt.store.activeSession(keys.sid(old))
  if (previous) await revokeSession(rt, previous)
  const session = await establish(rt, identity)
  setAuthCookie(event, 'sid', session.raw, rt.config.SESSION_ABSOLUTE_SECONDS)
  return sendRedirect(event, '/', 303)
}

export async function linkCallback(event: H3Event, rt: Runtime) {
  const { row, query } = await exchange(event, rt, 'link')
  const session = await requireSession(event, rt)
  if (session.pk !== row.centralKey || !session.user.mfa || session.user.provider !== 'password') throw httpError(403, 'Confirm your original identity first')
  const provider = await directProvider(rt, row.provider)
  const url = new URL(callback(rt, row.mode))
  url.search = query.toString()
  const tokens = await oidc.authorizationCodeGrant(provider, url, { pkceCodeVerifier: row.verifier, expectedState: row.state, expectedNonce: row.nonce, idTokenExpected: true })
  const claims = tokens.claims()
  if (!claims?.sub || claims.email_verified !== true || typeof claims.email !== 'string' || claims.email.toLowerCase() !== session.user.email.toLowerCase()) throw httpError(403, 'Linking requires the same verified email and proof of both identities')
  if (!await rt.store.activeSession(session.pk)) throw httpError(401, 'Sign-in required')
  try {
    await rt.cognito.client.send(new AdminLinkProviderForUserCommand({
      UserPoolId: rt.config.COGNITO_USER_POOL_ID,
      DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: session.username },
      SourceUser: { ProviderName: providerName[row.provider], ProviderAttributeName: 'Cognito_Subject', ProviderAttributeValue: claims.sub }
    }))
  } catch (error) {
    if (conflict(error) || (error instanceof Error && ['AliasExistsException', 'InvalidParameterException', 'LimitExceededException'].includes(error.name))) {
      throw httpError(409, 'This identity cannot be linked to the current account')
    }
    throw error
  }
  return sendRedirect(event, '/?linked=1', 303)
}
