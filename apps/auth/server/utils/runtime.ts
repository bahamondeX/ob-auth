import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { KMSClient } from '@aws-sdk/client-kms'
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { awsCredentialsProvider } from '@vercel/functions/oidc'
import { z } from 'zod'
import { IdentityProvider } from './cognito'
import { loadConfig } from './config'
import { Encryption } from './crypto'
import { Store } from './state'

const providerSecret = z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1), issuer: z.url().optional() })
let cached: ReturnType<typeof initialize> | undefined

async function initialize() {
  const config = loadConfig()
  const options = {
    region: config.AWS_REGION,
    maxAttempts: 3,
    ...(config.AWS_ROLE_ARN && process.env.VERCEL ? { credentials: awsCredentialsProvider({ roleArn: config.AWS_ROLE_ARN }) } : {})
  }
  const secrets = new SecretsManagerClient(options)
  const readSecret = async (arn: string) => {
    const response = await secrets.send(new GetSecretValueCommand({ SecretId: arn }))
    if (!response.SecretString) throw new Error('Missing configured secret version')
    return response.SecretString
  }
  const secret = config.COGNITO_SECRET_ARN ? await readSecret(config.COGNITO_SECRET_ARN) : config.COGNITO_CLIENT_SECRET!
  return {
    config,
    cognito: new IdentityProvider(new CognitoIdentityProviderClient(options), config, secret),
    store: new Store(DynamoDBDocumentClient.from(new DynamoDBClient(options), { marshallOptions: { removeUndefinedValues: true } }), config.SESSION_TABLE),
    encryption: new Encryption(new KMSClient(options), config.SESSION_ENCRYPTION_KEY_ID),
    async provider(provider: string) {
      const arn = process.env[provider.toUpperCase() + '_SECRET_ARN']
      if (!arn) throw new Error('Missing configured identity provider')
      return providerSecret.parse(JSON.parse(await readSecret(arn)))
    }
  }
}

export function runtime() {
  if (!cached) {
    cached = initialize().catch((error: unknown) => {
      cached = undefined
      throw error
    })
  }
  return cached
}

export type Runtime = Awaited<ReturnType<typeof runtime>>
