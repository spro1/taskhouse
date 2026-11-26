import { useEffect, useState } from 'react'
import { DocView, Editor } from './Editor.tsx'
import { api, ApiError, message, PRIORITIES, subscribe, type Issue, type Project, type Ref } from './api.ts'
import { IssueList, Link, nav, toast, type Me } from './App.tsx'
import { t, type Key } from './i18n.ts'

type Related = { children: Issue[]; links: { kind: string; outward: boolean; key: string; title: string; status: string; category: number }[]; attachments: { id: number; name: string; size: number }[]; watching: boolean }
const LINK_TEXT: Record<string, [Key, Key]> = { blocks: ['link.blocks', 'link.blockedBy'], relates: ['link.relates', 'link.relates'], duplicates: ['link.duplicates', 'link.duplicatedBy'] }
const FIELD_NAMES: Record<string, Key> = {
  created: 'history.created', title: 'col.title', doc: 'field.description', status: 'field.status', assignee: 'field.assignee', type: 'field.type', priority: 'field.priority', parent: 'field.parent',
  sprint: 'field.sprint', points: 'field.points', due: 'field.due', labels: 'field.labels', link: 'field.links', attachment: 'field.attachments', deleted: 'history.deleted', restored: 'history.restored',
}
const show = (v: any): string => (v === null || v === undefined ? t('common.empty') : Array.isArray(v) ? v.join(', ') || t('common.empty') : typeof v === 'object' ? v.name ?? JSON.stringify(v) : String(v))

