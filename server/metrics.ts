// Operational metrics, as in Pagehouse: request counts and timings, server errors, and counters other modules bump
// (mail and webhook deliveries). Exposed as Prometheus text at /metrics (only with METRICS_TOKEN) and as JSON for
// Admin → Monitoring. Everything here is per instance and resets on restart, as Prometheus expects.
import type { MiddlewareHandler } from 'hono'
import { monitorEventLoopDelay } from 'node:perf_hooks'

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
const MINUTES = 15

type Hist = { buckets: number[]; sum: number; count: number }
type Minute = { at: number; n: number; errors: number; slow: number }
export type ServerError = { at: string; method: string; path: string; status: number; message: string }

const loop = monitorEventLoopDelay({ resolution: 20 })
loop.enable()
const requests = new Map<string, number>() // `${method} ${route} ${status}` → count
const timings = new Map<string, Hist>() // route → histogram
const minutes: Minute[] = []
const errors: ServerError[] = []
const counters = new Map<string, number>() // `${name}{labels}` → count

/** One label set per route shape, never per id or issue key, so the number of series stays small. */
export function routeOf(path: string) {
  if (!path.startsWith('/api/')) return path === '/healthz' || path === '/metrics' ? path : 'static'
  return path.split('/').slice(0, 5).map((s) => (/^\d+$/.test(s) ? ':id' : /^[A-Z][A-Z0-9]+(-\d+)?$/.test(s) ? ':key' : s.length > 40 ? ':x' : s)).join('/')
}

function minute(now: number) {
  const at = Math.floor(now / 60_000)
  let m = minutes[minutes.length - 1]
  if (!m || m.at !== at) {
    m = { at, n: 0, errors: 0, slow: 0 }
    minutes.push(m)
    while (minutes.length && minutes[0].at <= at - MINUTES) minutes.shift()
  }
  return m
}

export function observe(method: string, path: string, status: number, seconds: number) {
  const route = routeOf(path)
  const key = `${method} ${route} ${status}`
  requests.set(key, (requests.get(key) ?? 0) + 1)
  let h = timings.get(route)
  if (!h) timings.set(route, (h = { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 }))
  BUCKETS.forEach((b, i) => seconds <= b && h!.buckets[i]++)
  h.sum += seconds
  h.count++
  const m = minute(Date.now())
  m.n++
  if (status >= 500) m.errors++
  if (seconds > 1) m.slow++
}

export function recordError(method: string, path: string, status: number, message: string) {
  errors.unshift({ at: new Date().toISOString(), method, path: routeOf(path), status, message: message.slice(0, 300) })
  errors.length = Math.min(errors.length, 30)
  inc('taskhouse_server_errors_total')
}

/** Bumps a counter, e.g. inc('taskhouse_mail_sent_total', { result: 'failed' }). */
export function inc(name: string, labels: Record<string, string> = {}) {
  const l = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')
  const key = l ? `${name}{${l}}` : name
  counters.set(key, (counters.get(key) ?? 0) + 1)
}
export const counter = (key: string) => counters.get(key) ?? 0

/** Times every request; long-lived WebSocket upgrades are left out of the timings. */
export const metricsMiddleware: MiddlewareHandler = async (c, next) => {
  const t = performance.now()
  await next()
  if (c.req.header('upgrade') === 'websocket') return
  observe(c.req.method, c.req.path, c.res.status, (performance.now() - t) / 1000)
}

export function processStats() {
  const mem = process.memoryUsage()
  return {
    uptimeSeconds: Math.round(process.uptime()),
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    loopDelayP99Ms: Math.round((loop.percentile(99) / 1e6) * 10) / 10,
  }
}

/** The last 15 minutes: requests, server errors, slow (>1 s) requests, and the latest errors. */
export function recentStats() {
  const now = Math.floor(Date.now() / 60_000)
  const live = minutes.filter((m) => m.at > now - MINUTES)
  return {
    minutes: MINUTES,
    requests: live.reduce((s, m) => s + m.n, 0),
    serverErrors: live.reduce((s, m) => s + m.errors, 0),
    slow: live.reduce((s, m) => s + m.slow, 0),
    errors: errors.slice(0, 10),
  }
}

/** Prometheus text format. `gauges` are read fresh for each scrape by the caller. */
export function prometheus(gauges: [name: string, help: string, value: number, labels?: Record<string, string>][]) {
  const out: string[] = []
  const seen = new Set<string>()
  const head = (name: string, help: string, type: string) => {
    if (seen.has(name)) return
    seen.add(name)
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`)
  }
  const lbl = (l?: Record<string, string>) => (l && Object.keys(l).length ? `{${Object.entries(l).map(([k, v]) => `${k}="${String(v).replace(/["\\\n]/g, '_')}"`).join(',')}}` : '')

  head('taskhouse_http_requests_total', 'HTTP requests by method, route and status.', 'counter')
  for (const [k, n] of requests) {
    const [method, route, status] = k.split(' ')
    out.push(`taskhouse_http_requests_total${lbl({ method, route, status })} ${n}`)
  }
  head('taskhouse_http_request_duration_seconds', 'HTTP request duration by route.', 'histogram')
  for (const [route, h] of timings) {
    BUCKETS.forEach((b, i) => out.push(`taskhouse_http_request_duration_seconds_bucket${lbl({ route, le: String(b) })} ${h.buckets[i]}`))
    out.push(`taskhouse_http_request_duration_seconds_bucket${lbl({ route, le: '+Inf' })} ${h.count}`)
    out.push(`taskhouse_http_request_duration_seconds_sum${lbl({ route })} ${h.sum.toFixed(6)}`)
    out.push(`taskhouse_http_request_duration_seconds_count${lbl({ route })} ${h.count}`)
  }
  const COUNTERS: Record<string, string> = {
    taskhouse_server_errors_total: 'Requests that failed with an unexpected server error.',
    taskhouse_mail_sent_total: 'Notification digest emails by result.',
    taskhouse_webhook_deliveries_total: 'Webhook deliveries by result.',
  }
  for (const name of Object.keys(COUNTERS)) {
    head(name, COUNTERS[name], 'counter')
    const mine = [...counters].filter(([k]) => k === name || k.startsWith(`${name}{`))
    if (!mine.length) out.push(`${name} 0`)
    for (const [k, n] of mine) out.push(`${k} ${n}`)
  }
  const p = processStats()
  for (const [name, help, value, labels] of [
    ['taskhouse_process_uptime_seconds', 'Seconds since this instance started.', p.uptimeSeconds],
    ['taskhouse_process_resident_memory_bytes', 'Resident memory of this instance.', p.rssBytes],
    ['taskhouse_process_heap_used_bytes', 'JavaScript heap in use.', p.heapUsedBytes],
    ['taskhouse_event_loop_delay_p99_seconds', 'Event loop delay, 99th percentile.', p.loopDelayP99Ms / 1000],
    ...gauges,
  ] as [string, string, number, Record<string, string> | undefined][]) {
    head(name, help, 'gauge')
    out.push(`${name}${lbl(labels)} ${Number.isFinite(value) ? value : 0}`)
  }
  return out.join('\n') + '\n'
}
