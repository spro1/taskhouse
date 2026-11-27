// Projects: creation with working defaults, roles, workflow, sprints and webhooks.
import type { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import { tx, type Db } from './db.ts'
import { audit, body, fail, HttpError, type Env, type User } from './http.ts'
import { LEVEL, LEVEL_NAME, projectsFor } from './access.ts'
import { applyChanges, enqueue, issueSelect } from './issues.ts'
import { sealSecret } from './secret.ts'

// No "backlog" status: in scrum the backlog is "not in a sprint", and a second meaning only confuses the board.
const DEFAULT_STATUSES: [string, number][] = [['할 일', 0], ['진행 중', 1], ['리뷰 중', 1], ['완료', 2]]
const RULE_KINDS = { conditions: ['is_assignee', 'is_reporter', 'has_role'], validators: ['required', 'subtasks_done', 'no_blockers'], post: ['set'] }

export function registerProjects(app: Hono<Env>, db: Db) {
  const user = (c: any) => c.get('user') as User
  /** The project if visible with at least `need`; 404 when invisible, 403 when visible but not enough. */
  const project = async (c: any, need: number = LEVEL.viewer) => {
    const [p] = await projectsFor(db, user(c), c.req.param('pkey'))
    if (!p) throw new HttpError(404, 'not_found')
    if (p.level < need) throw new HttpError(403, 'forbidden')
    return p
  }

  app.get('/api/projects', async (c) => c.json((await projectsFor(db, user(c))).map((p) => ({ ...p, role: LEVEL_NAME[p.level] }))))

  app.post('/api/projects', async (c) => {
    const b = await body(c)
    const key = String(b.key ?? '').toUpperCase()
    const name = String(b.name ?? '').trim().slice(0, 100)
    const visibility = b.visibility ?? 'private'
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key) || !name || !['edit', 'view', 'private'].includes(visibility)) return fail(c, 400, 'bad_request')
    const id = await tx(db, async (q) => {
      const p = (await q.query('INSERT INTO projects (key, name, visibility) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING RETURNING id', [key, name, visibility])).rows[0]
      if (!p) return null
      await q.query(`INSERT INTO statuses (project_id, name, category, position) SELECT $1, n, c, o FROM unnest($2::text[], $3::smallint[]) WITH ORDINALITY AS x(n, c, o)`,
        [p.id, DEFAULT_STATUSES.map((s) => s[0]), DEFAULT_STATUSES.map((s) => s[1])])
      // The creator administers it; it's usable straight away with no further setup.
      await q.query('INSERT INTO project_roles (project_id, user_id, level) VALUES ($1, $2, 4)', [p.id, user(c).id])
      return p.id
    })
    if (!id) return fail(c, 409, 'key_taken')
    await audit(db, c, 'project.create', key)
    return c.json({ id, key, name, visibility }, 201)
  })

  app.get('/api/projects/:pkey', async (c) => {
    const p = await project(c)
    const [statuses, types, sprints, roles, transitions] = await Promise.all([
      db.query('SELECT id, name, category, on_board AS "onBoard" FROM statuses WHERE project_id = $1 ORDER BY position', [p.id]),
      db.query('SELECT id, name, level FROM issue_types WHERE project_id IS NULL OR project_id = $1 ORDER BY level, id', [p.id]),
      db.query(`SELECT id, name, goal, state, started_at AS "startedAt", ends_at AS "endsAt" FROM sprints WHERE project_id = $1 AND state <> 'closed' ORDER BY id`, [p.id]),
      db.query(`SELECT r.level, CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id', u.id, 'name', u.name) END AS "user",
          CASE WHEN g.id IS NULL THEN NULL ELSE jsonb_build_object('id', g.id, 'name', g.name) END AS "group"
        FROM project_roles r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN groups g ON g.id = r.group_id WHERE r.project_id = $1`, [p.id]),
      db.query(`SELECT t.name, f.name AS "from", s.name AS "to", t.rules FROM transitions t JOIN statuses s ON s.id = t.to_id LEFT JOIN statuses f ON f.id = t.from_id
        WHERE t.project_id = $1 ORDER BY t.id`, [p.id]),
    ])
    return c.json({
      ...p, role: LEVEL_NAME[p.level], statuses: statuses.rows, types: types.rows, sprints: sprints.rows,
      roles: roles.rows.map((r) => ({ ...r, role: LEVEL_NAME[r.level] })), transitions: transitions.rows,
    })
  })

  app.patch('/api/projects/:pkey', async (c) => {
    const p = await project(c, LEVEL.admin)
    const b = await body(c)
    if (b.visibility !== undefined && !['edit', 'view', 'private'].includes(b.visibility)) return fail(c, 400, 'bad_request')
    const name = b.name === undefined ? null : String(b.name).trim().slice(0, 100) || null
    await db.query('UPDATE projects SET name = COALESCE($2, name), visibility = COALESCE($3, visibility) WHERE id = $1', [p.id, name, b.visibility ?? null])
    await audit(db, c, 'project.update', p.key, true, { name, visibility: b.visibility })
    return c.json({ ok: true })
  })

  // Replaces the role list: [{user | group, role: viewer|reporter|member|admin}].
  app.put('/api/projects/:pkey/roles', async (c) => {
    const p = await project(c, LEVEL.admin)
    const b = await body(c)
    const roles = Array.isArray(b.roles) ? b.roles : null
    const levels = roles?.map((r: any) => LEVEL[r.role as keyof typeof LEVEL])
    if (!roles || roles.length > 500 || levels!.some((l: unknown) => !l) || roles.some((r: any) => !r.user === !r.group)) return fail(c, 400, 'bad_request')
    // Losing your own admin role here would lock you out of the settings.
    if (!user(c).isAdmin && !roles.some((r: any) => Number(r.user) === user(c).id && r.role === 'admin')) return fail(c, 400, 'keep_yourself_admin')
    await tx(db, async (q) => {
      await q.query('DELETE FROM project_roles WHERE project_id = $1', [p.id])
      for (const [i, r] of roles.entries())
        await q.query('INSERT INTO project_roles (project_id, user_id, group_id, level) VALUES ($1, $2, $3, $4)', [p.id, Number(r.user) || null, Number(r.group) || null, levels![i]])
    }).catch((e) => {
      throw e.code === '23503' || e.code === '23505' ? new HttpError(400, 'bad_request') : e
    })
    await audit(db, c, 'project.roles', p.key, true, { roles })
    return c.json({ ok: true })
  })

  // Replaces statuses and transitions. Statuses keep their id when sent with it; one still used by issues can't go.
  // An empty transition list means every move is allowed.
  app.put('/api/projects/:pkey/workflow', async (c) => {
    const p = await project(c, LEVEL.admin)
    const b = await body(c)
    const statuses: any[] = Array.isArray(b.statuses) ? b.statuses : []
    const transitions: any[] = Array.isArray(b.transitions) ? b.transitions : []
    const names = statuses.map((s) => String(s.name ?? '').trim())
    const ok = statuses.length >= 2 && statuses.length <= 30 && names.every((n) => n && n.length <= 50) && new Set(names).size === names.length
      && statuses.every((s) => [0, 1, 2].includes(s.category)) && statuses.some((s) => s.category === 0) && statuses.some((s) => s.category === 2)
      && statuses.every((s) => s.onBoard === undefined || typeof s.onBoard === 'boolean') && statuses.some((s) => s.onBoard !== false)
      && transitions.length <= 200 && transitions.every((t) => names.includes(t.to) && (t.from == null || names.includes(t.from))
        && Object.entries(RULE_KINDS).every(([k, kinds]) => (t.rules?.[k] ?? []).every((r: any) => kinds.includes(r?.kind))))
    if (!ok) return fail(c, 400, 'bad_request')
    await tx(db, async (q) => {
      const keep = statuses.map((s) => Number(s.id)).filter(Boolean)
      const inUse = (await q.query(`SELECT s.name FROM statuses s WHERE s.project_id = $1 AND NOT (s.id = ANY($2)) AND EXISTS (SELECT 1 FROM issues i WHERE i.status_id = s.id)`, [p.id, keep])).rows
      if (inUse.length) throw new HttpError(409, 'status_in_use', { statuses: inUse.map((r) => r.name) })
      await q.query('DELETE FROM transitions WHERE project_id = $1', [p.id])
      await q.query('DELETE FROM statuses WHERE project_id = $1 AND NOT (id = ANY($2))', [p.id, keep])
      // Park the names first so swapping two names doesn't trip the unique constraint.
      await q.query(`UPDATE statuses SET name = '~' || id WHERE project_id = $1`, [p.id])
      const ids = new Map<string, number>()
      for (const [i, s] of statuses.entries()) {
        const r = s.id
          ? (await q.query('UPDATE statuses SET name = $3, category = $4, position = $5, on_board = $6 WHERE id = $1 AND project_id = $2 RETURNING id', [s.id, p.id, names[i], s.category, i, s.onBoard !== false])).rows[0]
          : (await q.query('INSERT INTO statuses (project_id, name, category, position, on_board) VALUES ($1, $2, $3, $4, $5) RETURNING id', [p.id, names[i], s.category, i, s.onBoard !== false])).rows[0]
        if (!r) throw new HttpError(400, 'bad_request')
        ids.set(names[i], r.id)
      }
      for (const t of transitions)
        await q.query('INSERT INTO transitions (project_id, name, from_id, to_id, rules) VALUES ($1, $2, $3, $4, $5)',
          [p.id, String(t.name ?? t.to).slice(0, 50), t.from == null ? null : ids.get(t.from), ids.get(t.to), JSON.stringify(t.rules ?? {})])
    })
    await audit(db, c, 'project.workflow', p.key, true, { statuses: names, transitions: transitions.length })
    return c.json({ ok: true })
  })

  app.get('/api/projects/:pkey/sprints', async (c) => {
    const p = await project(c)
    return c.json((await db.query(`SELECT id, name, goal, state, started_at AS "startedAt", ends_at AS "endsAt", closed_at AS "closedAt"
      FROM sprints WHERE project_id = $1 ORDER BY id DESC LIMIT 100`, [p.id])).rows)
  })
  app.post('/api/projects/:pkey/sprints', async (c) => {
    const p = await project(c, LEVEL.member)
    const b = await body(c)
    const n = (await db.query('SELECT count(*)::int AS n FROM sprints WHERE project_id = $1', [p.id])).rows[0].n
    const name = String(b.name ?? '').trim().slice(0, 100) || `${p.key} 스프린트 ${n + 1}`
    return c.json((await db.query('INSERT INTO sprints (project_id, name, goal) VALUES ($1, $2, $3) RETURNING id, name, goal, state', [p.id, name, String(b.goal ?? '').slice(0, 500)])).rows[0], 201)
  })
  app.patch('/api/projects/:pkey/sprints/:id', async (c) => {
    const p = await project(c, LEVEL.member)
    const b = await body(c)
    if (b.endsAt != null && (typeof b.endsAt !== 'string' || isNaN(Date.parse(b.endsAt)))) return fail(c, 400, 'bad_request')
    const r = await db.query(`UPDATE sprints SET name = COALESCE($3, name), goal = COALESCE($4, goal), ends_at = COALESCE($5, ends_at) WHERE id = $1 AND project_id = $2`,
      [Number(c.req.param('id')) || 0, p.id, b.name ? String(b.name).slice(0, 100) : null, typeof b.goal === 'string' ? b.goal.slice(0, 500) : null, b.endsAt ?? null])
    return r.rowCount ? c.json({ ok: true }) : fail(c, 404, 'not_found')
  })
  app.post('/api/projects/:pkey/sprints/:id/start', async (c) => {
    const p = await project(c, LEVEL.member)
    const b = await body(c)
    const days = Number(b.days ?? 14)
    if (!Number.isInteger(days) || days < 1 || days > 90) return fail(c, 400, 'bad_request')
    const r = await db.query(`UPDATE sprints SET state = 'active', started_at = now(), ends_at = now() + make_interval(days => $3) WHERE id = $1 AND project_id = $2 AND state = 'planned' RETURNING id`,
      [Number(c.req.param('id')) || 0, p.id, days]).catch((e) => {
      if (e.code === '23505') throw new HttpError(409, 'sprint_already_active')
      throw e
    })
    if (!r.rowCount) return fail(c, 404, 'not_found')
    await db.query(`INSERT INTO jobs (kind, payload) SELECT 'webhook', jsonb_build_object('hook', id, 'body', $2::jsonb) FROM webhooks WHERE project_id = $1 AND (events = '{}' OR 'sprint.started' = ANY(events))`,
      [p.id, JSON.stringify({ event: 'sprint.started', at: new Date().toISOString(), project: p.key, sprint: r.rows[0].id })])
    return c.json({ ok: true })
  })
  // Unfinished issues move to `moveTo` (another open sprint) or back to the backlog (null), each with a change log line.
  app.post('/api/projects/:pkey/sprints/:id/complete', async (c) => {
    const p = await project(c, LEVEL.member)
    const b = await body(c)
    const id = Number(c.req.param('id')) || 0
    const moved = await tx(db, async (q) => {
      const s = (await q.query(`UPDATE sprints SET state = 'closed', closed_at = now() WHERE id = $1 AND project_id = $2 AND state = 'active' RETURNING id`, [id, p.id])).rows[0]
      if (!s) throw new HttpError(404, 'not_found')
      const open = (await q.query(`${issueSelect(true)} WHERE i.sprint_id = $1 AND i.deleted_at IS NULL AND s.category <> 2 FOR UPDATE OF i`, [id])).rows
      for (const issue of open) await applyChanges(q, issue as any, { sprint: b.moveTo ?? null }, user(c))
      const done = (await q.query(`${issueSelect(true)} WHERE i.sprint_id = $1 AND i.deleted_at IS NULL LIMIT 1`, [id])).rows[0]
      if (done) await enqueue(q, done as any, user(c), 'sprint.completed', { sprint: id })
      return open.length
    })
    return c.json({ ok: true, moved })
  })

  // Webhooks make this server send requests into the network, so only site admins manage them.
  const hooksAdmin = async (c: any) => {
    if (!user(c).isAdmin) throw new HttpError(403, 'admin_only')
    return project(c)
  }
  app.get('/api/projects/:pkey/webhooks', async (c) => {
    const p = await hooksAdmin(c)
    return c.json((await db.query(`SELECT w.id, w.url, w.format, w.events, w.created_at AS "createdAt",
        (SELECT jsonb_build_object('at', j.created_at, 'attempts', j.attempts, 'error', j.last_error, 'done', j.done_at IS NOT NULL)
         FROM jobs j WHERE j.kind = 'webhook' AND (j.payload->>'hook')::bigint = w.id ORDER BY j.id DESC LIMIT 1) AS last
      FROM webhooks w WHERE w.project_id = $1 ORDER BY w.id`, [p.id])).rows)
  })
  app.post('/api/projects/:pkey/webhooks', async (c) => {
    const p = await hooksAdmin(c)
    const b = await body(c)
    let url: URL | null = null
    try { url = new URL(String(b.url)) } catch {}
    const events = Array.isArray(b.events) ? b.events.map(String).slice(0, 20) : []
    if (!url || !/^https?:$/.test(url.protocol) || url.username || !['json', 'chat'].includes(b.format ?? 'json')) return fail(c, 400, 'bad_request')
    const secret = randomBytes(24).toString('hex')
    const row = (await db.query('INSERT INTO webhooks (project_id, url, secret, format, events) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [p.id, url.toString(), sealSecret(secret), b.format ?? 'json', events])).rows[0]
    await audit(db, c, 'webhook.create', p.key, true, { url: url.origin, format: b.format ?? 'json' })
    // The signing secret is shown once.
    return c.json({ id: row.id, secret }, 201)
  })
  app.delete('/api/projects/:pkey/webhooks/:id', async (c) => {
    const p = await hooksAdmin(c)
    const r = await db.query('DELETE FROM webhooks WHERE id = $1 AND project_id = $2', [Number(c.req.param('id')) || 0, p.id])
    await audit(db, c, 'webhook.delete', p.key)
    return r.rowCount ? c.json({ ok: true }) : fail(c, 404, 'not_found')
  })
}
