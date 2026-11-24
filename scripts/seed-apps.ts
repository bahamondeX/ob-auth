import { readFile, writeFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { registerApplication, reportRegistrationError } from './app-registry.ts'

const apps = [
  ['aegis', 'AEGIS', 'https://aegis.oscarbahamonde.com', false],
  ['connectivity', 'Connectivity', 'https://connectivity.oscarbahamonde.com', false],
  ['portfolio', 'Oscar Bahamonde', 'https://www.oscarbahamonde.com', false],
  ['example-nuxt', 'Nuxt SSO example', 'http://localhost:3101', true],
  ['example-react', 'React SSO example', 'http://localhost:3102', true]
] as const

async function configureExample(framework: 'nuxt' | 'react', origin: string, credentialsPath: string) {
  const credentials = parseEnv(await readFile(credentialsPath, 'utf8'))
  const env = {
    OB_AUTH_DOMAIN: process.env.AUTH_DOMAIN || 'http://localhost:3000',
    OB_AUTH_APP_ORIGIN: origin,
    OB_AUTH_CLIENT_ID: credentials.OB_AUTH_CLIENT_ID,
    OB_AUTH_CLIENT_SECRET: credentials.OB_AUTH_CLIENT_SECRET,
    OB_AUTH_SESSION_KEY: credentials.OB_AUTH_SESSION_KEY,
    OB_AUTH_LOGOUT_URI: origin
  }
  const prefix = framework === 'nuxt' ? 'NUXT_' : ''
  const content = Object.entries(env).map(([name, value]) => `${prefix}${name}=${value}`).join('\n') + '\n'
  try {
    await writeFile(`examples/${framework}/.env`, content, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (typeof error !== 'object' || !error || !('code' in error) || error.code !== 'EEXIST') throw error
  }
}

try {
  for (const [id, name, origin, enabled] of apps) {
    const result = await registerApplication({
      applicationId: id, clientId: id, name, callbacks: [origin + '/auth/callback'],
      logoutUrls: [origin], allowedOrigins: [origin], enabled, output: '.env.app.' + id,
      policy: { requireMfa: true, requireVerifiedEmail: true, allowedSubjects: [] }
    })
    if (id === 'example-nuxt' || id === 'example-react') await configureExample(id === 'example-nuxt' ? 'nuxt' : 'react', origin, result.path)
    console.log(`Client ${result.clientId} ${result.created ? 'registered' : 'already registered'} (${enabled ? 'enabled' : 'disabled'})`)
  }
} catch (error) {
  reportRegistrationError(error)
}
