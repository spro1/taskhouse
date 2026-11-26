import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from './app.ts'
import { openDb, type Db } from './db.ts'
import { ensureSetupToken } from './auth.ts'
import { pruneFiles, runJobs, sealWebhookSecrets } from './jobs.ts'
import { csvCell } from './export.ts'
import { sendDigests, useTestTransport } from './mail.ts'
import nodemailer from 'nodemailer'
import { dateValue, hangulBigrams, koreanStem } from './search.ts'
import { testDatabase } from './testdb.ts'
import { parseTql } from './tql.ts'
import { serve } from '@hono/node-server'
import WebSocket from 'ws'
import pg from 'pg'

let db: Db
let app: ReturnType<typeof createApp>
let stop: () => Promise<void>
let dbUrl: string
let dataDir: string
// The webhook test receiver runs on this machine; everything else about loopback stays blocked.
process.env.WEBHOOK_ALLOW = '127.0.0.1'
before(async () => {
  const t = await testDatabase()
  stop = t.stop
  dbUrl = t.url
  assert.match(new URL(t.url).pathname, /_test$/) // the test wipes it
  db = await openDb(t.url)
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
  await db.end()
  db = await openDb(t.url)
  dataDir = mkdtempSync(join(tmpdir(), 'taskhouse-'))
  app = createApp(db, dataDir)
})
after(async () => {
  await db.end()
  await stop()
})

