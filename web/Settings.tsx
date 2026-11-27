import { useEffect, useRef, useState } from 'react'
import { api, CATEGORY_NAMES, message, type Project, type Ref, type Status } from './api.ts'
import { toast, type Me } from './App.tsx'
import { lang, LANGS, setLang, t, type Lang } from './i18n.ts'
import { Select } from './Select.tsx'
import { Avatar, bumpAvatar } from './icons.tsx'

const ROLES = ['viewer', 'reporter', 'member', 'admin'] as const

export function Settings({ project, reload, me }: { project: Project; reload: () => void; me: Me }) {
  const act = (p: Promise<unknown>, ok = t('common.saved')) => p.then(() => { toast(ok); reload() }, (e) => toast(message(e)))
  return (
    <div className="settings">
      <section>
        <h3>{t('settings.visibility')}</h3>
        <Select label={t('settings.visibility')} value={project.visibility} onChange={(v) => act(api('PATCH', `/api/projects/${project.key}`, { visibility: v }))}
          options={(['private', 'view', 'edit'] as const).map((v) => ({ value: v, label: t(`vis.${v}.long`) }))} />
      </section>
      {/* Keyed by the saved data, so after a save the editors start again from what the server has (with real ids). */}
      <Roles key={JSON.stringify(project.roles)} project={project} act={act} me={me} />
      <Workflow key={JSON.stringify([project.statuses, (project as any).transitions])} project={project} act={act} />
      {me.isAdmin && <Webhooks project={project} />}
      <section>
        <h3>{t('export.title')}</h3>
        <p className="muted">{t('export.sub')}</p>
        <div className="inline">
          <a className="button" href={`/api/projects/${project.key}/export?format=json`} download>{t('export.json')}</a>
          <a className="button" href={`/api/projects/${project.key}/export?format=csv`} download>{t('export.csv')}</a>
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
      <h3>{t('roles.title')}</h3>
      <ul className="list">
        {rows.map((r, i) => (
          <li key={i}>
            {r.user ? r.user.name : t('roles.group', { name: r.group!.name })}
            <span className="grow" />
            <Select label={t('roles.title')} value={r.role} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, role: v } : x)))}
              options={ROLES.map((k) => ({ value: k, label: t(`role.${k}`) }))} />
            <button className="ghost" disabled={r.user?.id === me.id} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
          </li>
        ))}
      </ul>
      <div className="inline">
        <Select label={t('roles.pick')} value={pick} onChange={setPick} placeholder={t('roles.pick')}
          options={[...users.map((u) => ({ value: `u:${u.id}`, label: u.name, icon: <Avatar user={u} size="sm" /> })), ...groups.map((g) => ({ value: `g:${g.id}`, label: t('roles.group', { name: g.name }) }))]} />
        <button onClick={add} disabled={!pick}>{t('common.add')}</button>
        <button className="primary" onClick={() => act(api('PUT', `/api/projects/${project.key}/roles`, { roles: rows.map((r) => ({ user: r.user?.id, group: r.group?.id, role: r.role })) }))}>{t('roles.save')}</button>
      </div>
    </section>
  )
}

