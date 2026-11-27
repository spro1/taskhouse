import { t } from './i18n.ts'
import { Select } from './Select.tsx'
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { api, message, PRIORITIES, searchAll, subscribe, type Issue, type Project, type Ref, type Sprint } from './api.ts'
import { Link, toast, type Me } from './App.tsx'
import { Avatar, Icon, PriorityIcon, TypeIcon } from './icons.tsx'

// Dragging carries the issue key; dropping on a card places the issue before it, on a column's free space at its end.
const dragKey = (e: DragEvent, key: string) => e.dataTransfer.setData('text/plain', key)
const dropKey = (e: DragEvent) => e.dataTransfer.getData('text/plain')

/** Moves `key` into a status and/or before another issue, then reloads. Each step goes through the normal API rules. */
async function move(key: string, opts: { to?: number; before?: string; after?: string; sprint?: number | null }, reload: () => void) {
  try {
    if (opts.sprint !== undefined) await api('PATCH', `/api/issues/${key}`, { sprint: opts.sprint })
    if (opts.to !== undefined) await api('POST', `/api/issues/${key}/transitions`, { to: opts.to })
    if (opts.before && opts.before !== key) await api('POST', `/api/issues/${key}/rank`, { before: opts.before })
    else if (opts.after && opts.after !== key) await api('POST', `/api/issues/${key}/rank`, { after: opts.after })
  } catch (e) {
    toast(message(e))
  }
  reload()
}

/** Reloads (at most every 300 ms) when anything in the project changes, and when the tab becomes visible again. */
function useLiveReload(project: string, load: () => void, deps: unknown[] = []) {
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const later = () => { clearTimeout(t); t = setTimeout(load, 300) }
    const stop = subscribe(project, later)
    const visible = () => document.visibilityState === 'visible' && later()
    document.addEventListener('visibilitychange', visible)
    return () => { stop(); clearTimeout(t); document.removeEventListener('visibilitychange', visible) }
  }, [project, ...deps])
}

type Open = (key: string) => void

// One list of people per page load is enough for the menus.
let people: Promise<Ref[]> | null = null
/** The assignee's avatar as a button: a small menu changes the assignee without opening the issue. */
function AssigneeMenu({ issue, onChanged }: { issue: Issue; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<Ref[]>([])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    ;(people ??= api<Ref[]>('GET', '/api/users')).then(setList, () => { people = null })
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    addEventListener('mousedown', close)
    return () => removeEventListener('mousedown', close)
  }, [open])
  const set = (id: number | null) => {
    setOpen(false)
    if (id === (issue.assignee?.id ?? null)) return
    api('PATCH', `/api/issues/${issue.key}`, { assignee: id, _base: { assignee: issue.assignee } }).then(onChanged, (e) => toast(message(e)))
  }
  return (
    <div className="assignee menu-wrap" ref={ref} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} draggable onDragStart={(e) => e.preventDefault()}>
      <button type="button" title={`${t('field.assignee')}: ${issue.assignee?.name ?? t('board.unassigned')}`} aria-label={`${t('field.assignee')}: ${issue.assignee?.name ?? t('board.unassigned')}`}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Avatar user={issue.assignee} /></button>
      {open && (
        <div className="dropdown" role="menu">
          <button role="menuitem" className={!issue.assignee ? 'on' : ''} onClick={() => set(null)}><Avatar user={null} size="sm" /> {t('board.unassigned')}</button>
          {list.map((u) => <button key={u.id} role="menuitem" className={issue.assignee?.id === u.id ? 'on' : ''} onClick={() => set(u.id)}><Avatar user={u} size="sm" /> {u.name}</button>)}
        </div>
      )}
    </div>
  )
}
/** A plain click opens the side panel; ⌘/Ctrl-click (or middle click) keeps the browser's open-in-new-tab. */
const IssueLink = ({ issue, onOpen, className }: { issue: Issue; onOpen: Open; className?: string }) => (
  <a href={`/browse/${issue.key}`} className={className} title={issue.title}
    onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return e.stopPropagation(); e.preventDefault(); e.stopPropagation(); onOpen(issue.key) }}>{issue.title}</a>
)

function Card({ issue, onOpen, selected, onChanged }: { issue: Issue; onOpen: Open; selected: boolean; onChanged: () => void }) {
  return (
    <div className={`card-issue ${issue.status.category === 2 ? 'done' : ''} ${selected ? 'selected' : ''}`} draggable onDragStart={(e) => dragKey(e, issue.key)} onClick={() => onOpen(issue.key)}>
      <IssueLink issue={issue} onOpen={onOpen} className="title-link" />
      {issue.labels.length > 0 && <div className="labels">{issue.labels.map((l) => <span key={l} className="label">{l}</span>)}</div>}
      <div className="meta">
        <TypeIcon type={issue.type} />
        <span className="key">{issue.key}</span>
        <span className="grow" />
        {issue.points !== null && <span className="pts" title={t('field.points')}>{issue.points}</span>}
        <PriorityIcon priority={issue.priority} label={PRIORITIES[issue.priority]} />
        <AssigneeMenu issue={issue} onChanged={onChanged} />
      </div>
    </div>
  )
}

