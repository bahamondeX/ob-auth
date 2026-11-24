import { AdminUserGlobalSignOutCommand, ChangePasswordCommand, RevokeTokenCommand } from '@aws-sdk/client-cognito-identity-provider'
import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { Identity, Tokens } from './cognito'
import { epoch, randomToken } from './crypto'
import type { Runtime } from './runtime'
import { conflict, keys, type Account, type Session } from './state'

function sessionError() {
  return Object.assign(new Error('Central session expired'), { name: 'SessionExpired' })
}

export async function establish(rt: Runtime, identity: Identity) {
  const { store, config, encryption } = rt
  const owner = keys.account(identity.user.sub)
  let account = await store.get<Account>(owner)
  if (!account) {
    try {
      await store.put({ pk: owner, generation: randomToken() })
    } catch (error) {
      if (!conflict(error)) throw error
    }
    account = await store.get<Account>(owner)
  }
  if (!account) throw sessionError()
  const raw = randomToken()
  const pk = keys.sid(raw)
  const now = epoch()
  const row: Session = {
    pk,
    generation: account.generation,
    sessionOwner: identity.user.sub,
    user: identity.user,
    username: identity.username,
    ttl: now + config.SESSION_ABSOLUTE_SECONDS,
    createdAt: now,
    lastSeen: now,
    idleUntil: now + config.SESSION_IDLE_SECONDS,
    encrypted: await encryption.seal(identity.tokens, pk),
    tokenExpiresAt: Math.min(identity.tokens.expiresAt, now + config.ACCESS_TOKEN_SECONDS)
  }
  await store.createSession(row)
  return { raw, row }
}

export async function touch(rt: Runtime, row: Session) {
  const now = epoch()
  if (now - row.lastSeen < 30) return
  try {
    await rt.store.db.send(new UpdateCommand({
      ...rt.store.sessionCheck(row),
      ConditionExpression: rt.store.sessionCheck(row).ConditionExpression + ' AND lastSeen < :seen',
      UpdateExpression: 'SET lastSeen = :now, idleUntil = :idle',
      ExpressionAttributeValues: { ':now': now, ':seen': now - 29, ':idle': Math.min(row.ttl, now + rt.config.SESSION_IDLE_SECONDS) }
    }))
  } catch (error) {
    if (!conflict(error)) throw error
  }
}

export async function currentTokens(rt: Runtime, session: Session): Promise<Tokens> {
  const { store, encryption, config } = rt
  const now = epoch()
  if (session.tokenExpiresAt > now + 30) return encryption.open<Tokens>(session.encrypted, session.pk)
  const lease = randomToken()
  const check = store.sessionCheck(session)
  try {
    await store.db.send(new UpdateCommand({
      ...check,
      ConditionExpression: check.ConditionExpression + ' AND tokenExpiresAt = :previous AND (attribute_not_exists(rotationUntil) OR rotationUntil <= :now)',
      UpdateExpression: 'SET rotationLease = :lease, rotationUntil = :until',
      ExpressionAttributeValues: { ...check.ExpressionAttributeValues, ':previous': session.tokenExpiresAt, ':lease': lease, ':until': now + 20 }
    }))
  } catch (error) {
    if (!conflict(error)) throw error
    const updated = await store.activeSession(session.pk)
    if (updated && updated.tokenExpiresAt > now + 30) return encryption.open<Tokens>(updated.encrypted, updated.pk)
    if (updated && session.tokenExpiresAt > now) return encryption.open<Tokens>(session.encrypted, session.pk)
    throw Object.assign(new Error('Session refresh in progress'), { name: 'RefreshPending' })
  }
  try {
    const old = await encryption.open<Tokens>(session.encrypted, session.pk)
    const tokens = await rt.cognito.refresh(old, session.sessionOwner)
    const encrypted = await encryption.seal(tokens, session.pk)
    await store.db.send(new UpdateCommand({
      ...check,
      ConditionExpression: check.ConditionExpression + ' AND rotationLease = :lease',
      UpdateExpression: 'SET encrypted = :encrypted, tokenExpiresAt = :expiry REMOVE rotationUntil, rotationLease',
      ExpressionAttributeValues: { ...check.ExpressionAttributeValues, ':now': epoch(), ':lease': lease, ':encrypted': encrypted, ':expiry': Math.min(tokens.expiresAt, epoch() + config.ACCESS_TOKEN_SECONDS) }
    }))
    if (!await store.activeSession(session.pk)) throw sessionError()
    return tokens
  } catch (error) {
    if (error instanceof Error && (error.name === 'NotAuthorizedException' || error.name === 'InvalidIdentity')) {
      await invalidate(rt, session)
      throw sessionError()
    }
    throw error
  }
}

export async function invalidate(rt: Runtime, row: Session) {
  try {
    await rt.store.db.send(new UpdateCommand({
      TableName: rt.store.table, Key: { pk: row.pk },
      ConditionExpression: 'attribute_exists(pk) AND attribute_not_exists(revoked)',
      UpdateExpression: 'SET revoked = :flag REMOVE encrypted, rotationLease, rotationUntil',
      ExpressionAttributeValues: { ':flag': true }
    }))
  } catch (error) {
    if (!conflict(error)) throw error
  }
}

export async function revokeSession(rt: Runtime, row: Session) {
  await invalidate(rt, row)
  const { refresh } = await rt.encryption.open<Tokens>(row.encrypted, row.pk)
  await rt.cognito.client.send(new RevokeTokenCommand({ Token: refresh, ClientId: rt.cognito.clientId, ClientSecret: rt.cognito.secret }))
}

export async function globalLogout(rt: Runtime, username: string, sub: string) {
  await rt.store.db.send(new UpdateCommand({
    TableName: rt.store.table, Key: { pk: keys.account(sub) },
    UpdateExpression: 'SET generation = :generation',
    ExpressionAttributeValues: { ':generation': randomToken() }
  }))
  await rt.cognito.client.send(new AdminUserGlobalSignOutCommand({
    UserPoolId: rt.config.COGNITO_USER_POOL_ID, Username: username
  }))
}

export async function changePassword(rt: Runtime, row: Session, oldPassword: string, password: string) {
  if (row.user.provider !== 'password') throw sessionError()
  const { access } = await currentTokens(rt, row)
  await rt.cognito.client.send(new ChangePasswordCommand({ AccessToken: access, PreviousPassword: oldPassword, ProposedPassword: password }))
  await globalLogout(rt, row.username, row.sessionOwner)
}
