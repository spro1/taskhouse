// Issues: create, field-level edit, transitions, rank, comments, links, watchers, attachments, history.
// Every change goes through applyChanges, which writes the row, the change log, notifications and webhook jobs
// in the caller's transaction.
import type { Hono } from 'hono'
import type pg from 'pg'
import { generateKeyBetween } from 'fractional-indexing'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tx, type Db } from './db.ts'
import { audit, body, docText, fail, HttpError, MAX_UPLOAD, mentions, sha256, toDoc, type Env, type User } from './http.ts'
import { canEdit, canSeeProject, LEVEL, projectsFor } from './access.ts'

type Q = pg.PoolClient

export const KEY_RE = /^([A-Z][A-Z0-9]{1,9})-(\d{1,9})$/

// The issue as the API returns it. `list` leaves out the description doc.
export const issueSelect = (list = false) => `SELECT i.id, p.key || '-' || i.number AS key, i.title, ${list ? '' : 'i.doc,'} i.priority, i.points, i.due_date AS due,
  i.labels, i.rank, i.lock_version AS "lockVersion", i.created_at AS "createdAt", i.updated_at AS "updatedAt", i.resolved_at AS "resolvedAt",
  jsonb_build_object('id', t.id, 'name', t.name, 'level', t.level) AS type,
  jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category) AS status,
  CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id', a.id, 'name', a.name) END AS assignee,
  jsonb_build_object('id', r.id, 'name', r.name) AS reporter,
  (SELECT p.key || '-' || x.number FROM issues x WHERE x.id = i.parent_id) AS parent,
  CASE WHEN sp.id IS NULL THEN NULL ELSE jsonb_build_object('id', sp.id, 'name', sp.name, 'state', sp.state) END AS sprint,
  i.project_id AS "projectId", i.deleted_at AS "deletedAt"
  FROM issues i JOIN projects p ON p.id = i.project_id JOIN issue_types t ON t.id = i.type_id JOIN statuses s ON s.id = i.status_id
  JOIN users r ON r.id = i.reporter_id LEFT JOIN users a ON a.id = i.assignee_id LEFT JOIN sprints sp ON sp.id = i.sprint_id`

export type Issue = Record<string, any> & { id: number; key: string; projectId: number; reporter: { id: number }; lockVersion: number }
type Loaded = { issue: Issue; level: number }

/** The issue if the user can see it. Anything else is 404, so hidden issues don't reveal that they exist. */
export async function loadIssue(q: Q | Db, user: User, key: string, opts: { lock?: boolean; deleted?: boolean } = {}): Promise<Loaded> {
  const m = KEY_RE.exec(key)
  if (!m) throw new HttpError(404, 'not_found')
  const [project] = await projectsFor(q, user, m[1])
  if (!project) throw new HttpError(404, 'not_found')
  const issue = (await q.query(`${issueSelect()} WHERE i.project_id = $1 AND i.number = $2 ${opts.lock ? 'FOR UPDATE OF i' : ''}`, [project.id, Number(m[2])])).rows[0]
  if (!issue || (issue.deletedAt && !opts.deleted)) throw new HttpError(404, 'not_found')
  return { issue, level: project.level }
}

// {id, name} references compare by id; arrays and plain values compare as they are.
const idOf = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) && 'id' in v ? v.id : v ?? null)
const same = (a: unknown, b: unknown) => JSON.stringify(idOf(a)) === JSON.stringify(idOf(b))
const plain = (s: string) => (s.length > 2000 ? `${s.slice(0, 2000)}…` : s)

