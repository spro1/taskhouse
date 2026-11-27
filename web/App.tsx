import { lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, ApiError, message, PRIORITIES, type Issue, type Project, type Ref } from './api.ts'
import { Avatar, Icon, PriorityIcon, TypeIcon } from './icons.tsx'
import { applyTheme, theme as currentTheme, type Theme } from './theme.ts'
import { lang, LANGS, setLang, t, type Key, type Lang } from './i18n.ts'
import { Select } from './Select.tsx'
import { Board, Backlog } from './Board.tsx'
// The issue screen carries the rich-text editor; it loads when first opened.
const IssueView = lazy(() => import('./Issue.tsx').then((m) => ({ default: m.IssueView })))
import { MySettings, Settings } from './Settings.tsx'
import { Search } from './Search.tsx'
import { Admin } from './Admin.tsx'

export type Me = { id: number; name: string; email: string; isAdmin: boolean; locale: Lang | null; theme: Theme | null; mustChangePassword: boolean; pagehouseUrl: string | null }

export const nav = (to: string) => {
  history.pushState(null, '', to)
  dispatchEvent(new PopStateEvent('popstate'))
}
export const Link = ({ to, children, className, title }: { to: string; children: ReactNode; className?: string; title?: string }) => (
  <a href={to} className={className} title={title} onClick={(e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); nav(to) } }}>{children}</a>
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

// One line at the bottom for errors and confirmations, optionally with one action (e.g. open what was just created).
type ToastAction = { label: string; run: () => void }
let showToast: (s: string, action?: ToastAction) => void = () => {}
export const toast = (s: string, action?: ToastAction) => showToast(s, action)
function Toast() {
  const [msg, setMsg] = useState<{ text: string; action?: ToastAction } | null>(null)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    showToast = (text, action) => { setMsg({ text, action }); clearTimeout(t); t = setTimeout(() => setMsg(null), action ? 6000 : 4000) }
  }, [])
  if (!msg) return null
  return (
    <div className="toast" role="status">
      {msg.text}
      {msg.action && <button className="toast-action" onClick={() => { msg.action!.run(); setMsg(null) }}>{msg.action.label}</button>}
    </div>
  )
}

const Brand = () => <span className="brand"><span className="logo">T</span>Taskhouse</span>
// A project's colour comes from its id, the same everywhere it's shown.
const PROJECT_COLORS = ['#2f6feb', '#6b5cf0', '#0d9488', '#d6409f', '#f76b15', '#30a46c', '#e5484d', '#8d6e63']
export const ProjectBadge = ({ p, lg }: { p: { id: number; key: string; name: string }; lg?: boolean }) => (
  <span className={`project-badge ${lg ? 'lg' : ''}`} style={{ background: PROJECT_COLORS[p.id % PROJECT_COLORS.length] }} aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
)

export function App() {
  const path = usePath()
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const load = () => api<Me>('GET', '/api/me').then((m) => {
    // The account's language follows it to every device (switching reloads the app).
    if (m.locale && m.locale !== lang) return setLang(m.locale)
    // The theme follows the account too (as in Pagehouse); this browser's copy only avoids a flash at load.
    if (m.theme && m.theme !== currentTheme) applyTheme(m.theme)
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
    <Select className="lang" label="Language" value={lang as string} onChange={(v) => setLang(v as Lang)} placement="end"
      options={Object.entries(LANGS).map(([code, l]) => ({ value: code, label: l.label }))} />
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
        <div className="inline-head"><Brand /><LangPicker /></div>
        <h1>{state.setupRequired ? t('setup.submit') : t('auth.login')}</h1>
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

// Typing in a field must never trigger a single-key shortcut.
const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

function Shell({ me, path }: { me: Me; path: string }) {
  const [quick, setQuick] = useState(false)
  const [unread, setUnread] = useState(0)
  const [showNotes, setShowNotes] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newProject, setNewProject] = useState(false)
  const [projects, setProjects] = useState<Project[]>()
  const loadProjects = () => api<Project[]>('GET', '/api/projects').then(setProjects, () => {})
  useEffect(() => { loadProjects() }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setQuick(true) }
      else if (e.key === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e) && !document.querySelector('.overlay')) { e.preventDefault(); setCreating(true) }
    }
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
  const current = m?.[1] ?? browse?.split('-')[0]
  return (
    <div className="layout">
      <Sidebar me={me} path={path} tab={m ? m[2] ?? 'board' : ''} projects={projects ?? []} current={current} unread={unread}
        onCreate={() => setCreating(true)} onQuick={() => setQuick(true)} onNotes={() => setShowNotes(true)} onNewProject={() => setNewProject(true)} />
      <main>
        <div className="page">
          <Suspense fallback={null}>
            {path === '/me' ? <MySettings me={me} /> : path.startsWith('/admin') ? <Admin me={me} tab={path === '/admin/monitor' ? 'monitor' : path === '/admin/audit' ? 'audit' : 'people'} /> : path === '/search' ? <Search />
              : browse ? <IssueView issueKey={browse} me={me} /> : m ? <ProjectPage pkey={m[1]} tab={m[2] ?? 'board'} me={me} />
              : <Home me={me} projects={projects} onNewProject={() => setNewProject(true)} />}
          </Suspense>
        </div>
      </main>
      {showNotes && <Notifications onClose={() => { setShowNotes(false); setUnread(0) }} />}
      {quick && <QuickSearch onClose={() => setQuick(false)} />}
      {creating && <CreateIssue projects={(projects ?? []).filter((p) => p.level >= 2)} current={current} onClose={() => setCreating(false)} />}
      {newProject && <NewProject onClose={() => setNewProject(false)} onDone={(key) => { setNewProject(false); loadProjects(); nav(`/p/${key}`) }} />}
    </div>
  )
}

