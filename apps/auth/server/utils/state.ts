import { ConditionalCheckFailedException, TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { digest, epoch, type Ciphertext } from './crypto.ts'

export interface User {
  sub: string
  email: string
  emailVerified: boolean
  provider: 'password' | 'google' | 'microsoft' | 'github'
  mfa: boolean
}

export interface BaseRow { pk: string; ttl?: number }
export interface Account extends BaseRow { generation: string }
export interface Session extends BaseRow {
  ttl: number
  sessionOwner: string
  generation: string
  user: User
  username: string
  createdAt: number
  lastSeen: number
  idleUntil: number
  revoked?: boolean
  encrypted: Ciphertext
  tokenExpiresAt: number
  rotationLease?: string
  rotationUntil?: number
}
export interface Client extends BaseRow {
  applicationId: string
  clientId: string
  name: string
  logo?: string
  clientAuth: 'client_secret_basic'
  secretDigest: string
  callbacks: string[]
  logoutUrls: string[]
  allowedOrigins: string[]
  enabled: boolean
  createdAt: number
  policy: { requireMfa: boolean; requireVerifiedEmail: boolean; allowedSubjects: string[] }
}
export interface Intent extends BaseRow {
  ttl: number
  clientId: string
  redirectUri: string
  state: string
  challenge: string
}
export interface Ticket extends Intent { sessionKey: string }
export interface Grant extends BaseRow { ttl: number; clientId: string; sessionKey: string }

export const keys = {
  account: (sub: string) => 'account#' + sub,
  client: (id: string) => 'client#' + id,
  sid: (raw: string) => 'session#' + digest(raw),
  intent: (raw: string) => 'intent#' + digest(raw),
  ticket: (raw: string) => 'ticket#' + digest(raw),
  grant: (raw: string) => 'grant#' + digest(raw),
  flow: (raw: string) => 'flow#' + digest(raw),
  oauth: (raw: string) => 'oauth#' + digest(raw)
}

export function conflict(error: unknown) {
  return error instanceof ConditionalCheckFailedException ||
    (error instanceof TransactionCanceledException && !!error.CancellationReasons?.some(reason => reason.Code === 'ConditionalCheckFailed' || reason.Code === 'TransactionConflict'))
}

export class Store {
  constructor(readonly db: DynamoDBDocumentClient, readonly table: string) {}

  async get<T extends BaseRow>(pk: string): Promise<T | undefined> {
    const { Item } = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk }, ConsistentRead: true }))
    return Item as T | undefined
  }

  async live<T extends BaseRow & { ttl: number }>(pk: string): Promise<T | undefined> {
    const row = await this.get<T>(pk)
    return row && row.ttl > epoch() ? row : undefined
  }

  async put<T extends BaseRow>(item: T) {
    await this.db.send(new PutCommand({ TableName: this.table, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }))
  }

  async delete(pk: string) {
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk } }))
  }

  async consume<T extends BaseRow & { ttl: number }>(pk: string) {
    const { Attributes } = await this.db.send(new DeleteCommand({
      TableName: this.table, Key: { pk },
      ConditionExpression: '#ttl > :now', ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':now': epoch() }, ReturnValues: 'ALL_OLD'
    }))
    return Attributes as T
  }

  async rate(key: string, max: number, period: number) {
    const expiry = (Math.floor(epoch() / period) + 1) * period
    const { Attributes } = await this.db.send(new UpdateCommand({
      TableName: this.table, Key: { pk: 'rate#' + digest(key) + '#' + expiry },
      UpdateExpression: 'SET #ttl = :expiry ADD #count :one',
      ExpressionAttributeNames: { '#ttl': 'ttl', '#count': 'count' },
      ExpressionAttributeValues: { ':expiry': expiry, ':one': 1 }, ReturnValues: 'UPDATED_NEW'
    }))
    return Number(Attributes?.count) <= max
  }

  async activeSession(pk: string): Promise<Session | undefined> {
    const row = await this.live<Session>(pk)
    if (!row || row.revoked || row.idleUntil <= epoch()) return
    const owner = await this.get<Account>(keys.account(row.sessionOwner))
    if (owner?.generation === row.generation) return row
  }

  async sessions(sub: string) {
    const result = await this.db.send(new QueryCommand({
      TableName: this.table, IndexName: 'user-sessions',
      KeyConditionExpression: 'sessionOwner = :sub',
      ExpressionAttributeValues: { ':sub': sub },
      Limit: 100
    }))
    return (result.Items ?? []) as Session[]
  }

  accountCheck(session: Session) {
    return {
      TableName: this.table, Key: { pk: keys.account(session.sessionOwner) },
      ConditionExpression: 'generation = :generation', ExpressionAttributeValues: { ':generation': session.generation }
    }
  }

  sessionCheck(session: Session) {
    return {
      TableName: this.table, Key: { pk: session.pk },
      ConditionExpression: 'attribute_not_exists(revoked) AND #ttl > :now AND idleUntil > :now',
      ExpressionAttributeNames: { '#ttl': 'ttl' }, ExpressionAttributeValues: { ':now': epoch() }
    }
  }

  async createSession(session: Session) {
    await this.db.send(new TransactWriteCommand({ TransactItems: [
      { ConditionCheck: this.accountCheck(session) },
      { Put: { TableName: this.table, Item: session, ConditionExpression: 'attribute_not_exists(pk)' } }
    ] }))
  }

  async issueTicket(session: Session, intent: Intent, ticket: Ticket) {
    await this.db.send(new TransactWriteCommand({ TransactItems: [
      { ConditionCheck: this.accountCheck(session) },
      { ConditionCheck: this.sessionCheck(session) },
      { Delete: { TableName: this.table, Key: { pk: intent.pk }, ConditionExpression: '#ttl > :now', ExpressionAttributeNames: { '#ttl': 'ttl' }, ExpressionAttributeValues: { ':now': epoch() } } },
      { Put: { TableName: this.table, Item: ticket, ConditionExpression: 'attribute_not_exists(pk)' } }
    ] }))
  }

  async exchangeTicket(ticket: Ticket, session: Session, grant: Grant) {
    await this.db.send(new TransactWriteCommand({ TransactItems: [
      { ConditionCheck: this.accountCheck(session) },
      { ConditionCheck: this.sessionCheck(session) },
      { Delete: {
        TableName: this.table, Key: { pk: ticket.pk },
        ConditionExpression: '#ttl > :now AND clientId = :client AND redirectUri = :uri AND challenge = :challenge',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':now': epoch(), ':client': ticket.clientId, ':uri': ticket.redirectUri, ':challenge': ticket.challenge }
      } },
      { Put: { TableName: this.table, Item: grant, ConditionExpression: 'attribute_not_exists(pk)' } }
    ] }))
  }
}
