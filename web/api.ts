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
  statuses: Status[]; types: (Ref & { level: number })[]; sprints: Sprint[]
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

const MESSAGES: Record<string, string> = {
  bad_credentials: '이메일 또는 비밀번호가 맞지 않습니다.',
  too_many_attempts: '시도가 너무 많습니다. 15분 뒤에 다시 해 주세요.',
  sso_only: '이 서버는 SSO로만 로그인할 수 있습니다.',
  bad_setup_token: '설정 토큰이 맞지 않습니다. 서버 로그에서 확인하세요.',
  transition_not_allowed: '워크플로에서 허용하지 않는 이동입니다.',
  validation_failed: '전이 조건을 만족하지 않습니다.',
  conflict: '다른 사람이 먼저 이 값을 바꿨습니다. 최신 값을 불러왔습니다.',
  bad_hierarchy: '계층이 맞지 않습니다. 하위 작업은 표준 이슈 아래, 표준 이슈는 에픽 아래에만 둘 수 있습니다.',
  bad_field: '입력값이 올바르지 않습니다.',
  forbidden: '권한이 없습니다.',
  not_found: '찾을 수 없습니다.',
  key_taken: '이미 쓰는 프로젝트 키입니다.',
  sprint_already_active: '이미 진행 중인 스프린트가 있습니다.',
  status_in_use: '이슈가 쓰고 있는 상태는 삭제할 수 없습니다.',
  bad_query: '검색 조건이 올바르지 않습니다.',
  file_too_large: '파일이 너무 큽니다.',
  too_large: '보낸 내용이 너무 큽니다.',
  storage_full: '첨부 저장 공간이 가득 찼습니다. 관리자에게 문의하세요.',
  cross_site: '다른 사이트에서 온 요청이라 거부했습니다.',
  admin_only: '사이트 관리자만 할 수 있습니다.',
  reset_invalid: '링크가 만료되었거나 이미 사용되었습니다.',
  not_yourself: '자기 자신에게는 할 수 없습니다.',
}
export const message = (e: unknown) => {
  if (e instanceof ApiError) {
    const extra = e.data?.why ? ` (${e.data.why})` : e.data?.field ? ` (${e.data.field})` : ''
    return (MESSAGES[e.message] ?? e.message) + extra
  }
  return String((e as Error)?.message ?? e)
}

export const PRIORITIES = ['긴급', '높음', '보통', '낮음', '최저']
export const CATEGORY_NAMES = ['할 일', '진행', '완료']

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
