import { createError, getCookie, getRequestHeader, getRequestIP, getRequestWebStream, setCookie, type H3Event } from 'h3'
import type { ZodType } from 'zod'
import { publicOrigin } from './config'
import { digest } from './crypto'
import type { Runtime } from './runtime'
import { conflict, keys } from './state'

type Cookie = 'sid' | 'intent' | 'flow' | 'oauth' | 'logout'
const name = (kind: Cookie) => (publicOrigin().startsWith('https:') ? '__Host-' : '') + 'ob_' + kind
const options = { httpOnly: true, sameSite: 'lax', path: '/' } as const

export const cookie = (event: H3Event, kind: Cookie) => getCookie(event, name(kind))
export function setAuthCookie(event: H3Event, kind: Cookie, value: string, maxAge: number) {
  setCookie(event, name(kind), value, { ...options, maxAge, secure: publicOrigin().startsWith('https:') })
}
export function clearCookie(event: H3Event, kind: Cookie) {
  setAuthCookie(event, kind, '', 0)
}

export const httpError = (statusCode: number, statusMessage: string) => createError({ statusCode, statusMessage })

export async function json<T>(event: H3Event, schema: ZodType<T>) {
  if (getRequestHeader(event, 'content-type')?.split(';')[0]?.trim() !== 'application/json') throw httpError(415, 'JSON required')
  const maximum = 8192
  const size = Number(getRequestHeader(event, 'content-length'))
  if (size > maximum) throw httpError(413, 'Request too large')
  const reader = getRequestWebStream(event)?.getReader()
  if (!reader) throw httpError(400, 'JSON body required')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maximum) {
        void reader.cancel().catch(() => {})
        throw httpError(413, 'Request too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  let input: unknown
  try {
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } catch {
    throw httpError(400, 'Invalid JSON')
  }
  const result = schema.safeParse(input)
  if (!result.success) throw httpError(400, 'Check the supplied fields')
  return result.data
}

export function csrf(event: H3Event) {
  if (getRequestHeader(event, 'origin') !== publicOrigin() || getRequestHeader(event, 'sec-fetch-site') === 'cross-site') throw httpError(403, 'Request origin rejected')
}

export async function rate(event: H3Event, rt: Runtime, op: string, max = 25, period = 300, subject?: string) {
  const ip = process.env.VERCEL === '1' ? getRequestHeader(event, 'x-vercel-forwarded-for')?.split(',')[0]?.trim() : getRequestIP(event)
  const bucket = await rt.store.rate('ip:' + (ip || 'unknown') + ':' + op, max, period)
  const accountBucket = !subject || await rt.store.rate('subject:' + digest(subject) + ':' + op, Math.max(5, Math.floor(max / 2)), period)
  if (!bucket || !accountBucket) throw httpError(429, 'Try again later')
}

export async function sessionFor(event: H3Event, rt: Runtime) {
  const token = cookie(event, 'sid')
  if (token) {
    const row = await rt.store.activeSession(keys.sid(token))
    if (row) return row
    clearCookie(event, 'sid')
  }
}

export async function requireSession(event: H3Event, rt: Runtime) {
  const row = await sessionFor(event, rt)
  if (!row) throw httpError(401, 'Sign-in required')
  return row
}

export function safeError(error: unknown) {
  if (typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number') return error
  if (conflict(error)) return httpError(409, 'This step expired or was already completed')
  const name = error instanceof Error ? error.name : ''
  switch (name) {
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
    case 'InvalidIdentity':
    case 'SessionExpired': return httpError(401, 'Authentication could not be completed')
    case 'CodeMismatchException':
    case 'EnableSoftwareTokenMFAException':
    case 'ExpiredCodeException': return httpError(400, 'The code is invalid or expired')
    case 'InvalidPasswordException':
    case 'PasswordHistoryPolicyViolationException': return httpError(400, 'Choose a password that meets the password policy')
    case 'TooManyRequestsException':
    case 'LimitExceededException':
    case 'TooManyFailedAttemptsException': return httpError(429, 'Try again later')
    case 'RefreshPending': return httpError(503, 'Session refresh in progress')
    default:
      console.error('OB Auth service error', { name })
      return httpError(503, 'Authentication service temporarily unavailable')
  }
}