// Editable fields. parse() turns the client's value into [column value, value for the change log].
type Parsed = [unknown, unknown]
const EDITABLE = ['title', 'doc', 'type', 'priority', 'assignee', 'parent', 'sprint', 'points', 'due', 'labels'] as const
async function parseField(q: Q, issue: Issue, field: string, v: unknown): Promise<{ col: string; db: unknown; log: unknown; cur: unknown }> {
  const bad = () => new HttpError(400, 'bad_field', { field })
  const ref = async (sql: string, params: unknown[]): Promise<Parsed> => {
    const r = (await q.query(sql, params)).rows[0]
    if (!r) throw bad()
    return [r.id, r]
  }
  switch (field) {
    case 'title': {
      const t = typeof v === 'string' ? v.trim() : ''
      if (!t || t.length > 255) throw bad()
      return { col: 'title', db: t, log: t, cur: issue.title }
    }
    case 'doc': {
      const d = toDoc(v)
      if (!d) throw bad()
      return { col: 'doc', db: d, log: plain(docText(d)), cur: issue.doc }
    }
    case 'type': {
      const [id, row] = await ref(`SELECT id, name, level FROM issue_types WHERE (project_id IS NULL OR project_id = $1) AND (id::text = $2 OR name = $2)`, [issue.projectId, String(idOf(v))])
      return { col: 'type_id', db: id, log: row, cur: issue.type }
    }
    case 'priority': {
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 4) throw bad()
      return { col: 'priority', db: v, log: v, cur: issue.priority }
    }
    case 'assignee': {
      if (v === null) return { col: 'assignee_id', db: null, log: null, cur: issue.assignee }
      const [id, row] = await ref('SELECT id, name FROM users WHERE id = $1 AND disabled_at IS NULL', [Number(idOf(v)) || 0])
      // Assigning someone who can't see the project would leak it through notifications.
      if (!(await canSeeProject(q, issue.projectId, [id as number])).length) throw bad()
      return { col: 'assignee_id', db: id, log: row, cur: issue.assignee }
    }
    case 'parent': {
      if (v === null) return { col: 'parent_id', db: null, log: null, cur: issue.parent }
      const m = KEY_RE.exec(String(v))
      const [id] = await ref(`SELECT x.id FROM issues x JOIN projects p ON p.id = x.project_id WHERE x.project_id = $1 AND p.key = $2 AND x.number = $3 AND x.deleted_at IS NULL`,
        [issue.projectId, m?.[1], Number(m?.[2])])
      if (id === issue.id) throw bad()
      return { col: 'parent_id', db: id, log: String(v), cur: issue.parent }
    }
    case 'sprint': {
      if (v === null) return { col: 'sprint_id', db: null, log: null, cur: issue.sprint }
      const [id, row] = await ref(`SELECT id, name FROM sprints WHERE id = $1 AND project_id = $2 AND state <> 'closed'`, [Number(idOf(v)) || 0, issue.projectId])
      return { col: 'sprint_id', db: id, log: row, cur: issue.sprint }
    }
    case 'points': {
      if (v !== null && (typeof v !== 'number' || !(v >= 0 && v < 100000))) throw bad()
      return { col: 'points', db: v === null ? null : Math.round(v * 10) / 10, log: v, cur: issue.points }
    }
    case 'due': {
      if (v !== null && !(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)))) throw bad()
      return { col: 'due_date', db: v, log: v, cur: issue.due }
    }
    case 'labels': {
      if (!Array.isArray(v) || v.length > 20) throw bad()
      const labels = [...new Set(v.map((l) => String(l).trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))].map((l) => l.slice(0, 50)).sort()
      return { col: 'labels', db: labels, log: labels, cur: issue.labels }
    }
    case 'status': {
      // Internal only: callers go through transition(), which checks the workflow first.
      const [id, row] = await ref('SELECT id, name, category FROM statuses WHERE id = $1 AND project_id = $2', [Number(idOf(v)) || 0, issue.projectId])
      return { col: 'status_id', db: id, log: { id, name: (row as any).name }, cur: issue.status }
    }
  }
  throw bad()
}

/** Writes the changed fields, the change log, notifications and webhook jobs. Returns what changed. */
export async function applyChanges(q: Q, issue: Issue, set: Record<string, unknown>, actor: User | null, event = 'issue.updated', quiet = false) {
  const cols: string[] = []
  const params: unknown[] = [issue.id]
  const changes: { field: string; old: unknown; new: unknown }[] = []
  let newStatusCat: number | null = null
  for (const [field, v] of Object.entries(set)) {
    const p = await parseField(q, issue, field, v)
    if (field === 'doc' ? JSON.stringify(p.cur) === JSON.stringify(p.db) : same(p.cur, p.db)) continue
    params.push(field === 'doc' ? JSON.stringify(p.db) : p.db)
    cols.push(`${p.col} = $${params.length}`)
    if (field === 'doc') {
      params.push(docText(p.db))
      cols.push(`text = $${params.length}`)
    }
    if (field === 'status') newStatusCat = (await q.query('SELECT category FROM statuses WHERE id = $1', [p.db])).rows[0].category
    const old = field === 'doc' ? plain(docText(p.cur)) : field === 'type' || field === 'status' || field === 'assignee' || field === 'sprint'
      ? (p.cur ? { id: (p.cur as any).id, name: (p.cur as any).name } : null) : p.cur
    changes.push({ field, old, new: field === 'type' ? { id: (p.log as any).id, name: (p.log as any).name } : p.log })
  }
  if (!changes.length) return changes
  if (newStatusCat !== null) cols.push(newStatusCat === 2 ? 'resolved_at = COALESCE(resolved_at, now())' : 'resolved_at = NULL')
  await q.query(`UPDATE issues SET ${cols.join(', ')}, lock_version = lock_version + 1, updated_at = now() WHERE id = $1`, params)
  if (set.type !== undefined || set.parent !== undefined) await checkHierarchy(q, issue.id)
  if (quiet) return changes
  await q.query(`INSERT INTO issue_changes (issue_id, actor_id, field, old, new) SELECT $1, $2, f, o, n FROM unnest($3::text[], $4::jsonb[], $5::jsonb[]) AS x(f, o, n)`,
    [issue.id, actor?.id ?? null, changes.map((c) => c.field), changes.map((c) => JSON.stringify(c.old)), changes.map((c) => JSON.stringify(c.new))])
  const extra = changes.find((c) => c.field === 'assignee')?.new as { id: number } | null
  const mentioned = set.doc ? [...mentions(toDoc(set.doc))] : []
  await fanout(q, issue, actor, event === 'issue.transitioned' ? 'transitioned' : 'updated', { changes }, [...(extra ? [extra.id] : []), ...mentioned])
  await enqueue(q, issue, actor, event, { changes })
  return changes
}

