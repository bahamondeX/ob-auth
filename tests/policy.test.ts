import { describe, expect, it } from 'vitest'
import { loadConfig } from '../apps/auth/server/utils/config.ts'
import { digest, equal, randomToken } from '../apps/auth/server/utils/crypto.ts'

const base = {
  COGNITO_USER_POOL_ID: 'us-east-1_Example',
  COGNITO_CLIENT_ID: 'test-client',
  COGNITO_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:example',
  SESSION_TABLE: 'test-state',
  SESSION_ENCRYPTION_KEY_ID: 'test-key',
}

describe('OB Auth runtime policy', () => {
  it('defaults to 15-minute access tokens, one-hour inactivity, and 60-second tickets', () => {
    expect(loadConfig(base)).toMatchObject({
      ACCESS_TOKEN_SECONDS: 900, SESSION_IDLE_SECONDS: 3600,
      SESSION_ABSOLUTE_SECONDS: 86400, TICKET_SECONDS: 60,
    })
  })

  it('rejects lifetime settings that contradict the refresh maximum', () => {
    expect(() => loadConfig({ ...base, SESSION_ABSOLUTE_SECONDS: '172800', REFRESH_LIFETIME_SECONDS: '86400' })).toThrow()
    expect(() => loadConfig({ ...base, SESSION_ABSOLUTE_SECONDS: '120', SESSION_IDLE_SECONDS: '300' })).toThrow()
    expect(() => loadConfig({ ...base, TICKET_SECONDS: '61' })).toThrow()
  })

  it('requires workload identity and HTTPS in Vercel production', () => {
    expect(() => loadConfig({ ...base, VERCEL_ENV: 'production' })).toThrow()
    expect(() => loadConfig({
      ...base, VERCEL_ENV: 'production', AUTH_DOMAIN: 'https://auth.example.com',
      AWS_ROLE_ARN: 'arn:aws:iam::000000000000:role/example',
    })).not.toThrow()
  })

  it('keeps credentials opaque and creates an RFC-compatible SHA-256 challenge', () => {
    expect(randomToken()).toMatch(/^[\w-]{43}$/)
    expect(digest('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
    expect(equal(digest('one'), digest('two'))).toBe(false)
  })
})
