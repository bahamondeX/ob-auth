import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { AdminCreateUserCommand, AdminSetUserPasswordCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'

const pool = process.env.COGNITO_USER_POOL_ID
if (!pool || process.env.AUTH_DOMAIN !== 'http://localhost:3000' || process.env.OB_AUTH_NATIVE_LIVE !== '1') {
  throw new Error('Set OB_AUTH_NATIVE_LIVE=1 in the loopback environment for a dedicated AWS test fixture')
}
const email = 'obauth-test-' + randomBytes(6).toString('hex') + '@example.invalid'
const password = 'Aa9!' + randomBytes(24).toString('base64url')
writeFileSync('.env.fixture', 'OB_AUTH_E2E_EMAIL=' + email + '\nOB_AUTH_E2E_PASSWORD=' + password + '\n', { mode: 0o600, flag: 'wx' })
const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' })
try {
  await client.send(new AdminCreateUserCommand({
    UserPoolId: pool, Username: email, MessageAction: 'SUPPRESS', TemporaryPassword: password,
    UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }]
  }))
  await client.send(new AdminSetUserPasswordCommand({ UserPoolId: pool, Username: email, Password: password, Permanent: true }))
  console.log('Dedicated Cognito fixture created. Email delivery is tested independently.')
} catch (error) {
  console.error('Cognito fixture creation failed', error instanceof Error ? error.name : 'UnknownError')
  process.exitCode = 1
} finally {
  client.destroy()
}