type Row = { key: string; id?: number; name: string; category: 0 | 1 | 2; onBoard: boolean }
type Rules = { conditions?: { kind: string; level?: number }[]; validators?: { kind: string; fields?: string[] }[]; post?: { kind: string; field: string; value: string }[] }
type Move = { name: string; from: string | null; to: string; rules: Rules }
// The rule kinds the server knows (server/issues.ts), as checkboxes.
const CHECKS: { label: string; group: keyof Rules; has: (r: Rules) => boolean; toggle: (r: Rules, on: boolean) => Rules }[] = [
  ...([[t('rule.assignee'), 'is_assignee'], [t('rule.reporter'), 'is_reporter']] as const).map(([label, kind]) => ({
    label, group: 'conditions' as const, has: (r: Rules) => !!r.conditions?.some((c) => c.kind === kind),
    toggle: (r: Rules, on: boolean) => ({ ...r, conditions: [...(r.conditions ?? []).filter((c) => c.kind !== kind), ...(on ? [{ kind }] : [])] }),
  })),
  { label: t('rule.admin'), group: 'conditions', has: (r) => !!r.conditions?.some((c) => c.kind === 'has_role'),
    toggle: (r, on) => ({ ...r, conditions: [...(r.conditions ?? []).filter((c) => c.kind !== 'has_role'), ...(on ? [{ kind: 'has_role', level: 4 }] : [])] }) },
  ...([[t('rule.needPoints'), 'points'], [t('rule.needAssignee'), 'assignee'], [t('rule.needDue'), 'due']] as const).map(([label, field]) => ({
    label, group: 'validators' as const, has: (r: Rules) => !!r.validators?.some((v) => v.kind === 'required' && v.fields?.includes(field)),
    toggle: (r: Rules, on: boolean) => {
      const fields = [...new Set([...(r.validators?.find((v) => v.kind === 'required')?.fields ?? []).filter((f) => f !== field), ...(on ? [field] : [])])]
      return { ...r, validators: [...(r.validators ?? []).filter((v) => v.kind !== 'required'), ...(fields.length ? [{ kind: 'required', fields }] : [])] }
    },
  })),
  ...([[t('rule.subtasksDone'), 'subtasks_done'], [t('rule.noBlockers'), 'no_blockers']] as const).map(([label, kind]) => ({
    label, group: 'validators' as const, has: (r: Rules) => !!r.validators?.some((v) => v.kind === kind),
    toggle: (r: Rules, on: boolean) => ({ ...r, validators: [...(r.validators ?? []).filter((v) => v.kind !== kind), ...(on ? [{ kind }] : [])] }),
  })),
  ...([[t('rule.toReporter'), '$reporter'], [t('rule.toMe'), '$me'], [t('rule.unassign'), '$none']] as const).map(([label, value]) => ({
    label, group: 'post' as const, has: (r: Rules) => !!r.post?.some((p) => p.field === 'assignee' && p.value === value),
    toggle: (r: Rules, on: boolean) => ({ ...r, post: [...(r.post ?? []).filter((p) => p.field !== 'assignee'), ...(on ? [{ kind: 'set', field: 'assignee', value }] : [])] }),
  })),
]
const GROUP_NAMES = { conditions: t('rule.who'), validators: t('rule.when'), post: t('rule.after') }

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
    statuses: rows.map(({ id, name, category, onBoard }) => ({ id, name, category, onBoard })),
    transitions: moves.map((m) => ({ name: m.name || nameOf(m.to), from: nameOf(m.from), to: nameOf(m.to), rules: m.rules })),
  }))
  return (
    <section>
      <h3>{t('workflow.statuses')}</h3>
      <p className="muted">{t('workflow.statuses.sub')}</p>
      <ul className="list">
        {rows.map((r, i) => (
          <li key={r.key}>
            <input value={r.name} onChange={(e) => set(i, { name: e.target.value })} aria-label={t('workflow.statusName')} />
            <Select label={t('workflow.category')} value={r.category} onChange={(v) => set(i, { category: v })}
              options={CATEGORY_NAMES.map((n, c) => ({ value: c as 0 | 1 | 2, label: n, icon: <span className={`dot c${c}`} /> }))} />
            <label className="check on-board" title={t('workflow.onBoard.hint')}>
              <input type="checkbox" checked={r.onBoard} disabled={r.onBoard && rows.filter((x) => x.onBoard).length === 1} onChange={(e) => set(i, { onBoard: e.target.checked })} />
              {t('workflow.onBoard')}
            </label>
            <button className="ghost" onClick={() => up(i)} aria-label={t('workflow.up')}>↑</button>
            <button className="ghost" onClick={() => drop(i)} aria-label={t('common.delete')}>×</button>
          </li>
        ))}
      </ul>
      <button onClick={() => setRows([...rows, { key: `n${Date.now()}`, name: '', category: 1, onBoard: true }])}>{t('workflow.addStatus')}</button>

      <h3 style={{ marginTop: 20 }}>{t('workflow.transitions')}</h3>
      <p className="muted">{moves.length ? t('workflow.onlyListed') : t('workflow.free')}</p>
      {moves.map((m, i) => (
        <div key={i} className="move">
          <div className="inline">
            <input placeholder={t('workflow.moveName')} aria-label={t('workflow.moveName')} value={m.name} onChange={(e) => setMove(i, { name: e.target.value })} />
            <Select label={t('workflow.from')} value={m.from ?? ''} onChange={(v) => setMove(i, { from: v || null })}
              options={[{ value: '', label: t('workflow.fromAny') }, ...rows.map((r) => ({ value: r.key, label: r.name }))]} />
            →
            <Select label={t('workflow.to')} value={m.to} onChange={(v) => setMove(i, { to: v })} options={rows.map((r) => ({ value: r.key, label: r.name }))} />
            <button className="ghost" onClick={() => setMoves(moves.filter((_, j) => j !== i))} aria-label={t('workflow.deleteMove')}>×</button>
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
        <button onClick={() => setMoves([...moves, { name: '', from: null, to: rows[0].key, rules: {} }])}>{t('workflow.addMove')}</button>
        <button className="primary" onClick={save}>{t('workflow.save')}</button>
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
      <h3>{t('hooks.title')}</h3>
      <ul className="list">
        {list.map((w) => (
          <li key={w.id}>
            {w.url} <span className="muted">{w.format === 'chat' ? t('hooks.chat') : 'JSON'}</span>
            {w.last && <span className={`pill ${w.last.error ? 'c3' : 'c2'}`}>{w.last.error ? t('hooks.failed', { error: w.last.error }) : t('hooks.ok')}</span>}
            <button className="ghost" onClick={() => api('DELETE', `/api/projects/${project.key}/webhooks/${w.id}`).then(load)}>×</button>
          </li>
        ))}
      </ul>
      <form className="inline" onSubmit={(e) => {
        e.preventDefault()
        api('POST', `/api/projects/${project.key}/webhooks`, { url, format }).then((r) => { setUrl(''); load(); if (format === 'json') prompt(t('hooks.secret'), r.secret) }, (x) => toast(message(x)))
      }}>
        <Select label={t('hooks.json')} value={format} onChange={setFormat} options={[{ value: 'chat', label: 'Slack·Mattermost·Teams' }, { value: 'json', label: t('hooks.json') }]} />
        <input type="url" required placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button>{t('common.add')}</button>
      </form>
    </section>
  )
}

export function MySettings({ me }: { me: Me }) {
  const [mine, setMine] = useState<{ emailNotify: boolean; mail: boolean; hasPassword: boolean; avatar: boolean }>()
  useEffect(() => { api('GET', '/api/me').then(setMine) }, [])
  return (
    <div className="settings">
      <h1>{t('me.title')} <span className="muted">{me.email}</span></h1>
      <Photo me={me} has={!!mine?.avatar} />
      <section>
        <h3>{t('me.language')}</h3>
        <Select label={t('me.language')} value={lang as string} onChange={(v) => api('PATCH', '/api/me', { locale: v }).then(() => setLang(v as Lang), (x) => toast(message(x)))}
          options={Object.entries(LANGS).map(([code, l]) => ({ value: code, label: l.label }))} />
      </section>
      <section>
        <h3>{t('me.mail')}</h3>
        {mine && !mine.mail && <p className="muted">{t('me.mailOff')}</p>}
        {mine && (
          <label className="check">
            <input type="checkbox" checked={mine.emailNotify} onChange={(e) => api('PATCH', '/api/me', { emailNotify: e.target.checked }).then(() => setMine({ ...mine, emailNotify: e.target.checked }))} />
            {t('me.mailDigest')}
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
      <h3>{t('auth.password.title')}</h3>
      <form className="inline" onSubmit={(e) => {
        e.preventDefault()
        if (f.password !== f.again) return toast(t('me.passwordMismatch'))
        api('POST', '/api/me/password', { current: f.current, password: f.password }).then(() => { toast(t('me.passwordChanged')); setF({ current: '', password: '', again: '' }) }, (x) => toast(message(x)))
      }}>
        {hasPassword && <input type="password" required placeholder={t('me.currentPassword')} aria-label={t('me.currentPassword')} autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />}
        <input type="password" required minLength={8} placeholder={t('auth.newPassword')} aria-label={t('auth.newPassword')} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <input type="password" required minLength={8} placeholder={t('me.confirmPassword')} aria-label={t('me.confirmPassword')} autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} />
        <button>{hasPassword ? t('me.change') : t('me.set')}</button>
      </form>
    </section>
  )
}

/** Crops the middle square and scales it to 256 px, so uploads are small whatever the camera made. */
async function squareImage(file: File, size = 256): Promise<Blob> {
  const img = await createImageBitmap(file)
  const side = Math.min(img.width, img.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  canvas.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('image'))), 'image/jpeg', 0.88))
}

