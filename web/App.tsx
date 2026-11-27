import { lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, ApiError, message, type Issue, type Project } from './api.ts'
import { lang, LANGS, setLang, t, type Key, type Lang } from './i18n.ts'
import { Board, Backlog } from './Board.tsx'
// The issue screen carries the rich-text editor; it loads when first opened.
const IssueView = lazy(() => import('./Issue.tsx').then((m) => ({ default: m.IssueView })))
import { MySettings, Settings } from './Settings.tsx'
import { Search } from './Search.tsx'
import { Admin } from './Admin.tsx'

export type Me = { id: number; name: string; email: string; isAdmin: boolean; locale: Lang | null; mustChangePassword: boolean; pagehouseUrl: string | null }

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
  const load = () => api<Me>('GET', '/api/me').then((m) => {
    // The account's language follows it to every device (switching reloads the app).
    if (m.locale && m.locale !== lang) return setLang(m.locale)
    setMe(m)
  }, () => setMe(null))
  useEffect(() => { load() }, [])
  const invite = path.match(/^\/invite\/([\w-]+)$/)?.[1]
  if (invite) return <><Invite token={invite} onDone={() => { load(); nav('/') }} /><Toast /></>
  const reset = path.match(/^\/reset\/([\w-]+)$/)?.[1]
  if (reset) return <><Invite token={reset} reset onDone={() => { load(); nav('/') }} /><Toast /></>
  if (me === undefined) return null
  if (me === null) return <><SignIn onDone={load} /><Toast /></>
  if (me.mustChangePassword) return <><MustChangePassword me={me} onDone={load} /><Toast /></>
  return <><Shell me={me} path={path} /><Toast /></>
}

const SSO_ERRORS: Record<string, Key> = {
  unavailable: 'sso.err.unavailable', account_disabled: 'sso.err.account_disabled', email_taken: 'sso.err.email_taken', no_email: 'sso.err.no_email',
  no_account: 'sso.err.no_account',
}

function LangPicker() {
  return (
    <select className="lang" aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
      {Object.entries(LANGS).map(([code, l]) => <option key={code} value={code}>{l.label}</option>)}
    </select>
  )
}

