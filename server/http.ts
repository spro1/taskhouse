// Shared bits for the route modules.
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { createHash } from 'node:crypto'
import type { Db } from './db.ts'

export type User = { id: number; email: string; name: string; isAdmin: boolean }
export type Env = { Variables: { user: User } }

/** Largest attachment, in bytes. */
export const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')

/** Error answer with a stable code the UI can translate. */
export const fail = (c: Context, status: ContentfulStatusCode, code: string, extra: object = {}) => c.json({ error: code, ...extra }, status)

export class HttpError extends Error {
  status: ContentfulStatusCode
  extra: object
  constructor(status: ContentfulStatusCode, code: string, extra: object = {}) {
    super(code)
    this.status = status
    this.extra = extra
  }
}

/**
 * The caller's address. TRUST_PROXY is how many reverse proxies stand in front (1 = one nginx). Each proxy appends to
 * X-Forwarded-For, so the client is that many hops from the right; the left end is whatever the client sent.
 */
export const clientIp = (c: Context) => {
  const proxies = Math.max(0, Math.floor(Number(process.env.TRUST_PROXY) || 0))
  if (proxies) {
    const hops = (c.req.header('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const ip = hops[hops.length - proxies]
    if (ip) return ip
  }
  return (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress ?? 'local'
}

export async function audit(db: Db, c: Context, action: string, target: string | null, ok = true, detail?: object, actorId?: number | null) {
  const actor = actorId !== undefined ? actorId : ((c.get('user') as User | undefined)?.id ?? null)
  await db.query('INSERT INTO audit_log (actor_id, action, target, ip, ok, detail) VALUES ($1, $2, $3, $4, $5, $6)',
    [actor, action, target, clientIp(c), ok, detail ? JSON.stringify(detail) : null])
}

/** JSON body or {} — handlers validate each field themselves. */
export const body = async (c: Context): Promise<Record<string, any>> => {
  const b = await c.req.json().catch(() => null)
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {}
}

// Plain text of a ProseMirror (Tiptap) doc, for search.
export function docText(node: any): string {
  if (!node || typeof node !== 'object') return ''
  if (typeof node.text === 'string') return node.text
  if (node.type === 'mention') return `@${node.attrs?.label ?? ''}`
  return Array.isArray(node.content) ? node.content.map(docText).join(node.content.some((c: any) => c?.type === 'text') ? '' : ' ') : ''
}

/** User ids mentioned in a doc. */
export function mentions(node: any, out = new Set<number>()): Set<number> {
  if (node && typeof node === 'object') {
    if (node.type === 'mention' && Number.isInteger(Number(node.attrs?.id))) out.add(Number(node.attrs.id))
    if (Array.isArray(node.content)) for (const c of node.content) mentions(c, out)
  }
  return out
}

/** A doc must be a ProseMirror root; plain strings become paragraphs so API clients can send text. */
export function toDoc(v: unknown) {
  if (typeof v === 'string')
    return { type: 'doc', content: v.split(/\n{2,}|\n/).map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })) }
  if (v && typeof v === 'object' && (v as any).type === 'doc' && JSON.stringify(v).length <= 1_000_000) return v
  return null
}

/** Whether an Origin header names this host. */
export function sameHost(origin: string, host: string | undefined) {
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