// A tiny client that keeps its own session cookie (or sends a bearer token).
function client(bearer?: string) {
  const c = {
    cookie: '',
    async call(method: string, path: string, body?: unknown) {
      const res = await app.request(path, {
        method,
        headers: { cookie: c.cookie, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      const set = res.headers.get('set-cookie')
      if (set?.startsWith('sid=')) c.cookie = set.split(';')[0]
      return res
    },
    async json(method: string, path: string, body?: unknown) {
      const r = await c.call(method, path, body)
      return { ...(await r.json()), http: r.status }
    },
    async list(method: string, path: string, body?: unknown) {
      return (await c.call(method, path, body)).json()
    },
  }
  return c
}

const admin = client()
const bob = client()
const carol = client()
let bobId: number, carolId: number, adminId: number

test('first run needs the setup token; then invites make accounts', async () => {
  const token = (await ensureSetupToken(db))!
  assert.equal(await ensureSetupToken(db), token) // every app instance prints the same one
  assert.equal((await admin.json('GET', '/api/auth/state')).setupRequired, true)
  assert.equal((await admin.call('GET', '/api/projects')).status, 401)
  const form = { email: 'admin@example.test', name: '관리자', password: 'password1' }
  assert.equal((await admin.call('POST', '/api/auth/setup', { ...form, token: 'wrong' })).status, 403)
  assert.equal((await admin.call('POST', '/api/auth/setup', { ...form, token })).status, 200)
  assert.equal((await client().call('POST', '/api/auth/setup', { ...form, token })).status, 409)
  adminId = (await admin.json('GET', '/api/me')).id

  for (const [c, email, name] of [[bob, 'bob@example.test', '밥'], [carol, 'carol@example.test', '캐롤']] as const) {
    const inv = await admin.json('POST', '/api/admin/invites', { email })
    assert.equal((await c.call('POST', `/api/auth/invite/${inv.token}`, { name, password: 'password1' })).status, 200)
    assert.equal((await c.call('POST', `/api/auth/invite/${inv.token}`, { name, password: 'password1' })).status, 404) // single use
  }
  bobId = (await bob.json('GET', '/api/me')).id
  carolId = (await carol.json('GET', '/api/me')).id
  assert.equal((await bob.call('GET', '/api/admin/users')).status, 403)
  assert.equal((await client().call('POST', '/api/auth/login', { email: 'bob@example.test', password: 'nope-nope' })).status, 401)
  assert.equal((await client().call('POST', '/api/auth/login', { email: 'bob@example.test', password: 'password1' })).status, 200)
  // A sign-in lasts a day (SESSION_HOURS, default 24), in the database and in the cookie.
  const r = await client().call('POST', '/api/auth/login', { email: 'bob@example.test', password: 'password1' })
  assert.match(r.headers.get('set-cookie')!, /Max-Age=86400/)
  const { hours } = (await db.query(`SELECT round(extract(epoch FROM max(expires_at) - now()) / 3600) AS hours FROM sessions WHERE user_id = $1`, [bobId])).rows[0]
  assert.equal(Number(hours), 24)
})

test('project defaults, issue keys, field-level merge', async () => {
  const p = await admin.json('POST', '/api/projects', { key: 'DEMO', name: '데모', visibility: 'private' })
  assert.equal(p.http, 201)
  assert.equal((await admin.call('POST', '/api/projects', { key: 'DEMO', name: 'x' })).status, 409)
  await admin.call('PUT', '/api/projects/DEMO/roles', { roles: [{ user: adminId, role: 'admin' }, { user: bobId, role: 'member' }] })
  const proj = await admin.json('GET', '/api/projects/DEMO')
  assert.deepEqual(proj.statuses.map((s: any) => s.name), ['할 일', '진행 중', '리뷰 중', '완료'])

  const a = await bob.json('POST', '/api/projects/DEMO/issues', { title: 'GPU 노드 드레인 시 파드 재배치 지연', type: '버그', priority: 1, labels: ['GPU', 'scheduler'] })
  assert.equal(a.http, 201)
  assert.equal(a.key, 'DEMO-1')
  assert.deepEqual(a.labels, ['gpu', 'scheduler'])
  assert.equal(a.status.name, '할 일')
  const b = await bob.json('POST', '/api/projects/DEMO/issues', { title: '두 번째' })
  assert.equal(b.key, 'DEMO-2')
  assert.equal((await bob.list('GET', '/api/issues/DEMO-1/changes')).length, 1) // just "created"

  // Two people edit different fields from the same starting point: both land.
  assert.equal((await admin.call('PATCH', '/api/issues/DEMO-1', { title: '새 제목', _base: { title: a.title } })).status, 200)
  assert.equal((await bob.call('PATCH', '/api/issues/DEMO-1', { points: 3, _base: { points: null } })).status, 200)
  // Same field from a stale start: 409 with the current value.
  const stale = await bob.json('PATCH', '/api/issues/DEMO-1', { title: '덮어쓰기', _base: { title: a.title } })
  assert.equal(stale.http, 409)
  assert.equal(stale.current.title, '새 제목')
  const now = await bob.json('GET', '/api/issues/DEMO-1')
  assert.equal(now.title, '새 제목')
  assert.equal(now.points, 3)
  assert.equal((await bob.call('PATCH', '/api/issues/DEMO-1', { status: 3 })).status, 400) // status only via transitions
  assert.equal((await bob.call('PATCH', '/api/issues/DEMO-1', { assignee: carolId })).status, 400) // carol can't see DEMO
})

test('hidden projects are 404 everywhere', async () => {
  assert.equal((await carol.call('GET', '/api/issues/DEMO-1')).status, 404)
  assert.equal((await carol.call('GET', '/api/issues/NOPE-1')).status, 404)
  assert.equal((await carol.call('PATCH', '/api/issues/DEMO-1', { title: 'x' })).status, 404)
  assert.equal((await carol.list('POST', '/api/search', { query: { field: 'text', op: '~', value: '제목' } })).issues.length, 0)
  assert.equal((await carol.list('GET', '/api/quick?q=DEMO-1')).issues.length, 0)
  assert.equal((await carol.list('GET', '/api/projects')).length, 0)
  // "view" visibility: carol may read but not write.
  await admin.call('PATCH', '/api/projects/DEMO', { visibility: 'view' })
  assert.equal((await carol.call('GET', '/api/issues/DEMO-1')).status, 200)
  assert.equal((await carol.call('PATCH', '/api/issues/DEMO-1', { title: 'x' })).status, 403)
  assert.equal((await carol.call('POST', '/api/issues/DEMO-1/comments', { text: 'x' })).status, 403)
  await admin.call('PATCH', '/api/projects/DEMO', { visibility: 'private' })
})

test('workflow rules: conditions, validators, post functions', async () => {
  // Default: any move.
  const moves = await bob.list('GET', '/api/issues/DEMO-2/transitions')
  assert.deepEqual(moves.map((m: any) => m.to.name), ['진행 중', '리뷰 중', '완료'])
  const done = await bob.json('POST', '/api/issues/DEMO-2/transitions', { to: '완료' })
  assert.equal(done.status.category, 2)
  assert.ok(done.resolvedAt)
  const back = await bob.json('POST', '/api/issues/DEMO-2/transitions', { to: '할 일' })
  assert.equal(back.resolvedAt, null)

  const proj = await admin.json('GET', '/api/projects/DEMO')
  const r = await admin.call('PUT', '/api/projects/DEMO/workflow', {
    statuses: proj.statuses,
    transitions: [
      { name: '시작', from: '할 일', to: '진행 중' },
      { name: '리뷰 요청', from: '진행 중', to: '리뷰 중', rules: { conditions: [{ kind: 'is_assignee' }], validators: [{ kind: 'required', fields: ['points'] }], post: [{ kind: 'set', field: 'assignee', value: '$reporter' }] } },
      { name: '완료', from: '리뷰 중', to: '완료', rules: { validators: [{ kind: 'subtasks_done' }] } },
      { name: '재오픈', from: null, to: '할 일' },
    ],
  })
  assert.equal(r.status, 200)
  assert.equal((await bob.json('POST', '/api/issues/DEMO-2/transitions', { to: '완료' })).error, 'transition_not_allowed')
  await bob.call('POST', '/api/issues/DEMO-2/transitions', { to: '진행 중' })
  // Not the assignee: the move isn't offered.
  assert.equal((await bob.json('POST', '/api/issues/DEMO-2/transitions', { to: '리뷰 중' })).error, 'transition_not_allowed')
  await bob.call('PATCH', '/api/issues/DEMO-2', { assignee: bobId })
  const v = await bob.json('POST', '/api/issues/DEMO-2/transitions', { to: '리뷰 중' })
  assert.equal(v.error, 'validation_failed')
  await bob.call('PATCH', '/api/issues/DEMO-2', { points: 2 })
  const reviewed = await bob.json('POST', '/api/issues/DEMO-2/transitions', { to: '리뷰 중' })
  assert.equal(reviewed.status.name, '리뷰 중')
  assert.equal(reviewed.assignee.id, bobId) // reporter is bob too

  // A subtask must hang under a standard issue; an open one blocks "완료".
  assert.equal((await bob.json('POST', '/api/projects/DEMO/issues', { title: '고아', type: '하위 작业' })).error, 'bad_field')
  assert.equal((await bob.json('POST', '/api/projects/DEMO/issues', { title: '고아', type: '하위 작업' })).error, 'bad_hierarchy')
  const sub = await bob.json('POST', '/api/projects/DEMO/issues', { title: '하위', type: '하위 작업', parent: 'DEMO-2' })
  assert.equal(sub.parent, 'DEMO-2')
  assert.equal((await bob.json('POST', '/api/issues/DEMO-2/transitions', { to: '완료' })).error, 'validation_failed')

  // A status still used by issues can't be dropped.
  const dropped = await admin.json('PUT', '/api/projects/DEMO/workflow', { statuses: proj.statuses.filter((s: any) => s.name !== '리뷰 중'), transitions: [] })
  assert.equal(dropped.error, 'status_in_use')
  // Renaming keeps issues on the same status; back to the free workflow.
  const renamed = proj.statuses.map((s: any) => (s.name === '리뷰 중' ? { ...s, name: '검토' } : s))
  assert.equal((await admin.call('PUT', '/api/projects/DEMO/workflow', { statuses: renamed, transitions: [] })).status, 200)
  assert.equal((await bob.json('GET', '/api/issues/DEMO-2')).status.name, '검토')
})

test('rank, search, Korean text, sprints', async () => {
  const keys = async (query: unknown, sort: unknown = 'rank asc') => (await bob.list('POST', '/api/search', { query, sort })).issues.map((i: any) => i.key)
  const all = { field: 'project', value: 'DEMO' }
  assert.deepEqual(await keys(all), ['DEMO-1', 'DEMO-2', 'DEMO-3'])
  assert.equal((await bob.call('POST', '/api/issues/DEMO-3/rank', { before: 'DEMO-1' })).status, 200)
  assert.equal((await bob.call('POST', '/api/issues/DEMO-1/rank', { after: 'DEMO-2' })).status, 200)
  assert.deepEqual(await keys(all), ['DEMO-3', 'DEMO-2', 'DEMO-1'])

  await bob.call('PATCH', '/api/issues/DEMO-1', { doc: '노드 드레인 이후 파드가 재배치되지 않음' })
  // Two-syllable word, and a word with a particle ("드레인을" -> "드레인").
  assert.deepEqual(await keys({ field: 'text', op: '~', value: '파드' }), ['DEMO-1'])
  assert.deepEqual(await keys({ field: 'text', op: '~', value: '드레인을' }), ['DEMO-1'])
  assert.deepEqual(await keys({ field: 'text', op: '~', value: '%' }), [])
  assert.deepEqual(await keys({ and: [all, { field: 'statusCategory', op: '!=', value: 'done' }, { field: 'assignee', value: 'me' }] }), ['DEMO-2'])
  assert.deepEqual(await keys({ and: [all, { field: 'assignee', op: 'empty' }] }, 'key asc'), ['DEMO-1', 'DEMO-3'])
  assert.deepEqual(await keys({ field: 'labels', value: 'gpu' }), ['DEMO-1'])
  assert.deepEqual(await keys({ and: [all, { field: 'created', op: '>=', value: '-1d' }] }, 'key desc'), ['DEMO-3', 'DEMO-2', 'DEMO-1'])
  assert.equal((await bob.json('POST', '/api/search', { query: { field: 'nope', value: 1 } })).error, 'bad_query')
  assert.equal((await bob.json('POST', '/api/search', { query: all, sort: 'rank; DROP TABLE issues' })).error, 'bad_query')
  const page = await bob.list('POST', '/api/search', { query: all, sort: 'key asc', limit: 2 })
  assert.equal(page.issues.length, 2)
  assert.equal((await bob.list('POST', '/api/search', { query: all, sort: 'key asc', limit: 2, cursor: page.next })).issues[0].key, 'DEMO-3')
  assert.equal((await bob.list('GET', '/api/quick?q=demo-2')).exact, true)

  const sprint = await bob.json('POST', '/api/projects/DEMO/sprints', {})
  assert.equal(sprint.name, 'DEMO 스프린트 1')
  await bob.call('POST', '/api/issues/bulk', { keys: ['DEMO-1', 'DEMO-2'], set: { sprint: sprint.id } })
  assert.equal((await bob.call('POST', `/api/projects/DEMO/sprints/${sprint.id}/start`, {})).status, 200)
  assert.deepEqual(await keys({ and: [all, { field: 'sprint', value: 'open' }] }, 'key asc'), ['DEMO-1', 'DEMO-2'])
  await bob.call('POST', '/api/issues/DEMO-1/transitions', { to: '완료' })
  const closed = await bob.json('POST', `/api/projects/DEMO/sprints/${sprint.id}/complete`, { moveTo: null })
  assert.equal(closed.moved, 1)
  assert.equal((await bob.json('GET', '/api/issues/DEMO-2')).sprint, null)
  assert.equal((await bob.json('GET', '/api/issues/DEMO-1')).sprint.id, sprint.id) // done work stays in its sprint
})

test('comments notify watchers who can see the project, never the actor', async () => {
  await admin.call('PATCH', '/api/issues/DEMO-3', { assignee: adminId })
  await bob.call('POST', '/api/issues/DEMO-3/comments', { text: '확인 부탁드립니다' })
  const n = await admin.list('GET', '/api/notifications?unread=1')
  assert.ok(n.some((x: any) => x.kind === 'commented' && x.data.key === 'DEMO-3'))
  assert.ok(!(await bob.list('GET', '/api/notifications')).some((x: any) => x.kind === 'commented'))
  // A mention of someone who can't see the project notifies nobody.
  await bob.call('POST', '/api/issues/DEMO-3/comments', { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: carolId, label: '캐롤' } }] }] } })
  assert.equal((await carol.list('GET', '/api/notifications')).length, 0)
  await admin.call('POST', '/api/notifications/read', {})
  assert.equal((await admin.list('GET', '/api/notifications?unread=1')).length, 0)
})

