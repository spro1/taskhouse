// Model Context Protocol endpoint (Streamable HTTP, JSON responses) at /api/mcp, as in Pagehouse, so AI agents can
// search, read and update issues with a personal API token. Every tool calls the regular REST API as that user, so
// agents get exactly the user's permissions, validation and history; nothing here bypasses them.
import type { Context, Hono } from 'hono'
import type { Env } from './http.ts'

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const str = { type: 'string' } as const
const int = { type: 'integer' } as const
const key = { type: 'string', description: 'Issue key, e.g. WEB-12' } as const
const TOOLS = [
  { name: 'list_projects', description: 'List the projects you can see, with their issue types, statuses and sprints.', inputSchema: { type: 'object', properties: {} } },
  { name: 'search_issues', description: 'Search issues with TQL, a JQL subset. Examples: `project = WEB AND statusCategory != done`, `assignee = currentUser() ORDER BY priority`, `text ~ "login"`, `sprint IN openSprints()`.',
    inputSchema: { type: 'object', properties: { tql: str, limit: { ...int, description: '1-100, default 20' } }, required: ['tql'] } },
  { name: 'get_issue', description: 'An issue with its fields, description (Markdown), subtasks, links and latest comments.', inputSchema: { type: 'object', properties: { key }, required: ['key'] } },
  { name: 'create_issue', description: 'Create an issue. type is a type name of the project (e.g. 작업, 버그, 스토리); assignee is an email or a name; priority 0 (urgent) to 4 (lowest).',
    inputSchema: { type: 'object', properties: { project: { ...str, description: 'Project key, e.g. WEB' }, title: str, type: str, description: { ...str, description: 'Markdown' }, assignee: str, priority: int, parent: key, labels: { type: 'array', items: str } }, required: ['project', 'title'] } },
  { name: 'update_issue', description: 'Change fields of an issue; send only what changes. assignee "" unassigns. Status changes go through transition_issue.',
    inputSchema: { type: 'object', properties: { key, title: str, description: { ...str, description: 'Markdown; replaces the description' }, assignee: str, priority: int, points: { type: 'number' }, due: { ...str, description: 'YYYY-MM-DD or ""' }, labels: { type: 'array', items: str }, parent: str }, required: ['key'] } },
  { name: 'transition_issue', description: 'Move an issue to another status by its name. The workflow rules of the project apply; the error lists the allowed statuses.',
    inputSchema: { type: 'object', properties: { key, status: str }, required: ['key', 'status'] } },
  { name: 'get_comments', description: 'Comments on an issue, oldest first, as Markdown.', inputSchema: { type: 'object', properties: { key }, required: ['key'] } },
  { name: 'add_comment', description: 'Add a comment (Markdown) to an issue.', inputSchema: { type: 'object', properties: { key, body: str }, required: ['key', 'body'] } },
]

export function registerMcp(app: Hono<Env>) {
  app.get('/api/mcp', (c) => c.body(null, 405, { Allow: 'POST' }))
  app.delete('/api/mcp', (c) => c.body(null, 405, { Allow: 'POST' }))

  app.post('/api/mcp', async (c) => {
    const msg = await c.req.json().catch(() => null)
    if (Array.isArray(msg)) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batches are not supported' } }, 400)
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }, 400)
    // Notifications (no id) need no answer.
    if (msg.id === undefined) return c.body(null, 202)
    const reply = (result: unknown) => c.json({ jsonrpc: '2.0', id: msg.id, result })
    const error = (code: number, message: string) => c.json({ jsonrpc: '2.0', id: msg.id, error: { code, message } })
    switch (msg.method) {
      case 'initialize':
        return reply({
          protocolVersion: VERSIONS.includes(msg.params?.protocolVersion) ? msg.params.protocolVersion : VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'taskhouse', version: process.env.APP_VERSION ?? 'dev' },
          instructions: 'Taskhouse issue tracker. Find issues with TQL (search_issues), read them (get_issue), create and update them, move them through the workflow (transition_issue) and comment. Issues are named by keys like WEB-12.',
        })
      case 'ping':
        return reply({})
      case 'tools/list':
        return reply({ tools: TOOLS })
      case 'tools/call': {
        const name = msg.params?.name
        if (!TOOLS.some((t) => t.name === name)) return error(-32602, `Unknown tool: ${name}`)
        try {
          return reply({ content: [{ type: 'text', text: await runTool(app, c, name, msg.params?.arguments ?? {}) }] })
        } catch (e) {
          // Tool failures (no access, not found, conflict) go back to the model as a result it can read.
          return reply({ content: [{ type: 'text', text: (e as Error).message }], isError: true })
        }
      }
      default:
        return error(-32601, `Method not found: ${msg.method}`)
    }
  })
}