function Photo({ me, has }: { me: Me; has: boolean }) {
  const [version, setVersion] = useState(0)
  const [present, setPresent] = useState(has)
  useEffect(() => setPresent(has), [has])
  const pick = useRef<HTMLInputElement>(null)
  // The sidebar and every list redraw with the new photo.
  const changed = () => { setVersion(bumpAvatar()); dispatchEvent(new CustomEvent('th:avatar')) }
  return (
    <section className="profile">
      <h3>{t('me.photo')}</h3>
      <div className="profile-row">
        <Avatar key={version} user={me} size="xl" />
        <div>
          <div className="inline">
            <button type="button" onClick={() => pick.current?.click()}>{t(present ? 'me.photo.change' : 'me.photo.add')}</button>
            {present && <button type="button" className="ghost danger" onClick={() => api('DELETE', '/api/me/avatar').then(() => { setPresent(false); changed() })}>{t('me.photo.remove')}</button>}
          </div>
          <p className="muted small">{t('me.photo.hint')}</p>
        </div>
        <input ref={pick} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          try {
            const form = new FormData()
            form.append('file', new File([await squareImage(f)], 'avatar.jpg', { type: 'image/jpeg' }))
            await api('PUT', '/api/me/avatar', form)
            setPresent(true)
            changed()
          } catch (x) { toast(message(x)) }
        }} />
      </div>
    </section>
  )
}

