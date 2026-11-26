import { lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, ApiError, message, type Issue, type Project } from './api.ts'
import { Board, Backlog } from './Board.tsx'
// The issue screen carries the rich-text editor; it loads when first opened.
const IssueView = lazy(() => import('./Issue.tsx').then((m) => ({ default: m.IssueView })))
import { MySettings, Settings } from './Settings.tsx'
import { Search } from './Search.tsx'
import { Admin } from './Admin.tsx'

export type Me = { id: number; name: string; email: string; isAdmin: boolean }

export const nav = (to: string) => {
  history.pushState(null, '', to)
  dispatchEvent(new PopStateEvent('popstate'))
}
export const Link = ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
  <a href={to} className={className} onClick={(e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); nav(to) } }}>{children}</a>
)
function usePath() {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const f = () => setPath(location.pathname)
    addEventListener('popstate', f)
    return () => removeEventListener('popstate', f)
  }, [])
  return path
}

// One line at the bottom for errors and confirmations.
let showToast: (s: string) => void = () => {}
export const toast = (s: string) => showToast(s)
function Toast() {
  const [text, setText] = useState('')
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    showToast = (s) => { setText(s); clearTimeout(t); t = setTimeout(() => setText(''), 4000) }
  }, [])
  return text ? <div className="toast" role="status">{text}</div> : null
}

export function App() {
  const path = usePath()
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const load = () => api<Me>('GET', '/api/me').then(setMe, () => setMe(null))
  useEffect(() => { load() }, [])
  const invite = path.match(/^\/invite\/([\w-]+)$/)?.[1]
  if (invite) return <><Invite token={invite} onDone={() => { load(); nav('/') }} /><Toast /></>
  const reset = path.match(/^\/reset\/([\w-]+)$/)?.[1]
  if (reset) return <><Invite token={reset} reset onDone={() => { load(); nav('/') }} /><Toast /></>
  if (me === undefined) return null
  if (me === null) return <><SignIn onDone={load} /><Toast /></>
  return <><Shell me={me} path={path} /><Toast /></>
}

const SSO_ERRORS: Record<string, string> = {
  unavailable: 'SSO 서버에 연결할 수 없습니다. 잠시 뒤에 다시 시도하거나 관리자에게 알려 주세요.',
  account_disabled: '비활성화된 계정입니다. 관리자에게 문의하세요.',
  email_taken: '같은 이메일의 계정이 이미 있는데, SSO에서 이메일이 확인되지 않아 연결하지 않았습니다. 관리자에게 문의하세요.',
  no_email: 'SSO 계정에 이메일이 없어 계정을 만들 수 없습니다.',
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<{ setupRequired: boolean; passwordLogin: boolean; sso: { label: string } | null }>()
  const [f, setF] = useState({ email: '', password: '', name: '', token: '' })
  const ssoError = new URLSearchParams(location.search).get('sso_error')
  const [err, setErr] = useState(ssoError ? SSO_ERRORS[ssoError] ?? 'SSO 로그인에 실패했습니다. 다시 시도해 주세요.' : '')
  // SSO-only servers hide the password form; admins with a password can still open it (IdP outage).
  const [breakGlass, setBreakGlass] = useState(false)
  useEffect(() => { api('GET', '/api/auth/state').then(setState) }, [])
  if (!state) return null
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api('POST', state.setupRequired ? '/api/auth/setup' : '/api/auth/login', f)
      onDone()
    } catch (x) { setErr(message(x)) }
  }
  const field = (k: keyof typeof f, label: string, type = 'text') => (
    <label>{label}<input type={type} value={f[k]} required onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  )
  return (
    <main className="auth">
      <form onSubmit={submit} className="card">
        <h1>Taskhouse</h1>
        {state.setupRequired && <p className="muted">처음 실행입니다. 서버 로그에 나온 설정 토큰으로 관리자 계정을 만드세요.</p>}
        {state.setupRequired && field('token', '설정 토큰')}
        {state.setupRequired && field('name', '이름')}
        {(state.setupRequired || state.passwordLogin || breakGlass) && <>{field('email', '이메일', 'email')}{field('password', '비밀번호 (8자 이상)', 'password')}</>}
        {err && <p className="error" role="alert">{err}</p>}
        {(state.setupRequired || state.passwordLogin || breakGlass) && <button className="primary">{state.setupRequired ? '관리자 계정 만들기' : '로그인'}</button>}
        {!state.setupRequired && state.sso && <a className="button" href="/api/auth/oidc/start">{state.sso.label}로 로그인</a>}
        {!state.setupRequired && !state.passwordLogin && !breakGlass && (
          <button type="button" className="link" onClick={() => setBreakGlass(true)}>관리자 비상 로그인 (SSO 장애 시)</button>
        )}
      </form>
    </main>
  )
}

