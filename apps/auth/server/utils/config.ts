import { z } from 'zod'

const origin = z.url().refine(value => {
  const url = new URL(value)
  return value === url.origin && (url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost'))
})
const providerNames = ['google', 'microsoft', 'github'] as const
export type Provider = typeof providerNames[number]
const limits = z.object({
  AWS_REGION: z.string().min(1).default('us-east-1'),
  AUTH_DOMAIN: origin.default('http://localhost:3000'),
  COGNITO_USER_POOL_ID: z.string().regex(/^[a-z0-9-]+_[a-zA-Z0-9]+$/),
  COGNITO_CLIENT_ID: z.string().min(1),
  COGNITO_CLIENT_SECRET: z.string().min(1).optional(),
  COGNITO_SECRET_ARN: z.string().startsWith('arn:').optional(),
  COGNITO_DOMAIN: origin.optional(),
  SESSION_TABLE: z.string().min(3),
  SESSION_ENCRYPTION_KEY_ID: z.string().min(1),
  SESSION_IDLE_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  SESSION_ABSOLUTE_SECONDS: z.coerce.number().int().min(60).max(2592000).default(86400),
  REFRESH_LIFETIME_SECONDS: z.coerce.number().int().min(86400).max(2592000).default(2592000),
  ACCESS_TOKEN_SECONDS: z.coerce.number().int().min(300).max(3600).default(900),
  TICKET_SECONDS: z.coerce.number().int().min(10).max(60).default(60),
  AWS_ROLE_ARN: z.string().startsWith('arn:').optional()
}).refine(c => c.SESSION_IDLE_SECONDS <= c.SESSION_ABSOLUTE_SECONDS && c.SESSION_ABSOLUTE_SECONDS <= c.REFRESH_LIFETIME_SECONDS && c.ACCESS_TOKEN_SECONDS < c.REFRESH_LIFETIME_SECONDS)
  .refine(c => !!(c.COGNITO_SECRET_ARN || c.COGNITO_CLIENT_SECRET))

export function publicOrigin() {
  return origin.parse(process.env.AUTH_DOMAIN || 'http://localhost:3000')
}

export function loadConfig(env = process.env) {
  const parsed = limits.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')))
  if (!parsed.success) throw new Error('Invalid OB Auth configuration: ' + parsed.error.issues.map(issue => issue.path.join('.') || 'session policy or secret source').join(', '))
  const config = parsed.data
  if (env.VERCEL_ENV === 'production' && (!config.AWS_ROLE_ARN || !config.COGNITO_SECRET_ARN || !config.AUTH_DOMAIN.startsWith('https:') || config.COGNITO_CLIENT_SECRET)) throw new Error('Production requires HTTPS, AWS workload identity and Secrets Manager')
  const providers = providerNames.filter(provider => env[provider.toUpperCase() + '_SECRET_ARN'])
  if (providers.length && !config.COGNITO_DOMAIN) throw new Error('Cognito federation origin is required')
  return { ...config, providers }
}
export type Configuration = ReturnType<typeof loadConfig>