function Tokens() {
  const [list, setList] = useState<any[]>([])
  const [name, setName] = useState('')
  const [days, setDays] = useState(90)
  const [shown, setShown] = useState('')
  const load = () => api('GET', '/api/me/tokens').then(setList)
  useEffect(() => { load() }, [])
  const url = `${location.origin}/api/mcp`
  const copy = (v: string) => navigator.clipboard?.writeText(v).then(() => toast(t('common.copied')), () => {})
  return (
    <section>
      <h3>{t('tokens.title')}</h3>
      <p className="muted">{t('tokens.sub')}</p>
      <form className="inline" onSubmit={(e) => { e.preventDefault(); api('POST', '/api/me/tokens', { name, days }).then((r) => { setShown(r.token); setName(''); load() }, (x) => toast(message(x))) }}>
        <input required placeholder={t('tokens.name')} aria-label={t('tokens.name')} value={name} onChange={(e) => setName(e.target.value)} />
        <Select label={t('tokens.days')} value={days} onChange={setDays} options={[30, 90, 365].map((d) => ({ value: d, label: t('tokens.daysN', { n: d }) }))} />
        <button className="primary">{t('common.create')}</button>
      </form>
      {shown && (
        <>
          <p className="token">{t('tokens.once')} <code>{shown}</code> <button className="link" onClick={() => copy(shown)}>{t('common.copy')}</button></p>
          <p className="token">{t('tokens.claude')} <code>{`claude mcp add --transport http taskhouse ${url} --header "Authorization: Bearer ${shown}"`}</code>{' '}
            <button className="link" onClick={() => copy(`claude mcp add --transport http taskhouse ${url} --header "Authorization: Bearer ${shown}"`)}>{t('common.copy')}</button></p>
        </>
      )}
      <p className="muted small">{t('tokens.endpoint')} <code>{url}</code> <button className="link" onClick={() => copy(url)}>{t('common.copy')}</button></p>
      <ul className="list">
        {list.map((k) => <li key={k.id}>{k.name} <span className="grow muted small">{t('tokens.expires', { date: new Date(k.expiresAt).toLocaleDateString() })}</span><button className="ghost sm danger" onClick={() => api('DELETE', `/api/me/tokens/${k.id}`).then(load)}>{t('tokens.revoke')}</button></li>)}
      </ul>
    </section>
  )
}
