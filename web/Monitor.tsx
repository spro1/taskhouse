// Admin → Monitoring, as in Pagehouse: live state (refreshed every 15 s), storage, backups, usage and recent errors.
import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { Link } from './App.tsx'
import { t } from './i18n.ts'

export function bytes(n: number) {
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  do { n /= 1024; i++ } while (n >= 1024 && i < u.length - 1)
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`
}
const duration = (s: number) => (s < 3600 ? t('mon.minutes', { n: Math.floor(s / 60) }) : s < 86400 ? t('mon.hours', { n: Math.floor(s / 3600) }) : t('mon.days', { n: Math.floor(s / 86400) }))

type Health = {
  db: { latencyMs: number; connections: number; waiting: number }
  process: { uptimeSeconds: number; rssBytes: number; heapUsedBytes: number; loopDelayP99Ms: number }
  recent: { minutes: number; requests: number; serverErrors: number; slow: number; errors: { at: string; method: string; path: string; message: string }[] }
  live: { connections: number }
  jobs: { pending: number; retrying: number; failed24h: number }
  mail: { enabled: boolean; backlog: number; failed: number }
  backup: { lastAt: string | null; overdue: boolean } | null
}

export function Monitor() {
  const [h, setH] = useState<Health>()
  const [s, setS] = useState<any>()
  const load = () => { api<Health>('GET', '/api/admin/health').then(setH, () => {}); api('GET', '/api/admin/stats').then(setS, () => {}) }
  useEffect(() => {
    load()
    const timer = setInterval(() => api<Health>('GET', '/api/admin/health').then(setH, () => {}), 15_000)
    return () => clearInterval(timer)
  }, [])
  if (!h || !s) return null
  const problems = [
    h.recent.serverErrors > 0 && t('mon.p.errors', { n: h.recent.serverErrors }),
    h.jobs.failed24h > 0 && t('mon.p.webhooks', { n: h.jobs.failed24h }),
    h.mail.backlog > 0 && t('mon.p.mail', { n: h.mail.backlog }),
    h.backup?.overdue && t('mon.p.backup'),
    h.db.waiting > 0 && t('mon.p.pool', { n: h.db.waiting }),
  ].filter(Boolean) as string[]
  const st = s.storage
  const cap = st.limitBytes ?? st.disk?.total ?? st.dbBytes + st.fileBytes
  const maxDay = Math.max(1, ...s.activity.map((a: any) => Math.max(a.created, a.resolved)))
  const tile = (label: string, value: string, bad = false, note?: string) => (
    <div className={`stat ${bad ? 'bad' : ''}`}><span className="muted small">{label}</span><b>{value}</b>{note && <span className="muted small">{note}</span>}</div>
  )
  return (
    <div className="monitor">
      <div className={`banner ${problems.length ? 'warn' : 'ok'}`} role="status">
        {problems.length ? problems.join(' · ') : t('mon.allGood')}
        <span className="grow" />
        <button className="ghost sm" onClick={load}>{t('mon.refresh')}</button>
      </div>

      <section className="panel">
        <h3>{t('mon.now', { n: h.recent.minutes })}</h3>
        <div className="stats">
          {tile(t('mon.requests'), h.recent.requests.toLocaleString())}
          {tile(t('mon.serverErrors'), String(h.recent.serverErrors), h.recent.serverErrors > 0)}
          {tile(t('mon.slow'), String(h.recent.slow), h.recent.slow > 0)}
          {tile(t('mon.dbLatency'), `${h.db.latencyMs} ms`, h.db.latencyMs > 50, t('mon.pool', { n: h.db.connections, w: h.db.waiting }))}
          {tile(t('mon.live'), String(h.live.connections))}
          {tile(t('mon.memory'), bytes(h.process.rssBytes), false, t('mon.loop', { ms: h.process.loopDelayP99Ms }))}
          {tile(t('mon.webhooks'), String(h.jobs.pending), h.jobs.failed24h > 0, t('mon.failed24h', { n: h.jobs.failed24h }))}
          {tile(t('mon.mail'), h.mail.enabled ? String(h.mail.backlog) : t('mon.off'), h.mail.backlog > 0, h.mail.enabled ? t('mon.mailFailed', { n: h.mail.failed }) : undefined)}
        </div>
        {h.recent.errors.length > 0 && (
          <>
            <h4>{t('mon.recentErrors')}</h4>
            <ul className="list boxed small">
              {h.recent.errors.map((e, i) => <li key={i}><span className="muted">{new Date(e.at).toLocaleTimeString()}</span><code>{e.method} {e.path}</code><span className="grow ellipsis">{e.message}</span></li>)}
            </ul>
          </>
        )}
      </section>

      <div className="two">
        <section className="panel">
          <h3>{t('mon.storage')}</h3>
          <p><b>{bytes(st.dbBytes + st.fileBytes)}</b> <span className="muted small">{st.limitBytes ? t('mon.ofLimit', { limit: bytes(st.limitBytes) }) : t('mon.noLimit')}</span></p>
          <div className="usage" aria-hidden="true">
            <span className="seg db" style={{ width: `${(st.dbBytes / cap) * 100}%` }} />
            <span className="seg files" style={{ width: `${(st.fileBytes / cap) * 100}%` }} />
          </div>
          <p className="muted small">
            <i className="dot c1" />{t('mon.db')} {bytes(st.dbBytes)} · <i className="dot c2" />{t('mon.files')} {bytes(st.fileBytes)}
            {st.disk && <> · {t('mon.disk', { free: bytes(st.disk.free), total: bytes(st.disk.total) })}</>}
          </p>
          {st.fileBytesBeforeDedup > st.fileBytes && <p className="muted small">{t('mon.dedup', { saved: bytes(st.fileBytesBeforeDedup - st.fileBytes) })}</p>}
        </section>
        <section className="panel">
          <h3>{t('mon.backups')}</h3>
          {!s.backups ? <p className="muted small">{t('mon.backups.none')}</p> : (
            <>
              <p>{s.backups.lastAutoAt ? t('mon.backups.last', { at: new Date(s.backups.lastAutoAt).toLocaleString() }) : t('mon.backups.never')}</p>
              <p className="muted small">{t('mon.backups.count', { n: s.backups.count, hours: s.backupIntervalHours })}</p>
              {h.backup?.overdue && <p className="error small">{t('mon.p.backup')}</p>}
            </>
          )}
          <h3 style={{ marginTop: 16 }}>{t('mon.system')}</h3>
          <p>Taskhouse {s.system.version} <span className="muted small">· {t('mon.uptime', { t: duration(s.system.uptimeSeconds) })}</span></p>
          <p className="muted small">Node {s.system.node} · PostgreSQL {s.system.postgres}</p>
        </section>
      </div>

      <section className="panel">
        <h3>{t('mon.usage')}</h3>
        <div className="stats">
          {tile(t('mon.c.users'), s.counts.activeUsers.toLocaleString(), false, t('mon.c.usersNote', { admins: s.counts.admins, disabled: s.counts.disabledUsers }))}
          {tile(t('mon.c.active'), s.counts.activePeople30d.toLocaleString())}
          {tile(t('mon.c.projects'), s.counts.projects.toLocaleString(), false, t('mon.c.sprints', { n: s.counts.activeSprints }))}
          {tile(t('mon.c.open'), s.counts.openIssues.toLocaleString(), false, t('mon.c.done', { n: s.counts.doneIssues }))}
          {tile(t('mon.c.comments'), s.counts.comments.toLocaleString())}
          {tile(t('mon.c.attachments'), s.counts.attachments.toLocaleString())}
          {tile(t('mon.c.tokens'), s.counts.apiTokens.toLocaleString())}
        </div>
        <h4>{t('mon.activity')}</h4>
        <div className="bars" role="img" aria-label={t('mon.activity')}>
          {s.activity.map((a: any) => (
            <div key={a.day} className="bar" title={t('mon.activityDay', { day: a.day, created: a.created, resolved: a.resolved })}>
              <span className="made" style={{ height: `${(a.created / maxDay) * 100}%` }} />
              <span className="fixed" style={{ height: `${(a.resolved / maxDay) * 100}%` }} />
              <small>{a.day.slice(8)}</small>
            </div>
          ))}
        </div>
        <p className="muted small"><i className="dot c1" />{t('mon.created')} · <i className="dot c2" />{t('mon.resolved')}</p>
      </section>

      <section className="panel">
        <h3>{t('home.projects')}</h3>
        <table className="results">
          <thead><tr><th>{t('auth.name')}</th><th>{t('mon.open')}</th><th>{t('mon.doneCol')}</th><th>{t('mon.lastUpdate')}</th></tr></thead>
          <tbody>
            {s.projects.map((p: any) => (
              <tr key={p.id}><td><Link to={`/p/${p.key}`}>{p.name}</Link> <span className="key">{p.key}</span></td><td>{p.open}</td><td>{p.done}</td>
                <td className="muted">{p.lastUpdate ? new Date(p.lastUpdate).toLocaleString() : '—'}</td></tr>
            ))}
          </tbody>
        </table>
        {s.largestFiles.length > 0 && (
          <>
            <h4>{t('mon.largest')}</h4>
            <table className="results">
              <tbody>
                {s.largestFiles.map((f: any) => <tr key={f.id}><td className="ellipsis" style={{ maxWidth: 360 }}>{f.name}</td><td><Link to={`/browse/${f.issue}`}>{f.issue}</Link></td><td>{bytes(f.size)}</td></tr>)}
              </tbody>
            </table>
          </>
        )}
      </section>
      <p className="muted small">{t('mon.prometheus')}</p>
    </div>
  )
}
