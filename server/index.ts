import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createApp } from './app.ts'
import { openDb } from './db.ts'
import { ensureSetupToken } from './auth.ts'
import { startJobs } from './jobs.ts'
import { startMail } from './mail.ts'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required, e.g. postgres://user:pass@localhost:5432/taskhouse')
  process.exit(1)
}
const db = await openDb(process.env.DATABASE_URL)
const dataDir = process.env.DATA_DIR ?? './data'
const app = createApp(db, dataDir, process.env.DATABASE_URL)
startJobs(db, join(dataDir, 'files'))
startMail(db)

const setup = await ensureSetupToken(db)
if (setup) console.log(`\n  First run: open the app and enter this setup token to create the admin account:\n\n    ${setup}\n`)

// The web app: hashed assets cached for a year, the HTML shell for every client route.
app.use('/assets/*', async (c, next) => {
  await next()
  if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable')
})
app.use('*', serveStatic({ root: './dist' }))
const shell = existsSync('./dist/index.html') ? readFileSync('./dist/index.html', 'utf8') : ''
app.get('*', (c) => (shell ? c.html(shell, 200, { 'Cache-Control': 'no-cache' }) : c.text('Not found', 404)))

const port = Number(process.env.PORT ?? 3000)
const server = serve({ fetch: app.fetch, port }, () => console.log(`taskhouse listening on http://localhost:${port}`))
app.live?.injectWebSocket(server)
for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 10_000).unref()
  })
