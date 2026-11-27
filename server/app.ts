import { Hono } from 'hono'
import { join } from 'node:path'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import type { Db } from './db.ts'
import { fail, HttpError, MAX_UPLOAD, sameHost, type Env } from './http.ts'
import { registerAuth } from './auth.ts'
import { registerProjects } from './projects.ts'
import { registerIssues } from './issues.ts'
import { registerSearch } from './search.ts'
import { registerLive } from './live.ts'
import { registerExport } from './export.ts'
import { metricsMiddleware, recordError } from './metrics.ts'
import { registerMonitor } from './monitor.ts'
import { registerMcp } from './mcp.ts'
import { registerAvatars } from './avatar.ts'

/** dbUrl turns on live updates (they need their own LISTEN connection). */
export function createApp(db: Db, dataDir: string, dbUrl?: string) {
  const app = new Hono<Env>()
  app.onError((e, c) => {
    if (e instanceof HttpError) return fail(c, e.status, e.message, e.extra)
    console.error(e)
    recordError(c.req.method, c.req.path, 500, (e as Error).message || String(e))
    return fail(c, 500, 'internal')
  })
  app.use('*', metricsMiddleware)
  // CSP: only this server's own scripts; inline style attributes are used by React. No framing (clickjacking).
  app.use('*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"], baseUri: ["'self'"], objectSrc: ["'none'"],
    },
    crossOriginEmbedderPolicy: false,
  }))
  // Bodies are read into memory, so cap them before anything reads one (sign-in included): 2 MB, uploads MAX_UPLOAD_MB.
  const small = bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => fail(c, 413, 'too_large') })
  const upload = bodyLimit({ maxSize: MAX_UPLOAD + 64 * 1024, onError: (c) => fail(c, 413, 'file_too_large') })
  app.use('/api/*', (c, next) => (c.req.path.endsWith('/attachments') ? upload : small)(c, next))
  // Browsers say where a request comes from: a change sent by another site (even a sibling subdomain, which
  // SameSite cookies let through) is refused. API clients with a token don't use cookies and aren't affected.
  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.header('authorization')) return next()
    const site = c.req.header('sec-fetch-site')
    const origin = c.req.header('origin')
    const ok = site ? site === 'same-origin' || site === 'none' : !origin || sameHost(origin, c.req.header('x-forwarded-host') ?? c.req.header('host'))
    return ok ? next() : fail(c, 403, 'cross_site')
  })
  app.get('/healthz', async (c) => {
    await db.query('SELECT 1')
    return c.json({ ok: true })
  })
  registerAuth(app, db)
  registerProjects(app, db)
  registerIssues(app, db, dataDir)
  registerSearch(app, db)
  registerExport(app, db)
  registerMcp(app)
  registerAvatars(app, db, join(dataDir, 'files'))
  const live = dbUrl ? registerLive(app, db, dbUrl) : null
  registerMonitor(app, db, join(dataDir, 'files'), () => live)
  app.all('/api/*', (c) => fail(c, 404, 'not_found'))
  return Object.assign(app, { live })
}
