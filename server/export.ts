// Export a whole project, so the data can always leave: GET /api/projects/:key/export?format=json|csv
// JSON holds everything (issues with descriptions, comments, links, history, sprints, attachment list);
// CSV is the issue list for spreadsheets. Streamed in batches, so 50,000 issues don't sit in memory.
import type { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type { Db } from './db.ts'
import { audit, fail, type Env, type User } from './http.ts'
import { LEVEL, projectsFor } from './access.ts'
import { issueSelect } from './issues.ts'

const BATCH = 1000

/** Rows of `sql` (which must select `id` and take the project as $1 and the last id as $2), batch by batch. */
async function* batches(db: Db, sql: string, projectId: number) {
  let last = 0
  for (;;) {
    const rows = (await db.query(`${sql} LIMIT ${BATCH}`, [projectId, last])).rows
    if (!rows.length) return
    yield rows
    last = rows.at(-1).id
  }
}

const PARTS: [string, string][] = [
  ['issues', `${issueSelect()} WHERE i.project_id = $1 AND i.id > $2 ORDER BY i.id`],
  ['comments', `SELECT cm.id, p.key || '-' || i.number AS issue, cm.author_id AS "authorId", cm.doc, cm.created_at AS "createdAt", cm.updated_at AS "updatedAt", cm.deleted_at AS "deletedAt"
    FROM comments cm JOIN issues i ON i.id = cm.issue_id JOIN projects p ON p.id = i.project_id WHERE i.project_id = $1 AND cm.id > $2 ORDER BY cm.id`],
  ['changes', `SELECT ch.id, p.key || '-' || i.number AS issue, ch.actor_id AS "actorId", ch.at, ch.field, ch.old, ch.new
    FROM issue_changes ch JOIN issues i ON i.id = ch.issue_id JOIN projects p ON p.id = i.project_id WHERE i.project_id = $1 AND ch.id > $2 ORDER BY ch.id`],
  ['attachments', `SELECT a.id, p.key || '-' || i.number AS issue, a.name, a.mime, a.size, a.sha256, a.uploader_id AS "uploaderId", a.created_at AS "createdAt"
    FROM attachments a JOIN issues i ON i.id = a.issue_id JOIN projects p ON p.id = i.project_id WHERE i.project_id = $1 AND a.id > $2 AND a.deleted_at IS NULL ORDER BY a.id`],
]

// Spreadsheets run a cell starting with = + - @ as a formula; a leading ' keeps it text.
export const csvCell = (v: unknown) => {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join(' ') : typeof v === 'object' ? String((v as any).name ?? '') : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const CSV_COLUMNS = ['key', 'type', 'status', 'title', 'priority', 'assignee', 'reporter', 'parent', 'sprint', 'points', 'labels', 'due', 'createdAt', 'updatedAt', 'resolvedAt']

export function registerExport(app: Hono<Env>, db: Db) {
  app.get('/api/projects/:pkey/export', async (c) => {
    const user = c.get('user') as User
    const [p] = await projectsFor(db, user, c.req.param('pkey'))
    if (!p) return fail(c, 404, 'not_found')
    if (p.level < LEVEL.admin) return fail(c, 403, 'forbidden')
    const csv = c.req.query('format') === 'csv'
    await audit(db, c, 'project.export', p.key, true, { format: csv ? 'csv' : 'json' })
    const day = new Date().toISOString().slice(0, 10)
    c.header('content-type', csv ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8')
    c.header('content-disposition', `attachment; filename="${p.key}-${day}.${csv ? 'csv' : 'json'}"`)
    return stream(c, async (out) => {
      if (csv) {
        // BOM so Excel reads UTF-8 (Korean) correctly.
        await out.write(`﻿${CSV_COLUMNS.join(',')}\r\n`)
        for await (const rows of batches(db, `${issueSelect(true)} WHERE i.project_id = $1 AND i.id > $2 AND i.deleted_at IS NULL ORDER BY i.id`, p.id))
          await out.write(rows.map((r) => CSV_COLUMNS.map((k) => csvCell(k === 'type' || k === 'status' ? r[k].name : r[k])).join(',')).join('\r\n') + '\r\n')
        return
      }
      const [statuses, sprints, types, people, links] = await Promise.all([
        db.query('SELECT id, name, category, position FROM statuses WHERE project_id = $1 ORDER BY position', [p.id]),
        db.query('SELECT id, name, goal, state, started_at AS "startedAt", ends_at AS "endsAt", closed_at AS "closedAt" FROM sprints WHERE project_id = $1 ORDER BY id', [p.id]),
        db.query('SELECT id, name, level FROM issue_types WHERE project_id IS NULL OR project_id = $1 ORDER BY id', [p.id]),
        // Everyone the export mentions by id, so the ids mean something outside this server.
        db.query(`SELECT id, name, email FROM users WHERE id IN (
          SELECT reporter_id FROM issues WHERE project_id = $1 UNION SELECT assignee_id FROM issues WHERE project_id = $1
          UNION SELECT cm.author_id FROM comments cm JOIN issues i ON i.id = cm.issue_id WHERE i.project_id = $1
          UNION SELECT ch.actor_id FROM issue_changes ch JOIN issues i ON i.id = ch.issue_id WHERE i.project_id = $1) ORDER BY id`, [p.id]),
        // Links are few next to issues: one query. A link to another project only if the exporter can see that one too.
        projectsFor(db, user).then((visible) => db.query(`SELECT ps.key || '-' || s.number AS source, pt.key || '-' || t.number AS target, l.kind FROM issue_links l
          JOIN issues s ON s.id = l.source_id JOIN issues t ON t.id = l.target_id JOIN projects ps ON ps.id = s.project_id JOIN projects pt ON pt.id = t.project_id
          WHERE (s.project_id = $1 OR t.project_id = $1) AND s.project_id = ANY($2) AND t.project_id = ANY($2)`, [p.id, visible.map((v) => v.id)])),
      ])
      const head = { format: 'taskhouse-export', version: 1, exportedAt: new Date().toISOString(), project: { key: p.key, name: p.name, visibility: p.visibility },
        statuses: statuses.rows, sprints: sprints.rows, types: types.rows, people: people.rows, links: links.rows }
      await out.write(JSON.stringify(head).slice(0, -1))
      for (const [name, sql] of PARTS) {
        await out.write(`,${JSON.stringify(name)}:[`)
        let first = true
        for await (const rows of batches(db, sql, p.id)) {
          await out.write((first ? '' : ',') + rows.map((r) => JSON.stringify(r)).join(','))
          first = false
        }
        await out.write(']')
      }
      await out.write('}')
    })
  })
}