test('email digests: one mail per person, after a quiet period, unread only', async () => {
  const mails: any[] = []
  const transport = nodemailer.createTransport({ jsonTransport: true })
  const send = transport.sendMail.bind(transport)
  transport.sendMail = (async (m: any) => { mails.push(m); return send(m) }) as any
  await db.query('UPDATE notifications SET mailed_at = now()') // earlier tests
  await bob.call('POST', '/api/issues/DEMO-3/comments', { text: '첫 번째' })
  await bob.call('POST', '/api/issues/DEMO-3/comments', { text: '두 번째' })
  assert.equal(await sendDigests(db, transport), 0) // still within the quiet period
  assert.equal(await sendDigests(db, transport, "now() + interval '6 minutes'"), 1)
  assert.equal(mails[0].to, 'admin@example.test')
  assert.match(mails[0].text, /DEMO-3[\s\S]*첫 번째[\s\S]*두 번째/)
  assert.equal(await sendDigests(db, transport, "now() + interval '6 minutes'"), 0) // not twice
  await bob.call('POST', '/api/issues/DEMO-3/comments', { text: '세 번째' })
  await admin.call('PATCH', '/api/me', { emailNotify: false })
  assert.equal(await sendDigests(db, transport, "now() + interval '6 minutes'"), 0)
  await admin.call('PATCH', '/api/me', { emailNotify: true })
  await admin.call('POST', '/api/notifications/read', {}) // read in the app: no mail
  assert.equal(await sendDigests(db, transport, "now() + interval '6 minutes'"), 0)
})

test('links: blocks / is blocked by, relates stored once', async () => {
  assert.equal((await bob.call('POST', '/api/issues/DEMO-3/links', { kind: 'is_blocked_by', target: 'DEMO-2' })).status, 200)
  assert.equal((await bob.call('POST', '/api/issues/DEMO-3/links', { kind: 'relates', target: 'DEMO-1' })).status, 200)
  assert.equal((await bob.call('POST', '/api/issues/DEMO-1/links', { kind: 'relates', target: 'DEMO-3' })).status, 200) // same row
  const rel = await bob.json('GET', '/api/issues/DEMO-3/related')
  assert.deepEqual(rel.links.map((l: any) => `${l.kind}:${l.outward}:${l.key}`).sort(), ['blocks:false:DEMO-2', 'relates:false:DEMO-1'])
})

