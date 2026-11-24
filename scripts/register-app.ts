import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { registerApplication, reportRegistrationError, validateUrl } from './app-registry.ts'

try {
  const { values } = parseArgs({ options: {
    name: { type: 'string' }, callback: { type: 'string', multiple: true },
    'application-id': { type: 'string' }, 'client-id': { type: 'string' },
    'logout-url': { type: 'string', multiple: true }, 'allowed-subject': { type: 'string', multiple: true },
    logo: { type: 'string' }, output: { type: 'string' }, disabled: { type: 'boolean' },
    'require-mfa': { type: 'boolean' }
  } })
  const name = values.name?.trim()
  const callbacks = values.callback
  if (!name || !callbacks?.length) throw new Error('Usage: pnpm auth:app:create --name "My Application" --callback https://myapp.oscarbahamonde.com/auth/callback')
  const clientId = values['client-id'] ?? 'ob-' + randomBytes(12).toString('hex')
  const slug = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
  const allowedOrigins = [...new Set(callbacks.map(callback => validateUrl(callback).origin))]
  const result = await registerApplication({
    applicationId: values['application-id'] ?? (slug || clientId), clientId, name, callbacks,
    logoutUrls: values['logout-url'] ?? allowedOrigins, allowedOrigins, enabled: !values.disabled,
    logo: values.logo, output: values.output ?? '.env.app.' + clientId,
    policy: { requireMfa: values['require-mfa'] ?? false, requireVerifiedEmail: true, allowedSubjects: values['allowed-subject'] ?? [] }
  })
  console.log(`Client ${result.clientId} ${result.created ? 'registered' : 'already registered'}. Credentials stored in ${result.path}`)
} catch (error) {
  reportRegistrationError(error)
}