export function IssueView({ issueKey, me }: { issueKey: string; me: Me }) {
  const [issue, setIssue] = useState<Issue | null>()
  const [project, setProject] = useState<Project>()
  const [related, setRelated] = useState<Related>()
  const [moves, setMoves] = useState<{ name: string; to: { id: number; name: string } }[]>([])
  const [comments, setComments] = useState<any[]>([])
  const [changes, setChanges] = useState<any[]>([])
  const [tab, setTab] = useState<'comments' | 'history'>('comments')
  const [users, setUsers] = useState<Ref[]>([])
  const [editingDesc, setEditingDesc] = useState(false)
  const [commentKey, setCommentKey] = useState(0)
  const base = `/api/issues/${issueKey}`

  const load = async () => {
    try {
      const i = await api<Issue>('GET', base)
      setIssue(i)
      const pkey = issueKey.split('-')[0]
      const [p, r, m, cm, ch] = await Promise.all([api('GET', `/api/projects/${pkey}`), api('GET', `${base}/related`), api('GET', `${base}/transitions`), api('GET', `${base}/comments`), api('GET', `${base}/changes`)])
      setProject(p); setRelated(r); setMoves(m); setComments(cm); setChanges(ch)
    } catch (e) {
      setIssue(e instanceof ApiError && e.status === 404 ? null : undefined)
    }
  }
  useEffect(() => { setEditingDesc(false); load() }, [issueKey])
  // Someone else's change to this issue (or its comments) shows up without a reload; open editors keep their text.
  useEffect(() => {
    if (!issue) return
    return subscribe(issueKey.split('-')[0], (ids) => { if (!ids || ids.includes(issue.id)) load() })
  }, [issueKey, issue?.id])
  useEffect(() => { api<Ref[]>('GET', '/api/users').then(setUsers) }, [])

  if (issue === null) return <p>{t('issue.notFound')}</p>
  if (!issue || !project || !related) return null
  const canEdit = project.level >= 3 || (project.level === 2 && issue.reporter.id === me.id)

  // Each field saves on its own with the value it started from, so a concurrent edit of another field is kept.
  const save = async (field: string, value: unknown) => {
    try {
      setIssue(await api('PATCH', base, { [field]: value, _base: { [field]: (issue as any)[field] } }))
      api('GET', `${base}/changes`).then(setChanges)
    } catch (e) {
      toast(message(e))
      load()
    }
  }
  const act = (p: Promise<unknown>) => p.then(load, (e) => toast(message(e)))
  const sprintChoices = project.sprints

  return (
    <div className="issue">
      <div className="main">
        <div className="crumbs">
          <Link to={`/p/${project.key}`}>{project.name}</Link>
          {issue.parent && <> / <Link to={`/browse/${issue.parent}`}>{issue.parent}</Link></>}
          {' / '}<span className="key">{issue.key}</span>
        </div>
        <input className="title" defaultValue={issue.title} key={`t${issue.title}`} disabled={!canEdit}
          onBlur={(e) => e.target.value.trim() && e.target.value !== issue.title && save('title', e.target.value)} />
        <h4>{t('field.description')}</h4>
        {!editingDesc ? (
          <div className="desc" onClick={(e) => canEdit && !(e.target as HTMLElement).closest('a') && setEditingDesc(true)}>
            <DocView doc={issue.doc} empty={<p className="muted">{canEdit ? t('issue.addDescription') : t('issue.noDescription')}</p>} />
          </div>
        ) : (
          <Editor content={issue.doc} placeholder={t('field.description')} onSubmit={(doc) => { save('doc', doc); setEditingDesc(false) }} onCancel={() => setEditingDesc(false)} />
        )}

        {(related.children.length > 0 || issue.type.level < 2) && (
          <>
            <h4>{issue.type.level === 0 ? t('issue.epicChildren') : t('issue.subtasks')}</h4>
            <IssueList issues={related.children} />
            {canEdit && issue.type.level < 2 && <QuickChild project={project} parent={issue} onDone={load} />}
          </>
        )}

        <h4>{t('field.links')}</h4>
        <ul className="list">
          {related.links.map((l) => (
            <li key={`${l.kind}${l.key}${l.outward}`}>
              <span className="muted">{t(LINK_TEXT[l.kind][l.outward ? 0 : 1])}</span> <Link to={`/browse/${l.key}`}><span className="key">{l.key}</span> {l.title}</Link>
              <span className={`pill c${l.category}`}>{l.status}</span>
              {canEdit && <button className="ghost" onClick={() => act(api('DELETE', `${base}/links`, { kind: l.kind === 'blocks' && !l.outward ? 'is_blocked_by' : l.kind, target: l.key }))}>×</button>}
            </li>
          ))}
        </ul>
        {canEdit && <AddLink base={base} onDone={load} />}

        <h4>{t('field.attachments')}</h4>
        <ul className="list">
          {related.attachments.map((a) => <li key={a.id}><a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">{a.name}</a> <span className="muted">{Math.ceil(a.size / 1024)} KB</span></li>)}
        </ul>
        {project.level >= 2 && (
          <input type="file" onChange={(e) => {
            const f = e.target.files?.[0]
            if (!f) return
            const form = new FormData()
            form.append('file', f)
            act(api('POST', `${base}/attachments`, form))
            e.target.value = ''
          }} />
        )}

        <nav className="tabs small">
          <button className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>{t('issue.comments', { n: comments.length })}</button>
          <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>{t('issue.history', { n: changes.length })}</button>
        </nav>
        {tab === 'comments' ? (
          <>
            {comments.map((c) => (
              <div key={c.id} className="comment">
                <b>{c.author.name}</b> <span className="muted">{new Date(c.createdAt).toLocaleString()}</span>
                {(c.author.id === me.id || project.level >= 4) && <button className="ghost" onClick={() => act(api('DELETE', `${base}/comments/${c.id}`))}>{t('common.delete')}</button>}
                <DocView doc={c.doc} />
              </div>
            ))}
            {project.level >= 2 && (
              <Editor key={commentKey} placeholder={t('issue.comment')} submitLabel={t('issue.addComment')}
                onSubmit={(doc) => act(api('POST', `${base}/comments`, { doc }).then(() => setCommentKey((k) => k + 1)))} />
            )}
          </>
        ) : (
          <ul className="list history">
            {changes.map((c) => (
              <li key={c.id}>
                <span className="muted">{new Date(c.at).toLocaleString()}</span> <b>{c.actor?.name ?? t('common.system')}</b> {FIELD_NAMES[c.field] ? t(FIELD_NAMES[c.field]) : c.field}
                {c.field !== 'created' && c.field !== 'deleted' && c.field !== 'restored' && <> : {c.field === 'doc' ? t('history.docChanged') : `${show(c.old)} → ${show(c.new)}`}</>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="side">
        <label>{t('field.status')}
          <select value="" disabled={!canEdit || !moves.length} onChange={(e) => act(api('POST', `${base}/transitions`, { to: Number(e.target.value), lockVersion: issue.lockVersion }))}>
            <option value="">{issue.status.name}</option>
            {moves.map((m) => <option key={m.to.id} value={m.to.id}>{m.name === m.to.name ? `→ ${m.to.name}` : `${m.name} → ${m.to.name}`}</option>)}
          </select>
        </label>
        <label>{t('field.assignee')}
          <select value={issue.assignee?.id ?? ''} disabled={!canEdit} onChange={(e) => save('assignee', e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('common.empty')}</option>
            {!users.some((u) => u.id === issue.assignee?.id) && issue.assignee && <option value={issue.assignee.id}>{issue.assignee.name}</option>}
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {canEdit && issue.assignee?.id !== me.id && <button className="link" onClick={() => save('assignee', me.id)}>{t('issue.assignMe')}</button>}
        </label>
        <label>{t('field.type')}
          <select value={issue.type.id} disabled={!canEdit} onChange={(e) => save('type', Number(e.target.value))}>
            {project.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>{t('field.priority')}
          <select value={issue.priority} disabled={!canEdit} onChange={(e) => save('priority', Number(e.target.value))}>
            {PRIORITIES.map((p, i) => <option key={i} value={i}>{p}</option>)}
          </select>
        </label>
        <label>{t('field.sprint')}
          <select value={issue.sprint?.id ?? ''} disabled={!canEdit} onChange={(e) => save('sprint', e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('project.backlog')}</option>
            {issue.sprint && !sprintChoices.some((s) => s.id === issue.sprint!.id) && <option value={issue.sprint.id}>{issue.sprint.name}</option>}
            {sprintChoices.map((s) => <option key={s.id} value={s.id}>{s.name}{s.state === 'active' ? ` (${t('sprint.active')})` : ''}</option>)}
          </select>
        </label>
        <label>{t('field.points')}
          <input type="number" min={0} step={0.5} defaultValue={issue.points ?? ''} key={`p${issue.points}`} disabled={!canEdit}
            onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== issue.points) save('points', v) }} />
        </label>
        <label>{t('field.due')}
          <input type="date" value={issue.due ?? ''} disabled={!canEdit} onChange={(e) => save('due', e.target.value || null)} />
        </label>
        <label>{t('field.labels')}
          <input defaultValue={issue.labels.join(', ')} key={`l${issue.labels.join()}`} disabled={!canEdit} placeholder={t('issue.labelsHint')}
            onBlur={(e) => { const v = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); if (v.join() !== issue.labels.join()) save('labels', v) }} />
        </label>
        <label>{t('field.parent')}
          <input defaultValue={issue.parent ?? ''} key={`pa${issue.parent}`} disabled={!canEdit} placeholder={issue.type.level === 0 ? t('issue.epicNoParent') : `${project.key}-1`}
            onBlur={(e) => { const v = e.target.value.trim().toUpperCase() || null; if (v !== issue.parent) save('parent', v) }} />
        </label>
        <p className="muted small">
          {t('issue.reporter')} {issue.reporter.name}<br />
          {t('issue.created')} {new Date(issue.createdAt).toLocaleString()}<br />
          {t('issue.updated')} {new Date(issue.updatedAt).toLocaleString()}
          {issue.resolvedAt && <><br />{t('issue.resolved')} {new Date(issue.resolvedAt).toLocaleString()}</>}
        </p>
        <button onClick={() => act(api(related.watching ? 'DELETE' : 'POST', `${base}/watch`))}>{related.watching ? t('issue.unwatch') : t('issue.watch')}</button>
        {canEdit && <button className="danger" onClick={() => { if (confirm(t('issue.deleteConfirm', { key: issue.key }))) api('DELETE', base).then(() => nav(`/p/${project.key}`), (e) => toast(message(e))) }}>{t('common.delete')}</button>}
      </aside>
    </div>
  )
}

function QuickChild({ project, parent, onDone }: { project: Project; parent: Issue; onDone: () => void }) {
  const [title, setTitle] = useState('')
  // Under an epic the default child is a story (a type name from the data); under a story, the subtask type.
  const type = project.types.find((x) => x.level === parent.type.level + 1 && (parent.type.level === 1 || x.name === '스토리')) ?? project.types.find((x) => x.level === parent.type.level + 1)
  return (
    <form className="inline" onSubmit={(e) => {
      e.preventDefault()
      if (!title.trim() || !type) return
      api('POST', `/api/projects/${project.key}/issues`, { title, type: type.id, parent: parent.key }).then(() => { setTitle(''); onDone() }, (x) => toast(message(x)))
    }}>
      <input placeholder={t('issue.addChild', { type: type?.name ?? t('issue.child') })} aria-label={t('issue.addChild', { type: type?.name ?? t('issue.child') })} value={title} onChange={(e) => setTitle(e.target.value)} />
    </form>
  )
}

function AddLink({ base, onDone }: { base: string; onDone: () => void }) {
  const [kind, setKind] = useState('blocks')
  const [target, setTarget] = useState('')
  return (
    <form className="inline" onSubmit={(e) => {
      e.preventDefault()
      api('POST', `${base}/links`, { kind, target: target.trim().toUpperCase() }).then(() => { setTarget(''); onDone() }, (x) => toast(message(x)))
    }}>
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="blocks">{t('link.blocks')}</option><option value="is_blocked_by">{t('link.blockedBy')}</option><option value="relates">{t('link.relates')}</option><option value="duplicates">{t('link.duplicates')}</option>
      </select>
      <input placeholder={t('col.key')} aria-label={t('col.key')} value={target} onChange={(e) => setTarget(e.target.value)} required />
      <button>{t('link.add')}</button>
    </form>
  )
}
