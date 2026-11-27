// Notification email: one digest per person once their notifications have been quiet for 5 minutes (or waited 30),
// so a burst of edits on one issue becomes one mail. Only unread notifications, and only for projects the person
// can still see when the mail goes out.
import nodemailer, { type Transporter } from 'nodemailer'
import { inc } from './metrics.ts'
import type { Db } from './db.ts'
import { canSeeProject } from './access.ts'

// Mail text in each account's language (users.locale; not chosen = Korean, like the interface).
export const TEXT = {
  ko: {
    kind: { created: '이슈를 만들었습니다', updated: '이슈를 바꿨습니다', transitioned: '상태를 바꿨습니다', commented: '댓글을 남겼습니다' } as Record<string, string>,
    system: '시스템',
    line: (actor: string, what: string) => `${actor}님이 ${what}`,
    subject: (n: number) => `[Taskhouse] 새 알림 ${n}건`,
    hello: (name: string) => `${name}님, 읽지 않은 알림입니다.`,
    off: '알림 메일은 내 설정에서 끌 수 있습니다:',
    resetSubject: '[Taskhouse] 비밀번호 재설정',
    resetBody: '아래 링크에서 새 비밀번호를 정하세요. 링크는 1시간 동안 한 번만 쓸 수 있습니다.',
    resetIgnore: '요청하지 않았다면 이 메일은 무시하세요.',
  },
  en: {
    kind: { created: 'created the issue', updated: 'updated the issue', transitioned: 'changed the status', commented: 'commented' } as Record<string, string>,
    system: 'System',
    line: (actor: string, what: string) => `${actor} ${what}`,
    subject: (n: number) => `[Taskhouse] ${n} new notification${n === 1 ? '' : 's'}`,
    hello: (name: string) => `${name}, here is what you haven't read yet.`,
    off: 'You can turn these emails off in your settings:',
    resetSubject: '[Taskhouse] Reset your password',
    resetBody: 'Choose a new password at the link below. It works once, for one hour.',
    resetIgnore: "If you didn't ask for this, ignore this email.",
  },
}
export const textFor = (locale: string | null | undefined) => TEXT[locale === 'en' ? 'en' : 'ko']

let testTransport: Transporter | null = null
/** Tests send through a capturing transport instead of SMTP. */
export const useTestTransport = (t: Transporter | null) => void (testTransport = t)
export const mailer = (): Transporter | null => testTransport ?? (process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null)
export const mailFrom = () => process.env.SMTP_FROM || 'taskhouse@localhost'

// `now` is a test hook (an SQL expression for the current time); never user input.
export async function sendDigests(db: Db, transport: Transporter, now = 'now()') {
  const due = (await db.query(`SELECT n.user_id FROM notifications n JOIN users u ON u.id = n.user_id
    WHERE n.read_at IS NULL AND n.mailed_at IS NULL AND u.email_notify AND u.disabled_at IS NULL
    GROUP BY n.user_id HAVING max(n.created_at) < ${now} - interval '5 minutes' OR min(n.created_at) < ${now} - interval '30 minutes'`)).rows
  let sent = 0
  for (const { user_id } of due) {
    // Claimed first, so two app instances never send the same digest.
    const rows = (await db.query(`UPDATE notifications n SET mailed_at = now() FROM issues i
      WHERE n.user_id = $1 AND n.read_at IS NULL AND n.mailed_at IS NULL AND i.id = n.issue_id
      RETURNING n.id, n.kind, n.data, i.project_id, (SELECT name FROM users WHERE id = n.actor_id) AS actor`, [user_id])).rows
    const visible = new Set<number>()
    for (const p of new Set(rows.map((r) => r.project_id))) if ((await canSeeProject(db, p, [user_id])).length) visible.add(p)
    const items = rows.filter((r) => visible.has(r.project_id))
    if (!items.length) continue
    const user = (await db.query('SELECT email, name, locale FROM users WHERE id = $1', [user_id])).rows[0]
    const L = textFor(user.locale)
    const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '')
    // Grouped by issue, oldest first.
    const byIssue = new Map<string, typeof items>()
    for (const r of items.sort((a, b) => a.id - b.id)) byIssue.set(r.data.key, [...(byIssue.get(r.data.key) ?? []), r])
    const lines = [...byIssue].map(([key, list]) =>
      `${key} ${list.at(-1)!.data.title}\n${base}/browse/${key}\n` +
      list.map((r) => `  - ${L.line(r.actor ?? L.system, L.kind[r.kind] ?? r.kind)}${r.data.text ? `: ${r.data.text}` : ''}`).join('\n'))
    try {
      await transport.sendMail({
        from: mailFrom(),
        to: user.email,
        subject: `${L.subject(items.length)}${byIssue.size === 1 ? ` · ${[...byIssue.keys()][0]}` : ''}`,
        text: `${L.hello(user.name)}\n\n${lines.join('\n\n')}\n\n${L.off} ${base}/me\n`,
      })
      sent++
      inc('taskhouse_mail_sent_total', { result: 'ok' })
    } catch (e) {
      inc('taskhouse_mail_sent_total', { result: 'failed' })
      // Give them back, so the next round tries again.
      await db.query('UPDATE notifications SET mailed_at = NULL WHERE id = ANY($1)', [items.map((r) => r.id)])
      console.error('mail:', (e as Error).message)
    }
  }
  return sent
}

export function startMail(db: Db) {
  const t = mailer()
  if (!t) return
  let busy = false
  setInterval(async () => {
    if (busy) return
    busy = true
    try { await sendDigests(db, t) } catch (e) { console.error('mail:', (e as Error).message) } finally { busy = false }
  }, 60_000).unref()
}
