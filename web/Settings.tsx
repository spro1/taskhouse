import { useEffect, useState } from 'react'
import { api, CATEGORY_NAMES, message, type Project, type Ref, type Status } from './api.ts'
import { toast, type Me } from './App.tsx'

const ROLE_NAMES: Record<string, string> = { viewer: '열람자', reporter: '보고자', member: '멤버', admin: '관리자' }

export function Settings({ project, reload, me }: { project: Project; reload: () => void; me: Me }) {
  const act = (p: Promise<unknown>, ok = '저장했습니다.') => p.then(() => { toast(ok); reload() }, (e) => toast(message(e)))
  return (
    <div className="settings">
      <section>
        <h3>공개 범위</h3>
        <select value={project.visibility} onChange={(e) => act(api('PATCH', `/api/projects/${project.key}`, { visibility: e.target.value }))}>
          <option value="private">비공개 (역할이 있는 사람만)</option>
          <option value="view">모두 보기 (로그인한 모두가 열람)</option>
          <option value="edit">모두 편집 (로그인한 모두가 멤버)</option>
        </select>
      </section>
      {/* Keyed by the saved data, so after a save the editors start again from what the server has (with real ids). */}
      <Roles key={JSON.stringify(project.roles)} project={project} act={act} me={me} />
      <Workflow key={JSON.stringify([project.statuses, (project as any).transitions])} project={project} act={act} />
      {me.isAdmin && <Webhooks project={project} />}
      <section>
        <h3>내보내기</h3>
        <p className="muted">이슈, 설명, 댓글, 링크, 변경 이력, 스프린트를 담습니다. 첨부 파일 자체는 백업에 들어 있습니다.</p>
        <div className="inline">
          <a className="button" href={`/api/projects/${project.key}/export?format=json`} download>JSON (전체)</a>
          <a className="button" href={`/api/projects/${project.key}/export?format=csv`} download>CSV (이슈 목록)</a>
        </div>
      </section>
    </div>
  )
}

