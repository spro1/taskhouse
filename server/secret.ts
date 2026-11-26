// Secrets kept in the database (webhook signing keys, the SSO client secret) are encrypted with SECRET_KEY from .env,
// which is not in the database or its backups, so a leaked dump doesn't leak them. Without SECRET_KEY they are stored
// as they are; values saved that way keep working, and are encrypted once SECRET_KEY is set (see sealStored).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const ENC = 'enc:v1:'
const key = () => (process.env.SECRET_KEY ? createHash('sha256').update(process.env.SECRET_KEY).digest() : null)
export const encrypting = () => !!key()
export const isSealed = (stored: string) => stored.startsWith(ENC)

export function sealSecret(plain: string): string {
  const k = key()
  if (!plain || !k) return plain
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', k, iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ENC + [iv, c.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.')
}

export function openSecret(stored: string): string {
  if (!isSealed(stored)) return stored
  const k = key()
  if (!k) throw new Error('a stored secret is encrypted but SECRET_KEY is not set')
  const [iv, tag, ct] = stored.slice(ENC.length).split('.').map((s) => Buffer.from(s, 'base64url'))
  const d = createDecipheriv('aes-256-gcm', k, iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
}