// An invite link (new account) or, with `reset`, a password reset link: both set a password and sign in.
function Invite({ token, onDone, reset = false }: { token: string; onDone: () => void; reset?: boolean }) {
  const [email, setEmail] = useState<string | null>(null)
  const [f, setF] = useState({ name: '', password: '' })
  const path = `/api/auth/${reset ? 'reset' : 'invite'}/${token}`
  useEffect(() => { api('GET', path).then((r) => setEmail(r.email), () => setEmail('')) }, [token])
  if (email === null) return null
  if (!email) return <main className="auth"><div className="card"><p>링크가 만료되었거나 이미 사용되었습니다. 관리자에게 새 링크를 요청하세요.</p></div></main>
  return (
    <main className="auth">
      <form className="card" onSubmit={(e) => { e.preventDefault(); api('POST', path, reset ? { password: f.password } : f).then(onDone, (x) => toast(message(x))) }}>
        <h1>{email}</h1>
        {reset ? <p className="muted">새 비밀번호를 정하세요. 다른 기기의 로그인은 끊깁니다.</p>
          : <label>이름<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>}
        <label>비밀번호 (8자 이상)<input type="password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        <button className="primary">{reset ? '비밀번호 바꾸기' : '계정 만들기'}</button>
      </form>
    </main>
  )
}

function Shell({ me, path }: { me: Me; path: string }) {
  const [quick, setQuick] = useState(false)
  const [unread, setUnread] = useState(0)
  const [showNotes, setShowNotes] = useState(false)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setQuick(true) } }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [])
  // shortcut: the unread count polls every 30 s (live updates are per project); a per-user channel would make it instant.
  useEffect(() => {
    const f = () => api<any[]>('GET', '/api/notifications?unread=1').then((n) => setUnread(n.length), () => {})
    f()
    const t = setInterval(f, 30_000)
    return () => clearInterval(t)
  }, [path])
  const m = path.match(/^\/p\/([A-Z0-9]+)(?:\/(\w+))?/)
  const browse = path.match(/^\/browse\/([A-Z0-9]+-\d+)$/)?.[1]
  return (
    <>
      <header className="top">
        <Link to="/" className="brand">Taskhouse</Link>
        <button className="search" onClick={() => setQuick(true)}>검색 또는 이슈 키 <kbd>⌘K</kbd></button>
        <Link to="/search" className="ghost">고급 검색</Link>
        <span className="grow" />
        <button className="ghost" onClick={() => setShowNotes(!showNotes)}>알림{unread ? <span className="badge">{unread}</span> : null}</button>
        {me.isAdmin && <Link to="/admin" className="ghost">관리</Link>}
        <Link to="/me" className="muted">{me.name}</Link>
        <button className="ghost" onClick={() => api('POST', '/api/auth/logout').then((r) => location.assign(r.redirect ?? '/'))}>로그아웃</button>
      </header>
      {showNotes && <Notifications onClose={() => { setShowNotes(false); setUnread(0) }} />}
      {quick && <QuickSearch onClose={() => setQuick(false)} />}
      <main className="page">
        <Suspense fallback={null}>
        {path === '/me' ? <MySettings me={me} /> : path === '/admin' ? <Admin me={me} /> : path === '/search' ? <Search /> : browse ? <IssueView issueKey={browse} me={me} /> : m ? <ProjectPage pkey={m[1]} tab={m[2] ?? 'board'} me={me} /> : <Home me={me} />}
        </Suspense>
      </main>
    </>
  )
}

function Home({ me }: { me: Me }) {
  const [projects, setProjects] = useState<Project[]>()
  const [mine, setMine] = useState<Issue[]>([])
  const [f, setF] = useState({ key: '', name: '', visibility: 'private' })
  const load = () => {
    api<Project[]>('GET', '/api/projects').then(setProjects)
    api('POST', '/api/search', { query: { and: [{ field: 'assignee', value: 'me' }, { field: 'statusCategory', op: '!=', value: 'done' }] }, sort: ['priority asc', 'updated desc'] })
      .then((r) => setMine(r.issues))
  }
  useEffect(load, [])
  const create = (e: FormEvent) => {
    e.preventDefault()
    api('POST', '/api/projects', f).then(() => { nav(`/p/${f.key.toUpperCase()}`) }, (x) => toast(message(x)))
  }
  return (
    <div className="home">
      <section>
        <h2>프로젝트</h2>
        <ul className="list">
          {projects?.map((p) => <li key={p.id}><Link to={`/p/${p.key}`}><b>{p.key}</b> {p.name}</Link> <span className="muted">{p.role}</span></li>)}
          {projects?.length === 0 && <li className="muted">아직 프로젝트가 없습니다.</li>}
        </ul>
        <form className="inline" onSubmit={create}>
          <input placeholder="키 (예: DEMO)" required pattern="[A-Za-z][A-Za-z0-9]{1,9}" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase() })} />
          <input placeholder="이름" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <select value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value })}>
            <option value="private">비공개</option><option value="view">모두 보기</option><option value="edit">모두 편집</option>
          </select>
          <button className="primary">새 프로젝트</button>
        </form>
      </section>
      <section>
        <h2>{me.name}님의 미완료 이슈</h2>
        <IssueList issues={mine} />
      </section>
    </div>
  )
}