// Markdown ⇄ the editor's document (Tiptap JSON), for the parts agents write: paragraphs, headings, lists, code blocks,
// bold, inline code and links. Anything else is kept as plain text.
export function fromMarkdown(md: string): any {
  const blocks: any[] = []
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const inline = (s: string): any[] => {
    const out: any[] = []
    const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:[^)\s]+|mailto:[^)\s]+)\))/g
    let last = 0
    for (const m of s.matchAll(re)) {
      if (m.index! > last) out.push({ type: 'text', text: s.slice(last, m.index) })
      if (m[2]) out.push({ type: 'text', text: m[2], marks: [{ type: 'bold' }] })
      else if (m[3]) out.push({ type: 'text', text: m[3], marks: [{ type: 'code' }] })
      else out.push({ type: 'text', text: m[4], marks: [{ type: 'link', attrs: { href: m[5] } }] })
      last = m.index! + m[0].length
    }
    if (last < s.length) out.push({ type: 'text', text: s.slice(last) })
    return out
  }
  const para = (s: string) => ({ type: 'paragraph', content: inline(s) })
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!l.trim()) continue
    if (l.startsWith('```')) {
      const code: string[] = []
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i])
      blocks.push({ type: 'codeBlock', content: code.length ? [{ type: 'text', text: code.join('\n') }] : [] })
      continue
    }
    const h = l.match(/^#{1,6}\s+(.*)$/)
    if (h) { blocks.push({ type: 'heading', attrs: { level: 3 }, content: inline(h[1]) }); continue }
    const list = (re: RegExp, type: string) => {
      const items: any[] = []
      while (i < lines.length && re.test(lines[i])) items.push({ type: 'listItem', content: [para(lines[i++].replace(re, ''))] })
      i--
      blocks.push({ type, content: items })
    }
    if (/^\s*[-*]\s+/.test(l)) { list(/^\s*[-*]\s+/, 'bulletList'); continue }
    if (/^\s*\d+[.)]\s+/.test(l)) { list(/^\s*\d+[.)]\s+/, 'orderedList'); continue }
    const text = [l]
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(```|#{1,6}\s|\s*[-*]\s|\s*\d+[.)]\s)/.test(lines[i + 1])) text.push(lines[++i])
    blocks.push(para(text.join(' ')))
  }
  return { type: 'doc', content: blocks }
}

export function toMarkdown(node: any): string {
  const inline = (n: any): string => {
    if (n.type === 'hardBreak') return '\n'
    if (n.type === 'mention') return `@${n.attrs?.label ?? ''}`
    if (n.type !== 'text') return (n.content ?? []).map(inline).join('')
    let s = String(n.text ?? '')
    for (const m of n.marks ?? []) {
      if (m.type === 'bold') s = `**${s}**`
      else if (m.type === 'code') s = `\`${s}\``
      else if (m.type === 'link' && m.attrs?.href) s = `[${s}](${m.attrs.href})`
    }
    return s
  }
  const block = (n: any): string => {
    const kids = n.content ?? []
    switch (n.type) {
      case 'heading': return `### ${kids.map(inline).join('')}`
      case 'bulletList': return kids.map((li: any) => `- ${(li.content ?? []).map(block).join(' ')}`).join('\n')
      case 'orderedList': return kids.map((li: any, i: number) => `${i + 1}. ${(li.content ?? []).map(block).join(' ')}`).join('\n')
      case 'codeBlock': return `\`\`\`\n${kids.map(inline).join('')}\n\`\`\``
      case 'blockquote': return kids.map(block).join('\n').split('\n').map((x: string) => `> ${x}`).join('\n')
      case 'horizontalRule': return '---'
      default: return kids.map(inline).join('')
    }
  }
  return (node?.content ?? []).map(block).filter(Boolean).join('\n\n')
}