function Sidebar(p: { me: Me; path: string; tab: string; projects: Project[]; current?: string; unread: number
  onCreate: () => void; onQuick: () => void; onNotes: () => void; onNewProject: () => void }) {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
  const [photo, setPhoto] = useState(0)
  useEffect(() => {
    const on = () => setPhoto(Date.now())
    addEventListener('th:avatar', on)
    return () => removeEventListener('th:avatar', on)
  }, [])
  return (
    <nav className="sidebar" aria-label={t('nav.label')}>
      <div className="sidebar-top">
        <Link to="/" className="brand"><span className="logo">T</span>Taskhouse</Link>
        <button className="ghost icon bell" title={t('nav.notifications')} aria-label={t('nav.notifications')} onClick={p.onNotes}>
          <Icon name="bell" />{p.unread ? <span className="badge">{p.unread}</span> : null}
        </button>
      </div>
      <button className="primary create-btn" onClick={p.onCreate}><Icon name="plus" /> {t('nav.create')}<kbd>C</kbd></button>
      <button className="nav-item search-trigger" onClick={p.onQuick}>
        <Icon name="search" /><span className="grow ellipsis">{t('nav.quick')}</span><kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <Link to="/" className={`nav-item ${p.path === '/' ? 'on' : ''}`}><Icon name="home" /> {t('nav.home')}</Link>
      <Link to="/search" className={`nav-item ${p.path === '/search' ? 'on' : ''}`}><Icon name="filter" /> {t('nav.search')}</Link>
      {/* set when Pagehouse shares this install's accounts */}
      {p.me.pagehouseUrl && <a href={p.me.pagehouseUrl} className="nav-item"><Icon name="link" /> Pagehouse</a>}

      <div className="tree-head">
        <span>{t('home.projects')}</span>
        <button className="ghost icon sm" title={t('project.create')} aria-label={t('project.create')} onClick={p.onNewProject}><Icon name="plus" size={14} /></button>
      </div>
      {p.projects.map((x) => (
        <div key={x.id}>
          <Link to={`/p/${x.key}`} className={`nav-item ${x.key === p.current ? 'current' : ''}`} title={`${x.name} (${x.key})`}>
            <ProjectBadge p={x} /><span className="grow ellipsis">{x.name}</span>
          </Link>
          {x.key === p.current && (
            <>
              <Link to={`/p/${x.key}`} className={`nav-item sub ${p.tab === 'board' ? 'on' : ''}`}><Icon name="board" /> {t('project.board')}</Link>
              <Link to={`/p/${x.key}/backlog`} className={`nav-item sub ${p.tab === 'backlog' ? 'on' : ''}`}><Icon name="backlog" /> {t('project.backlog')}</Link>
              {x.level >= 4 && <Link to={`/p/${x.key}/settings`} className={`nav-item sub ${p.tab === 'settings' ? 'on' : ''}`}><Icon name="settings" /> {t('project.settings')}</Link>}
            </>
          )}
        </div>
      ))}
      {!p.projects.length && <p className="muted small" style={{ padding: '4px 10px' }}>{t('home.noProjects')}</p>}

      <div className="sidebar-foot">
        {p.me.isAdmin && <Link to="/admin" className={`nav-item ${p.path.startsWith('/admin') ? 'on' : ''}`}><Icon name="settings" /> {t('nav.admin')}</Link>}
        <div className="me">
          <Avatar key={photo} user={p.me} />
          <Link to="/me" className="me-name" title={t('me.title')}>{p.me.name}</Link>
          <ThemeButton />
          <button className="ghost icon" title={t('nav.logout')} aria-label={t('nav.logout')}
            onClick={() => api('POST', '/api/auth/logout').then((r) => location.assign(r.redirect ?? '/'))}><Icon name="logout" /></button>
        </div>
      </div>
    </nav>
  )
}