export function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return <p className="muted">없습니다.</p>
  return (
    <ul className="list">
      {issues.map((i) => (
        <li key={i.id}>
          <Link to={`/browse/${i.key}`}><span className="key">{i.key}</span> {i.title}</Link>
          <span className={`pill c${i.status.category}`}>{i.status.name}</span>
        </li>
      ))}
    </ul>
  )
}

function ProjectPage({ pkey, tab, me }: { pkey: string; tab: string; me: Me }) {
  const [project, setProject] = useState<Project | null>()
  const load = () => api<Project>('GET', `/api/projects/${pkey}`).then(setProject, (e) => setProject(e instanceof ApiError && e.status === 404 ? null : undefined))
  useEffect(() => { load() }, [pkey])
  if (project === null) return <p>프로젝트를 찾을 수 없습니다.</p>
  if (!project) return null
  return (
    <>
      <nav className="tabs">
        <h1>{project.name} <span className="muted">{project.key}</span></h1>
        <Link to={`/p/${pkey}`} className={tab === 'board' ? 'on' : ''}>보드</Link>
        <Link to={`/p/${pkey}/backlog`} className={tab === 'backlog' ? 'on' : ''}>백로그</Link>
        {project.level >= 4 && <Link to={`/p/${pkey}/settings`} className={tab === 'settings' ? 'on' : ''}>설정</Link>}
      </nav>
      {tab === 'backlog' ? <Backlog project={project} reload={load} /> : tab === 'settings' ? <Settings project={project} reload={load} me={me} /> : <Board project={project} />}
    </>
  )
}

function QuickSearch({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Issue[]>([])
  useEffect(() => {
    if (!q.trim()) return setHits([])
    const t = setTimeout(() => api('GET', `/api/quick?q=${encodeURIComponent(q)}`).then((r) => setHits(r.issues)), 150)
    return () => clearTimeout(t)
  }, [q])
  const go = (key: string) => { onClose(); nav(`/browse/${key}`) }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="quick" onClick={(e) => e.stopPropagation()}>
        <input autoFocus placeholder="이슈 키(DEMO-12) 또는 제목·본문" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && hits[0]) go(hits[0].key) }} />
        <ul className="list">
          {hits.map((i) => <li key={i.id}><a href={`/browse/${i.key}`} onClick={(e) => { e.preventDefault(); go(i.key) }}><span className="key">{i.key}</span> {i.title}</a><span className={`pill c${i.status.category}`}>{i.status.name}</span></li>)}
        </ul>
      </div>
    </div>
  )
}

const NOTE_TEXT: Record<string, string> = { created: '이슈를 만들었습니다', updated: '이슈를 바꿨습니다', transitioned: '상태를 바꿨습니다', commented: '댓글을 남겼습니다' }
function Notifications({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<any[]>([])
  useEffect(() => { api<any[]>('GET', '/api/notifications').then(setList); api('POST', '/api/notifications/read', {}) }, [])
  return (
    <div className="overlay" onClick={onClose}>
      <div className="notes" onClick={(e) => e.stopPropagation()}>
        {!list.length && <p className="muted">알림이 없습니다.</p>}
        {list.map((n) => (
          <a key={n.id} href={`/browse/${n.data.key}`} className={n.readAt ? '' : 'unread'} onClick={(e) => { e.preventDefault(); onClose(); nav(`/browse/${n.data.key}`) }}>
            <b>{n.actor?.name ?? '시스템'}</b>님이 <span className="key">{n.data.key}</span> {NOTE_TEXT[n.kind] ?? n.kind}
            <div className="muted">{n.data.title}{n.data.text ? ` — ${n.data.text}` : ''}</div>
          </a>
        ))}
      </div>
    </div>
  )
}
