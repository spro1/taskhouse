import { useEffect, useRef, useState } from 'react'
import { DocView, Editor } from './Editor.tsx'
import { api, ApiError, message, PRIORITIES, subscribe, type Issue, type Project, type Ref } from './api.ts'
import { IssueList, Link, nav, toast, type Me } from './App.tsx'
import { t, type Key } from './i18n.ts'
import { Avatar, Icon, PriorityIcon, TypeIcon } from './icons.tsx'
import { Select } from './Select.tsx'

type Related = { children: Issue[]; links: { kind: string; outward: boolean; key: string; title: string; status: string; category: number }[]; attachments: { id: number; name: string; size: number }[]; watching: boolean }
const LINK_TEXT: Record<string, [Key, Key]> = { blocks: ['link.blocks', 'link.blockedBy'], relates: ['link.relates', 'link.relates'], duplicates: ['link.duplicates', 'link.duplicatedBy'] }
const FIELD_NAMES: Record<string, Key> = {
  created: 'history.created', title: 'col.title', doc: 'field.description', status: 'field.status', assignee: 'field.assignee', type: 'field.type', priority: 'field.priority', parent: 'field.parent',
  sprint: 'field.sprint', points: 'field.points', due: 'field.due', labels: 'field.labels', link: 'field.links', attachment: 'field.attachments', deleted: 'history.deleted', restored: 'history.restored',
}
const show = (v: any): string => (v === null || v === undefined ? t('common.empty') : Array.isArray(v) ? v.join(', ') || t('common.empty') : typeof v === 'object' ? v.name ?? JSON.stringify(v) : String(v))