function ThemeButton() {
  const [th, setTh] = useState<Theme>(currentTheme)
  const next: Theme = th === 'system' ? 'light' : th === 'light' ? 'dark' : 'system'
  const label = t('theme.toggle', { mode: t(`theme.${th}`) })
  return (
    <button className="ghost icon" title={label} aria-label={label} onClick={() => { applyTheme(next); setTh(next); api('PATCH', '/api/me', { theme: next }).catch(() => {}) }}>
      <Icon name={th === 'system' ? 'monitor' : th === 'light' ? 'sun' : 'moon'} />
    </button>
  )
}

function Modal({ title, onClose, children, foot, onSubmit }: { title: string; onClose: () => void; children: ReactNode; foot: ReactNode; onSubmit: (e: FormEvent) => void }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <form className="modal" role="dialog" aria-modal="true" aria-label={title} onSubmit={(e) => { e.preventDefault(); onSubmit(e) }}>
        <div className="modal-head"><h2>{title}</h2><button type="button" className="ghost icon sm" aria-label={t('common.cancel')} onClick={onClose}><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{foot}</div>
      </form>
    </div>
  )
}

// The rich-text editor is a separate chunk; the create dialog loads it when opened.
const Editor = lazy(() => import('./Editor.tsx').then((m) => ({ default: m.Editor })))

function CreateIssue({ projects, current, onClose }: { projects: Project[]; current?: string; onClose: () => void }) {
  const last = (() => { try { return localStorage.getItem('th:lastProject') } catch { return null } })()
  const pick = [current, last].find((k) => projects.some((p) => p.key === k)) ?? projects[0]?.key ?? ''
  const [pkey, setPkey] = useState(pick)
  const [project, setProject] = useState<Project>()
  const [users, setUsers] = useState<Ref[]>([])
  const [f, setF] = useState({ type: '', title: '', assignee: '', priority: 2 })
  const [doc, setDoc] = useState<any>(null)
  const [again, setAgain] = useState(false)
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<Ref[]>('GET', '/api/users').then(setUsers) }, [])
  useEffect(() => {
    if (!pkey) return
    api<Project>('GET', `/api/projects/${pkey}`).then((p) => {
      setProject(p)
      const types = p.types.filter((x) => x.level < 2)
      setF((v) => ({ ...v, type: types.some((x) => String(x.id) === v.type) ? v.type : String((types.find((x) => x.level === 1) ?? types[0])?.id ?? '') }))
    })
  }, [pkey])
  if (!projects.length) return (
    <Modal title={t('create.title')} onClose={onClose} onSubmit={onClose} foot={<button className="primary">{t('common.cancel')}</button>}>
      <p>{t('create.noProject')}</p>
    </Modal>
  )
  const submit = async () => {
    if (!f.title.trim() || busy) return
    setBusy(true)
    try {
      const body: Record<string, unknown> = { title: f.title, type: Number(f.type), priority: f.priority }
      if (f.assignee) body.assignee = Number(f.assignee)
      if (doc?.content?.some((n: any) => n.content?.length)) body.doc = doc
      const r = await api<Issue>('POST', `/api/projects/${pkey}/issues`, body)
      try { localStorage.setItem('th:lastProject', pkey) } catch {}
      toast(t('create.done', { key: r.key }), { label: t('create.view'), run: () => nav(`/browse/${r.key}`) })
      if (!again) return onClose()
      setF({ ...f, title: '' }); setDoc(null); setRound(round + 1)
    } catch (e) { toast(message(e)) } finally { setBusy(false) }
  }
  return (
    <Modal title={t('create.title')} onClose={onClose} onSubmit={submit} foot={<>
      <label className="check"><input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} />{t('create.another')}</label>
      <button type="button" onClick={onClose}>{t('common.cancel')}</button>
      <button className="primary" disabled={busy || !f.title.trim()}>{t('common.create')}</button>
    </>}>
      <div className="two">
        <label>{t('create.project')}
          <Select label={t('create.project')} value={pkey} onChange={setPkey} options={projects.map((p) => ({ value: p.key, label: p.name, hint: p.key, icon: <ProjectBadge p={p} /> }))} />
        </label>
        <label>{t('field.type')}
          <Select label={t('field.type')} value={f.type} onChange={(v) => setF({ ...f, type: v })}
            options={(project?.types ?? []).filter((x) => x.level < 2).map((x) => ({ value: String(x.id), label: x.name, icon: <TypeIcon type={x} /> }))} />
        </label>
      </div>
      <label>{t('create.summary')}
        <input autoFocus required maxLength={255} value={f.title} key={round} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </label>
      <label>{t('field.description')}
        <Suspense fallback={null}><Editor key={`${pkey}${round}`} bare onChange={setDoc} placeholder={t('field.description')} onSubmit={submit} /></Suspense>
      </label>
      <div className="two">
        <label>{t('field.assignee')}
          <Select label={t('field.assignee')} value={f.assignee} onChange={(v) => setF({ ...f, assignee: v })}
            options={[{ value: '', label: t('board.unassigned'), icon: <Avatar user={null} size="sm" /> }, ...users.map((u) => ({ value: String(u.id), label: u.name, icon: <Avatar user={u} size="sm" /> }))]} />
        </label>
        <label>{t('field.priority')}
          <Select label={t('field.priority')} value={f.priority} onChange={(v) => setF({ ...f, priority: v })}
            options={PRIORITIES.map((x, i) => ({ value: i, label: x, icon: <PriorityIcon priority={i} label={x} /> }))} />
        </label>
      </div>
    </Modal>
  )
}

