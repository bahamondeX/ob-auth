import {
  AdminGetUserCommand, ConfirmForgotPasswordCommand, ConfirmSignUpCommand, ForgotPasswordCommand,
  ResendConfirmationCodeCommand, SignUpCommand, type InitiateAuthCommandOutput
} from '@aws-sdk/client-cognito-identity-provider'
import type { H3Event } from 'h3'
import { z } from 'zod'
import type { Identity } from './cognito'
import { epoch, randomToken, type Ciphertext } from './crypto'
import { clearCookie, cookie, httpError, json, rate, requireSession, setAuthCookie } from './http'
import type { Runtime } from './runtime'
import { establish, globalLogout, revokeSession } from './session'
import { keys, type BaseRow, type Session } from './state'

export const emailSchema = z.email().max(254).transform(email => email.trim().toLowerCase())
const passwordSchema = z.string().min(1).max(256)
export const newPassword = z.string().min(12).max(256)
const codeSchema = z.string().regex(/^\d{6}$/)
const credentials = z.object({ email: emailSchema, password: passwordSchema })
const confirmation = z.object({ email: emailSchema, code: codeSchema })
const emailOnly = z.object({ email: emailSchema })

type Step =
  | { kind: 'totp' | 'pool-enroll' | 'new_password'; username: string; session: string }
  | { kind: 'enroll'; identity: Identity }
type LinkIntent = { provider: 'google' | 'microsoft' | 'github'; centralKey: string; sub: string }
interface Flow extends BaseRow { ttl: number; encrypted: Ciphertext }
interface FlowData { step: Step; link?: LinkIntent }

async function createFlow(event: H3Event, rt: Runtime, step: Step, link?: LinkIntent) {
  const old = cookie(event, 'flow')
  if (old) await rt.store.delete(keys.flow(old))
  const raw = randomToken()
  const pk = keys.flow(raw)
  const lifetime = 7 * 60
  await rt.store.put<Flow>({ pk, ttl: epoch() + lifetime, encrypted: await rt.encryption.seal({ step, link }, pk) })
  setAuthCookie(event, 'flow', raw, lifetime)
}

function enrollment(secret: string, label: string) {
  const query = new URLSearchParams({ secret, issuer: 'OB Auth', digits: '6', period: '30', algorithm: 'SHA1' })
  return { step: 'enroll', secret, otpauth: 'otpauth://totp/OB%20Auth:' + encodeURIComponent(label) + '?' + query }
}

async function finish(event: H3Event, rt: Runtime, identity: Identity, link?: LinkIntent) {
  if (link) {
    const current = await requireSession(event, rt)
    if (current.pk !== link.centralKey || identity.user.sub !== link.sub || !identity.user.mfa) throw httpError(403, 'Confirm your original identity first')
    const { startLink } = await import('./federation')
    return { step: 'authenticated', next: await startLink(event, rt, current, link.provider) }
  }
  const oldSid = cookie(event, 'sid')
  const old = oldSid && await rt.store.activeSession(keys.sid(oldSid))
  if (old) await revokeSession(rt, old)
  const { raw } = await establish(rt, identity)
  setAuthCookie(event, 'sid', raw, rt.config.SESSION_ABSOLUTE_SECONDS)
  return { step: 'authenticated' }
}

async function processResult(
  event: H3Event, rt: Runtime, result: InitiateAuthCommandOutput, username: string, mfa = false, link?: LinkIntent
) {
  if (result.AuthenticationResult) {
    const identity = await rt.cognito.identity(result.AuthenticationResult, 'password', mfa)
    if (!identity.user.emailVerified) throw httpError(403, 'Verify your email before signing in')
    if (mfa) return finish(event, rt, identity, link)
    if (link) throw httpError(403, 'TOTP verification is required to link an identity')
    const { SecretCode } = await rt.cognito.associate({ AccessToken: identity.tokens.access })
    if (!SecretCode) throw httpError(503, 'Authenticator enrollment unavailable')
    await createFlow(event, rt, { kind: 'enroll', identity })
    return enrollment(SecretCode, identity.user.email)
  }
  const challenge = rt.cognito.challenge(result, username)
  if (challenge.challenge === 'SOFTWARE_TOKEN_MFA') {
    await createFlow(event, rt, { kind: 'totp', username: challenge.username, session: challenge.session }, link)
    return { step: 'totp' }
  }
  if (challenge.challenge === 'MFA_SETUP' && !link) {
    const association = await rt.cognito.associate({ Session: challenge.session })
    if (!association.SecretCode || !association.Session) throw httpError(503, 'Authenticator enrollment unavailable')
    await createFlow(event, rt, { kind: 'pool-enroll', username: challenge.username, session: association.Session })
    return enrollment(association.SecretCode, username)
  }
  if (challenge.challenge === 'NEW_PASSWORD_REQUIRED' && !link && (!result.ChallengeParameters?.requiredAttributes || result.ChallengeParameters.requiredAttributes === '[]')) {
    await createFlow(event, rt, { kind: 'new_password', username: challenge.username, session: challenge.session })
    return { step: 'new_password' }
  }
  throw httpError(403, 'This sign-in requires an unsupported directory challenge')
}

function hasName(error: unknown, names: string[]) {
  return error instanceof Error && names.includes(error.name)
}

export async function signIn(event: H3Event, rt: Runtime) {
  const { email, password } = await json(event, credentials)
  await rate(event, rt, 'sign-in', 18, 300, email)
  let result
  try {
    result = await rt.cognito.initiate(email, password)
  } catch (error) {
    if (hasName(error, ['UserNotConfirmedException', 'PasswordResetRequiredException'])) throw httpError(401, 'Authentication could not be completed')
    throw error
  }
  return processResult(event, rt, result, email)
}