test('webhooks are queued with the change and signed on delivery', async () => {
  const got: { sig: string; body: string }[] = []
  const srv = createServer((req, res) => {
    let b = ''
    req.on('data', (d) => (b += d)).on('end', () => (got.push({ sig: String(req.headers['x-signature']), body: b }), res.end('ok')))
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const port = (srv.address() as any).port
  const hook = await admin.json('POST', '/api/projects/DEMO/webhooks', { url: `http://127.0.0.1:${port}/x`, events: ['issue.transitioned'] })
  await db.query('UPDATE jobs SET done_at = now()') // earlier events
  await bob.call('POST', '/api/issues/DEMO-3/transitions', { to: '진행 중' })
  await bob.call('PATCH', '/api/issues/DEMO-3', { title: '구독하지 않은 이벤트' })
  assert.equal(await runJobs(db), 1)
  srv.close()
  assert.equal(got.length, 1)
  assert.equal(got[0].sig, `sha256=${createHmac('sha256', hook.secret).update(got[0].body).digest('hex')}`)
  const ev = JSON.parse(got[0].body)
  assert.equal(ev.event, 'issue.transitioned')
  assert.deepEqual(ev.changes[0], { field: 'status', old: { id: ev.changes[0].old.id, name: '할 일' }, new: { id: ev.changes[0].new.id, name: '진행 중' } })
})

test('live updates: ids only, to people who can see the project', async () => {
  const liveApp = createApp(db, mkdtempSync(join(tmpdir(), 'taskhouse-')), dbUrl)
  const server = serve({ fetch: liveApp.fetch, port: 0 })
  liveApp.live!.injectWebSocket(server)
  await liveApp.live!.ready()
  const port = (server.address() as any).port
  const open = (cookie: string) => new Promise<{ ws: WebSocket; got: any[]; closed: Promise<number> }>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live?project=DEMO`, { headers: { cookie } })
    const got: any[] = []
    ws.on('message', (m) => got.push(JSON.parse(String(m))))
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)))
    ws.on('open', () => resolve({ ws, got, closed }))
    ws.on('unexpected-response', (_q, res) => reject(new Error(`HTTP ${res.statusCode}`)))
  })
  const b = await open(bob.cookie)
  const c = await open(carol.cookie)
  assert.equal(await c.closed, 4404) // carol can't see DEMO
  await admin.call('PATCH', '/api/issues/DEMO-1', { title: '실시간' })
  await admin.call('POST', '/api/issues/DEMO-1/comments', { text: '실시간 댓글' })
  await new Promise((r) => setTimeout(r, 400))
  const ids = b.got.flatMap((m) => m.issues ?? [])
  const v1 = (await admin.json('GET', '/api/issues/DEMO-1')).id
  assert.ok(ids.includes(v1))
  assert.ok(!JSON.stringify(b.got).includes('실시간')) // no content over the socket
  await assert.rejects(open(''), /401/)
  b.ws.close()
  await liveApp.live!.close()
  server.close()
})

test('API tokens expire with the account', async () => {
  const t = await bob.json('POST', '/api/me/tokens', { name: 'agent', days: 30 })
  const agent = client(t.token)
  assert.equal((await agent.call('GET', '/api/issues/DEMO-1')).status, 200)
  await admin.call('PATCH', `/api/admin/users/${bobId}`, { disabled: true })
  assert.equal((await agent.call('GET', '/api/issues/DEMO-1')).status, 401)
  assert.equal((await bob.call('GET', '/api/me')).status, 401) // sessions gone too
  await admin.call('PATCH', `/api/admin/users/${bobId}`, { disabled: false })
  assert.equal((await agent.call('GET', '/api/issues/DEMO-1')).status, 401) // revoked, not just paused
  const actions = (await admin.list('GET', '/api/admin/audit')).map((a: any) => a.action)
  for (const a of ['auth.setup', 'auth.login', 'project.workflow', 'token.create', 'user.update', 'issue.bulk']) assert.ok(actions.includes(a), a)
})

test('TQL: the design doc\'s 20 queries run, and mean what they say', async () => {
  await bob.call('POST', '/api/auth/login', { email: 'bob@example.test', password: 'password1' }) // signed out by the token test
  const tql = async (q: string) => {
    const r = await bob.json('POST', '/api/search', { tql: q, limit: 200 })
    assert.equal(r.http, 200, `${q}: ${JSON.stringify(r)}`)
    return r.issues.map((i: any) => i.key)
  }
  // Section 7 of the design (project DEMO, fixVersion queries aside: versions come in phase 2).
  for (const q of [
    'assignee = currentUser() AND statusCategory != done ORDER BY priority',
    'project = DEMO AND sprint IN openSprints() ORDER BY rank',
    'project = DEMO AND sprint IS EMPTY AND statusCategory != done ORDER BY rank',
    'type = 버그 AND priority = 긴급 AND assignee IS EMPTY',
    'due < startOfDay() AND statusCategory != done',
    'resolved >= startOfWeek() AND assignee = currentUser()',
    'statusCategory = doing AND updated < -7d',
    'parent = DEMO-2 ORDER BY status',
    'linked = "is blocked by" AND assignee = currentUser() AND statusCategory != done',
    'status CHANGED FROM 완료 AFTER -30d',
    'sprint IN openSprints() AND sprint CHANGED AFTER startOfWeek()',
    'type = 스토리 AND points IS EMPTY AND sprint IN openSprints()',
    'assignee IN membersOf("demo-dev") AND statusCategory = doing',
    'text ~ "드레인 지연" AND project = DEMO',
    'status = "리뷰 중" AND NOT status CHANGED AFTER -3d',
    'reporter = currentUser() AND created >= -1d ORDER BY created DESC',
    'priority IN (높음, 긴급) OR labels = gpu ORDER BY key DESC, updated',
    'assignee = "밥" AND (statusCategory = todo OR statusCategory = "in progress")',
    'sprint IN closedSprints()',
    'ORDER BY updated DESC',
  ]) await tql(q)

  assert.deepEqual(await tql('project = DEMO AND key IN (DEMO-1, DEMO-2) ORDER BY key'), ['DEMO-1', 'DEMO-2'])
  assert.deepEqual(await tql('linked = "is blocked by"'), ['DEMO-3'])
  assert.deepEqual(await tql('linked = blocks'), ['DEMO-2'])
  assert.deepEqual(await tql('parent = DEMO-2'), ['DEMO-3'])
  // DEMO-1 went to 완료 earlier and came back? It was moved to 완료 once: it CHANGED TO 완료.
  assert.ok((await tql('status CHANGED TO 완료')).includes('DEMO-1'))
  assert.ok((await tql(`assignee CHANGED TO "밥" BY "밥"`)).includes('DEMO-2'))
  assert.deepEqual(await tql('assignee = 밥 ORDER BY key'), await tql(`assignee = ${bobId} ORDER BY key`))
  // Errors point at the problem instead of failing as 500.
  for (const [q, why] of [['nope = 1', /unknown field nope/], ['priority = 아주높음', /priority needs a number/], ['status = "열린', /unterminated/],
    ['assignee =', /expected a value/], ['project = DEMO ORDER BY nope', /cannot sort/], ['(project = DEMO', /expected \)/], ['due < tomorrow()', /unknown function/]] as const) {
    const r = await bob.json('POST', '/api/search', { tql: q })
    assert.equal(r.http, 400, q)
    assert.match(r.why, why, q)
  }
  // Saved filters keep the text.
  const f = await bob.json('POST', '/api/filters', { name: '내 버그', tql: 'type = 버그 AND assignee = currentUser() ORDER BY priority' })
  assert.equal(f.http, 201)
  assert.equal((await bob.list('GET', '/api/filters'))[0].tql, 'type = 버그 AND assignee = currentUser() ORDER BY priority')
  assert.equal((await bob.json('POST', '/api/filters', { name: 'x', tql: 'nope = 1' })).http, 400)
})

test('upgrade: later migrations apply to a database made by 0.1 (001 only) with data in it', async () => {
  await db.query('DROP DATABASE IF EXISTS taskhouse_upgrade_test')
  await db.query('CREATE DATABASE taskhouse_upgrade_test')
  const url = dbUrl.replace(/\/[^/]+$/, '/taskhouse_upgrade_test')
  const old = new pg.Client(url)
  await old.connect()
  await old.query(readFileSync(new URL('./migrations/001_init.sql', import.meta.url), 'utf8'))
  await old.query(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
    INSERT INTO schema_migrations (name) VALUES ('001_init.sql');
    INSERT INTO users (email, name) VALUES ('a@x', 'A'); INSERT INTO projects (key, name, issue_seq) VALUES ('OLD', '옛', 1);
    INSERT INTO statuses (project_id, name, category, position) VALUES (1, '할 일', 0, 0);
    INSERT INTO issues (project_id, number, type_id, title, text, status_id, reporter_id, rank) VALUES (1, 1, 3, '배포 장애', '파드 재배치', 1, 1, 'a0');
    INSERT INTO notifications (user_id, issue_id, kind) VALUES (1, 1, 'created'); INSERT INTO filters (owner_id, name, query) VALUES (1, 'f', '{"and":[]}')`)
  await old.end()
  const up = await openDb(url)
  const r = (await up.query(`SELECT grams, (SELECT email_notify FROM users) AS notify, (SELECT count(*)::int FROM schema_migrations) AS n FROM issues`)).rows[0]
  assert.deepEqual(r.grams.sort(), ['배포', '배치', '장애', '재배', '파드'].sort())
  assert.equal(r.notify, true)
  const listen = new pg.Client(url)
  await listen.connect()
  await listen.query('LISTEN th_live')
  const got = new Promise((res) => listen.on('notification', (m) => res(JSON.parse(m.payload!))))
  await up.query(`UPDATE issues SET title = '바뀜'`)
  assert.deepEqual(await got, { p: 1, i: 1 })
  await listen.end()
  await up.end()
  await db.query('DROP DATABASE taskhouse_upgrade_test')
})

test('SSO: sign-in, groups, and every check that should refuse', async () => {
  let nonce = ''
  let lastSecret: string | null = null
  let claims: Record<string, unknown> = {}
  const idp = createServer((req, res) => {
    const u = new URL(req.url!, 'http://idp')
    const send = (o: object) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)) }
    if (u.pathname === '/.well-known/openid-configuration')
      return send({ issuer, authorization_endpoint: `${issuer}/auth`, token_endpoint: `${issuer}/token`, userinfo_endpoint: `${issuer}/userinfo`, end_session_endpoint: `${issuer}/logout` })
    if (u.pathname === '/userinfo') return send({ sub: claims.sub, groups: claims.groups })
    let body = ''
    req.on('data', (d) => (body += d)).on('end', () => {
      lastSecret = new URLSearchParams(body).get('client_secret')
      if (new URLSearchParams(body).get('code') !== 'good') return res.writeHead(400).end()
      const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
      send({ access_token: 'at', id_token: [part({ alg: 'none' }), part({ iss: issuer, aud: 'taskhouse', exp: Date.now() / 1000 + 60, nonce, ...claims }), ''].join('.') })
    })
  })
  await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r))
  const issuer = `http://127.0.0.1:${(idp.address() as any).port}`
  Object.assign(process.env, { OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'taskhouse', OIDC_ADMIN_GROUP: 'th-admins' })
  const sso = async (c: Record<string, unknown>, opts: { code?: string; state?: string } = {}) => {
    claims = c
    const start = await app.request('/api/auth/oidc/start')
    const to = new URL(start.headers.get('location')!)
    nonce = to.searchParams.get('nonce')!
    const r = await app.request(`/api/auth/oidc/callback?code=${opts.code ?? 'good'}&state=${opts.state ?? to.searchParams.get('state')}`,
      { headers: { cookie: start.headers.get('set-cookie')!.split(';')[0] } })
    const cookies = r.headers.getSetCookie().map((x) => x.split(';')[0])
    const sid = cookies.find((x) => x.startsWith('sid='))
    return { to: r.headers.get('location'), cookies: cookies.join('; '), me: sid ? await (await app.request('/api/me', { headers: { cookie: sid } })).json() : null }
  }
  try {
    const ok = await sso({ sub: 's-1', email: 'Dana@Example.test', email_verified: true, name: '다나', groups: ['/th-dev', 'th-admins'] })
    assert.equal(ok.to, '/')
    assert.equal(ok.me.email, 'dana@example.test')
    assert.equal(ok.me.isAdmin, true) // admin group
    assert.ok((await admin.list('GET', '/api/groups')).some((g: any) => g.name === 'th-dev' && g.source === 'oidc'))
    // Signing out sends the browser to the IdP to end its session too, with the ID token as the hint.
    const out = await (await app.request('/api/auth/logout', { method: 'POST', headers: { cookie: ok.cookies } })).json()
    const end = new URL(out.redirect)
    assert.equal(`${end.origin}${end.pathname}`, `${issuer}/logout`)
    assert.ok(end.searchParams.get('id_token_hint'))
    assert.equal(end.searchParams.get('post_logout_redirect_uri'), 'http://localhost/')
    // Same person again, now out of the admin group: SSO-only accounts follow the IdP.
    assert.equal((await sso({ sub: 's-1', email: 'dana@example.test', email_verified: true, groups: [] })).me.isAdmin, false)

    assert.match((await sso({ sub: 's-2', email: 'e@example.test', email_verified: true }, { state: 'forged' })).to!, /sso_error=failed/)
    assert.match((await sso({ sub: 's-2', email: 'e@example.test', email_verified: true, nonce: 'replayed' })).to!, /sso_error=failed/)
    assert.match((await sso({ sub: 's-2', email: 'e@example.test', email_verified: true, aud: 'another-app' })).to!, /sso_error=failed/)
    assert.match((await sso({ sub: 's-2', email: 'e@example.test', email_verified: true }, { code: 'bad' })).to!, /sso_error=failed/)
    // An unverified email never takes over an existing account.
    assert.match((await sso({ sub: 's-2', email: 'bob@example.test', email_verified: false })).to!, /sso_error=email_taken/)

    // The setup admin signs in with SSO once (linked by verified email) and isn't in the admin group: still admin,
    // and still the break-glass account when passwords are switched off.
    const linked = await sso({ sub: 's-3', email: 'admin@example.test', email_verified: true, groups: [] })
    assert.equal(linked.me.id, adminId)
    assert.equal(linked.me.isAdmin, true)
    process.env.PASSWORD_LOGIN = '0'
    assert.equal((await client().call('POST', '/api/auth/login', { email: 'admin@example.test', password: 'password1' })).status, 200)
    assert.equal((await client().json('POST', '/api/auth/login', { email: 'bob@example.test', password: 'password1' })).error, 'sso_only')

    // The same provider set up on the admin screen. Environment variables win, so first the screen is read-only.
    assert.equal((await admin.json('PUT', '/api/admin/sso', { enabled: true, issuer, clientId: 'taskhouse' })).error, 'sso_env')
    for (const k of ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_ADMIN_GROUP', 'PASSWORD_LOGIN']) delete process.env[k]
    assert.equal((await client().json('GET', '/api/auth/state')).sso, null)
    process.env.SECRET_KEY = 'test-secret-key'
    assert.equal((await admin.json('PUT', '/api/admin/sso', { enabled: true, issuer: 'http://127.0.0.1:1', clientId: 'x' })).error, 'sso_discovery')
    const saved = await admin.json('PUT', '/api/admin/sso', { enabled: true, issuer, clientId: 'taskhouse', clientSecret: 's3cret', label: '사내 SSO', groupsClaim: 'groups', adminGroup: 'th-admins' })
    assert.equal(saved.source, 'admin')
    assert.equal(saved.hasSecret, true)
    assert.equal(saved.clientSecret, undefined) // never sent back
    assert.match((await db.query(`SELECT value->>'clientSecret' AS s FROM settings WHERE key = 'sso'`)).rows[0].s, /^enc:v1:/)
    assert.equal((await client().json('GET', '/api/auth/state')).sso.label, '사내 SSO')
    const viaScreen = await sso({ sub: 's-9', email: 'erin@example.test', email_verified: true, groups: ['th-admins'] })
    assert.equal(viaScreen.me.isAdmin, true)
    assert.equal(lastSecret, 's3cret') // decrypted for the token request

    // autoCreate / trustEmail. Settings saved before these options existed read as the defaults, which are the
    // original behaviour: create accounts on first sign-in, link to an existing account only by a verified email.
    await db.query(`UPDATE settings SET value = value - 'autoCreate' - 'trustEmail' WHERE key = 'sso'`)
    const old = await admin.json('GET', '/api/admin/sso')
    assert.equal(old.autoCreate, true)
    assert.equal(old.trustEmail, false)
    assert.match((await sso({ sub: 's-c', email: 'carol@example.test' })).to!, /sso_error=email_taken/) // no email_verified: not linked
    // autoCreate off: newcomers are refused; people who already have an account still get in.
    const base = { enabled: true, issuer, clientId: 'taskhouse', label: '사내 SSO' }
    await admin.call('PUT', '/api/admin/sso', { ...base, autoCreate: false })
    assert.match((await sso({ sub: 's-new', email: 'newbie@example.test', email_verified: true })).to!, /sso_error=no_account/)
    assert.equal((await sso({ sub: 's-9', email: 'erin@example.test', email_verified: true })).me.email, 'erin@example.test')
    // trustEmail: an IdP that never sends email_verified may link to the local account with that email;
    // one that says false is still refused.
    await admin.call('PUT', '/api/admin/sso', { ...base, trustEmail: true })
    assert.equal((await admin.json('GET', '/api/admin/sso')).trustEmail, true)
    assert.match((await sso({ sub: 's-c', email: 'carol@example.test', email_verified: false })).to!, /sso_error=email_taken/)
    assert.match((await sso({ sub: 's-c', email: 'carol@example.test', email_verified: 'false' })).to!, /sso_error=email_taken/)
    assert.equal((await sso({ sub: 's-c', email: 'carol@example.test' })).me.email, 'carol@example.test')
    await admin.call('PUT', '/api/admin/sso', base)
    // Saving again without a secret keeps the stored one.
    await admin.call('PUT', '/api/admin/sso', { enabled: true, issuer, clientId: 'taskhouse', label: '사내 SSO' })
    assert.equal((await admin.json('GET', '/api/admin/sso')).hasSecret, true)
    assert.equal((await bob.call('GET', '/api/admin/sso')).status, 403)
    await admin.call('PUT', '/api/admin/sso', { enabled: false, issuer, clientId: 'taskhouse' })
    assert.equal((await client().json('GET', '/api/auth/state')).sso, null)
  } finally {
    for (const k of ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_ADMIN_GROUP', 'PASSWORD_LOGIN', 'SECRET_KEY']) delete process.env[k]
    idp.close()
  }
})

