import { createHash, randomBytes } from 'node:crypto'
import { lstat, open, readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { isDeepStrictEqual, parseEnv } from 'node:util'
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import type { Client } from '../apps/auth/server/utils/state.ts'

export interface ApplicationInput {
  applicationId: string
  clientId: string
  name: string
  logo?: string
  callbacks: string[]
  logoutUrls: string[]
  allowedOrigins: string[]
  enabled: boolean
  policy: Client['policy']
  output: string
}

const identifier = /^[a-z0-9][a-z0-9-]{0,63}$/
const token = () => randomBytes(32).toString('base64url')
const digest = (value: string) => createHash('sha256').update(value).digest('base64url')

export function validateUrl(value: string) {
  if (value !== value.trim() || value.includes('*')) throw new Error('Use an exact URL without spaces or wildcards')
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.hash) {
    throw new Error('Use HTTPS URLs or local loopback HTTP URLs without credentials or fragments')
  }
  return url
}

async function readCredentials(path: string, clientId: string) {
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error('Credential file must be a regular file with mode 600')
    const values = parseEnv(await readFile(path, 'utf8'))
    const secret = values.OB_AUTH_CLIENT_SECRET
    const hasRandomToken = (value?: string) => /^[A-Za-z0-9_-]{43}$/.test(value ?? '')
    if (values.OB_AUTH_CLIENT_ID !== clientId || !hasRandomToken(secret) || !hasRandomToken(values.OB_AUTH_SESSION_KEY)) {
      throw new Error('Credential file already exists with a different format or client ID')
    }
    return secret
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
}

export async function registerApplication(input: ApplicationInput) {
  if (!identifier.test(input.applicationId) || !identifier.test(input.clientId)) throw new Error('Use lowercase letters, digits and hyphens in IDs')
  if (!input.name.trim() || input.name.length > 100) throw new Error('Application name must contain 1 to 100 characters')
  if (!input.callbacks.length) throw new Error('At least one exact callback URL is required')
  const callbacks = [...new Set(input.callbacks)]
  const callbackOrigins = new Set(callbacks.map(callback => {
    const url = validateUrl(callback)
    if (url.search || callback !== url.href) throw new Error('Use canonical callback URLs without a query')
    return url.origin
  }))
  for (const logout of input.logoutUrls) {
    if (!callbackOrigins.has(validateUrl(logout).origin)) throw new Error('Logout URLs must use a registered callback origin')
  }
  for (const origin of input.allowedOrigins) {
    if (validateUrl(origin).origin !== origin || !callbackOrigins.has(origin)) throw new Error('Allowed origins must be exact callback origins')
  }
  if (input.logo && validateUrl(input.logo).protocol !== 'https:') throw new Error('Application logos must use HTTPS')
  if (input.policy.allowedSubjects.some(sub => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sub))) {
    throw new Error('Allowed subjects must be Cognito user UUIDs')
  }

  const path = resolve(input.output)
  if (!/^\.env(?:\..+)?$/.test(basename(path)) || basename(path) === '.env.example') throw new Error('Choose a private .env or .env.* output file')
  const table = process.env.SESSION_TABLE
  if (!table) throw new Error('Set SESSION_TABLE in the project .env file')
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }), {
    marshallOptions: { removeUndefinedValues: true }
  })
  const pk = 'client#' + input.clientId
  const { Item: existing } = await db.send(new GetCommand({ TableName: table, Key: { pk }, ConsistentRead: true }))
  let secret = await readCredentials(path, input.clientId)
  if (existing && (!secret || existing.secretDigest !== digest(secret))) throw new Error('Client ID is already registered with different credentials')
  if (!secret) {
    secret = token()
    const file = await open(path, 'wx', 0o600)
    try {
      await file.writeFile(`OB_AUTH_CLIENT_ID=${input.clientId}\nOB_AUTH_CLIENT_SECRET=${secret}\nOB_AUTH_SESSION_KEY=${token()}\n`)
    } finally {
      await file.close()
    }
  }
  const item: Client = {
    pk, applicationId: input.applicationId, clientId: input.clientId, name: input.name,
    logo: input.logo, callbacks, logoutUrls: [...new Set(input.logoutUrls)],
    allowedOrigins: [...new Set(input.allowedOrigins)], enabled: input.enabled, createdAt: Math.floor(Date.now() / 1000),
    clientAuth: 'client_secret_basic', secretDigest: digest(secret), policy: input.policy
  }
  if (existing) {
    const comparableFields = ['applicationId', 'clientId', 'name', 'logo', 'callbacks', 'logoutUrls', 'allowedOrigins', 'enabled', 'policy'] as const
    if (comparableFields.some(field => !isDeepStrictEqual(existing[field], item[field]))) {
      throw new Error('Client ID is registered with different settings')
    }
    return { clientId: input.clientId, path, created: false }
  }
  try {
    await db.send(new PutCommand({ TableName: table, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }))
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) throw new Error('Client ID was registered concurrently')
    throw error
  }
  return { clientId: input.clientId, path, created: true }
}

export function reportRegistrationError(error: unknown) {
  const message = error instanceof Error && error.constructor === Error ? error.message : error instanceof Error ? error.name : 'UnknownError'
  console.error('Application registration failed. ' + message)
  process.exitCode = 1
}
