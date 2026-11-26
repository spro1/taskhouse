// Background work from the jobs table: webhook delivery with retries, and retention cleanup.
// Claiming a job pushes its run_at forward (a lease), so a crashed worker's job is simply picked up again later.
import { createHmac } from 'node:crypto'
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from './db.ts'

const MAX_ATTEMPTS = 5

// Webhooks never go to this machine or to link-local addresses (cloud metadata at 169.254.169.254), checked on the
// address actually connected to, so a DNS name can't point there either. WEBHOOK_ALLOW lists hosts exempt from it.
const blocked = new net.BlockList()
blocked.addSubnet('0.0.0.0', 8)
blocked.addSubnet('127.0.0.0', 8)
blocked.addSubnet('169.254.0.0', 16)
blocked.addAddress('::', 'ipv6')
blocked.addAddress('::1', 'ipv6')
blocked.addSubnet('fe80::', 10, 'ipv6')
const isBlocked = (ip: string) => {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1]
  return v4 ? blocked.check(v4) : blocked.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4')
}
const allowed = () => new Set((process.env.WEBHOOK_ALLOW ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean))

export function checkedLookup(host: string): net.LookupFunction {
  return (hostname, opts, cb) =>
    dns.lookup(hostname, { ...opts, all: true }, (err, addrs: dns.LookupAddress[]) => {
      if (err) return cb(err, '', 0)
      const bad = addrs.find((a) => isBlocked(a.address))
      if (bad && !allowed().has(host)) return cb(new Error(`blocked address ${bad.address}`), '', 0)
      if ((opts as dns.LookupAllOptions).all) return (cb as any)(null, addrs)
      cb(null, addrs[0].address, addrs[0].family)
    })
}

/** POST with the address check; resolves with the HTTP status. Redirects are not followed. */
function post(url: string, body: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const u = new URL(url)
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (net.isIP(host) && isBlocked(host) && !allowed().has(host)) return reject(new Error(`blocked address ${host}`))
    const req = (u.protocol === 'https:' ? https : http).request(u, {
      method: 'POST', headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) }, lookup: checkedLookup(host), timeout: 10_000,
    }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end(body)
  })
}

async function deliver(db: Db, payload: { hook: number; body: any }) {
  const hook = (await db.query('SELECT url, secret, format FROM webhooks WHERE id = $1', [payload.hook])).rows[0]
  if (!hook) return // deleted since: nothing to do
  const b = payload.body
  const text = b.issue ? `${b.actor?.name ?? 'taskhouse'} · ${b.event} · <${b.issue.url}|${b.issue.key}> ${b.issue.title}` : `${b.event} ${b.project ?? ''}`
  const raw = JSON.stringify(hook.format === 'chat' ? { text } : b)
  const status = await post(hook.url, raw, {
    'content-type': 'application/json', 'x-signature': `sha256=${createHmac('sha256', hook.secret).update(raw).digest('hex')}`, 'x-event': b.event,
  })
  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
}

export async function runJobs(db: Db) {
  const jobs = (await db.query(`UPDATE jobs SET run_at = now() + interval '5 minutes', attempts = attempts + 1
    WHERE id IN (SELECT id FROM jobs WHERE done_at IS NULL AND run_at <= now() ORDER BY run_at LIMIT 20 FOR UPDATE SKIP LOCKED)
    RETURNING id, kind, payload, attempts`)).rows
  await Promise.all(jobs.map(async (j) => {
    try {
      if (j.kind === 'webhook') await deliver(db, j.payload)
      await db.query('UPDATE jobs SET done_at = now(), last_error = NULL WHERE id = $1', [j.id])
    } catch (e) {
      // 1, 4, 16, 64 minutes, then give up (the error stays visible on the webhook list).
      await db.query(`UPDATE jobs SET last_error = $2, run_at = now() + make_interval(mins => $3), done_at = CASE WHEN attempts >= $4 THEN now() END WHERE id = $1`,
        [j.id, String((e as Error).message).slice(0, 500), 4 ** (j.attempts - 1), MAX_ATTEMPTS])
    }
  }))
  return jobs.length
}

/** Attachment files nothing refers to any more (deleted 30+ days ago, or an upload whose transaction failed). */
export async function pruneFiles(db: Db, filesDir: string, now = Date.now()) {
  await db.query(`DELETE FROM attachments WHERE deleted_at < now() - interval '30 days'`)
  const used = new Set((await db.query('SELECT DISTINCT sha256 FROM attachments')).rows.map((r) => r.sha256))
  let removed = 0
  for (const name of readdirSync(filesDir)) {
    const path = join(filesDir, name)
    // An hour's grace: a file is written just before its row commits.
    if (!used.has(name) && now - statSync(path).mtimeMs > 3600_000) unlinkSync(path), removed++
  }
  return removed
}

export async function prune(db: Db) {
  await db.query(`DELETE FROM jobs WHERE done_at < now() - interval '30 days'`)
  await db.query(`DELETE FROM notifications WHERE created_at < now() - interval '90 days'`)
  await db.query(`DELETE FROM sessions WHERE expires_at < now()`)
  await db.query(`DELETE FROM audit_log WHERE at < now() - make_interval(days => $1)`, [Number(process.env.AUDIT_KEEP_DAYS ?? 365)])
}

export function startJobs(db: Db, filesDir: string) {
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try { while ((await runJobs(db)) === 20); } catch (e) { console.error('jobs:', (e as Error).message) } finally { busy = false }
  }
  setInterval(tick, 2000).unref()
  setInterval(() => prune(db).then(() => pruneFiles(db, filesDir)).catch((e) => console.error('prune:', e.message)), 3600_000).unref()
}