// Signed in with a temporary password from an admin: choose your own before anything else.
function MustChangePassword({ me, onDone }: { me: Me; onDone: () => void }) {
  const [f, setF] = useState({ current: '', password: '' })
  return (
    <main className="auth">
      <form className="card" onSubmit={(e) => { e.preventDefault(); api('POST', '/api/me/password', f).then(onDone, (x) => toast(message(x))) }}>
        <h1>{t('temp.title')}</h1>
        <p className="muted">{t('temp.sub', { name: me.name })}</p>
        <label>{t('temp.current')}<input type="password" required autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></label>
        <label>{t('auth.newPassword')}<input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        <button className="primary">{t('auth.setPassword')}</button>
      </form>
    </main>
  )
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<{ setupRequired: boolean; passwordLogin: boolean; forgot: boolean; sso: { label: string } | null }>()
  const [forgot, setForgot] = useState<'' | 'open' | 'sent'>('')
  const [f, setF] = useState({ email: '', password: '', name: '', token: '' })
  const ssoError = new URLSearchParams(location.search).get('sso_error')
  const [err, setErr] = useState(ssoError ? t(SSO_ERRORS[ssoError] ?? 'sso.err.failed') : '')
  // SSO-only servers hide the password form; admins with a password can still open it (IdP outage).
  const [breakGlass, setBreakGlass] = useState(false)
  useEffect(() => { api('GET', '/api/auth/state').then(setState) }, [])
  if (!state) return null
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      if (forgot) {
        await api('POST', '/api/auth/forgot', { email: f.email })
        return setForgot('sent')
      }
      await api('POST', state.setupRequired ? '/api/auth/setup' : '/api/auth/login', f)
      onDone()
    } catch (x) { setErr(message(x)) }
  }
  const field = (k: keyof typeof f, label: string, type = 'text') => (
    <label>{label}<input type={type} value={f[k]} required onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  )
  if (forgot) return (
    <main className="auth">
      <form onSubmit={submit} className="card">
        <h1>{t('forgot.title')}</h1>
        {forgot === 'sent' ? <p role="status">{t('forgot.sent')}</p> : <>
          <p className="muted">{t('forgot.sub')}</p>
          {field('email', t('auth.email'), 'email')}
          {err && <p className="error" role="alert">{err}</p>}
          <button className="primary">{t('forgot.send')}</button>
        </>}
        <button type="button" className="link" onClick={() => { setForgot(''); setErr('') }}>{t('forgot.back')}</button>
      </form>
    </main>
  )
  return (
    <main className="auth">
      <form onSubmit={submit} className="card">
        <div className="inline-head"><h1>Taskhouse</h1><LangPicker /></div>
        {state.setupRequired && <p className="muted">{t('setup.sub')}</p>}
        {state.setupRequired && field('token', t('setup.token'))}
        {state.setupRequired && field('name', t('auth.name'))}
        {(state.setupRequired || state.passwordLogin || breakGlass) && <>{field('email', t('auth.email'), 'email')}{field('password', t('auth.password'), 'password')}</>}
        {err && <p className="error" role="alert">{err}</p>}
        {(state.setupRequired || state.passwordLogin || breakGlass) && <button className="primary">{state.setupRequired ? t('setup.submit') : t('auth.login')}</button>}
        {!state.setupRequired && state.sso && <a className="button" href="/api/auth/oidc/start">{t('auth.sso', { name: state.sso.label })}</a>}
        {!state.setupRequired && !state.passwordLogin && !breakGlass && (
          <button type="button" className="link" onClick={() => setBreakGlass(true)}>{t('auth.breakGlass')}</button>
        )}
        {!state.setupRequired && (state.passwordLogin || breakGlass) && (state.forgot
          ? <button type="button" className="link" onClick={() => { setForgot('open'); setErr('') }}>{t('forgot.link')}</button>
          : <p className="muted small">{t('forgot.askAdmin')}</p>)}
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
  if (!email) return <main className="auth"><div className="card"><p>{t('link.invalid')}</p></div></main>
  return (
    <main className="auth">
      <form className="card" onSubmit={(e) => { e.preventDefault(); api('POST', path, reset ? { password: f.password } : f).then(onDone, (x) => toast(message(x))) }}>
        <h1>{email}</h1>
        {reset ? <p className="muted">{t('reset.sub')}</p>
          : <label>{t('auth.name')}<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>}
        <label>{t('auth.password')}<input type="password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        <button className="primary">{reset ? t('auth.setPassword') : t('invite.submit')}</button>
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
        {me.pagehouseUrl && <a href={me.pagehouseUrl} className="ghost">Pagehouse</a>}
        <button className="search" onClick={() => setQuick(true)}>{t('nav.quick')} <kbd>⌘K</kbd></button>
        <Link to="/search" className="ghost">{t('nav.search')}</Link>
        <span className="grow" />
        <button className="ghost" onClick={() => setShowNotes(!showNotes)}>{t('nav.notifications')}{unread ? <span className="badge">{unread}</span> : null}</button>
        {me.isAdmin && <Link to="/admin" className="ghost">{t('nav.admin')}</Link>}
        <Link to="/me" className="muted">{me.name}</Link>
        <button className="ghost" onClick={() => api('POST', '/api/auth/logout').then((r) => location.assign(r.redirect ?? '/'))}>{t('nav.logout')}</button>
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
        <h2>{t('home.projects')}</h2>
        <ul className="list">
          {projects?.map((p) => <li key={p.id}><Link to={`/p/${p.key}`}><b>{p.key}</b> {p.name}</Link> <span className="muted">{t(`role.${p.role}` as Key)}</span></li>)}
          {projects?.length === 0 && <li className="muted">{t('home.noProjects')}</li>}
        </ul>
        <form className="inline" onSubmit={create}>
          <input placeholder={t('home.key')} aria-label={t('home.key')} required pattern="[A-Za-z][A-Za-z0-9]{1,9}" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase() })} />
          <input placeholder={t('auth.name')} aria-label={t('auth.name')} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <select value={f.visibility} aria-label={t('settings.visibility')} onChange={(e) => setF({ ...f, visibility: e.target.value })}>
            <option value="private">{t('vis.private')}</option><option value="view">{t('vis.view')}</option><option value="edit">{t('vis.edit')}</option>
          </select>
          <button className="primary">{t('home.newProject')}</button>
        </form>
      </section>
      <section>
        <h2>{t('home.mine', { name: me.name })}</h2>
        <IssueList issues={mine} />
      </section>
    </div>
  )
}

export function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return <p className="muted">{t('common.none')}</p>
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
  if (project === null) return <p>{t('project.notFound')}</p>
  if (!project) return null
  return (
    <>
      <nav className="tabs">
        <h1>{project.name} <span className="muted">{project.key}</span></h1>
        <Link to={`/p/${pkey}`} className={tab === 'board' ? 'on' : ''}>{t('project.board')}</Link>
        <Link to={`/p/${pkey}/backlog`} className={tab === 'backlog' ? 'on' : ''}>{t('project.backlog')}</Link>
        {project.level >= 4 && <Link to={`/p/${pkey}/settings`} className={tab === 'settings' ? 'on' : ''}>{t('project.settings')}</Link>}
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
        <input autoFocus placeholder={t('quick.placeholder')} aria-label={t('nav.quick')} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && hits[0]) go(hits[0].key) }} />
        <ul className="list">
          {hits.map((i) => <li key={i.id}><a href={`/browse/${i.key}`} onClick={(e) => { e.preventDefault(); go(i.key) }}><span className="key">{i.key}</span> {i.title}</a><span className={`pill c${i.status.category}`}>{i.status.name}</span></li>)}
        </ul>
      </div>
    </div>
  )
}

function Notifications({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<any[]>([])
  useEffect(() => { api<any[]>('GET', '/api/notifications').then(setList); api('POST', '/api/notifications/read', {}) }, [])
  return (
    <div className="overlay" onClick={onClose}>
      <div className="notes" onClick={(e) => e.stopPropagation()}>
        {!list.length && <p className="muted">{t('notes.none')}</p>}
        {list.map((n) => (
          <a key={n.id} href={`/browse/${n.data.key}`} className={n.readAt ? '' : 'unread'} onClick={(e) => { e.preventDefault(); onClose(); nav(`/browse/${n.data.key}`) }}>
            {t(`notes.${n.kind}` as Key, { actor: n.actor?.name ?? t('common.system'), key: n.data.key })}
            <div className="muted">{n.data.title}{n.data.text ? ` — ${n.data.text}` : ''}</div>
          </a>
        ))}
      </div>
    </div>
  )
}
