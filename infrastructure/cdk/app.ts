import { App, ArnFormat, BootstraplessSynthesizer, CfnOutput, CfnParameter, RemovalPolicy, SecretValue, Stack, Tags } from 'aws-cdk-lib'
import { CfnBudget } from 'aws-cdk-lib/aws-budgets'
import { Alarm, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch'
import { CfnUserPool, CfnUserPoolClient, CfnUserPoolDomain, CfnUserPoolIdentityProvider } from 'aws-cdk-lib/aws-cognito'
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb'
import { CfnOIDCProvider, Effect, PolicyStatement, Role, WebIdentityPrincipal } from 'aws-cdk-lib/aws-iam'
import { Key } from 'aws-cdk-lib/aws-kms'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import { CfnEmailIdentity } from 'aws-cdk-lib/aws-ses'

const app = new App()
const account = process.env.OB_AWS_ACCOUNT || '414135856271'
const region = process.env.AWS_REGION || 'us-east-1'
const team = process.env.OB_VERCEL_TEAM || 'oscarbahamondedev-gmailcoms-projects'
const domain = process.env.OB_PORTAL_ORIGIN || 'https://auth.oscarbahamonde.com'
const portal = new URL(domain)
if (portal.protocol !== 'https:' || portal.origin !== domain) throw new Error('OB_PORTAL_ORIGIN must be a canonical HTTPS origin')

function duration(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`)
  return value
}

const accessSeconds = duration('ACCESS_TOKEN_SECONDS', 900, 300, 3600)
const refreshSeconds = duration('REFRESH_LIFETIME_SECONDS', 2592000, 86400, 2592000)
const accessUnit = accessSeconds % 60 === 0 ? 'minutes' : 'seconds'
const refreshUnit = refreshSeconds % 86400 === 0 ? 'days' : 'seconds'
const accessValidity = accessUnit === 'minutes' ? accessSeconds / 60 : accessSeconds
const refreshValidity = refreshUnit === 'days' ? refreshSeconds / 86400 : refreshSeconds
const stack = new Stack(app, 'ob-auth', {
  stackName: 'ob-auth-identity',
  env: { account, region },
  synthesizer: new BootstraplessSynthesizer(),
  terminationProtection: true,
  description: 'OB Auth centralized identity and session infrastructure'
})
Tags.of(stack).add('Project', 'OBAuth')
Tags.of(stack).add('Environment', 'production')
Tags.of(stack).add('OBAuthPilot', 'true')

const senderDomain = portal.hostname
const sender = new CfnEmailIdentity(stack, 'SenderIdentity', { emailIdentity: senderDomain })
sender.applyRemovalPolicy(RemovalPolicy.RETAIN)
const senderArn = stack.formatArn({ service: 'ses', resource: 'identity', resourceName: sender.ref, arnFormat: ArnFormat.SLASH_RESOURCE_NAME })
const dkim = [
  [sender.attrDkimDnsTokenName1, sender.attrDkimDnsTokenValue1],
  [sender.attrDkimDnsTokenName2, sender.attrDkimDnsTokenValue2],
  [sender.attrDkimDnsTokenName3, sender.attrDkimDnsTokenValue3]
]
for (const [index, [name, value]] of dkim.entries()) {
  new CfnOutput(stack, `SesDkimName${index + 1}`, { value: name })
  new CfnOutput(stack, `SesDkimValue${index + 1}`, { value })
}
const productionEmail = process.env.OB_SES_ENABLED === 'true'
const senderName = process.env.OB_SES_FROM?.trim() || 'OB Auth <no-reply@' + senderDomain + '>'
const pool = new CfnUserPool(stack, 'Directory', {
  userPoolName: 'ob-auth-directory',
  userPoolTier: 'ESSENTIALS',
  deletionProtection: 'ACTIVE',
  usernameAttributes: ['email'],
  usernameConfiguration: { caseSensitive: false },
  autoVerifiedAttributes: ['email'],
  userAttributeUpdateSettings: { attributesRequireVerificationBeforeUpdate: ['email'] },
  accountRecoverySetting: { recoveryMechanisms: [{ name: 'verified_email', priority: 1 }] },
  emailConfiguration: productionEmail ? { emailSendingAccount: 'DEVELOPER', sourceArn: senderArn, from: senderName } : { emailSendingAccount: 'COGNITO_DEFAULT' },
  enabledMfas: ['SOFTWARE_TOKEN_MFA'],
  mfaConfiguration: 'OPTIONAL',
  policies: { passwordPolicy: { minimumLength: 12, requireLowercase: true, requireUppercase: true, requireNumbers: true, requireSymbols: true, temporaryPasswordValidityDays: 1 } },
  schema: [{ name: 'email', attributeDataType: 'String', mutable: true, required: true }]
})
pool.applyRemovalPolicy(RemovalPolicy.RETAIN)
const prefix = 'ob-auth-' + account
const authDomain = new CfnUserPoolDomain(stack, 'FederationDomain', { domain: prefix, userPoolId: pool.ref, managedLoginVersion: 2 })

const providers: CfnUserPoolIdentityProvider[] = []
const providerArns: string[] = []
for (const provider of ['Google', 'Microsoft', 'GitHub'] as const) {
  const suppliedArn = process.env['OB_' + provider.toUpperCase() + '_SECRET_ARN']
  if (!suppliedArn) continue
  const secret = new CfnParameter(stack, provider + 'SecretArn', { default: suppliedArn, noEcho: true })
  providerArns.push(secret.valueAsString)
  const details: Record<string, string> = {
    client_id: SecretValue.secretsManager(secret.valueAsString, { jsonField: 'clientId' }).unsafeUnwrap(),
    client_secret: SecretValue.secretsManager(secret.valueAsString, { jsonField: 'clientSecret' }).unsafeUnwrap(),
    authorize_scopes: 'openid email profile'
  }
  if (provider !== 'Google') {
    const issuer = process.env['OB_' + provider.toUpperCase() + '_ISSUER']
    if (!issuer || new URL(issuer).protocol !== 'https:') throw new Error('A trusted provider issuer is required')
    details.oidc_issuer = issuer
    details.attributes_request_method = 'GET'
    const authorizationEndpoint = provider === 'GitHub' ? process.env.OB_GITHUB_AUTHORIZE_URL : undefined
    if (authorizationEndpoint) {
      if (new URL(authorizationEndpoint).origin !== new URL(issuer).origin) throw new Error('GitHub authorization endpoint must belong to the configured HTTPS broker')
      details.authorize_url = authorizationEndpoint
    }
  }
  providers.push(new CfnUserPoolIdentityProvider(stack, provider, {
    providerName: provider, providerType: provider === 'Google' ? 'Google' : 'OIDC',
    userPoolId: pool.ref, providerDetails: details,
    attributeMapping: { email: 'email', ...(provider === 'Microsoft' ? {} : { email_verified: 'email_verified' }) }
  }))
}

const client = new CfnUserPoolClient(stack, 'PortalClient', {
  clientName: 'ob-auth-nitro',
  userPoolId: pool.ref,
  generateSecret: true,
  preventUserExistenceErrors: 'ENABLED',
  enableTokenRevocation: true,
  explicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH'],
  accessTokenValidity: accessValidity,
  idTokenValidity: accessValidity,
  refreshTokenValidity: refreshValidity,
  tokenValidityUnits: { accessToken: accessUnit, idToken: accessUnit, refreshToken: refreshUnit },
  authSessionValidity: 8,
  refreshTokenRotation: { feature: 'ENABLED', retryGracePeriodSeconds: 60 },
  readAttributes: ['email', 'email_verified'],
  writeAttributes: ['email'],
  supportedIdentityProviders: providers.length ? providers.map(p => p.providerName) : ['COGNITO'],
  ...(providers.length ? {
    allowedOAuthFlowsUserPoolClient: true, allowedOAuthFlows: ['code'],
    allowedOAuthScopes: ['openid', 'email', 'profile'],
    callbackUrLs: [domain + '/api/auth/callback'],
    logoutUrLs: [domain + '/api/auth/signed-out']
  } : {})
})
for (const provider of providers) client.addResourceDependency(provider)

const table = new Table(stack, 'SessionStore', {
  tableName: 'ob-auth-state',
  partitionKey: { name: 'pk', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  maxReadRequestUnits: 25,
  maxWriteRequestUnits: 10,
  encryption: TableEncryption.AWS_MANAGED,
  timeToLiveAttribute: 'ttl',
  deletionProtection: true,
  removalPolicy: RemovalPolicy.RETAIN
})
table.addGlobalSecondaryIndex({
  indexName: 'user-sessions',
  partitionKey: { name: 'sessionOwner', type: AttributeType.STRING }
})
const key = new Key(stack, 'SessionKey', { alias: 'alias/ob-auth-tokens', enableKeyRotation: true, removalPolicy: RemovalPolicy.RETAIN })
const portalSecret = new Secret(stack, 'CognitoSecret', {
  secretName: 'ob-auth/portal-client',
  description: 'Confidential Cognito client secret',
  secretStringValue: SecretValue.resourceAttribute(client.attrClientSecret)
})
const configuredIssuerArn = process.env.OB_VERCEL_ISSUER_ARN || undefined
const expectedIssuerArn = 'arn:aws:iam::' + account + ':oidc-provider/oidc.vercel.com/' + team
if (configuredIssuerArn && configuredIssuerArn !== expectedIssuerArn) throw new Error('Vercel issuer ARN does not match the configured account and team')
const issuerArn = configuredIssuerArn ?? new CfnOIDCProvider(stack, 'VercelIssuer', {
  url: 'https://oidc.vercel.com/' + team,
  clientIdList: ['https://vercel.com/' + team]
}).attrArn
const role = new Role(stack, 'PortalRole', {
  roleName: 'ob-auth-vercel-production',
  assumedBy: new WebIdentityPrincipal(issuerArn, {
    StringEquals: {
      ['oidc.vercel.com/' + team + ':aud']: 'https://vercel.com/' + team,
      ['oidc.vercel.com/' + team + ':sub']: 'owner:' + team + ':project:ob-auth:environment:production'
    }
  })
})
role.addToPolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['dynamodb:GetItem', 'dynamodb:ConditionCheckItem'],
  resources: [table.tableArn]
}))
role.addToPolicy(new PolicyStatement({
  actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
  conditions: {
    Null: { 'dynamodb:LeadingKeys': 'false' },
    'ForAllValues:StringNotLike': { 'dynamodb:LeadingKeys': 'client#*' }
  },
  resources: [table.tableArn]
}))
role.addToPolicy(new PolicyStatement({ actions: ['dynamodb:Query'], resources: [table.tableArn + '/index/user-sessions'] }))
role.addToPolicy(new PolicyStatement({
  actions: ['kms:GenerateDataKey', 'kms:Decrypt'], resources: [key.keyArn],
  conditions: { StringLike: { 'kms:EncryptionContext:obAuthRecord': ['session#*', 'flow#*'] } }
}))
role.addToPolicy(new PolicyStatement({ actions: ['cognito-idp:AdminUserGlobalSignOut', 'cognito-idp:AdminGetUser'], resources: [pool.attrArn] }))
portalSecret.grantRead(role)
if (providerArns.length) {
  role.addToPolicy(new PolicyStatement({ actions: ['secretsmanager:GetSecretValue'], resources: providerArns }))
  role.addToPolicy(new PolicyStatement({ actions: ['cognito-idp:AdminLinkProviderForUser'], resources: [pool.attrArn] }))
}
new Alarm(stack, 'StateThrottles', {
  alarmDescription: 'OB Auth DynamoDB requests were throttled',
  metric: new Metric({ namespace: 'AWS/DynamoDB', metricName: 'WriteThrottleEvents', dimensionsMap: { TableName: table.tableName }, statistic: 'sum' }),
  threshold: 10,
  evaluationPeriods: 1,
  treatMissingData: TreatMissingData.NOT_BREACHING
})
if (process.env.OB_BUDGET_EMAIL) {
  new CfnBudget(stack, 'CostWatch', {
    budget: {
      budgetName: 'ob-auth-monthly', budgetType: 'COST', timeUnit: 'MONTHLY',
      budgetLimit: { amount: 15, unit: 'USD' },
      costTypes: { includeCredit: false, includeRefund: false },
      costFilters: { TagKeyValue: ['user:OBAuthPilot$true'] }
    },
    notificationsWithSubscribers: [60, 100].map(threshold => ({
      notification: { comparisonOperator: 'GREATER_THAN', notificationType: 'ACTUAL', threshold, thresholdType: 'PERCENTAGE' },
      subscribers: [{ address: process.env.OB_BUDGET_EMAIL!, subscriptionType: 'EMAIL' }]
    }))
  })
}
new CfnOutput(stack, 'UserPoolId', { value: pool.ref })
new CfnOutput(stack, 'ClientId', { value: client.ref })
new CfnOutput(stack, 'CognitoOrigin', { value: 'https://' + authDomain.ref + '.auth.' + region + '.amazoncognito.com' })
new CfnOutput(stack, 'SessionTable', { value: table.tableName })
new CfnOutput(stack, 'TokenKey', { value: key.keyArn })
new CfnOutput(stack, 'CognitoSecretArn', { value: portalSecret.secretArn })
new CfnOutput(stack, 'RuntimeRoleArn', { value: role.roleArn })
