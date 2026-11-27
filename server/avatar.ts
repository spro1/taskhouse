// Profile photos, as in Pagehouse: the browser sends a small square JPEG (it resizes before uploading), stored by
// content hash next to attachments. Anyone signed in may see a photo; a missing one answers 404, cached briefly.
import type { Hono } from 'hono'
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from './db.ts'
import { fail, sha256, type Env } from './http.ts'

const TYPES = ['image/png', 'image/jpeg', 'image/webp']

export function registerAvatars(app: Hono<Env>, db: Db, filesDir: string) {
  mkdirSync(filesDir, { recursive: true })
  app.put('/api/me/avatar', async (c) => {
    const file = (await c.req.parseBody()).file
    if (!(file instanceof File) || !TYPES.includes(file.type)) return fail(c, 400, 'bad_request')
    if (file.size > 1024 * 1024) return fail(c, 413, 'file_too_large')
    const buf = Buffer.from(await file.arrayBuffer())
    const hash = sha256(buf)
    const path = join(filesDir, hash)
    // Touched when it already exists, so the unused-file cleanup (an hour's grace) never races this upload.
    if (existsSync(path)) utimesSync(path, new Date(), new Date())
    else writeFileSync(path, buf)
    await db.query('UPDATE users SET avatar = $1 WHERE id = $2', [`${hash}:${file.type}`, c.get('user').id])
    return c.json({ avatar: true })
  })
  app.delete('/api/me/avatar', async (c) => {
    await db.query('UPDATE users SET avatar = NULL WHERE id = $1', [c.get('user').id])
    return c.json({ avatar: false })
  })
  app.get('/api/users/:id/avatar', async (c) => {
    const id = Number(c.req.param('id'))
    const a = Number.isInteger(id) ? (await db.query('SELECT avatar FROM users WHERE id = $1', [id])).rows[0]?.avatar as string | undefined : undefined
    if (!a) return c.body(null, 404, { 'Cache-Control': 'private, max-age=300' })
    const [hash, mime] = a.split(':')
    const path = join(filesDir, hash)
    if (!/^[0-9a-f]{64}$/.test(hash) || !TYPES.includes(mime) || !existsSync(path)) return c.body(null, 404)
    const etag = `"${hash}"`
    if (c.req.header('if-none-match') === etag) return c.body(null, 304)
    return c.body(readFileSync(path), 200, { 'Content-Type': mime, ETag: etag, 'Cache-Control': 'private, max-age=300' })
  })
}
