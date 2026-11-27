// Monitoring for site admins, as in Pagehouse: Admin → Monitoring reads /api/admin/health (live state, polled) and
// /api/admin/stats (storage, backups, usage); Prometheus scrapes /metrics with METRICS_TOKEN as a bearer token.
// /api/admin/* is admin-only (auth.ts); /metrics answers 404 unless METRICS_TOKEN is set.
import type { Hono } from 'hono'
import { readdirSync, readFileSync, statfsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from './db.ts'
import { sha256, type Env } from './http.ts'
import { counter, processStats, prometheus, recentStats } from './metrics.ts'

const version = (() => {
  try { return JSON.parse(readFileSync('package.json', 'utf8')).version as string } catch { return 'dev' }
})()

type Live = { connections: () => number } | null

/** Backup folders under BACKUP_DIR (./backups mounted read-only): auto-…, manual-…, pre… */
export function backups(dir = process.env.BACKUP_DIR) {
  if (!dir) return null
  try {
    const list = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, at: statSync(join(dir, e.name)).mtimeMs })).sort((a, b) => b.at - a.at)
    const auto = list.find((b) => b.name.startsWith('auto-'))
    return { count: list.length, latest: list[0] ? { name: list[0].name, at: new Date(list[0].at).toISOString() } : null, lastAutoAt: auto ? new Date(auto.at).toISOString() : null }
  } catch {
    return null
  }
}

const intervalHours = () => Number(process.env.BACKUP_INTERVAL_HOURS ?? 24) || 24

/** What an operator wants at a glance; shared by Admin → Monitoring and /metrics. */
export async function health(db: Db, live: Live) {
  const t = performance.now()
  await db.query('SELECT 1')
  const latencyMs = Math.round((performance.now() - t) * 10) / 10
  const q = (await db.query(
    `SELECT (SELECT count(*) FROM jobs WHERE done_at IS NULL)::int AS "jobsPending",
            (SELECT count(*) FROM jobs WHERE done_at IS NULL AND attempts > 0 AND last_error IS NOT NULL)::int AS "jobsRetrying",
            (SELECT count(*) FROM jobs WHERE done_at > now() - interval '24 hours' AND last_error IS NOT NULL)::int AS "jobsFailed24h",
            (SELECT count(*) FROM notifications n JOIN users u ON u.id = n.user_id
               WHERE n.mailed_at IS NULL AND n.read_at IS NULL AND u.email_notify AND n.created_at < now() - interval '40 minutes')::int AS "mailBacklog",
            (SELECT count(*) FROM users WHERE disabled_at IS NULL)::int AS users,
            (SELECT count(*) FROM issues WHERE deleted_at IS NULL)::int AS issues`,
  )).rows[0]
  const bk = backups()
  const last = bk?.lastAutoAt ? new Date(bk.lastAutoAt).getTime() : null
  return {
    db: { latencyMs, connections: db.totalCount, idle: db.idleCount, waiting: db.waitingCount },
    process: processStats(),
    recent: recentStats(),
    live: { connections: live?.connections() ?? 0 },
    jobs: { pending: q.jobsPending, retrying: q.jobsRetrying, failed24h: q.jobsFailed24h },
    mail: { enabled: !!process.env.SMTP_URL, backlog: process.env.SMTP_URL ? q.mailBacklog : 0, failed: counter('taskhouse_mail_sent_total{result="failed"}') },
    backup: bk ? { lastAt: bk.lastAutoAt, overdue: !last || Date.now() - last > intervalHours() * 1.5 * 3600_000 } : null,
    counts: { users: q.users, issues: q.issues },
  }
}

async function storage(db: Db, filesDir: string) {
  const r = (await db.query(`SELECT pg_database_size(current_database())::bigint AS db,
      (SELECT coalesce(sum(size), 0) FROM (SELECT DISTINCT ON (sha256) size FROM attachments) x)::bigint AS files,
      (SELECT coalesce(sum(size), 0) FROM attachments)::bigint AS logical`)).rows[0]
  let disk: { free: number; total: number } | null = null
  try {
    const s = statfsSync(filesDir)
    disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }
  } catch {}
  const limit = Number(process.env.MAX_STORAGE_GB ?? 0) * 1024 ** 3
  return { dbBytes: Number(r.db), fileBytes: Number(r.files), fileBytesBeforeDedup: Number(r.logical), limitBytes: limit || null, disk }
}

