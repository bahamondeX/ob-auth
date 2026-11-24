import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { DecryptCommand, GenerateDataKeyCommand, type KMSClient } from '@aws-sdk/client-kms'

export const randomToken = () => randomBytes(32).toString('base64url')
export const digest = (value: string) => createHash('sha256').update(value).digest('base64url')
export const epoch = () => Math.floor(Date.now() / 1000)
export const equal = (left: string, right: string) => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export interface Ciphertext { key: string; iv: string; tag: string; data: string }

export class Encryption {
  constructor(private kms: KMSClient, private keyId: string) {}

  async seal(value: unknown, id: string): Promise<Ciphertext> {
    const result = await this.kms.send(new GenerateDataKeyCommand({
      KeyId: this.keyId, KeySpec: 'AES_256', EncryptionContext: { obAuthRecord: id }
    }))
    if (!result.Plaintext || !result.CiphertextBlob) throw new Error('Missing KMS data key')
    const iv = randomBytes(12)
    try {
      const cipher = createCipheriv('aes-256-gcm', result.Plaintext, iv)
      cipher.setAAD(Buffer.from(id))
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
      return { key: Buffer.from(result.CiphertextBlob).toString('base64'), iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
    } finally {
      result.Plaintext.fill(0)
    }
  }

  async open<T>(value: Ciphertext, id: string): Promise<T> {
    const { Plaintext: key } = await this.kms.send(new DecryptCommand({
      KeyId: this.keyId, CiphertextBlob: Buffer.from(value.key, 'base64'), EncryptionContext: { obAuthRecord: id }
    }))
    if (!key) throw new Error('Missing KMS data key')
    try {
      const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'))
      cipher.setAAD(Buffer.from(id))
      cipher.setAuthTag(Buffer.from(value.tag, 'base64'))
      return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data, 'base64')), cipher.final()]).toString('utf8')) as T
    } finally {
      key.fill(0)
    }
  }
}
