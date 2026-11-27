import { useEffect, useState, type FormEvent } from 'react'
import { api, message, PRIORITIES, type Issue } from './api.ts'
import { Link, toast } from './App.tsx'
import { t } from './i18n.ts'
import { Avatar, PriorityIcon, TypeIcon } from './icons.tsx'

type Filter = { id: number; name: string; tql: string | null }
const EXAMPLES = [
  'assignee = currentUser() AND statusCategory != done ORDER BY priority',
  'sprint IN openSprints() AND type = 버그',
  'text ~ "배포" AND updated >= -7d ORDER BY updated DESC',
  'status CHANGED FROM 완료 AFTER -30d',
]

// TQL search (a JQL subset). The query lives in the URL (?q=), so a search can be bookmarked or shared.
export function Search() {
  const initial = new URLSearchParams(location.search).get('q') ?? EXAMPLES[0]
  const [q, setQ] = useState(initial)
  const [issues, setIssues] = useState<Issue[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState<Filter[]>([])
  const loadFilters = () => api<Filter[]>('GET', '/api/filters').then(setFilters)
  const run = async (tql: string, cursor: string | null = null) => {
    try {
      const r = await api('POST', '/api/search', { tql, cursor, limit: 100 })
      setIssues(cursor ? [...issues, ...r.issues] : r.issues)
      setNext(r.next)
      setError('')
      if (!cursor) history.replaceState(null, '', `/search?q=${encodeURIComponent(tql)}`)
    } catch (e) {
      setError(message(e))
    }
  }
  useEffect(() => { run(initial); loadFilters() }, [])
  const submit = (e: FormEvent) => { e.preventDefault(); run(q) }
  const save = () => {
    const name = prompt(t('search.filterName'))
    if (name) api('POST', '/api/filters', { name, tql: q }).then(loadFilters, (e) => toast(message(e)))
  }
  return (
    <>
    <div className="page-head"><h1>{t('nav.search')}</h1></div>
    <div className="search-page">
      <aside>
        <h3>{t('search.saved')}</h3>
        <ul className="list">
          {filters.map((f) => (
            <li key={f.id}>
              <a href="#" onClick={(e) => { e.preventDefault(); if (f.tql) { setQ(f.tql); run(f.tql) } }}>{f.name}</a>
              <button className="ghost" aria-label={t('search.deleteFilter')} onClick={() => api('DELETE', `/api/filters/${f.id}`).then(loadFilters)}>×</button>
            </li>
          ))}
          {!filters.length && <li className="muted">{t('common.none')}</li>}
        </ul>
        <h3>{t('search.examples')}</h3>
        {EXAMPLES.map((x) => <button key={x} className="link example" onClick={() => { setQ(x); run(x) }}>{x}</button>)}
      </aside>
      <div>
        <form onSubmit={submit} className="inline">
          <input className="tql" value={q} onChange={(e) => setQ(e.target.value)} aria-label="TQL" spellCheck={false} />
          <button className="primary">{t('search.run')}</button>
          <button type="button" onClick={save}>{t('search.save')}</button>
        </form>
        {error ? <p className="error">{error}</p> : <p className="muted">{t(next ? 'search.countMore' : 'search.count', { n: issues.length })}</p>}
        <table className="results">
          <thead><tr><th>{t('col.key')}</th><th>{t('col.title')}</th><th>{t('field.type')}</th><th>{t('field.status')}</th><th>{t('field.priority')}</th><th>{t('field.assignee')}</th><th>{t('col.updated')}</th></tr></thead>
          <tbody>
            {issues.map((i) => (
              <tr key={i.id}>
                <td className="key">{i.key}</td>
                <td><Link to={`/browse/${i.key}`}>{i.title}</Link></td>
                <td><span className="cell"><TypeIcon type={i.type} />{i.type.name}</span></td>
                <td><span className={`lozenge c${i.status.category}`}>{i.status.name}</span></td>
                <td><span className="cell"><PriorityIcon priority={i.priority} label={PRIORITIES[i.priority]} />{PRIORITIES[i.priority]}</span></td>
                <td>{i.assignee && <span className="cell"><Avatar user={i.assignee} size="sm" />{i.assignee.name}</span>}</td>
                <td className="muted">{new Date(i.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {next && <button onClick={() => run(q, next)}>{t('common.more')}</button>}
      </div>
    </div>
    </>
  )
}