export function registerMonitor(app: Hono<Env>, db: Db, filesDir: string, live: () => Live) {
  const all = async (sql: string) => (await db.query(sql)).rows
  app.get('/api/admin/health', async (c) => c.json(await health(db, live())))

  app.get('/api/admin/stats', async (c) => {
    const [counts, projects, activity, largest, pg] = await Promise.all([
      all(`SELECT (SELECT count(*) FROM users WHERE disabled_at IS NULL)::int AS "activeUsers",
                  (SELECT count(*) FROM users WHERE disabled_at IS NOT NULL)::int AS "disabledUsers",
                  (SELECT count(*) FROM users WHERE is_admin AND disabled_at IS NULL)::int AS admins,
                  (SELECT count(*) FROM projects)::int AS projects,
                  (SELECT count(*) FROM issues i JOIN statuses s ON s.id = i.status_id WHERE i.deleted_at IS NULL AND s.category < 2)::int AS "openIssues",
                  (SELECT count(*) FROM issues i JOIN statuses s ON s.id = i.status_id WHERE i.deleted_at IS NULL AND s.category = 2)::int AS "doneIssues",
                  (SELECT count(*) FROM comments WHERE deleted_at IS NULL)::int AS comments,
                  (SELECT count(*) FROM attachments WHERE deleted_at IS NULL)::int AS attachments,
                  (SELECT count(*) FROM sprints WHERE state = 'active')::int AS "activeSprints",
                  (SELECT count(*) FROM api_tokens WHERE expires_at > now())::int AS "apiTokens",
                  (SELECT count(DISTINCT actor_id) FROM issue_changes WHERE at > now() - interval '30 days')::int AS "activePeople30d"`),
      all(`SELECT p.id, p.key, p.name,
             count(i.id) FILTER (WHERE s.category < 2)::int AS open,
             count(i.id) FILTER (WHERE s.category = 2)::int AS done,
             max(i.updated_at) AS "lastUpdate"
           FROM projects p LEFT JOIN issues i ON i.project_id = p.id AND i.deleted_at IS NULL LEFT JOIN statuses s ON s.id = i.status_id
           GROUP BY p.id ORDER BY open DESC, p.name`),
      all(`SELECT to_char(d, 'YYYY-MM-DD') AS day,
             (SELECT count(*) FROM issues WHERE created_at::date = d::date)::int AS created,
             (SELECT count(*) FROM issues WHERE resolved_at::date = d::date)::int AS resolved
           FROM generate_series(current_date - 13, current_date, interval '1 day') d ORDER BY d`),
      all(`SELECT a.id, a.name, a.size, i.id AS "issueId", p.key || '-' || i.number AS issue
           FROM attachments a JOIN issues i ON i.id = a.issue_id JOIN projects p ON p.id = i.project_id
           WHERE a.deleted_at IS NULL ORDER BY a.size DESC LIMIT 10`),
      all(`SELECT current_setting('server_version') AS v`),
    ])
    return c.json({
      storage: await storage(db, filesDir),
      backups: backups(),
      backupIntervalHours: intervalHours(),
      counts: counts[0],
      projects,
      activity,
      largestFiles: largest.map((f) => ({ ...f, size: Number(f.size) })),
      system: { version, node: process.version, postgres: pg[0].v, uptimeSeconds: Math.round(process.uptime()) },
    })
  })

  // Prometheus scrape endpoint, off unless METRICS_TOKEN is set; scrapers send it as a bearer token.
  app.get('/metrics', async (c) => {
    const want = process.env.METRICS_TOKEN
    if (!want) return c.text('Not found', 404)
    const got = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    if (sha256(got) !== sha256(want)) return c.text('Unauthorized', 401, { 'WWW-Authenticate': 'Bearer' })
    const h = await health(db, live())
    const s = await storage(db, filesDir)
    return c.text(prometheus([
      ['taskhouse_info', 'Running version.', 1, { version }],
      ['taskhouse_db_latency_seconds', 'Time for a trivial database query.', h.db.latencyMs / 1000],
      ['taskhouse_db_pool_connections', 'Database connections held by this instance.', h.db.connections],
      ['taskhouse_db_pool_waiting', 'Queries waiting for a database connection.', h.db.waiting],
      ['taskhouse_live_connections', 'Live-update WebSocket connections on this instance.', h.live.connections],
      ['taskhouse_jobs_pending', 'Webhook deliveries waiting or being retried.', h.jobs.pending],
      ['taskhouse_jobs_failed_24h', 'Webhook deliveries given up in the last 24 hours.', h.jobs.failed24h],
      ['taskhouse_notification_backlog', 'Notification emails waiting longer than expected.', h.mail.backlog],
      ['taskhouse_storage_bytes', 'Storage used.', s.dbBytes, { kind: 'database' }],
      ['taskhouse_storage_bytes', 'Storage used.', s.fileBytes, { kind: 'files' }],
      ['taskhouse_storage_limit_bytes', 'Attachment storage limit (0 = none).', s.limitBytes ?? 0],
      ['taskhouse_backup_last_success_timestamp_seconds', 'When the last automatic backup was written (0 = never or not visible).', h.backup?.lastAt ? Math.round(new Date(h.backup.lastAt).getTime() / 1000) : 0],
      ['taskhouse_users', 'Active accounts.', h.counts.users],
      ['taskhouse_issues', 'Issues not deleted.', h.counts.issues],
    ]), 200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' })
  })
}
