// Live updates over one WebSocket per open project view: GET /api/live?project=KEY.
// The database announces changes (migration 003); this process listens once and fans out to subscribed sockets.
// With several app instances each listens on its own, so it works across them without anything extra.
import type { Hono } from 'hono'
import { createNodeWebSocket } from '@hono/node-ws'
import type { WSContext } from 'hono/ws'
import pg from 'pg'
import type { Db } from './db.ts'
import { sameHost, type Env, type User } from './http.ts'
import { projectsFor } from './access.ts'

// A socket lives at most this long; the reconnect checks the session and the project role again.
const MAX_AGE_MS = 3600_000

export function registerLive(app: Hono<Env>, db: Db, url: string) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: app as any })
  const subs = new Map<number, Set<WSContext>>()
  // Changes are batched per socket for 150 ms: a bulk edit of 200 issues becomes one message.
  const pending = new Map<WSContext, Set<number>>()
  const send = (ws: WSContext, ids: number[]) => {
    let p = pending.get(ws)
    if (!p) {
      pending.set(ws, (p = new Set()))
      setTimeout(() => {
        pending.delete(ws)
        if (ws.readyState === 1) ws.send(JSON.stringify({ issues: [...p!] }))
      }, 150)
    }
    for (const id of ids) p.add(id)
  }

  let listener: pg.Client | null = null
  let closed = false
  const listen = async (delay = 0): Promise<void> => {
    if (closed) return
    await new Promise((r) => setTimeout(r, delay))
    const c = new pg.Client({ connectionString: url })
    c.on('notification', (m) => {
      try {
        const { p, i } = JSON.parse(m.payload ?? '{}')
        for (const ws of subs.get(p) ?? []) send(ws, i ? [i] : [])
      } catch {}
    })
    const retry = () => {
      if (listener !== c) return
      listener = null
      c.end().catch(() => {})
      // Changes may have been missed while disconnected: everyone reloads.
      for (const set of subs.values()) for (const ws of set) ws.readyState === 1 && ws.send(JSON.stringify({ resync: true }))
      void listen(Math.min(delay * 2 || 1000, 30_000))
    }
    c.on('error', retry)
    c.on('end', retry)
    try {
      await c.connect()
      await c.query('LISTEN th_live')
      listener = c
    } catch {
      c.end().catch(() => {})
      void listen(Math.min(delay * 2 || 1000, 30_000))
    }
  }
  void listen()

  app.get('/api/live', upgradeWebSocket(async (c) => {
    const user = c.get('user') as User
    // A page on another site can open a socket with the user's cookies; only our own pages may.
    const origin = c.req.header('origin')
    const foreign = origin && !sameHost(origin, c.req.header('x-forwarded-host') ?? c.req.header('host'))
    const [project] = foreign ? [] : await projectsFor(db, user, c.req.query('project') ?? '')
    let timer: ReturnType<typeof setTimeout>
    return {
      onOpen(_e, ws) {
        if (!project) return ws.close(4404, 'not_found')
        if (!subs.has(project.id)) subs.set(project.id, new Set())
        subs.get(project.id)!.add(ws)
        timer = setTimeout(() => ws.close(4000, 'max_age'), MAX_AGE_MS)
      },
      onClose(_e, ws) {
        clearTimeout(timer)
        if (project) subs.get(project.id)?.delete(ws)
        pending.delete(ws)
      },
    }
  }))

  return {
    injectWebSocket,
    connections: () => [...subs.values()].reduce((n, set) => n + set.size, 0),
    ready: async () => { while (!listener) await new Promise((r) => setTimeout(r, 20)) },
    close: async () => {
      closed = true
      const c = listener
      listener = null
      await c?.end().catch(() => {})
    },
  }
}