export function Board({ project, me, onOpen, selected }: { project: Project; me: Me; onOpen: Open; selected?: string }) {
  const active = project.sprints.find((s) => s.state === 'active')
  const [issues, setIssues] = useState<Issue[]>([])
  const [over, setOver] = useState<number | null>(null)
  // Quick filters: text, one or more people (0 = unassigned), only mine. They only narrow what's shown.
  const [q, setQ] = useState('')
  const [people, setPeople] = useState<number[]>([])
  const [mine, setMine] = useState(false)
  const load = () => {
    const scope = active ? { field: 'sprint', value: active.id }
      : { or: [{ field: 'statusCategory', op: '!=', value: 'done' }, { field: 'resolved', op: '>=', value: '-14d' }] }
    searchAll({ and: [{ field: 'project', value: project.key }, scope, { field: 'type', op: '!=', value: '에픽' }] }).then(setIssues, (e) => toast(message(e)))
  }
  useEffect(load, [project.key, active?.id])
  useLiveReload(project.key, load, [active?.id])
  const assignees = [...new Map(issues.filter((i) => i.assignee).map((i) => [i.assignee!.id, i.assignee!])).values()]
  const needle = q.trim().toLowerCase()
  const shown = issues.filter((i) => (!needle || i.title.toLowerCase().includes(needle) || i.key.toLowerCase().includes(needle))
    && (!people.length || people.includes(i.assignee?.id ?? 0)) && (!mine || i.assignee?.id === me.id))
  const filtered = needle || people.length || mine
  // Statuses left off the board in project settings: named under the filters, so their issues aren't silently gone.
  const hidden = project.statuses.filter((s) => !s.onBoard)
  const toggle = (id: number) => setPeople(people.includes(id) ? people.filter((x) => x !== id) : [...people, id])
  return (
    <>
      <div className="toolbar-row">
        <input type="search" placeholder={t('board.search')} aria-label={t('board.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="avatars">
          {assignees.map((u) => <button key={u.id} className={people.includes(u.id) ? 'on' : ''} title={u.name} aria-pressed={people.includes(u.id)} onClick={() => toggle(u.id)}><Avatar user={u} /></button>)}
          {issues.some((i) => !i.assignee) && <button className={people.includes(0) ? 'on' : ''} title={t('board.unassigned')} aria-pressed={people.includes(0)} onClick={() => toggle(0)}><Avatar user={null} /></button>}
        </div>
        <button className={`toggle-chip ${mine ? 'on' : ''}`} aria-pressed={mine} onClick={() => setMine(!mine)}>{t('board.mine')}</button>
        {filtered ? <button className="ghost sm" onClick={() => { setQ(''); setPeople([]); setMine(false) }}>{t('board.clear')}</button> : null}
        <span className="grow" />
        <span className="muted small">{active ? `${active.name}${active.endsAt ? ` · ${t('board.until', { date: new Date(active.endsAt).toLocaleDateString() })}` : ''}` : t('board.noSprint')}</span>
      </div>
      {hidden.length > 0 && <p className="muted small">{t('board.hidden', { names: hidden.map((s) => `${s.name} (${issues.filter((i) => i.status.id === s.id).length})`).join(', ') })}</p>}
      <div className="board">
        {project.statuses.filter((s) => s.onBoard).map((s) => {
          const all = issues.filter((i) => i.status.id === s.id)
          const col = shown.filter((i) => i.status.id === s.id)
          return (
            <section key={s.id} className={`column ${over === s.id ? 'over' : ''}`} aria-label={s.name}
              onDragOver={(e) => { e.preventDefault(); setOver(s.id) }} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const k = dropKey(e); const it = issues.find((i) => i.key === k); move(k, { to: it?.status.id === s.id ? undefined : s.id, after: all.at(-1)?.key }, load) }}>
              <h3>{s.name} <span className="count">{filtered ? `${col.length}/${all.length}` : all.length}</span></h3>
              {col.map((i) => (
                <div key={i.id} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(null); const k = dropKey(e); const it = issues.find((x) => x.key === k); move(k, { to: it?.status.id === s.id ? undefined : s.id, before: i.key }, load) }}>
                  <Card issue={i} onOpen={onOpen} selected={i.key === selected} onChanged={load} />
                </div>
              ))}
            </section>
          )
        })}
      </div>
    </>
  )
}