const PRIORITY = ['urgent', 'high', 'medium', 'low', 'lowest']

async function runTool(app: Hono<Env>, c: Context, name: string, a: Record<string, any>): Promise<string> {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { authorization: c.req.header('authorization') ?? '', cookie: c.req.header('cookie') ?? '', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error([data.error ?? `HTTP ${res.status}`, data.field && `field: ${data.field}`, data.why].filter(Boolean).join(' — '))
    return data
  }
  const text = (v: unknown, field: string) => {
    if (typeof v !== 'string' || !v.trim()) throw new Error(`${field} is required`)
    return v.trim()
  }
  const person = async (v: string) => {
    if (!v) return null
    const list: { id: number; name: string; email: string }[] = await call('GET', `/api/users?q=${encodeURIComponent(v)}`)
    const hit = list.find((u) => u.email.toLowerCase() === v.toLowerCase()) ?? list.find((u) => u.name === v) ?? (list.length === 1 ? list[0] : null)
    if (!hit) throw new Error(`No single person matches "${v}"${list.length ? `: ${list.map((u) => `${u.name} <${u.email}>`).join(', ')}` : ''}`)
    return hit.id
  }
  const base = process.env.PUBLIC_URL?.replace(/\/$/, '')
  const line = (i: any) => `${i.key} [${i.status.name}] ${i.title} · ${i.type.name} · ${PRIORITY[i.priority]}${i.assignee ? ` · ${i.assignee.name}` : ''}`
  switch (name) {
    case 'list_projects': {
      const list = await call('GET', '/api/projects')
      if (!list.length) return 'No projects.'
      const full = await Promise.all(list.map((p: any) => call('GET', `/api/projects/${p.key}`)))
      return full.map((p: any) => [
        `${p.key}: ${p.name} (your role: ${p.role})`,
        `  types: ${p.types.map((t: any) => t.name).join(', ')}`,
        `  statuses: ${p.statuses.map((s: any) => s.name).join(' → ')}`,
        ...(p.sprints.filter((s: any) => s.state !== 'closed').length ? [`  sprints: ${p.sprints.filter((s: any) => s.state !== 'closed').map((s: any) => `${s.name} (${s.state})`).join(', ')}`] : []),
      ].join('\n')).join('\n')
    }
    case 'search_issues': {
      const r = await call('POST', '/api/search', { tql: text(a.tql, 'tql'), limit: Math.min(Math.max(Number(a.limit) || 20, 1), 100) })
      if (!r.issues.length) return 'No issues found.'
      return r.issues.map(line).join('\n') + (r.next ? '\n(more results: narrow the query or raise limit)' : '')
    }
    case 'get_issue': {
      const k = text(a.key, 'key').toUpperCase()
      const [i, rel, comments] = await Promise.all([call('GET', `/api/issues/${k}`), call('GET', `/api/issues/${k}/related`), call('GET', `/api/issues/${k}/comments`)])
      const head = [
        `key: ${i.key}`, `title: ${i.title}`, `type: ${i.type.name}`, `status: ${i.status.name}`, `priority: ${PRIORITY[i.priority]}`,
        `assignee: ${i.assignee?.name ?? 'unassigned'}`, `reporter: ${i.reporter.name}`,
        ...(i.sprint ? [`sprint: ${i.sprint.name}`] : []), ...(i.points !== null ? [`points: ${i.points}`] : []), ...(i.due ? [`due: ${i.due}`] : []),
        ...(i.labels.length ? [`labels: ${i.labels.join(', ')}`] : []), ...(i.parent ? [`parent: ${i.parent}`] : []),
        `updated: ${i.updatedAt}`, ...(base ? [`url: ${base}/browse/${i.key}`] : []),
      ]
      const parts = [head.join('\n'), `## Description\n\n${toMarkdown(i.doc) || '(none)'}`]
      if (rel.children.length) parts.push(`## Child issues\n\n${rel.children.map((x: any) => `- ${line(x)}`).join('\n')}`)
      if (rel.links.length) parts.push(`## Links\n\n${rel.links.map((l: any) => `- ${l.outward ? l.kind : `${l.kind} (inward)`} ${l.key} [${l.status}] ${l.title}`).join('\n')}`)
      if (comments.length) parts.push(`## Latest comments\n\n${comments.slice(-5).map((x: any) => `- ${x.author.name}, ${x.createdAt}: ${toMarkdown(x.doc)}`).join('\n')}`)
      return parts.join('\n\n')
    }
    case 'create_issue': {
      const body: Record<string, unknown> = { title: text(a.title, 'title') }
      if (typeof a.type === 'string' && a.type) body.type = a.type
      if (typeof a.description === 'string' && a.description.trim()) body.doc = fromMarkdown(a.description)
      if (typeof a.assignee === 'string' && a.assignee) body.assignee = await person(a.assignee)
      if (Number.isInteger(a.priority)) body.priority = a.priority
      if (typeof a.parent === 'string' && a.parent) body.parent = a.parent.toUpperCase()
      if (Array.isArray(a.labels)) body.labels = a.labels.map(String)
      const i = await call('POST', `/api/projects/${encodeURIComponent(text(a.project, 'project').toUpperCase())}/issues`, body)
      return `Created ${i.key}: ${i.title}${base ? ` (${base}/browse/${i.key})` : ''}`
    }
    case 'update_issue': {
      const k = text(a.key, 'key').toUpperCase()
      const set: Record<string, unknown> = {}
      if (typeof a.title === 'string' && a.title.trim()) set.title = a.title
      if (typeof a.description === 'string') set.doc = fromMarkdown(a.description)
      if (typeof a.assignee === 'string') set.assignee = await person(a.assignee)
      if (Number.isInteger(a.priority)) set.priority = a.priority
      if (typeof a.points === 'number') set.points = a.points
      if (typeof a.due === 'string') set.due = a.due || null
      if (Array.isArray(a.labels)) set.labels = a.labels.map(String)
      if (typeof a.parent === 'string') set.parent = a.parent ? a.parent.toUpperCase() : null
      if (!Object.keys(set).length) throw new Error('Nothing to change: send at least one field.')
      const i = await call('PATCH', `/api/issues/${k}`, set)
      return `Updated ${i.key}: ${Object.keys(set).join(', ')}.`
    }
    case 'transition_issue': {
      const k = text(a.key, 'key').toUpperCase()
      const want = text(a.status, 'status').toLowerCase()
      const moves: { name: string; to: { id: number; name: string } }[] = await call('GET', `/api/issues/${k}/transitions`)
      const m = moves.find((x) => x.to.name.toLowerCase() === want) ?? moves.find((x) => x.name.toLowerCase() === want)
      if (!m) throw new Error(`Can't move ${k} to "${a.status}". Allowed: ${moves.map((x) => x.to.name).join(', ') || 'none'}`)
      const i = await call('POST', `/api/issues/${k}/transitions`, { to: m.to.id })
      return `${i.key} is now ${i.status.name}.`
    }
    case 'get_comments': {
      const list = await call('GET', `/api/issues/${text(a.key, 'key').toUpperCase()}/comments`)
      return list.map((x: any) => `- #${x.id} ${x.author.name}, ${x.createdAt}\n  ${toMarkdown(x.doc).replace(/\n/g, '\n  ')}`).join('\n') || 'No comments.'
    }
    case 'add_comment': {
      const r = await call('POST', `/api/issues/${text(a.key, 'key').toUpperCase()}/comments`, { doc: fromMarkdown(text(a.body, 'body')) })
      return `Added comment #${r.id}.`
    }
  }
  throw new Error(`Unknown tool: ${name}`)
}