test('passwords: change with the current one, reset with an admin link', async () => {
  const dana = (await admin.list('GET', '/api/admin/users')).find((u: any) => u.email === 'bob@example.test')
  await bob.call('POST', '/api/auth/login', { email: 'bob@example.test', password: 'password1' })
  assert.equal((await bob.call('POST', '/api/me/password', { current: 'wrong-one', password: 'password2' })).status, 403)
  assert.equal((await bob.call('POST', '/api/me/password', { current: 'password1', password: 'password2' })).status, 200)
  assert.equal((await bob.call('GET', '/api/me')).status, 200) // this session stays
  const link = await admin.json('POST', `/api/admin/users/${dana.id}/reset-link`)
  assert.equal((await client().json('GET', `/api/auth/reset/${link.token}`)).email, 'bob@example.test')
  assert.equal((await client().call('POST', `/api/auth/reset/${link.token}`, { password: 'password3' })).status, 200)
  assert.equal((await client().call('POST', `/api/auth/reset/${link.token}`, { password: 'password4' })).status, 404) // once
  assert.equal((await bob.call('GET', '/api/me')).status, 401) // everyone signed out
  assert.equal((await bob.call('POST', '/api/auth/login', { email: 'bob@example.test', password: 'password3' })).status, 200)
  assert.equal((await bob.call('POST', `/api/admin/users/${dana.id}/reset-link`)).status, 403)
})