export function Backlog({ project, reload, onOpen, selected }: { project: Project; reload: () => void; onOpen: Open; selected?: string }) {
  const [issues, setIssues] = useState<Issue[]>([])
  const [adding, setAdding] = useState<number | 'backlog' | null>(null)
  const [title, setTitle] = useState('')
  const [type, setType] = useState(() => String(project.types.find((x) => x.level === 1)?.id ?? ''))
  const [over, setOver] = useState<string | null>(null)
  // Epics and subtasks aren't planned on their own: subtasks show on their parent's screen.
  const load = () => searchAll({ and: [{ field: 'project', value: project.key }, { field: 'statusCategory', op: '!=', value: 'done' }, { field: 'type', op: '!=', value: '에픽' }] })
    .then((r) => setIssues(r.filter((i) => i.type.level === 1)), (e) => toast(message(e)))
  useEffect(() => { load() }, [project.key])
  useLiveReload(project.key, () => { load(); reload() })
  const sprints: (Sprint | null)[] = [...project.sprints.filter((s) => s.state === 'active'), ...project.sprints.filter((s) => s.state === 'planned'), null]
  const act = (p: Promise<unknown>) => p.then(() => { reload(); load() }, (e) => toast(message(e)))
  const create = (e: FormEvent, sprint: number | null) => {
    e.preventDefault()
    if (!title.trim()) return
    act(api('POST', `/api/projects/${project.key}/issues`, { title, type: Number(type), ...(sprint ? { sprint } : {}) }))
    setTitle('')
  }
  return (
    <div className="backlog">
      {sprints.map((s) => {
        const id = s?.id ?? 'backlog'
        const rows = issues.filter((i) => (i.sprint?.id ?? null) === (s?.id ?? null))
        const pts = rows.reduce((n, i) => n + (i.points ?? 0), 0)
        const byCat = [0, 1, 2].map((c) => rows.filter((i) => i.status.category === c).length)
        return (
          <section key={id} className={over === String(id) ? 'over' : ''} onDragOver={(e) => { e.preventDefault(); setOver(String(id)) }}
            onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); move(dropKey(e), { sprint: s?.id ?? null, after: rows.at(-1)?.key }, load) }}>
            <header>
              <h3>{s ? s.name : t('project.backlog')}</h3>
              <span className="muted small">{t('backlog.count', { n: rows.length, points: pts })}{s?.endsAt ? ` · ${t('board.until', { date: new Date(s.endsAt).toLocaleDateString() })}` : ''}</span>
              <span className="grow" />
              <span className="counts">{byCat.map((n, c) => <span key={c} className={`pts lozenge c${c}`} title={t(`category.${c}` as 'category.0')}>{n}</span>)}</span>
              {s?.state === 'planned' && <button className="sm" onClick={() => act(api('POST', `/api/projects/${project.key}/sprints/${s.id}/start`, { days: 14 }))}>{t('sprint.start')}</button>}
              {s?.state === 'active' && <button className="sm" onClick={() => confirmComplete(project, s, act)}>{t('sprint.complete')}</button>}
              {!s && <button className="sm" onClick={() => act(api('POST', `/api/projects/${project.key}/sprints`, {}))}>{t('sprint.create')}</button>}
            </header>
            <ul className="list rows grid-rows">
              {rows.map((i) => (
                <li key={i.id} draggable onDragStart={(e) => dragKey(e, i.key)} className={i.key === selected ? 'selected' : ''} onClick={() => onOpen(i.key)}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(null); move(dropKey(e), { sprint: (s?.id ?? null) === (issues.find((x) => x.key === dropKey(e))?.sprint?.id ?? null) ? undefined : s?.id ?? null, before: i.key }, load) }}>
                  <TypeIcon type={i.type} />
                  <span className="key">{i.key}</span>
                  <span className="title-cell"><IssueLink issue={i} onOpen={onOpen} />{i.labels.slice(0, 3).map((l) => <span key={l} className="label">{l}</span>)}</span>
                  <span><span className={`lozenge c${i.status.category}`}>{i.status.name}</span></span>
                  <span className="pts" title={t('field.points')}>{i.points ?? '-'}</span>
                  <PriorityIcon priority={i.priority} label={PRIORITIES[i.priority]} />
                  <AssigneeMenu issue={i} onChanged={load} />
                </li>
              ))}
              {!rows.length && <li className="list-empty">{t('backlog.empty')}</li>}
            </ul>
            {adding === id ? (
              <form className="add-row" onSubmit={(e) => create(e, s?.id ?? null)}
                onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && !title.trim() && setAdding(null)}>
                <Select label={t('field.type')} value={type} onChange={setType} options={project.types.filter((x) => x.level === 1).map((x) => ({ value: String(x.id), label: x.name, icon: <TypeIcon type={x} /> }))} />
                <input autoFocus placeholder={t('backlog.newIssue')} aria-label={t('backlog.newIssue')} value={title} onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setAdding(null)} />
                <button className="primary sm" disabled={!title.trim()}>{t('common.create')}</button>
              </form>
            ) : (
              project.level >= 2 && <button className="add-btn" onClick={() => { setTitle(''); setAdding(id) }}><Icon name="plus" /> {t('backlog.create')}</button>
            )}
          </section>
        )
      })}
    </div>
  )
}

function confirmComplete(project: Project, s: Sprint, act: (p: Promise<unknown>) => void) {
  const next = project.sprints.find((x) => x.state === 'planned')
  // Unfinished work goes to the next planned sprint if there is one, else back to the backlog.
  act(api('POST', `/api/projects/${project.key}/sprints/${s.id}/complete`, { moveTo: next?.id ?? null }).then((r) =>
    toast(t('sprint.completed', { n: r.moved, to: next ? next.name : t('project.backlog') }))))
}