// Epic (0) > standard (1) > subtask (2): a parent is exactly one level up, in the same project; subtasks need one.
async function checkHierarchy(q: Q, id: number) {
  const bad = (await q.query(
    `SELECT 1 FROM issues i JOIN issue_types t ON t.id = i.type_id
       LEFT JOIN issues pi ON pi.id = i.parent_id LEFT JOIN issue_types pt ON pt.id = pi.type_id
     WHERE (i.id = $1 OR i.parent_id = $1) AND i.deleted_at IS NULL
       AND ((i.parent_id IS NULL AND t.level = 2) OR (i.parent_id IS NOT NULL AND pt.level <> t.level - 1))`,
    [id],
  )).rowCount
  if (bad) throw new HttpError(400, 'bad_hierarchy')
}

/** In-app notifications for reporter, assignee, watchers and mentioned people who can see the project; never the actor. */
async function fanout(q: Q, issue: Issue, actor: User | null, kind: string, data: object, extra: number[] = []) {
  const watchers = (await q.query('SELECT user_id FROM watchers WHERE issue_id = $1', [issue.id])).rows.map((r) => r.user_id)
  const ids = [...new Set([issue.reporter?.id, issue.assignee?.id, ...watchers, ...extra].filter((x): x is number => !!x && x !== actor?.id))]
  const to = await canSeeProject(q, issue.projectId, ids)
  if (to.length)
    await q.query(`INSERT INTO notifications (user_id, issue_id, actor_id, kind, data) SELECT unnest($1::bigint[]), $2, $3, $4, $5`,
      [to, issue.id, actor?.id ?? null, kind, JSON.stringify({ key: issue.key, title: issue.title, ...data })])
}

/** Webhook deliveries, written in the same transaction as the change. */
export async function enqueue(q: Q, issue: Issue, actor: User | null, event: string, extra: object = {}) {
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '')
  const payload = {
    event, at: new Date().toISOString(), actor: actor ? { id: actor.id, name: actor.name } : null,
    issue: { key: issue.key, title: issue.title, url: `${base}/browse/${issue.key}` }, ...extra,
  }
  await q.query(`INSERT INTO jobs (kind, payload) SELECT 'webhook', jsonb_build_object('hook', id, 'body', $2::jsonb) FROM webhooks
    WHERE project_id = $1 AND (events = '{}' OR $3 = ANY(events))`, [issue.projectId, JSON.stringify(payload), event])
}

type Rules = { conditions?: any[]; validators?: any[]; post?: any[] }
const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)

async function conditionsPass(issue: Issue, user: User, level: number, rules: Rules) {
  return (rules.conditions ?? []).every((r) =>
    r.kind === 'is_assignee' ? issue.assignee?.id === user.id
      : r.kind === 'is_reporter' ? issue.reporter.id === user.id
        : r.kind === 'has_role' ? level >= (Number(r.level) || LEVEL.admin)
          : false)
}

/** Status moves allowed from the issue's current status. No transition rows = every move is allowed. */
async function allowedMoves(q: Q | Db, issue: Issue, user: User, level: number) {
  const statuses = (await q.query('SELECT id, name, category FROM statuses WHERE project_id = $1 ORDER BY position', [issue.projectId])).rows
  const rows = (await q.query('SELECT name, from_id, to_id, rules FROM transitions WHERE project_id = $1', [issue.projectId])).rows
  const others = statuses.filter((s) => s.id !== issue.status.id)
  if (!rows.length) return others.map((s) => ({ name: s.name, to: s, rules: {} as Rules }))
  const out = []
  for (const t of rows)
    if ((t.from_id === null || t.from_id === issue.status.id) && t.to_id !== issue.status.id && (await conditionsPass(issue, user, level, t.rules)))
      out.push({ name: t.name, to: statuses.find((s) => s.id === t.to_id), rules: t.rules as Rules })
  return out
}