function NewProject({ onClose, onDone }: { onClose: () => void; onDone: (key: string) => void }) {
  const [f, setF] = useState({ key: '', name: '', visibility: 'private' })
  return (
    <Modal title={t('project.create')} onClose={onClose} onSubmit={() => api('POST', '/api/projects', f).then(() => onDone(f.key), (x) => toast(message(x)))}
      foot={<><button type="button" onClick={onClose}>{t('common.cancel')}</button><button className="primary">{t('common.create')}</button></>}>
      <label>{t('auth.name')}<input autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label>{t('home.key')}
        <input required pattern="[A-Za-z][A-Za-z0-9]{1,9}" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase() })} />
        <span className="hint">{t('project.keyHint')}</span>
      </label>
      <label>{t('settings.visibility')}
        <Select label={t('settings.visibility')} value={f.visibility} onChange={(v) => setF({ ...f, visibility: v })}
          options={(['private', 'view', 'edit'] as const).map((v) => ({ value: v, label: t(`vis.${v}`) }))} />
      </label>
    </Modal>
  )
}

function Home({ me, projects, onNewProject }: { me: Me; projects?: Project[]; onNewProject: () => void }) {
  const [mine, setMine] = useState<Issue[]>()
  useEffect(() => {
    api('POST', '/api/search', { query: { and: [{ field: 'assignee', value: 'me' }, { field: 'statusCategory', op: '!=', value: 'done' }] }, sort: ['priority asc', 'updated desc'] })
      .then((r) => setMine(r.issues))
  }, [])
  return (
    <>
      <div className="page-head"><h1>{t('nav.home')}</h1><button onClick={onNewProject}><Icon name="plus" /> {t('project.create')}</button></div>
      <h4>{t('home.projects')}</h4>
      {projects?.length === 0 && <p className="muted">{t('home.noProjects')}</p>}
      {projects && projects.length > 0 && (
        <table className="results projects">
          <thead><tr><th>{t('auth.name')}</th><th>{t('col.key')}</th><th>{t('settings.visibility')}</th><th>{t('home.myRole')}</th><th></th></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td><Link to={`/p/${p.key}`} className="project-name"><ProjectBadge p={p} /> {p.name}</Link></td>
                <td className="key">{p.key}</td>
                <td className="muted">{t(`vis.${p.visibility}` as Key)}</td>
                <td className="muted">{t(`role.${p.role}` as Key)}</td>
                <td className="links"><Link to={`/p/${p.key}`}>{t('project.board')}</Link><Link to={`/p/${p.key}/backlog`}>{t('project.backlog')}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h4>{t('home.mine', { name: me.name })}</h4>
      {mine && <IssueList issues={mine} />}
    </>
  )
}

export function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return <p className="muted">{t('common.none')}</p>
  return (
    <ul className="list boxed grid-rows short">
      {issues.map((i) => (
        <li key={i.id}>
          <TypeIcon type={i.type} />
          <span className="key">{i.key}</span>
          <span className="title-cell"><Link to={`/browse/${i.key}`} title={i.title}>{i.title}</Link></span>
          <span><span className={`lozenge c${i.status.category}`}>{i.status.name}</span></span>
          <PriorityIcon priority={i.priority} label={PRIORITIES[i.priority]} />
          <Avatar user={i.assignee} />
        </li>
      ))}
    </ul>
  )
}

function ProjectPage({ pkey, tab, me }: { pkey: string; tab: string; me: Me }) {
  const [project, setProject] = useState<Project | null>()
  // The issue open in the side panel; kept in the URL (?issue=KEY) so it survives a reload and can be shared.
  const [peek, setPeek] = useState(() => new URLSearchParams(location.search).get('issue') ?? undefined)
  const open = (key?: string) => {
    setPeek(key)
    history.replaceState(null, '', key ? `${location.pathname}?issue=${key}` : location.pathname)
  }
  const load = () => api<Project>('GET', `/api/projects/${pkey}`).then(setProject, (e) => setProject(e instanceof ApiError && e.status === 404 ? null : undefined))
  useEffect(() => { load() }, [pkey])
  useEffect(() => {
    if (!peek) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !typing(e) && !document.querySelector('.overlay') && open(undefined)
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [peek])
  if (project === null) return <p>{t('project.notFound')}</p>
  if (!project) return null
  return (
    <div className={peek && tab !== 'settings' ? 'with-panel' : ''}>
      <div className="crumbs"><Link to="/">{t('home.projects')}</Link><i>/</i><span>{project.name}</span></div>
      <div className="page-head">
        <h1>{tab === 'backlog' ? t('project.backlog') : tab === 'settings' ? t('project.settings') : t('project.board')}</h1>
      </div>
      {tab === 'backlog' ? <Backlog project={project} reload={load} onOpen={open} selected={peek} />
        : tab === 'settings' ? <Settings project={project} reload={load} me={me} />
        : <Board project={project} me={me} onOpen={open} selected={peek} />}
      {peek && tab !== 'settings' && (
        <aside className="issue-panel" aria-label={peek}>
          <div className="panel-bar">
            <Link to={`/browse/${peek}`} className="button sm"><Icon name="chevron" size={14} /> {t('panel.open')}</Link>
            <span className="grow" />
            <button className="ghost icon sm" aria-label={t('panel.close')} title={`${t('panel.close')} (Esc)`} onClick={() => open(undefined)}><Icon name="x" /></button>
          </div>
          <Suspense fallback={null}><IssueView key={peek} issueKey={peek} me={me} panel /></Suspense>
        </aside>
      )}
    </div>
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
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="quick" role="dialog" aria-label={t('nav.quick')}>
        <input autoFocus placeholder={t('quick.placeholder')} aria-label={t('nav.quick')} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && hits[0]) go(hits[0].key) }} />
        <ul className="list">
          {hits.map((i) => (
            <li key={i.id}>
              <TypeIcon type={i.type} /><span className="key">{i.key}</span>
              <a href={`/browse/${i.key}`} onClick={(e) => { e.preventDefault(); go(i.key) }}>{i.title}</a>
              <span className={`lozenge c${i.status.category}`}>{i.status.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function Notifications({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<any[]>([])
  useEffect(() => { api<any[]>('GET', '/api/notifications').then(setList); api('POST', '/api/notifications/read', {}) }, [])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="notes" role="dialog" aria-label={t('nav.notifications')}>
        <h2>{t('nav.notifications')}</h2>
        {!list.length && <p className="muted" style={{ padding: '0 8px' }}>{t('notes.none')}</p>}
        {list.map((n) => (
          <a key={n.id} href={`/browse/${n.data.key}`} className={n.readAt ? '' : 'unread'} onClick={(e) => { e.preventDefault(); onClose(); nav(`/browse/${n.data.key}`) }}>
            {t(`notes.${n.kind}` as Key, { actor: n.actor?.name ?? t('common.system'), key: n.data.key })}
            <div className="muted small">{n.data.title}{n.data.text ? ` — ${n.data.text}` : ''}</div>
          </a>
        ))}
      </div>
    </div>
  )
}