export async function linkIdentity(event: H3Event, rt: Runtime, row: Session) {
  const { provider, password } = await json(event, z.object({ provider: z.enum(['google', 'github']), password: passwordSchema }))
  if (row.user.provider !== 'password' || !row.user.mfa || !rt.config.providers.includes(provider)) throw httpError(403, 'Linking requires a verified password account and an enabled provider')
  await rate(event, rt, 'link', 10, 300, row.user.sub)
  return processResult(event, rt, await rt.cognito.initiate(row.user.email, password), row.user.email, false, {
    provider, centralKey: row.pk, sub: row.user.sub
  })
}

export async function challenge(event: H3Event, rt: Runtime) {
  const { code, password } = await json(event, z.object({ code: codeSchema.optional(), password: newPassword.optional() }))
  const raw = cookie(event, 'flow')
  if (!raw) throw httpError(401, 'Sign-in challenge expired')
  const pk = keys.flow(raw)
  await rate(event, rt, 'challenge', 25, 300, raw)
  const row = await rt.store.live<Flow>(pk)
  if (!row) throw httpError(401, 'Sign-in challenge expired')
  const { step, link } = await rt.encryption.open<FlowData>(row.encrypted, pk)
  if (step.kind === 'new_password' ? !password : !code) throw httpError(400, 'Complete the requested verification')
  await rt.store.consume<Flow>(pk)
  let result: InitiateAuthCommandOutput | undefined
  try {
    if (step.kind === 'enroll') {
      await rt.cognito.verifyTotp({ AccessToken: step.identity.tokens.access }, code!)
      await rt.cognito.enableTotp(step.identity.tokens.access)
    } else if (step.kind === 'pool-enroll') {
      const verification = await rt.cognito.verifyTotp({ Session: step.session }, code!)
      if (!verification.Session) throw httpError(401, 'Sign-in challenge expired')
      result = await rt.cognito.respond('MFA_SETUP', step.username, verification.Session)
    } else if (step.kind === 'new_password') {
      result = await rt.cognito.respond('NEW_PASSWORD_REQUIRED', step.username, step.session, password!)
    } else {
      result = await rt.cognito.respond('SOFTWARE_TOKEN_MFA', step.username, step.session, code!)
    }
  } catch (error) {
    if (hasName(error, ['CodeMismatchException', 'EnableSoftwareTokenMFAException', 'InvalidPasswordException', 'InvalidIdentity']) && row.ttl > epoch()) await rt.store.put(row)
    throw error
  }
  clearCookie(event, 'flow')
  if (step.kind === 'enroll') return finish(event, rt, { ...step.identity, user: { ...step.identity.user, mfa: true } })
  if (!result) throw httpError(401, 'Sign-in challenge expired')
  return processResult(event, rt, result, step.username, step.kind !== 'new_password', link)
}

export async function directoryAction(event: H3Event, rt: Runtime, action: string) {
  const { cognito } = rt
  if (action === 'signup') {
    const { email, password } = await json(event, credentials.extend({ password: newPassword }))
    await rate(event, rt, action, 12, 300, email)
    try {
      await cognito.client.send(new SignUpCommand({
        ClientId: cognito.clientId, SecretHash: cognito.hash(email), Username: email, Password: password,
        UserAttributes: [{ Name: 'email', Value: email }]
      }))
    } catch (error) {
      if (!hasName(error, ['UsernameExistsException', 'AliasExistsException'])) throw error
    }
    return { step: 'confirm' }
  }
  if (action === 'reset') {
    const { email, code, password } = await json(event, confirmation.extend({ password: newPassword }))
    await rate(event, rt, action, 15, 300, email)
    try {
      await cognito.client.send(new ConfirmForgotPasswordCommand({
        ClientId: cognito.clientId, SecretHash: cognito.hash(email), Username: email, ConfirmationCode: code, Password: password
      }))
    } catch (error) {
      if (hasName(error, ['UserNotFoundException', 'NotAuthorizedException', 'InvalidParameterException'])) throw httpError(400, 'The code is invalid or expired')
      throw error
    }
    const user = await cognito.client.send(new AdminGetUserCommand({
      UserPoolId: rt.config.COGNITO_USER_POOL_ID, Username: email
    }))
    const sub = user.UserAttributes?.find(attribute => attribute.Name === 'sub')?.Value
    if (!user.Username || !sub) throw httpError(503, 'Password reset session cleanup unavailable')
    await globalLogout(rt, user.Username, sub)
    return { ok: true }
  }
  if (action === 'confirm') {
    const { email, code } = await json(event, confirmation)
    await rate(event, rt, action, 20, 300, email)
    try {
      await cognito.client.send(new ConfirmSignUpCommand({
        ClientId: cognito.clientId, SecretHash: cognito.hash(email), Username: email, ConfirmationCode: code, ForceAliasCreation: false
      }))
    } catch (error) {
      if (hasName(error, ['AliasExistsException', 'UserNotFoundException', 'NotAuthorizedException'])) throw httpError(400, 'The code is invalid or expired')
      throw error
    }
    return { ok: true }
  }
  const { email } = await json(event, emailOnly)
  await rate(event, rt, action, 12, 300, email)
  const input = { ClientId: cognito.clientId, SecretHash: cognito.hash(email), Username: email }
  try {
    if (action === 'resend') await cognito.client.send(new ResendConfirmationCodeCommand(input))
    else await cognito.client.send(new ForgotPasswordCommand(input))
  } catch (error) {
    if (!hasName(error, ['UserNotFoundException', 'NotAuthorizedException', 'InvalidParameterException', 'LimitExceededException'])) throw error
  }
  return { ok: true }
}