// `panel`: shown in the side panel next to a board or backlog, in one column.
export function IssueView({ issueKey, me, panel = false }: { issueKey: string; me: Me; panel?: boolean }) {
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
  const [adding, setAdding] = useState<'child' | 'link' | null>(null)
  const [menu, setMenu] = useState(false)
  const file = useRef<HTMLInputElement>(null)
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

  const done = related.children.filter((c) => c.status.category === 2).length
  const upload = (f?: File) => {
    if (!f) return
    const form = new FormData()
    form.append('file', f)
    act(api('POST', `${base}/attachments`, form))
  }

  const side = (
    <>
        <div className="side-top">
          <Select className={`status-select c${issue.status.category}`} label={t('field.status')} disabled={!canEdit || !moves.length} value={issue.status.id}
            options={[{ value: issue.status.id, label: issue.status.name }, ...moves.map((m) => ({ value: m.to.id, label: m.to.name, hint: m.name === m.to.name ? undefined : m.name }))]}
            onChange={(to) => act(api('POST', `${base}/transitions`, { to, lockVersion: issue.lockVersion }))} />
          <span className="grow" />
          <button className={`ghost ${related.watching ? 'on' : ''}`} aria-pressed={related.watching} onClick={() => act(api(related.watching ? 'DELETE' : 'POST', `${base}/watch`))}>
            <Icon name="eye" /> {related.watching ? t('issue.unwatch') : t('issue.watch')}
          </button>
          {canEdit && (
            <div className="menu-wrap">
              <button className="ghost icon" aria-label={t('issue.moreActions')} aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="more" /></button>
              {menu && (
                <div className="dropdown" role="menu">
                  <button role="menuitem" className="danger" onClick={() => { setMenu(false); if (confirm(t('issue.deleteConfirm', { key: issue.key }))) api('DELETE', base).then(() => nav(`/p/${project.key}`), (e) => toast(message(e))) }}>
                    <Icon name="trash" /> {t('common.delete')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <section className="details">
          <h3>{t('issue.details')}</h3>
          <div className="fields">
            <span>{t('field.assignee')}</span>
            <Select label={t('field.assignee')} disabled={!canEdit} value={issue.assignee?.id ?? 0}
              options={[{ value: 0, label: t('board.unassigned'), icon: <Avatar user={null} size="sm" /> },
                ...(issue.assignee && !users.some((u) => u.id === issue.assignee!.id) ? [issue.assignee] : []).concat(users).map((u) => ({ value: u.id, label: u.name, icon: <Avatar user={u} size="sm" /> }))]}
              onChange={(v) => save('assignee', v || null)} />
            {canEdit && issue.assignee?.id !== me.id && <button className="link note" onClick={() => save('assignee', me.id)}>{t('issue.assignMe')}</button>}
            <span>{t('issue.reporter')}</span>
            <div className="with-avatar"><Avatar user={issue.reporter} size="sm" /> {issue.reporter.name}</div>
            <span>{t('field.type')}</span>
            <Select label={t('field.type')} disabled={!canEdit} value={issue.type.id}
              options={project.types.map((x) => ({ value: x.id, label: x.name, icon: <TypeIcon type={x} /> }))} onChange={(v) => save('type', v)} />
            <span>{t('field.priority')}</span>
            <Select label={t('field.priority')} disabled={!canEdit} value={issue.priority}
              options={PRIORITIES.map((p, i) => ({ value: i, label: p, icon: <PriorityIcon priority={i} label={p} /> }))} onChange={(v) => save('priority', v)} />
            <span>{t('field.sprint')}</span>
            <Select label={t('field.sprint')} disabled={!canEdit} value={issue.sprint?.id ?? 0}
              options={[{ value: 0, label: t('project.backlog') },
                ...(issue.sprint && !sprintChoices.some((x) => x.id === issue.sprint!.id) ? [{ value: issue.sprint.id, label: issue.sprint.name }] : []),
                ...sprintChoices.map((x) => ({ value: x.id, label: x.name, hint: x.state === 'active' ? t('sprint.active') : undefined }))]}
              onChange={(v) => save('sprint', v || null)} />
            <span>{t('field.points')}</span>
            <input type="number" min={0} step={0.5} defaultValue={issue.points ?? ''} key={`p${issue.points}`} disabled={!canEdit} aria-label={t('field.points')} placeholder={t('common.empty')}
              onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== issue.points) save('points', v) }} />
            <span>{t('field.due')}</span>
            <input type="date" value={issue.due ?? ''} disabled={!canEdit} aria-label={t('field.due')} onChange={(e) => save('due', e.target.value || null)} />
            <span>{t('field.labels')}</span>
            <input defaultValue={issue.labels.join(', ')} key={`l${issue.labels.join()}`} disabled={!canEdit} aria-label={t('field.labels')} placeholder={t('issue.labelsHint')}
              onBlur={(e) => { const v = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); if (v.join() !== issue.labels.join()) save('labels', v) }} />
            <span>{t('field.parent')}</span>
            <ParentField issue={issue} canEdit={canEdit} onSave={(v) => save('parent', v)} />
          </div>
        </section>
        <div className="dates">
          {t('issue.created')} {new Date(issue.createdAt).toLocaleString()}<br />
          {t('issue.updated')} {new Date(issue.updatedAt).toLocaleString()}
          {issue.resolvedAt && <><br />{t('issue.resolved')} {new Date(issue.resolvedAt).toLocaleString()}</>}
        </div>
    </>
  )

  return (
    <div className={`issue ${panel ? 'in-drawer' : ''}`}>
      <div className="main">
        <div className="crumbs">
          <Link to="/">{t('home.projects')}</Link><i>/</i>
          <Link to={`/p/${project.key}`}>{project.name}</Link><i>/</i>
          {issue.parent && <><Link to={`/browse/${issue.parent}`}>{issue.parent}</Link><i>/</i></>}
          <TypeIcon type={issue.type} size={14} /><span className="key">{issue.key}</span>
        </div>
        <input className="title" defaultValue={issue.title} key={`t${issue.title}`} disabled={!canEdit} aria-label={t('col.title')}
          onBlur={(e) => e.target.value.trim() && e.target.value !== issue.title && save('title', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        <div className="issue-actions">
          {project.level >= 2 && <button onClick={() => file.current?.click()}><Icon name="paperclip" size={14} /> {t('issue.attach')}</button>}
          {canEdit && issue.type.level < 2 && <button onClick={() => setAdding('child')}><Icon name="subtask" size={14} /> {t('issue.addChildButton')}</button>}
          {canEdit && <button onClick={() => setAdding('link')}><Icon name="link" size={14} /> {t('issue.addLink')}</button>}
          <input ref={file} type="file" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        {panel && <div className="side in-panel">{side}</div>}

        <h4>{t('field.description')}</h4>
        {!editingDesc ? (
          <div className="desc" onClick={(e) => canEdit && !(e.target as HTMLElement).closest('a') && setEditingDesc(true)}>
            <DocView doc={issue.doc} empty={<p className="muted">{canEdit ? t('issue.addDescription') : t('issue.noDescription')}</p>} />
          </div>
        ) : (
          <Editor content={issue.doc} placeholder={t('field.description')} onSubmit={(doc) => { save('doc', doc); setEditingDesc(false) }} onCancel={() => setEditingDesc(false)} />
        )}

        {(related.children.length > 0 || adding === 'child') && (
          <>
            <h4>{issue.type.level === 0 ? t('issue.epicChildren') : t('issue.subtasks')}</h4>
            {related.children.length > 0 && (
              <div className="progress">
                <div className="bar"><span style={{ width: `${(done / related.children.length) * 100}%` }} /></div>
                {t('issue.done', { done, total: related.children.length })}
              </div>
            )}
            {related.children.length > 0 && <IssueList issues={related.children} />}
            {canEdit && issue.type.level < 2 && adding === 'child' && <QuickChild project={project} parent={issue} onDone={load} onClose={() => setAdding(null)} />}
          </>
        )}

        {(related.links.length > 0 || adding === 'link') && (
          <>
            <h4>{t('field.links')}</h4>
            {related.links.length > 0 && (
              <ul className="list boxed">
                {related.links.map((l) => (
                  <li key={`${l.kind}${l.key}${l.outward}`}>
                    <span className="muted small" style={{ width: 110 }}>{t(LINK_TEXT[l.kind][l.outward ? 0 : 1])}</span>
                    <span className="key">{l.key}</span>
                    <Link to={`/browse/${l.key}`}>{l.title}</Link>
                    <span className={`lozenge c${l.category}`}>{l.status}</span>
                    {canEdit && <button className="ghost icon sm" aria-label={t('common.delete')} onClick={() => act(api('DELETE', `${base}/links`, { kind: l.kind === 'blocks' && !l.outward ? 'is_blocked_by' : l.kind, target: l.key }))}><Icon name="x" size={14} /></button>}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && adding === 'link' && <AddLink base={base} self={issue.key} onDone={load} onClose={() => setAdding(null)} />}
          </>
        )}

        {related.attachments.length > 0 && (
          <>
            <h4>{t('field.attachments')}</h4>
            <div className="attachments">
              {related.attachments.map((a) => (
                <a key={a.id} className="attachment" href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">
                  <Icon name="paperclip" size={14} />{a.name} <span className="muted small">{Math.ceil(a.size / 1024)} KB</span>
                </a>
              ))}
            </div>
          </>
        )}

        <h4>{t('issue.activity')}</h4>
        <nav className="tabs" style={{ marginTop: 0 }}>
          <button className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>{t('issue.comments', { n: comments.length })}</button>
          <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>{t('issue.history', { n: changes.length })}</button>
        </nav>
        {tab === 'comments' ? (
          <>
            {project.level >= 2 && (
              <div className="comment">
                <Avatar user={me} size="lg" />
                <Editor key={commentKey} placeholder={t('issue.comment')} submitLabel={t('issue.addComment')}
                  onSubmit={(doc) => act(api('POST', `${base}/comments`, { doc }).then(() => setCommentKey((k) => k + 1)))} />
              </div>
            )}
            {comments.map((c) => (
              <div key={c.id} className="comment">
                <Avatar user={c.author} size="lg" />
                <div>
                  <div className="who">
                    <b>{c.author.name}</b> <span className="muted small">{new Date(c.createdAt).toLocaleString()}</span>
                    {(c.author.id === me.id || project.level >= 4) && <button className="ghost" onClick={() => act(api('DELETE', `${base}/comments/${c.id}`))}>{t('common.delete')}</button>}
                  </div>
                  <DocView doc={c.doc} />
                </div>
              </div>
            ))}
          </>
        ) : (
          <ul className="list history">
            {changes.map((c) => (
              <li key={c.id}>
                <b>{c.actor?.name ?? t('common.system')}</b> {FIELD_NAMES[c.field] ? t(FIELD_NAMES[c.field]) : c.field}
                {c.field !== 'created' && c.field !== 'deleted' && c.field !== 'restored' && <> : {c.field === 'doc' ? t('history.docChanged') : `${show(c.old)} → ${show(c.new)}`}</>}
                <span className="muted small"> · {new Date(c.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!panel && <aside className="side">{side}</aside>}
    </div>
  )
}

function QuickChild({ project, parent, onDone, onClose }: { project: Project; parent: Issue; onDone: () => void; onClose: () => void }) {
  const [title, setTitle] = useState('')
  // Under an epic the default child is a story (a type name from the data); under a story, the subtask type.
  const type = project.types.find((x) => x.level === parent.type.level + 1 && (parent.type.level === 1 || x.name === '스토리')) ?? project.types.find((x) => x.level === parent.type.level + 1)
  return (
    <form className="inline" onSubmit={(e) => {
      e.preventDefault()
      if (!title.trim() || !type) return
      api('POST', `/api/projects/${project.key}/issues`, { title, type: type.id, parent: parent.key }).then(() => { setTitle(''); onDone() }, (x) => toast(message(x)))
    }}>
      <input autoFocus placeholder={t('issue.addChild', { type: type?.name ?? t('issue.child') })} aria-label={t('issue.addChild', { type: type?.name ?? t('issue.child') })} value={title} onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onClose()} />
      <button className="primary">{t('common.add')}</button>
      <button type="button" onClick={onClose}>{t('common.cancel')}</button>
    </form>
  )
}

/** Find an issue by key or words in its title (quick search), with the keyboard or the mouse. */
export function IssuePicker({ onPick, exclude = [], placeholder, onEscape, accept = () => true }: { onPick: (i: Issue) => void; exclude?: string[]; placeholder: string; onEscape?: () => void; accept?: (i: Issue) => boolean }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Issue[]>([])
  const [idx, setIdx] = useState(0)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!q.trim()) return setHits([])
    const t = setTimeout(() => api('GET', `/api/quick?q=${encodeURIComponent(q.trim())}`).then((r) => { setHits(r.issues.filter((i: Issue) => !exclude.includes(i.key) && accept(i)).slice(0, 8)); setIdx(0) }, () => setHits([])), 150)
    return () => clearTimeout(t)
  }, [q])
  const pick = (i: Issue) => { onPick(i); setQ(''); setHits([]) }
  return (
    <div className="picker">
      <input autoFocus value={q} placeholder={placeholder} aria-label={placeholder} role="combobox" aria-expanded={open && hits.length > 0} aria-autocomplete="list"
        onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((idx + 1) % Math.max(hits.length, 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((idx + hits.length - 1) % Math.max(hits.length, 1)) }
          else if (e.key === 'Enter') { e.preventDefault(); if (hits[idx]) pick(hits[idx]) }
          else if (e.key === 'Escape') onEscape?.()
        }} />
      {open && q.trim() && (
        <ul className="picker-menu" role="listbox">
          {hits.map((i, n) => (
            <li key={i.id} role="option" aria-selected={n === idx} className={n === idx ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); pick(i) }} onMouseEnter={() => setIdx(n)}>
              <TypeIcon type={i.type} /><span className="key">{i.key}</span><span className="grow ellipsis">{i.title}</span>
              <span className={`lozenge c${i.status.category}`}>{i.status.name}</span>
            </li>
          ))}
          {!hits.length && <li className="muted small">{t('picker.none')}</li>}
        </ul>
      )}
    </div>
  )
}

/** The parent: a link to it, changed with the issue picker (only issues one level up in the same project fit). */
function ParentField({ issue, canEdit, onSave }: { issue: Issue; canEdit: boolean; onSave: (key: string | null) => void }) {
  const [editing, setEditing] = useState(false)
  if (issue.type.level === 0) return <span className="muted small field-text">{t('issue.epicNoParent')}</span>
  if (editing) return (
    <IssuePicker placeholder={t('picker.parent')} exclude={[issue.key]} onEscape={() => setEditing(false)}
      accept={(i) => i.type.level === issue.type.level - 1 && i.key.split('-')[0] === issue.key.split('-')[0]}
      onPick={(i) => { onSave(i.key); setEditing(false) }} />
  )
  return (
    <div className="field-text">
      {issue.parent ? <Link to={`/browse/${issue.parent}`}>{issue.parent}</Link> : <span className="muted">{t('common.empty')}</span>}
      {canEdit && <button className="link" onClick={() => setEditing(true)}>{t('picker.change')}</button>}
      {canEdit && issue.parent && issue.type.level === 1 && <button className="link danger" onClick={() => onSave(null)}>{t('picker.clear')}</button>}
    </div>
  )
}

function AddLink({ base, self, onDone, onClose }: { base: string; self: string; onDone: () => void; onClose: () => void }) {
  const [kind, setKind] = useState('blocks')
  return (
    <div className="add-link">
      <Select label={t('field.links')} value={kind} onChange={setKind}
        options={[{ value: 'blocks', label: t('link.blocks') }, { value: 'is_blocked_by', label: t('link.blockedBy') }, { value: 'relates', label: t('link.relates') }, { value: 'duplicates', label: t('link.duplicates') }]} />
      <IssuePicker exclude={[self]} placeholder={t('picker.placeholder')} onEscape={onClose}
        onPick={(i) => api('POST', `${base}/links`, { kind, target: i.key }).then(() => { toast(t('link.added', { key: i.key })); onDone(); onClose() }, (x) => toast(message(x)))} />
      <button type="button" onClick={onClose}>{t('common.cancel')}</button>
    </div>
  )
}