test('webhook signing keys are encrypted at rest and still sign the same', async () => {
  const got: { sig: string; body: string }[] = []
  const srv = createServer((req, res) => {
    let b = ''
    req.on('data', (d) => (b += d)).on('end', () => (got.push({ sig: String(req.headers['x-signature']), body: b }), res.end('ok')))
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(srv.address() as any).port}/x`
  try {
    // A key saved before SECRET_KEY existed stays usable, and is encrypted once SECRET_KEY is set.
    const legacy = (await db.query(`INSERT INTO webhooks (project_id, url, secret, events) SELECT id, $1, 'plain-old-secret', '{issue.updated}' FROM projects WHERE key = 'DEMO' RETURNING id`, [url])).rows[0]
    process.env.SECRET_KEY = 'test-secret-key'
    const fresh = await admin.json('POST', '/api/projects/DEMO/webhooks', { url, events: ['issue.updated'] })
    assert.match((await db.query('SELECT secret FROM webhooks WHERE id = $1', [fresh.id])).rows[0].secret, /^enc:v1:/)
    assert.ok((await sealWebhookSecrets(db)) >= 1)
    assert.equal(await sealWebhookSecrets(db), 0) // nothing left in plain text
    assert.match((await db.query('SELECT secret FROM webhooks WHERE id = $1', [legacy.id])).rows[0].secret, /^enc:v1:/)
    await db.query('UPDATE jobs SET done_at = now()')
    await bob.call('PATCH', '/api/issues/DEMO-1', { priority: 3 })
    await runJobs(db)
    const mac = (key: string, body: string) => `sha256=${createHmac('sha256', key).update(body).digest('hex')}`
    assert.equal(got.length, 2)
    assert.ok(got.some((g) => g.sig === mac(fresh.secret, g.body)))
    assert.ok(got.some((g) => g.sig === mac('plain-old-secret', g.body)))
  } finally {
    delete process.env.SECRET_KEY
    await db.query('DELETE FROM webhooks WHERE url = $1', [url])
    srv.close()
  }
})

test('sign-in limits: per address and account, per address, per account; spoofed X-Forwarded-For does not help', async () => {
  const login = (email: string, xff?: string) => app.request('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(xff ? { 'x-forwarded-for': xff } : {}) },
    body: JSON.stringify({ email, password: 'wrong-password' }),
  })
  process.env.TRUST_PROXY = '1'
  try {
    // One proxy: the client is the last hop; whatever the client put to the left is ignored.
    for (let i = 0; i < 10; i++) assert.equal((await login('target@example.test', `1.1.1.${i}, 10.0.0.1`)).status, 401)
    const blocked = await login('target@example.test', '9.9.9.9, 10.0.0.1')
    assert.equal(blocked.status, 429)
    assert.equal(blocked.headers.get('retry-after'), '900')
    // Another machine may still try that account (30 per account), and the first one other accounts (50 per address).
    assert.equal((await login('target@example.test', '10.0.0.2')).status, 401)
    assert.equal((await login('someone@example.test', '10.0.0.1')).status, 401)
    for (let i = 0; i < 40; i++) await login(`spray${i}@example.test`, '10.0.0.1')
    assert.equal((await login('fresh@example.test', '10.0.0.1')).status, 429) // the address is done
  } finally {
    delete process.env.TRUST_PROXY
  }
})

test('forgot password (mail) and temporary passwords (admin)', async () => {
  assert.equal((await client().json('POST', '/api/auth/forgot', { email: 'carol@example.test' })).error, 'mail_off')
  const mails: any[] = []
  const transport = nodemailer.createTransport({ jsonTransport: true })
  transport.sendMail = (async (m: any) => (mails.push(m), {})) as any
  useTestTransport(transport)
  try {
    assert.equal((await client().json('GET', '/api/auth/state')).forgot, true)
    // Same answer with or without an account; only the real one gets mail.
    assert.equal((await client().call('POST', '/api/auth/forgot', { email: 'nobody@example.test' })).status, 200)
    assert.equal((await client().call('POST', '/api/auth/forgot', { email: 'Carol@example.test' })).status, 200)
    assert.equal(mails.length, 1)
    assert.equal(mails[0].to, 'carol@example.test')
    assert.match(mails[0].subject, /비밀번호 재설정/)
    const token = mails[0].text.match(/\/reset\/([\w-]+)/)[1]
    assert.equal((await client().call('POST', `/api/auth/reset/${token}`, { password: 'carol-new-1' })).status, 200)
    assert.equal((await client().call('POST', '/api/auth/login', { email: 'carol@example.test', password: 'carol-new-1' })).status, 200)
    // In the account's language.
    await carol.call('POST', '/api/auth/login', { email: 'carol@example.test', password: 'carol-new-1' })
    await carol.call('PATCH', '/api/me', { locale: 'en' })
    await client().call('POST', '/api/auth/forgot', { email: 'carol@example.test' })
    assert.match(mails.at(-1).subject, /Reset your password/)
    // Every request counts, so nobody gets flooded with mail.
    for (let i = 0; i < 10; i++) await client().call('POST', '/api/auth/forgot', { email: 'flood@example.test' })
    assert.equal((await client().call('POST', '/api/auth/forgot', { email: 'flood@example.test' })).status, 429)
  } finally {
    useTestTransport(null)
  }

  const carolId = (await admin.list('GET', '/api/admin/users')).find((u: any) => u.email === 'carol@example.test').id
  assert.equal((await admin.call('POST', `/api/admin/users/${adminId}/temp-password`)).status, 400) // not yourself
  const temp = await admin.json('POST', `/api/admin/users/${carolId}/temp-password`)
  assert.match(temp.password, /^[a-zA-Z2-9]{12}$/)
  assert.equal((await carol.call('GET', '/api/me')).status, 401) // signed out everywhere
  assert.equal((await carol.call('POST', '/api/auth/login', { email: 'carol@example.test', password: 'carol-new-1' })).status, 401)
  assert.equal((await carol.call('POST', '/api/auth/login', { email: 'carol@example.test', password: temp.password })).status, 200)
  assert.equal((await carol.json('GET', '/api/me')).mustChangePassword, true)
  assert.equal((await carol.call('POST', '/api/me/password', { current: temp.password, password: 'carol-own-1' })).status, 200)
  assert.equal((await carol.json('GET', '/api/me')).mustChangePassword, false)
  assert.ok((await admin.list('GET', '/api/admin/audit')).some((a: any) => a.action === 'user.temp_password'))
})

test('hardening: body size, cross-site requests, uploads, webhooks, export, input checks', async () => {
  // Bodies are capped before anything reads them, sign-in included.
  const big = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x'.repeat(3 * 1024 * 1024) }) })
  assert.equal(big.status, 413)
  // A change sent from another site is refused; the same from our own pages (or a token client) is not.
  const cross = await app.request('/api/issues/DEMO-1', { method: 'PATCH', headers: { cookie: bob.cookie, 'content-type': 'application/json', 'sec-fetch-site': 'same-site' }, body: '{"priority":1}' })
  assert.equal(cross.status, 403)
  const own = await app.request('/api/issues/DEMO-1', { method: 'PATCH', headers: { cookie: bob.cookie, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: '{"priority":1}' })
  assert.equal(own.status, 200)
  assert.match((await app.request('/healthz')).headers.get('content-security-policy')!, /frame-ancestors 'none'/)

  // Someone who can't see the issue puts nothing on disk.
  const files = () => readdirSync(join(dataDir, 'files')).length
  const before = files()
  const form = new FormData()
  form.append('file', new File(['secret bytes'], 'x.txt'))
  const up = await app.request('/api/issues/DEMO-1/attachments', { method: 'POST', headers: { cookie: carol.cookie }, body: form })
  assert.equal(up.status, 404)
  assert.equal(files(), before)

  // Webhooks: site admins only, and never to link-local (cloud metadata) addresses.
  await admin.call('PUT', '/api/projects/DEMO/roles', { roles: [{ user: adminId, role: 'admin' }, { user: bobId, role: 'admin' }] })
  assert.equal((await bob.call('POST', '/api/projects/DEMO/webhooks', { url: 'http://example.com/x' })).status, 403)
  await admin.call('POST', '/api/projects/DEMO/webhooks', { url: 'http://169.254.169.254/latest/meta-data', events: ['issue.updated'] })
  await db.query('UPDATE jobs SET done_at = now()')
  await bob.call('PATCH', '/api/issues/DEMO-1', { priority: 2 })
  await runJobs(db)
  const err = (await db.query(`SELECT last_error FROM jobs WHERE payload->'body'->>'event' = 'issue.updated' ORDER BY id DESC LIMIT 1`)).rows[0].last_error
  assert.match(err, /blocked address 169\.254\.169\.254/)

  // Export: everything as JSON, the issue list as CSV (formulas defused); project admins only.
  const json = await (await app.request('/api/projects/DEMO/export', { headers: { cookie: admin.cookie } })).json()
  assert.equal(json.format, 'taskhouse-export')
  assert.equal(json.issues.length, (await db.query(`SELECT count(*)::int AS n FROM issues WHERE project_id = (SELECT id FROM projects WHERE key = 'DEMO')`)).rows[0].n)
  assert.ok(json.comments.length > 0 && json.changes.length > 0 && json.links.length > 0)
  assert.ok(json.issues[0].doc)
  const bytes = Buffer.from(await (await app.request('/api/projects/DEMO/export?format=csv', { headers: { cookie: admin.cookie } })).arrayBuffer())
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]) // BOM: Excel reads Korean as UTF-8
  const csv = bytes.subarray(3).toString('utf8')
  assert.match(csv, /^key,type,status,title/)
  assert.match(csv, /\nDEMO-1,버그,[^\n]*,\d{4}-\d\d-\d\dT/) // dates filled in
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`)
  assert.equal((await carol.call('GET', '/api/projects/DEMO/export')).status, 404)
  assert.ok((await admin.list('GET', '/api/admin/audit')).some((a: any) => a.action === 'project.export'))

  // User input that used to reach the database as is.
  assert.equal((await bob.json('POST', '/api/search', { tql: 'status ~ 완료' })).http, 400)
  assert.equal((await bob.json('POST', '/api/search', { tql: 'type > 버그' })).http, 400)
  const sprint = await bob.json('POST', '/api/projects/DEMO/sprints', {})
  assert.equal((await bob.call('PATCH', `/api/projects/DEMO/sprints/${sprint.id}`, { endsAt: '내일' })).status, 400)

  // Files nothing refers to go after an hour; files in use stay.
  const orphan = join(dataDir, 'files', 'f'.repeat(64))
  writeFileSync(orphan, 'x')
  utimesSync(orphan, new Date(Date.now() - 2 * 3600_000), new Date(Date.now() - 2 * 3600_000))
  const kept = files()
  assert.equal(await pruneFiles(db, join(dataDir, 'files')), 1)
  assert.equal(files(), kept - 1)
})

test('helpers', () => {
  assert.deepEqual(parseTql('text ~ b', new Date()).sort, [])
  assert.deepEqual(parseTql('status = 완료 AND NOT (type = 버그 OR priority > 2) ORDER BY rank').query,
    { and: [{ field: 'status', op: '=', value: '완료' }, { not: { or: [{ field: 'type', op: '=', value: '버그' }, { field: 'priority', op: '>', value: 2 }] } }] })
  assert.equal(koreanStem('배포를'), '배포')
  assert.deepEqual(hangulBigrams('파드 재배치a'), ['파드', '재배', '배치'])
  assert.equal(koreanStem('이'), '이')
  assert.equal(dateValue('-1d', Date.parse('2026-01-02T00:00:00Z')), '2026-01-01T00:00:00.000Z')
  assert.throws(() => dateValue('soon'))
})
