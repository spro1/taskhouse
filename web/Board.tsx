import { useEffect, useState, type DragEvent, type FormEvent } from 'react'
import { api, message, PRIORITIES, searchAll, subscribe, type Issue, type Project, type Sprint } from './api.ts'
import { Link, toast } from './App.tsx'

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

function Card({ issue }: { issue: Issue }) {
  return (
    <div className="card-issue" draggable onDragStart={(e) => dragKey(e, issue.key)}>
      <Link to={`/browse/${issue.key}`}>{issue.title}</Link>
      <div className="meta">
        <span className="key">{issue.key}</span>
        <span className="muted">{issue.type.name}</span>
        {issue.priority < 2 && <span className="pill c3">{PRIORITIES[issue.priority]}</span>}
        {issue.points !== null && <span className="pts">{issue.points}</span>}
        <span className="grow" />
        {issue.assignee && <span className="avatar" title={issue.assignee.name}>{issue.assignee.name.slice(0, 2)}</span>}
      </div>
    </div>
  )
}

export function Board({ project }: { project: Project }) {
  const active = project.sprints.find((s) => s.state === 'active')
  const [issues, setIssues] = useState<Issue[]>([])
  const [over, setOver] = useState<number | null>(null)
  const load = () => {
    const scope = active ? { field: 'sprint', value: active.id }
      : { or: [{ field: 'statusCategory', op: '!=', value: 'done' }, { field: 'resolved', op: '>=', value: '-14d' }] }
    searchAll({ and: [{ field: 'project', value: project.key }, scope, { field: 'type', op: '!=', value: '에픽' }] }).then(setIssues, (e) => toast(message(e)))
  }
  useEffect(load, [project.key, active?.id])
  useLiveReload(project.key, load, [active?.id])
  return (
    <>
      <p className="muted">{active ? `${active.name}${active.endsAt ? ` · ${new Date(active.endsAt).toLocaleDateString()}까지` : ''}` : '진행 중인 스프린트가 없어 열린 이슈 전체(최근 14일 완료 포함)를 보여 줍니다.'}</p>
      <div className="board">
        {project.statuses.map((s) => {
          const col = issues.filter((i) => i.status.id === s.id)
          return (
            <section key={s.id} className={`column ${over === s.id ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(s.id) }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const k = dropKey(e); const it = issues.find((i) => i.key === k); move(k, { to: it?.status.id === s.id ? undefined : s.id, after: col.at(-1)?.key }, load) }}>
              <h3><span className={`dot c${s.category}`} />{s.name} <span className="muted">{col.length}</span></h3>
              {col.map((i) => (
                <div key={i.id} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(null); const k = dropKey(e); const it = issues.find((x) => x.key === k); move(k, { to: it?.status.id === s.id ? undefined : s.id, before: i.key }, load) }}>
                  <Card issue={i} />
                </div>
              ))}
            </section>
          )
        })}
      </div>
    </>
  )
}

export function Backlog({ project, reload }: { project: Project; reload: () => void }) {
  const [issues, setIssues] = useState<Issue[]>([])
  const [title, setTitle] = useState('')
  const [type, setType] = useState('작업')
  const load = () => searchAll({ and: [{ field: 'project', value: project.key }, { field: 'statusCategory', op: '!=', value: 'done' }, { field: 'type', op: '!=', value: '에픽' }] })
    .then(setIssues, (e) => toast(message(e)))
  useEffect(() => { load() }, [project.key])
  useLiveReload(project.key, () => { load(); reload() })
  const sprints: (Sprint | null)[] = [...project.sprints.filter((s) => s.state === 'active'), ...project.sprints.filter((s) => s.state === 'planned'), null]
  const act = (p: Promise<unknown>) => p.then(() => { reload(); load() }, (e) => toast(message(e)))
  const create = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    act(api('POST', `/api/projects/${project.key}/issues`, { title, type }))
    setTitle('')
  }
  return (
    <div className="backlog">
      {sprints.map((s) => {
        const rows = issues.filter((i) => (i.sprint?.id ?? null) === (s?.id ?? null))
        const pts = rows.reduce((n, i) => n + (i.points ?? 0), 0)
        return (
          <section key={s?.id ?? 'backlog'} onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); move(dropKey(e), { sprint: s?.id ?? null, after: rows.at(-1)?.key }, load) }}>
            <header>
              <h3>{s ? s.name : '백로그'} <span className="muted">{rows.length}건 · {pts}점</span></h3>
              <span className="grow" />
              {s?.state === 'planned' && <button onClick={() => act(api('POST', `/api/projects/${project.key}/sprints/${s.id}/start`, { days: 14 }))}>스프린트 시작</button>}
              {s?.state === 'active' && <button onClick={() => confirmComplete(project, s, act)}>스프린트 완료</button>}
              {!s && <button onClick={() => act(api('POST', `/api/projects/${project.key}/sprints`, {}))}>스프린트 만들기</button>}
            </header>
            <ul className="list rows">
              {rows.map((i) => (
                <li key={i.id} draggable onDragStart={(e) => dragKey(e, i.key)}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); move(dropKey(e), { sprint: (s?.id ?? null) === (issues.find((x) => x.key === dropKey(e))?.sprint?.id ?? null) ? undefined : s?.id ?? null, before: i.key }, load) }}>
                  <Link to={`/browse/${i.key}`}><span className="key">{i.key}</span> {i.title}</Link>
                  <span className="muted">{i.type.name}</span>
                  <span className={`pill c${i.status.category}`}>{i.status.name}</span>
                  <span className="pts">{i.points ?? '-'}</span>
                  <span className="avatar" title={i.assignee?.name}>{i.assignee?.name.slice(0, 2) ?? ''}</span>
                </li>
              ))}
            </ul>
            {!s && (
              <form className="inline" onSubmit={create}>
                <select value={type} onChange={(e) => setType(e.target.value)}>{project.types.filter((t) => t.level === 1).map((t) => <option key={t.id}>{t.name}</option>)}</select>
                <input placeholder="새 이슈 제목 입력 후 Enter" value={title} onChange={(e) => setTitle(e.target.value)} />
              </form>
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
    toast(`스프린트를 완료했습니다. 미완료 ${r.moved}건을 ${next ? next.name : '백로그'}로 옮겼습니다.`)))
}
