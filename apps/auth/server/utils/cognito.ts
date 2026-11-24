import { createHmac } from 'node:crypto'
import {
  AssociateSoftwareTokenCommand, CognitoIdentityProviderClient, GetTokensFromRefreshTokenCommand,
  InitiateAuthCommand, RespondToAuthChallengeCommand, SetUserMFAPreferenceCommand,
  VerifySoftwareTokenCommand, type AuthenticationResultType,
  type InitiateAuthCommandOutput
} from '@aws-sdk/client-cognito-identity-provider'
import { CognitoJwtVerifier } from 'aws-jwt-verify'
import type { Configuration } from './config'
import { equal } from './crypto'
import type { User } from './state'

export interface Tokens { access: string; refresh: string; expiresAt: number }
export interface Identity { user: User; username: string; tokens: Tokens }
export const invalidIdentity = () => Object.assign(new Error('Identity verification failed'), { name: 'InvalidIdentity' })

export class IdentityProvider {
  private readonly idVerifier
  private readonly accessVerifier
  constructor(readonly client: CognitoIdentityProviderClient, readonly config: Configuration, readonly secret: string) {
    const settings = { userPoolId: config.COGNITO_USER_POOL_ID, clientId: config.COGNITO_CLIENT_ID }
    this.idVerifier = CognitoJwtVerifier.create({ ...settings, tokenUse: 'id' })
    this.accessVerifier = CognitoJwtVerifier.create({ ...settings, tokenUse: 'access' })
  }

  hash(username: string) {
    return createHmac('sha256', this.secret).update(username + this.config.COGNITO_CLIENT_ID).digest('base64')
  }

  get clientId() { return this.config.COGNITO_CLIENT_ID }

  initiate(email: string, password: string) {
    return this.client.send(new InitiateAuthCommand({
      ClientId: this.clientId, AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: email, PASSWORD: password, SECRET_HASH: this.hash(email) }
    }))
  }

  challenge(result: InitiateAuthCommandOutput, fallbackUsername: string) {
    const username = result.ChallengeParameters?.USER_ID_FOR_SRP || result.ChallengeParameters?.USERNAME || fallbackUsername
    if (!result.Session || !result.ChallengeName) throw invalidIdentity()
    return { username, session: result.Session, challenge: result.ChallengeName }
  }

  respond(challenge: 'SOFTWARE_TOKEN_MFA' | 'MFA_SETUP' | 'NEW_PASSWORD_REQUIRED', username: string, session: string, value?: string) {
    return this.client.send(new RespondToAuthChallengeCommand({
      ClientId: this.clientId, ChallengeName: challenge, Session: session,
      ChallengeResponses: {
        USERNAME: username, SECRET_HASH: this.hash(username),
        ...(challenge === 'SOFTWARE_TOKEN_MFA' ? { SOFTWARE_TOKEN_MFA_CODE: value! } : {}),
        ...(challenge === 'NEW_PASSWORD_REQUIRED' ? { NEW_PASSWORD: value! } : {})
      }
    }))
  }

  associate(input: { Session: string } | { AccessToken: string }) {
    return this.client.send(new AssociateSoftwareTokenCommand(input))
  }

  async verifyTotp(input: { Session: string } | { AccessToken: string }, code: string) {
    const result = await this.client.send(new VerifySoftwareTokenCommand({ ...input, UserCode: code, FriendlyDeviceName: 'OB Auth' }))
    if (result.Status !== 'SUCCESS') throw invalidIdentity()
    return result
  }

  enableTotp(access: string) {
    return this.client.send(new SetUserMFAPreferenceCommand({ AccessToken: access, SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true } }))
  }

  async identity(result: AuthenticationResultType, provider: User['provider'], mfa: boolean, nonce?: string) {
    if (!result.IdToken || !result.AccessToken || !result.RefreshToken) throw invalidIdentity()
    const [id, access] = await Promise.all([this.idVerifier.verify(result.IdToken), this.accessVerifier.verify(result.AccessToken)])
    if (id.sub !== access.sub || typeof id.email !== 'string' || !access.username || (nonce && (typeof id.nonce !== 'string' || !equal(id.nonce, nonce)))) throw invalidIdentity()
    if (provider !== 'password') {
      const expected = { google: 'Google', microsoft: 'Microsoft', github: 'GitHub' }[provider]
      const identities = id.identities
      if (!Array.isArray(identities) || !identities.some(entry => typeof entry === 'object' && entry !== null && 'providerName' in entry && entry.providerName === expected)) throw invalidIdentity()
    }
    const user: User = { sub: id.sub, email: id.email, emailVerified: id.email_verified === true, provider, mfa }
    return { user, username: access.username, tokens: { access: result.AccessToken, refresh: result.RefreshToken, expiresAt: access.exp } } satisfies Identity
  }

  async refresh(tokens: Tokens, sub: string): Promise<Tokens> {
    const output = await this.client.send(new GetTokensFromRefreshTokenCommand({ ClientId: this.clientId, ClientSecret: this.secret, RefreshToken: tokens.refresh }))
    const result = output.AuthenticationResult
    if (!result?.AccessToken || !result.RefreshToken || !result.IdToken) throw invalidIdentity()
    const [access, id] = await Promise.all([this.accessVerifier.verify(result.AccessToken), this.idVerifier.verify(result.IdToken)])
    if (access.sub !== sub || id.sub !== sub) throw invalidIdentity()
    return { access: result.AccessToken, refresh: result.RefreshToken, expiresAt: access.exp }
  }
}