function Roles({ project, act, me }: { project: Project; act: (p: Promise<unknown>) => void; me: Me }) {
  const [rows, setRows] = useState(project.roles.map((r) => ({ user: r.user, group: r.group, role: r.role })))
  const [users, setUsers] = useState<Ref[]>([])
  const [groups, setGroups] = useState<Ref[]>([])
  const [pick, setPick] = useState('')
  useEffect(() => { api('GET', '/api/users').then(setUsers); api('GET', '/api/groups').then(setGroups) }, [])
  const add = () => {
    const [kind, id] = pick.split(':')
    const ref = (kind === 'u' ? users : groups).find((x) => x.id === Number(id))
    if (ref) setRows([...rows, { user: kind === 'u' ? ref : null, group: kind === 'g' ? ref : null, role: 'member' }])
    setPick('')
  }
  return (
    <section>
      <h3>역할</h3>
      <ul className="list">
        {rows.map((r, i) => (
          <li key={i}>
            {r.user ? r.user.name : `그룹 ${r.group!.name}`}
            <span className="grow" />
            <select value={r.role} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}>
              {Object.entries(ROLE_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button className="ghost" disabled={r.user?.id === me.id} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
          </li>
        ))}
      </ul>
      <div className="inline">
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">사람 또는 그룹 추가…</option>
          {users.map((u) => <option key={`u${u.id}`} value={`u:${u.id}`}>{u.name}</option>)}
          {groups.map((g) => <option key={`g${g.id}`} value={`g:${g.id}`}>그룹: {g.name}</option>)}
        </select>
        <button onClick={add} disabled={!pick}>추가</button>
        <button className="primary" onClick={() => act(api('PUT', `/api/projects/${project.key}/roles`, { roles: rows.map((r) => ({ user: r.user?.id, group: r.group?.id, role: r.role })) }))}>역할 저장</button>
      </div>
    </section>
  )
}

type Row = { key: string; id?: number; name: string; category: 0 | 1 | 2 }
type Rules = { conditions?: { kind: string; level?: number }[]; validators?: { kind: string; fields?: string[] }[]; post?: { kind: string; field: string; value: string }[] }
type Move = { name: string; from: string | null; to: string; rules: Rules }
// The rule kinds the server knows (server/issues.ts), as checkboxes.
const CHECKS: { label: string; group: keyof Rules; has: (r: Rules) => boolean; toggle: (r: Rules, on: boolean) => Rules }[] = [
  ...([['담당자만', 'is_assignee'], ['보고자만', 'is_reporter']] as const).map(([label, kind]) => ({
    label, group: 'conditions' as const, has: (r: Rules) => !!r.conditions?.some((c) => c.kind === kind),
    toggle: (r: Rules, on: boolean) => ({ ...r, conditions: [...(r.conditions ?? []).filter((c) => c.kind !== kind), ...(on ? [{ kind }] : [])] }),
  })),
  { label: '프로젝트 관리자만', group: 'conditions', has: (r) => !!r.conditions?.some((c) => c.kind === 'has_role'),
    toggle: (r, on) => ({ ...r, conditions: [...(r.conditions ?? []).filter((c) => c.kind !== 'has_role'), ...(on ? [{ kind: 'has_role', level: 4 }] : [])] }) },
  ...([['포인트 필수', 'points'], ['담당자 필수', 'assignee'], ['기한 필수', 'due']] as const).map(([label, field]) => ({
    label, group: 'validators' as const, has: (r: Rules) => !!r.validators?.some((v) => v.kind === 'required' && v.fields?.includes(field)),
    toggle: (r: Rules, on: boolean) => {
      const fields = [...new Set([...(r.validators?.find((v) => v.kind === 'required')?.fields ?? []).filter((f) => f !== field), ...(on ? [field] : [])])]
      return { ...r, validators: [...(r.validators ?? []).filter((v) => v.kind !== 'required'), ...(fields.length ? [{ kind: 'required', fields }] : [])] }
    },
  })),
  ...([['하위 작업 모두 완료', 'subtasks_done'], ['차단 이슈 없음', 'no_blockers']] as const).map(([label, kind]) => ({
    label, group: 'validators' as const, has: (r: Rules) => !!r.validators?.some((v) => v.kind === kind),
    toggle: (r: Rules, on: boolean) => ({ ...r, validators: [...(r.validators ?? []).filter((v) => v.kind !== kind), ...(on ? [{ kind }] : [])] }),
  })),
  ...([['보고자에게 할당', '$reporter'], ['나에게 할당', '$me'], ['담당자 비우기', '$none']] as const).map(([label, value]) => ({
    label, group: 'post' as const, has: (r: Rules) => !!r.post?.some((p) => p.field === 'assignee' && p.value === value),
    toggle: (r: Rules, on: boolean) => ({ ...r, post: [...(r.post ?? []).filter((p) => p.field !== 'assignee'), ...(on ? [{ kind: 'set', field: 'assignee', value }] : [])] }),
  })),
]
const GROUP_NAMES = { conditions: '누가', validators: '조건', post: '이동 후' }

// Transitions refer to statuses by row key while editing, so renaming a status keeps its transitions.
function Workflow({ project, act }: { project: Project; act: (p: Promise<unknown>) => void }) {
  const [rows, setRows] = useState<Row[]>(project.statuses.map((s) => ({ ...s, key: String(s.id) })))
  const keyOf = (name: string | null) => (name == null ? null : String(project.statuses.find((s) => s.name === name)?.id ?? ''))
  const [moves, setMoves] = useState<Move[]>(((project as any).transitions ?? []).map((t: any) => ({ ...t, from: keyOf(t.from), to: keyOf(t.to)! })))
  const set = (i: number, v: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...v } : r)))
  const up = (i: number) => i > 0 && setRows([...rows.slice(0, i - 1), rows[i], rows[i - 1], ...rows.slice(i + 1)])
  const drop = (i: number) => {
    setMoves(moves.filter((m) => m.from !== rows[i].key && m.to !== rows[i].key))
    setRows(rows.filter((_, j) => j !== i))
  }
  const setMove = (i: number, v: Partial<Move>) => setMoves(moves.map((m, j) => (j === i ? { ...m, ...v } : m)))
  const nameOf = (key: string | null) => (key == null ? null : rows.find((r) => r.key === key)?.name ?? '')
  const save = () => act(api('PUT', `/api/projects/${project.key}/workflow`, {
    statuses: rows.map(({ id, name, category }) => ({ id, name, category })),
    transitions: moves.map((m) => ({ name: m.name || nameOf(m.to), from: nameOf(m.from), to: nameOf(m.to), rules: m.rules })),
  }))
  return (
    <section>
      <h3>상태</h3>
      <p className="muted">보드의 열 순서입니다. 차트와 스프린트 완료 판정은 이름이 아니라 범주를 봅니다.</p>
      <ul className="list">
        {rows.map((r, i) => (
          <li key={r.key}>
            <input value={r.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="상태 이름" />
            <select value={r.category} onChange={(e) => set(i, { category: Number(e.target.value) as 0 | 1 | 2 })} aria-label="범주">
              {CATEGORY_NAMES.map((n, c) => <option key={c} value={c}>{n}</option>)}
            </select>
            <button className="ghost" onClick={() => up(i)} aria-label="위로">↑</button>
            <button className="ghost" onClick={() => drop(i)} aria-label="삭제">×</button>
          </li>
        ))}
      </ul>
      <button onClick={() => setRows([...rows, { key: `n${Date.now()}`, name: '', category: 1 }])}>상태 추가</button>

      <h3 style={{ marginTop: 20 }}>전이 규칙</h3>
      <p className="muted">{moves.length ? '아래에 적은 이동만 허용합니다.' : '규칙이 없으면 어느 상태로든 이동할 수 있습니다. 규칙을 하나라도 추가하면 적은 이동만 허용합니다.'}</p>
      {moves.map((m, i) => (
        <div key={i} className="move">
          <div className="inline">
            <input placeholder="이름 (비우면 도착 상태 이름)" value={m.name} onChange={(e) => setMove(i, { name: e.target.value })} />
            <select value={m.from ?? ''} onChange={(e) => setMove(i, { from: e.target.value || null })} aria-label="출발 상태">
              <option value="">어느 상태에서든</option>
              {rows.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </select>
            →
            <select value={m.to} onChange={(e) => setMove(i, { to: e.target.value })} aria-label="도착 상태">
              {rows.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </select>
            <button className="ghost" onClick={() => setMoves(moves.filter((_, j) => j !== i))} aria-label="전이 삭제">×</button>
          </div>
          {(Object.keys(GROUP_NAMES) as (keyof Rules)[]).map((g) => (
            <div key={g} className="checks">
              <span className="muted">{GROUP_NAMES[g]}</span>
              {CHECKS.filter((c) => c.group === g).map((c) => (
                <label key={c.label} className="check">
                  <input type="checkbox" checked={c.has(m.rules)} onChange={(e) => setMove(i, { rules: c.toggle(m.rules, e.target.checked) })} />{c.label}
                </label>
              ))}
            </div>
          ))}
        </div>
      ))}
      <div className="inline">
        <button onClick={() => setMoves([...moves, { name: '', from: null, to: rows[0].key, rules: {} }])}>전이 추가</button>
        <button className="primary" onClick={save}>워크플로 저장</button>
      </div>
    </section>
  )
}

function Webhooks({ project }: { project: Project }) {
  const [list, setList] = useState<any[]>([])
  const [url, setUrl] = useState('')
  const [format, setFormat] = useState('chat')
  const load = () => api('GET', `/api/projects/${project.key}/webhooks`).then(setList)
  useEffect(() => { load() }, [])
  return (
    <section>
      <h3>웹훅과 메신저</h3>
      <ul className="list">
        {list.map((w) => (
          <li key={w.id}>
            {w.url} <span className="muted">{w.format === 'chat' ? '메신저' : 'JSON'}</span>
            {w.last && <span className={`pill ${w.last.error ? 'c3' : 'c2'}`}>{w.last.error ? `실패: ${w.last.error}` : '정상'}</span>}
            <button className="ghost" onClick={() => api('DELETE', `/api/projects/${project.key}/webhooks/${w.id}`).then(load)}>×</button>
          </li>
        ))}
      </ul>
      <form className="inline" onSubmit={(e) => {
        e.preventDefault()
        api('POST', `/api/projects/${project.key}/webhooks`, { url, format }).then((r) => { setUrl(''); load(); if (format === 'json') prompt('서명 비밀값 (한 번만 표시됩니다)', r.secret) }, (x) => toast(message(x)))
      }}>
        <select value={format} onChange={(e) => setFormat(e.target.value)}><option value="chat">Slack·Mattermost·Teams</option><option value="json">JSON (서명)</option></select>
        <input type="url" required placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button>추가</button>
      </form>
    </section>
  )
}

export function MySettings({ me }: { me: Me }) {
  const [mine, setMine] = useState<{ emailNotify: boolean; mail: boolean; hasPassword: boolean }>()
  useEffect(() => { api('GET', '/api/me').then(setMine) }, [])
  return (
    <div className="settings">
      <h1>내 설정 <span className="muted">{me.email}</span></h1>
      <section>
        <h3>알림 메일</h3>
        {mine && !mine.mail && <p className="muted">이 서버에는 메일 발송(SMTP)이 설정되어 있지 않습니다.</p>}
        {mine && (
          <label className="check">
            <input type="checkbox" checked={mine.emailNotify} onChange={(e) => api('PATCH', '/api/me', { emailNotify: e.target.checked }).then(() => setMine({ ...mine, emailNotify: e.target.checked }))} />
            읽지 않은 알림을 메일로 묶어 받기 (마지막 알림 후 5분, 최대 30분 뒤)
          </label>
        )}
      </section>
      <Password hasPassword={!!mine?.hasPassword} />
      <Tokens />
    </div>
  )
}

function Password({ hasPassword }: { hasPassword: boolean }) {
  const [f, setF] = useState({ current: '', password: '', again: '' })
  return (
    <section>
      <h3>비밀번호</h3>
      <form className="inline" onSubmit={(e) => {
        e.preventDefault()
        if (f.password !== f.again) return toast('새 비밀번호가 서로 다릅니다.')
        api('POST', '/api/me/password', { current: f.current, password: f.password }).then(() => { toast('비밀번호를 바꿨습니다. 다른 기기의 로그인은 끊겼습니다.'); setF({ current: '', password: '', again: '' }) }, (x) => toast(message(x)))
      }}>
        {hasPassword && <input type="password" required placeholder="현재 비밀번호" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />}
        <input type="password" required minLength={8} placeholder="새 비밀번호 (8자 이상)" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <input type="password" required minLength={8} placeholder="새 비밀번호 확인" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} />
        <button>{hasPassword ? '바꾸기' : '설정하기'}</button>
      </form>
    </section>
  )
}

function Tokens() {
  const [list, setList] = useState<any[]>([])
  const [name, setName] = useState('')
  const [shown, setShown] = useState('')
  const load = () => api('GET', '/api/me/tokens').then(setList)
  useEffect(() => { load() }, [])
  return (
    <section>
      <h3>내 API 토큰</h3>
      <p className="muted">스크립트와 AI 에이전트가 내 권한으로 API를 씁니다. 90일 뒤 만료됩니다.</p>
      {shown && <p className="token">새 토큰 (지금만 보입니다): <code>{shown}</code></p>}
      <ul className="list">
        {list.map((t) => <li key={t.id}>{t.name} <span className="muted">{new Date(t.expiresAt).toLocaleDateString()} 만료</span><button className="ghost" onClick={() => api('DELETE', `/api/me/tokens/${t.id}`).then(load)}>폐기</button></li>)}
      </ul>
      <form className="inline" onSubmit={(e) => { e.preventDefault(); api('POST', '/api/me/tokens', { name }).then((r) => { setShown(r.token); setName(''); load() }) }}>
        <input required placeholder="토큰 이름" value={name} onChange={(e) => setName(e.target.value)} />
        <button>만들기</button>
      </form>
    </section>
  )
}
