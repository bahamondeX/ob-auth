import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import {
  AdminDeleteSoftwareTokenCommand, AdminGetUserCommand, AdminUserGlobalSignOutCommand, CognitoIdentityProviderClient
} from '@aws-sdk/client-cognito-identity-provider'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'

try {
  const { values } = parseArgs({ options: { username: { type: 'string' }, 'verified-subject': { type: 'string' } } })
  const username = values.username
  const subject = values['verified-subject']
  const UserPoolId = process.env.COGNITO_USER_POOL_ID
  const TableName = process.env.SESSION_TABLE
  if (!UserPoolId || !TableName || !username || !subject || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(subject)) {
    throw new Error('Provide the OB Auth configuration and the independently verified Cognito subject and username')
  }
  const region = process.env.AWS_REGION || 'us-east-1'
  const cognito = new CognitoIdentityProviderClient({ region })
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }))
  const user = await cognito.send(new AdminGetUserCommand({ UserPoolId, Username: username }))
  const attributes = Object.fromEntries(user.UserAttributes?.map(attribute => [attribute.Name, attribute.Value]) ?? [])
  if (attributes.sub !== subject || attributes.email_verified !== 'true' || !user.Enabled || user.UserStatus !== 'CONFIRMED' || !user.Username) {
    throw new Error('User must match the verified subject and have an enabled, confirmed password account')
  }
  const target = { UserPoolId, Username: user.Username }
  const invalidateCentral = () => db.send(new UpdateCommand({
    TableName, Key: { pk: 'account#' + subject }, UpdateExpression: 'SET generation = :generation',
    ExpressionAttributeValues: { ':generation': randomBytes(32).toString('base64url') }
  }))
  await invalidateCentral()
  try {
    await cognito.send(new AdminUserGlobalSignOutCommand(target))
    await cognito.send(new AdminDeleteSoftwareTokenCommand(target))
    await cognito.send(new AdminUserGlobalSignOutCommand(target))
  } finally {
    await invalidateCentral()
  }
  console.log('Authenticator removed and sessions revoked. The next sign-in requires authenticator enrollment.')
} catch (error) {
  const message = error instanceof Error && error.constructor === Error ? error.message : error instanceof Error ? error.name : 'UnknownError'
  console.error('Authenticator recovery did not complete. ' + message)
  process.exitCode = 1
}