export async function transition(q: Q, loaded: Loaded, user: User, to: unknown) {
  const { issue, level } = loaded
  const move = (await allowedMoves(q, issue, user, level)).find((m) => m.to.id === Number(to) || m.to.name === to)
  if (!move) throw new HttpError(400, 'transition_not_allowed')
  for (const v of move.rules.validators ?? []) {
    const fail = (why: string) => new HttpError(400, 'validation_failed', { rule: v.kind, why })
    if (v.kind === 'required') {
      for (const f of v.fields ?? []) if (empty(f === 'assignee' ? issue.assignee : f === 'due' ? issue.due : issue[f])) throw fail(f)
    } else if (v.kind === 'subtasks_done') {
      if ((await q.query(`SELECT 1 FROM issues i JOIN statuses s ON s.id = i.status_id WHERE i.parent_id = $1 AND i.deleted_at IS NULL AND s.category <> 2 LIMIT 1`, [issue.id])).rowCount) throw fail('open_children')
    } else if (v.kind === 'no_blockers') {
      if ((await q.query(`SELECT 1 FROM issue_links l JOIN issues i ON i.id = l.source_id JOIN statuses s ON s.id = i.status_id
        WHERE l.target_id = $1 AND l.kind = 'blocks' AND i.deleted_at IS NULL AND s.category <> 2 LIMIT 1`, [issue.id])).rowCount) throw fail('blocked')
    } else throw fail('unknown_rule')
  }
  const set: Record<string, unknown> = { status: move.to.id }
  for (const p of move.rules.post ?? [])
    if (p.kind === 'set' && EDITABLE.includes(p.field))
      set[p.field] = p.value === '$reporter' ? issue.reporter.id : p.value === '$me' ? user.id : p.value === '$none' ? null : p.value
  return applyChanges(q, issue, set, user, 'issue.transitioned')
}

