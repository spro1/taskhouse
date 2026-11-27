import { hasKey, t, type Key } from './i18n.ts'
// Thin client for the REST API. Errors carry the server's code so screens can show a Korean message.
export type Ref = { id: number; name: string }
export type Status = { id: number; name: string; category: 0 | 1 | 2 }
export type Issue = {
  id: number; key: string; title: string; doc?: any; priority: number; points: number | null; due: string | null; labels: string[]
  rank: string; lockVersion: number; createdAt: string; updatedAt: string; resolvedAt: string | null
  type: Ref & { level: number }; status: Status; assignee: Ref | null; reporter: Ref; parent: string | null
  sprint: (Ref & { state: string }) | null
}
export type Sprint = { id: number; name: string; goal: string; state: 'planned' | 'active' | 'closed'; endsAt: string | null }
export type Project = {
  id: number; key: string; name: string; visibility: 'edit' | 'view' | 'private'; role: string; level: number
  statuses: (Status & { onBoard: boolean })[]; types: (Ref & { level: number })[]; sprints: Sprint[]
  roles: { role: string; user: Ref | null; group: Ref | null }[]
}

export class ApiError extends Error {
  status: number
  data: any
  constructor(status: number, data: any) {
    super(data?.error ?? `HTTP ${status}`)
    this.status = status
    this.data = data
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData
  const r = await fetch(path, {
    method,
    headers: body && !isForm ? { 'content-type': 'application/json' } : {},
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : null
  if (!r.ok) throw new ApiError(r.status, data)
  return data
}

/** Every page of a search (boards and backlogs show whole lists). */
export async function searchAll(query: unknown, sort: string | string[] = 'rank asc') {
  const out: Issue[] = []
  let cursor: string | null = '0'
  while (cursor !== null && out.length < 2000) {
    const r: { issues: Issue[]; next: string | null } = await api('POST', '/api/search', { query, sort, cursor, limit: 200 })
    out.push(...r.issues)
    cursor = r.next
  }
  return out
}

export const message = (e: unknown) => {
  if (e instanceof ApiError) {
    const extra = e.data?.why ? ` (${e.data.why})` : e.data?.field ? ` (${e.data.field})` : ''
    return (hasKey(`err.${e.message}`) ? t(`err.${e.message}` as Key) : e.message) + extra
  }
  return String((e as Error)?.message ?? e)
}

export const PRIORITIES = [t('priority.0'), t('priority.1'), t('priority.2'), t('priority.3'), t('priority.4')]
export const CATEGORY_NAMES = [t('category.0'), t('category.1'), t('category.2')]

/**
 * Live updates for one project: calls onChange with the changed issue ids, or null when changes may have been missed
 * (after a reconnect), in which case reload everything. Reconnects with backoff. Returns a function that stops it.
 */
export function subscribe(project: string, onChange: (ids: number[] | null) => void) {
  let ws: WebSocket | null = null
  let stopped = false
  let delay = 1000
  let timer: ReturnType<typeof setTimeout>
  const connect = (resync: boolean) => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live?project=${encodeURIComponent(project)}`)
    ws.onopen = () => { delay = 1000; if (resync) onChange(null) }
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data)
      onChange(d.resync ? null : d.issues)
    }
    ws.onclose = (e) => {
      // 4404: no access to the project; 401 shows up as a plain close before open. Don't hammer either.
      if (stopped || e.code === 4404) return
      timer = setTimeout(() => connect(true), delay)
      delay = Math.min(delay * 2, 30_000)
    }
  }
  connect(false)
  return () => { stopped = true; clearTimeout(timer); ws?.close() }
}