export function registerIssues(app: Hono<Env>, db: Db, dataDir: string) {
  const filesDir = join(dataDir, 'files')
  mkdirSync(filesDir, { recursive: true })
  const user = (c: any) => c.get('user') as User
  const get = async (c: any) => {
    const { issue } = await loadIssue(db, user(c), c.req.param('key'))
    return c.json(issue)
  }
  /** Runs fn on the locked issue in a transaction, after checking the user may edit it. */
  const editing = <T>(c: any, fn: (q: Q, l: Loaded) => Promise<T>, need: 'edit' | 'comment' | 'admin' = 'edit') =>
    tx(db, async (q) => {
      const l = await loadIssue(q, user(c), c.req.param('key'), { lock: true, deleted: need === 'admin' })
      const ok = need === 'comment' ? l.level >= LEVEL.reporter : need === 'admin' ? l.level >= LEVEL.admin : canEdit(l.level, user(c), l.issue.reporter.id)
      if (!ok) throw new HttpError(403, 'forbidden')
      return fn(q, l)
    })
  const reload = async (c: any, key: string) => (await loadIssue(db, user(c), key)).issue

  app.post('/api/projects/:pkey/issues', async (c) => {
    const b = await body(c)
    const key = await tx(db, async (q) => {
      const [project] = await projectsFor(q, user(c), c.req.param('pkey'))
      if (!project) throw new HttpError(404, 'not_found')
      if (project.level < LEVEL.reporter) throw new HttpError(403, 'forbidden')
      // Locks the project row: numbers have no gaps and new issues get distinct ranks at the bottom.
      const { issue_seq: number } = (await q.query('UPDATE projects SET issue_seq = issue_seq + 1 WHERE id = $1 RETURNING issue_seq', [project.id])).rows[0]
      const status = (await q.query('SELECT id FROM statuses WHERE project_id = $1 ORDER BY position LIMIT 1', [project.id])).rows[0]
      const type = (await q.query(`SELECT id FROM issue_types WHERE (project_id IS NULL OR project_id = $1) AND (id::text = $2 OR name = $2) ORDER BY project_id NULLS LAST LIMIT 1`,
        [project.id, String(b.type ?? '작업')])).rows[0]
      if (!type) throw new HttpError(400, 'bad_field', { field: 'type' })
      const last = (await q.query('SELECT max(rank COLLATE "C") AS r FROM issues WHERE project_id = $1', [project.id])).rows[0].r
      const title = typeof b.title === 'string' ? b.title.trim() : ''
      if (!title || title.length > 255) throw new HttpError(400, 'bad_field', { field: 'title' })
      const id = (await q.query(`INSERT INTO issues (project_id, number, type_id, title, status_id, reporter_id, rank) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [project.id, number, type.id, title, status.id, user(c).id, generateKeyBetween(last, null)])).rows[0].id
      const key = `${project.key}-${number}`
      const { issue } = await loadIssue(q, user(c), key, { lock: true })
      // The rest goes through the normal edit path, so the same validation applies; creation itself is one log line.
      const rest = Object.fromEntries(EDITABLE.filter((f) => f !== 'title' && f !== 'type' && b[f] !== undefined).map((f) => [f, b[f]]))
      await applyChanges(q, issue, rest, user(c), 'issue.created', true)
      await checkHierarchy(q, id)
      await q.query(`INSERT INTO issue_changes (issue_id, actor_id, field) VALUES ($1, $2, 'created')`, [id, user(c).id])
      const created = (await loadIssue(q, user(c), key)).issue
      await fanout(q, created, user(c), 'created', {}, b.doc ? [...mentions(toDoc(b.doc))] : [])
      await enqueue(q, created, user(c), 'issue.created')
      return key
    })
    return c.json(await reload(c, key), 201)
  })

  app.get('/api/issues/:key', get)
  app.get('/api/issues/:key/card', async (c) => {
    const { issue } = await loadIssue(db, user(c), c.req.param('key'))
    return c.json({ key: issue.key, title: issue.title, status: issue.status, assignee: issue.assignee })
  })

  // Field-level merge: send only the fields you change. `_base` holds the values you started from; a field that
  // someone else changed meanwhile answers 409, while their changes to other fields are kept.
  app.patch('/api/issues/:key', async (c) => {
    const b = await body(c)
    const set = Object.fromEntries(Object.entries(b).filter(([k]) => k !== '_base'))
    if (!Object.keys(set).length || Object.keys(set).some((k) => !(EDITABLE as readonly string[]).includes(k))) return fail(c, 400, 'bad_request')
    const base = b._base && typeof b._base === 'object' ? b._base : {}
    await editing(c, async (q, { issue }) => {
      for (const f of Object.keys(base))
        if (f in set && (f === 'doc' ? JSON.stringify(base[f]) !== JSON.stringify(issue.doc) : !same(base[f], issue[f])))
          throw new HttpError(409, 'conflict', { field: f, current: issue })
      return applyChanges(q, issue, set, user(c))
    })
    return c.json(await reload(c, c.req.param('key')))
  })

  app.post('/api/issues/bulk', async (c) => {
    const b = await body(c)
    const keys = Array.isArray(b.keys) ? [...new Set(b.keys.map(String))] : []
    const set = b.set && typeof b.set === 'object' ? b.set : {}
    if (!keys.length || keys.length > 200 || !Object.keys(set).length || Object.keys(set).some((k) => !(EDITABLE as readonly string[]).includes(k) || k === 'doc' || k === 'title'))
      return fail(c, 400, 'bad_request')
    await tx(db, async (q) => {
      for (const key of keys as string[]) {
        const l = await loadIssue(q, user(c), key, { lock: true }).catch(() => { throw new HttpError(404, 'not_found', { key }) })
        if (!canEdit(l.level, user(c), l.issue.reporter.id)) throw new HttpError(403, 'forbidden', { key })
        await applyChanges(q, l.issue, set, user(c))
      }
    })
    await audit(db, c, 'issue.bulk', null, true, { keys, set })
    return c.json({ ok: true, count: keys.length })
  })

  app.get('/api/issues/:key/transitions', async (c) => {
    const { issue, level } = await loadIssue(db, user(c), c.req.param('key'))
    if (!canEdit(level, user(c), issue.reporter.id)) return c.json([])
    return c.json((await allowedMoves(db, issue, user(c), level)).map((m) => ({ name: m.name, to: m.to })))
  })
  // The only way to change status: board drags, API, automation and Git all come through here, so rules always apply.
  app.post('/api/issues/:key/transitions', async (c) => {
    const b = await body(c)
    await editing(c, (q, l) => {
      if (b.lockVersion !== undefined && b.lockVersion !== l.issue.lockVersion) throw new HttpError(409, 'conflict', { field: 'status', current: l.issue })
      return transition(q, l, user(c), b.to)
    })
    return c.json(await reload(c, c.req.param('key')))
  })

  // Move before or after another issue of the same project (board and backlog order).
  app.post('/api/issues/:key/rank', async (c) => {
    const b = await body(c)
    await editing(c, async (q, { issue, level }) => {
      if (level < LEVEL.member) throw new HttpError(403, 'forbidden')
      await q.query('SELECT 1 FROM projects WHERE id = $1 FOR UPDATE', [issue.projectId])
      const other = async (key: unknown) => {
        const o = await loadIssue(q, user(c), String(key)).catch(() => null)
        if (!o || o.issue.projectId !== issue.projectId || o.issue.id === issue.id) throw new HttpError(400, 'bad_request')
        return o.issue.rank as string
      }
      const near = (op: '<' | '>', r: string) => q.query(
        `SELECT ${op === '<' ? 'max' : 'min'}(rank COLLATE "C") AS r FROM issues WHERE project_id = $1 AND id <> $2 AND rank ${op} $3`, [issue.projectId, issue.id, r])
        .then((x) => x.rows[0].r as string | null)
      let lo: string | null, hi: string | null
      if (b.after) [lo, hi] = [await other(b.after), null], hi = await near('>', lo!)
      else if (b.before) [lo, hi] = [null, await other(b.before)], lo = await near('<', hi!)
      else throw new HttpError(400, 'bad_request')
      await q.query('UPDATE issues SET rank = $2, lock_version = lock_version + 1 WHERE id = $1', [issue.id, generateKeyBetween(lo, hi)])
    })
    return c.json(await reload(c, c.req.param('key')))
  })

  app.delete('/api/issues/:key', async (c) => {
    await editing(c, async (q, { issue, level }) => {
      if (level < LEVEL.member && issue.reporter.id !== user(c).id) throw new HttpError(403, 'forbidden')
      await q.query('UPDATE issues SET deleted_at = now(), lock_version = lock_version + 1 WHERE id = $1', [issue.id])
      await q.query(`INSERT INTO issue_changes (issue_id, actor_id, field) VALUES ($1, $2, 'deleted')`, [issue.id, user(c).id])
      await enqueue(q, issue, user(c), 'issue.deleted')
    })
    await audit(db, c, 'issue.delete', c.req.param('key'))
    return c.json({ ok: true })
  })
  app.post('/api/issues/:key/restore', async (c) => {
    await editing(c, async (q, { issue }) => {
      await q.query('UPDATE issues SET deleted_at = NULL, lock_version = lock_version + 1 WHERE id = $1', [issue.id])
      await q.query(`INSERT INTO issue_changes (issue_id, actor_id, field) VALUES ($1, $2, 'restored')`, [issue.id, user(c).id])
    }, 'admin')
    await audit(db, c, 'issue.restore', c.req.param('key'))
    return c.json(await reload(c, c.req.param('key')))
  })

  app.get('/api/issues/:key/changes', async (c) => {
    const { issue } = await loadIssue(db, user(c), c.req.param('key'))
    return c.json((await db.query(`SELECT ch.id, ch.at, ch.field, ch.old, ch.new, CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id', u.id, 'name', u.name) END AS actor
      FROM issue_changes ch LEFT JOIN users u ON u.id = ch.actor_id WHERE ch.issue_id = $1 ORDER BY ch.id`, [issue.id])).rows)
  })

  // Children, links and attachments for the issue screen, in one call.
  app.get('/api/issues/:key/related', async (c) => {
    const { issue } = await loadIssue(db, user(c), c.req.param('key'))
    const children = (await db.query(`${issueSelect(true)} WHERE i.parent_id = $1 AND i.deleted_at IS NULL ORDER BY i.rank`, [issue.id])).rows
    const links = (await db.query(`SELECT l.kind, l.source_id = $1 AS outward, p.key || '-' || o.number AS key, o.title, s.name AS status, s.category
      FROM issue_links l JOIN issues o ON o.id = CASE WHEN l.source_id = $1 THEN l.target_id ELSE l.source_id END
      JOIN projects p ON p.id = o.project_id JOIN statuses s ON s.id = o.status_id
      WHERE (l.source_id = $1 OR l.target_id = $1) AND o.deleted_at IS NULL AND o.project_id = ANY($2)`,
      [issue.id, (await projectsFor(db, user(c))).map((p) => p.id)])).rows
    const attachments = (await db.query(`SELECT id, name, mime, size, created_at AS "createdAt" FROM attachments WHERE issue_id = $1 AND deleted_at IS NULL ORDER BY id`, [issue.id])).rows
    const watching = !!(await db.query('SELECT 1 FROM watchers WHERE issue_id = $1 AND user_id = $2', [issue.id, user(c).id])).rowCount
    return c.json({ children, links, attachments, watching })
  })

  app.get('/api/issues/:key/comments', async (c) => {
    const { issue } = await loadIssue(db, user(c), c.req.param('key'))
    return c.json((await db.query(`SELECT cm.id, cm.doc, cm.created_at AS "createdAt", cm.updated_at AS "updatedAt", jsonb_build_object('id', u.id, 'name', u.name) AS author
      FROM comments cm JOIN users u ON u.id = cm.author_id WHERE cm.issue_id = $1 AND cm.deleted_at IS NULL ORDER BY cm.id`, [issue.id])).rows)
  })
  app.post('/api/issues/:key/comments', async (c) => {
    const b = await body(c)
    const doc = toDoc(b.doc ?? b.text)
    if (!doc || !docText(doc).trim()) return fail(c, 400, 'bad_request')
    const row = await editing(c, async (q, { issue }) => {
      const r = (await q.query('INSERT INTO comments (issue_id, author_id, doc, text) VALUES ($1, $2, $3, $4) RETURNING id', [issue.id, user(c).id, JSON.stringify(doc), docText(doc)])).rows[0]
      // Commenting means you care: follow the issue from now on.
      await q.query('INSERT INTO watchers (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [issue.id, user(c).id])
      await fanout(q, issue, user(c), 'commented', { comment: r.id, text: plain(docText(doc)).slice(0, 300) }, [...mentions(doc)])
      await enqueue(q, issue, user(c), 'comment.created', { comment: { id: r.id, text: docText(doc) } })
      return r
    }, 'comment')
    return c.json(row, 201)
  })
  const ownComment = (c: any, q: Q, issueId: number, level: number) =>
    q.query('SELECT id FROM comments WHERE id = $1 AND issue_id = $2 AND deleted_at IS NULL AND (author_id = $3 OR $4)',
      [Number(c.req.param('id')) || 0, issueId, user(c).id, level >= LEVEL.admin]).then((r) => {
      if (!r.rowCount) throw new HttpError(404, 'not_found')
    })
  app.patch('/api/issues/:key/comments/:id', async (c) => {
    const doc = toDoc((await body(c)).doc)
    if (!doc) return fail(c, 400, 'bad_request')
    await editing(c, async (q, { issue, level }) => {
      await ownComment(c, q, issue.id, level)
      await q.query('UPDATE comments SET doc = $2, text = $3, updated_at = now() WHERE id = $1', [Number(c.req.param('id')), JSON.stringify(doc), docText(doc)])
    }, 'comment')
    return c.json({ ok: true })
  })
  app.delete('/api/issues/:key/comments/:id', async (c) => {
    await editing(c, async (q, { issue, level }) => {
      await ownComment(c, q, issue.id, level)
      await q.query('UPDATE comments SET deleted_at = now() WHERE id = $1', [Number(c.req.param('id'))])
    }, 'comment')
    return c.json({ ok: true })
  })

  // kind: blocks | is_blocked_by | relates | duplicates. Stored as one directed row; "is blocked by" is the reverse of "blocks".
  const linkRow = async (c: any, q: Q, issue: Issue) => {
    const b = await body(c)
    const kinds: Record<string, string> = { blocks: 'blocks', is_blocked_by: 'blocks', relates: 'relates', duplicates: 'duplicates' }
    const kind = kinds[b.kind]
    const other = await loadIssue(q, user(c), String(b.target)).catch(() => null)
    if (!kind || !other || other.issue.id === issue.id) throw new HttpError(400, 'bad_request')
    let [s, t] = b.kind === 'is_blocked_by' ? [other.issue.id, issue.id] : [issue.id, other.issue.id]
    if (kind === 'relates' && s > t) [s, t] = [t, s]
    return { s, t, kind, label: `${b.kind} ${other.issue.key}` }
  }
  app.post('/api/issues/:key/links', async (c) => {
    await editing(c, async (q, { issue }) => {
      const l = await linkRow(c, q, issue)
      const r = await q.query('INSERT INTO issue_links (source_id, target_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [l.s, l.t, l.kind])
      if (r.rowCount) await q.query(`INSERT INTO issue_changes (issue_id, actor_id, field, new) VALUES ($1, $2, 'link', $3)`, [issue.id, user(c).id, JSON.stringify(l.label)])
    })
    return c.json({ ok: true })
  })
  app.delete('/api/issues/:key/links', async (c) => {
    await editing(c, async (q, { issue }) => {
      const l = await linkRow(c, q, issue)
      const r = await q.query('DELETE FROM issue_links WHERE source_id = $1 AND target_id = $2 AND kind = $3', [l.s, l.t, l.kind])
      if (r.rowCount) await q.query(`INSERT INTO issue_changes (issue_id, actor_id, field, old) VALUES ($1, $2, 'link', $3)`, [issue.id, user(c).id, JSON.stringify(l.label)])
    })
    return c.json({ ok: true })
  })

  app.post('/api/issues/:key/watch', async (c) => {
    const { issue } = await loadIssue(db, user(c), c.req.param('key'))
    await db.query('INSERT INTO watchers (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [issue.id, user(c).id])
    return c.json({ ok: true })
  })
  app.delete('/api/issues/:key/watch', async (c) => {
    const { issue } = await loadIssue(db, user(c), c.req.param('key'))
    await db.query('DELETE FROM watchers WHERE issue_id = $1 AND user_id = $2', [issue.id, user(c).id])
    return c.json({ ok: true })
  })

  // The body size is capped before this runs (app.ts). Files are written only after the permission check,
  // inside the transaction: someone who can't see the issue never puts a byte on disk.
  const MAX_STORAGE = Number(process.env.MAX_STORAGE_GB ?? 0) * 1024 ** 3
  app.post('/api/issues/:key/attachments', async (c) => {
    const file = (await c.req.parseBody()).file
    if (!(file instanceof File)) return fail(c, 400, 'bad_request')
    if (file.size > MAX_UPLOAD) return fail(c, 413, 'file_too_large')
    const row = await editing(c, async (q, { issue }) => {
      const buf = Buffer.from(await file.arrayBuffer())
      const hash = sha256(buf)
      if (MAX_STORAGE) {
        // When storage is full only new uploads stop; everything else keeps working.
        const { used } = (await q.query('SELECT coalesce(sum(size), 0)::bigint AS used FROM (SELECT DISTINCT ON (sha256) size FROM attachments) x')).rows[0]
        if (used + buf.length > MAX_STORAGE) throw new HttpError(507, 'storage_full')
      }
      // Content-addressed and immutable: the same bytes are stored once, and backups can hard-link unchanged files.
      if (!existsSync(join(filesDir, hash))) writeFileSync(join(filesDir, hash), buf)
      const r = (await q.query(`INSERT INTO attachments (issue_id, name, mime, size, sha256, uploader_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, mime, size`,
        [issue.id, file.name.slice(0, 255) || 'file', file.type || 'application/octet-stream', buf.length, hash, user(c).id])).rows[0]
      await q.query(`INSERT INTO issue_changes (issue_id, actor_id, field, new) VALUES ($1, $2, 'attachment', $3)`, [issue.id, user(c).id, JSON.stringify(r.name)])
      return r
    }, 'comment')
    return c.json(row, 201)
  })
  app.get('/api/attachments/:id', async (c) => {
    const a = (await db.query(`SELECT a.name, a.mime, a.sha256, p.key || '-' || i.number AS key FROM attachments a JOIN issues i ON i.id = a.issue_id JOIN projects p ON p.id = i.project_id
      WHERE a.id = $1 AND a.deleted_at IS NULL`, [Number(c.req.param('id')) || 0])).rows[0]
    if (!a) return fail(c, 404, 'not_found')
    await loadIssue(db, user(c), a.key)
    // Only images render inline; anything else downloads, so an uploaded HTML file can't run script here.
    const inline = /^image\/(png|jpeg|gif|webp)$/.test(a.mime)
    return c.body(readFileSync(join(filesDir, a.sha256)), 200, {
      'content-type': inline ? a.mime : 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      'x-content-type-options': 'nosniff',
    })
  })
  app.delete('/api/attachments/:id', async (c) => {
    const a = (await db.query(`SELECT a.id, a.uploader_id, p.key || '-' || i.number AS key FROM attachments a JOIN issues i ON i.id = a.issue_id JOIN projects p ON p.id = i.project_id
      WHERE a.id = $1 AND a.deleted_at IS NULL`, [Number(c.req.param('id')) || 0])).rows[0]
    if (!a) return fail(c, 404, 'not_found')
    const { level } = await loadIssue(db, user(c), a.key)
    if (a.uploader_id !== user(c).id && level < LEVEL.member) return fail(c, 403, 'forbidden')
    await db.query('UPDATE attachments SET deleted_at = now() WHERE id = $1', [a.id])
    return c.json({ ok: true })
  })

  app.get('/api/notifications', async (c) =>
    c.json((await db.query(`SELECT n.id, n.kind, n.data, n.created_at AS "createdAt", n.read_at AS "readAt",
        CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id', u.id, 'name', u.name) END AS actor
      FROM notifications n LEFT JOIN users u ON u.id = n.actor_id WHERE n.user_id = $1 AND ($2::boolean IS NOT TRUE OR n.read_at IS NULL)
      ORDER BY n.id DESC LIMIT 100`, [user(c).id, c.req.query('unread') === '1'])).rows))
  app.post('/api/notifications/read', async (c) => {
    const b = await body(c)
    const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isInteger) : null
    await db.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2))`, [user(c).id, ids])
    return c.json({ ok: true })
  })
}
