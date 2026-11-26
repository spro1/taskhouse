// Search: a filter tree compiled to one parameterized SQL statement, with the caller's visibility always ANDed on.
// The tree is the same shape a TQL parser (phase 2) will produce, so chips, saved filters, boards and TQL share one engine:
//   {and: [...]} | {or: [...]} | {not: node} | {field, op, value}
import type { Hono } from 'hono'
import { tx, type Db } from './db.ts'
import { body, fail, HttpError, type Env, type User } from './http.ts'
import { projectsFor } from './access.ts'
import { issueSelect, KEY_RE, loadIssue } from './issues.ts'
import { parseTql } from './tql.ts'

type Node = { and?: Node[]; or?: Node[]; not?: Node; field?: string; op?: string; value?: any }
const CATEGORY: Record<string, number> = { todo: 0, doing: 1, done: 2 }

// Korean words carry particles ("배포를"): searching by the stem finds every form. Kept only if two syllables remain.
const PARTICLES = ['으로부터', '에서는', '에게서', '으로는', '이라는', '에서', '에게', '으로', '이랑', '까지', '부터', '처럼', '보다', '라는', '하고', '을', '를', '이', '가', '은', '는', '에', '의', '로', '와', '과', '도', '만', '랑']
export function koreanStem(term: string) {
  if (!/[가-힣]$/.test(term)) return term
  for (const p of PARTICLES) if (term.endsWith(p) && [...term.slice(0, -p.length)].length >= 2) return term.slice(0, -p.length)
  return term
}
/** Adjacent Hangul syllable pairs, as the database's hangul_bigrams() makes them. */
export function hangulBigrams(t: string) {
  const out = new Set<string>()
  for (let i = 0; i + 1 < t.length; i++) if (/^[가-힣]{2}$/.test(t.slice(i, i + 2))) out.add(t.slice(i, i + 2))
  return [...out]
}
const like = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`

/** '-7d', '2w', '-1m' (relative to now) or an ISO date. */
export function dateValue(v: unknown, now = Date.now()): string {
  const m = /^([+-]?\d{1,4})([dwmh])$/.exec(String(v))
  if (m) return new Date(now + Number(m[1]) * { h: 3600e3, d: 86400e3, w: 7 * 86400e3, m: 30 * 86400e3 }[m[2]]!).toISOString()
  if (!isNaN(Date.parse(String(v)))) return String(v)
  throw new HttpError(400, 'bad_query', { why: `bad date ${v}` })
}

export function compile(node: Node, user: User, add: (v: unknown) => string, depth = 0): string {
  const bad = (why: string) => new HttpError(400, 'bad_query', { why })
  if (depth > 20) throw bad('too deep')
  if (node.and || node.or) {
    const list = (node.and ?? node.or)!
    if (!Array.isArray(list) || list.length > 50) throw bad('bad list')
    if (!list.length) return 'TRUE'
    return `(${list.map((n) => compile(n, user, add, depth + 1)).join(node.and ? ' AND ' : ' OR ')})`
  }
  if (node.not) return `NOT (${compile(node.not, user, add, depth + 1)})`
  const { field, op = '=', value } = node
  const values = (Array.isArray(value) ? value : [value]).slice(0, 200)
  const neg = op === '!=' || op === 'not in'
  if (!['=', '!=', 'in', 'not in', 'empty', 'not empty', '~', '!~', '<', '<=', '>', '>=', 'changed'].includes(op)) throw bad(`bad operator ${op}`)
  if (op === 'changed') return changed(node, user, add, bad)
  // Operators that only mean something on some fields: refuse the rest instead of quietly treating them as "=".
  if ((op === '~' || op === '!~') && field !== 'text' && field !== 'title') throw bad(`${op} only works on text and title`)
  if (['<', '<=', '>', '>='].includes(op) && !['priority', 'points', 'due', 'created', 'updated', 'resolved'].includes(String(field)))
    throw bad(`${op} doesn't work on ${field}`)
  const num = (v: unknown) => {
    const n = Number(v)
    if (v === null || v === '' || !Number.isFinite(n)) throw bad(`${field} needs a number, got ${v}`)
    return n
  }
  const set = (col: string, vals: unknown[], cast: string) => `${neg ? 'NOT ' : ''}(${col} = ANY(${add(vals)}::${cast}[]))`
  const nullable = (col: string, vals: unknown[], cast: string) => {
    if (op === 'empty') return `${col} IS NULL`
    if (op === 'not empty') return `${col} IS NOT NULL`
    const real = vals.filter((v) => v !== null)
    const parts = [real.length ? `${col} = ANY(${add(real)}::${cast}[])` : null, real.length < vals.length ? `${col} IS NULL` : null].filter(Boolean)
    // "!=" also matches empty values ("assignee != me" includes unassigned issues).
    return neg ? `NOT COALESCE(${parts.join(' OR ')}, false)` : `(${parts.join(' OR ')})`
  }
  // People by id, 'me', name or email, membersOf group ({group}), or null (= unassigned).
  const people = (col: string) => {
    if (op === 'empty' || op === 'not empty') return nullable(col, [], 'bigint')
    const ids = values.filter((v) => v === 'me' || (typeof v === 'number') || /^\d+$/.test(String(v))).map((v) => (v === 'me' ? user.id : Number(v)))
    const names = values.filter((v) => typeof v === 'string' && v !== 'me' && !/^\d+$/.test(v))
    const groups = values.filter((v) => v && typeof v === 'object').map((v) => String(v.group))
    const parts = [
      ids.length ? `${col} = ANY(${add(ids)}::bigint[])` : null,
      names.length ? `${col} IN (SELECT id FROM users WHERE name = ANY(${add(names)}::text[]) OR email = ANY(${add(names.map((n) => n.toLowerCase()))}::text[]))` : null,
      groups.length ? `${col} IN (SELECT gm.user_id FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE g.name = ANY(${add(groups)}::text[]))` : null,
      values.includes(null) ? `${col} IS NULL` : null,
    ].filter(Boolean)
    // "!=" also matches empty values ("assignee != me" includes unassigned issues).
    return `${neg ? 'NOT ' : ''}COALESCE(${parts.join(' OR ') || 'false'}, false)`
  }
  const cmp = (col: string, v: string) => {
    if (!['=', '<', '<=', '>', '>='].includes(op)) throw bad(`operator ${op} not allowed on ${field}`)
    return `${col} ${op} ${v}`
  }
  switch (field) {
    case 'project': return set('p.key', values.map(String), 'text')
    case 'key': return `${neg ? 'NOT ' : ''}((p.key || '-' || i.number) = ANY(${add(values.map(String))}::text[]))`
    case 'type': return `${neg ? 'NOT ' : ''}(t.name = ANY(${add(values.map(String))}::text[]) OR t.id::text = ANY(${add(values.map(String))}::text[]))`
    case 'status': return `${neg ? 'NOT ' : ''}(s.name = ANY(${add(values.map(String))}::text[]) OR s.id::text = ANY(${add(values.map(String))}::text[]))`
    case 'statusCategory': {
      const cats = values.map((v) => CATEGORY[String(v)])
      if (cats.some((c) => c === undefined)) throw bad('statusCategory is todo, doing or done')
      return set('s.category', cats, 'int')
    }
    case 'priority':
      if (['<', '<=', '>', '>='].includes(op)) return cmp('i.priority', add(num(value)))
      return set('i.priority', values.map(num), 'int')
    case 'assignee': return people('i.assignee_id')
    case 'reporter': return people('i.reporter_id')
    case 'parent': {
      if (op === 'empty' || op === 'not empty') return nullable('i.parent_id', [], 'bigint')
      return `${neg ? 'NOT ' : ''}(i.parent_id IN (SELECT x.id FROM issues x JOIN projects xp ON xp.id = x.project_id WHERE (xp.key || '-' || x.number) = ANY(${add(values.map(String))}::text[])))`
    }
    case 'sprint': {
      if (op === 'empty' || op === 'not empty') return nullable('i.sprint_id', [], 'bigint')
      // 'open' / 'closed' (openSprints(), closedSprints()), ids, names, or null (= backlog).
      const states = values.filter((v) => v === 'open' || v === 'closed').map((v) => (v === 'open' ? 'active' : 'closed'))
      const rest = values.filter((v) => v !== 'open' && v !== 'closed' && v !== null)
      const ids = rest.filter((v) => /^\d+$/.test(String(v))).map(Number)
      const names = rest.filter((v) => !/^\d+$/.test(String(v))).map(String)
      const parts = [states.length ? `i.sprint_id IN (SELECT id FROM sprints WHERE state = ANY(${add(states)}::text[]))` : null,
        values.includes(null) ? 'i.sprint_id IS NULL' : null,
        ids.length ? `i.sprint_id = ANY(${add(ids)}::bigint[])` : null,
        names.length ? `i.sprint_id IN (SELECT id FROM sprints WHERE name = ANY(${add(names)}::text[]))` : null].filter(Boolean)
      return `${neg ? 'NOT ' : ''}COALESCE(${parts.join(' OR ') || 'false'}, false)`
    }
    case 'linked': {
      // blocks | is blocked by | relates | duplicates | is duplicated by
      const any = `EXISTS (SELECT 1 FROM issue_links l WHERE l.source_id = i.id OR l.target_id = i.id)`
      if (op === 'empty') return `NOT ${any}`
      if (op === 'not empty') return any
      const one = (v: unknown) => {
        const k = String(v).toLowerCase().replace(/_/g, ' ')
        const dir: Record<string, string> = {
          blocks: `l.source_id = i.id AND l.kind = 'blocks'`, 'is blocked by': `l.target_id = i.id AND l.kind = 'blocks'`,
          relates: `(l.source_id = i.id OR l.target_id = i.id) AND l.kind = 'relates'`,
          duplicates: `l.source_id = i.id AND l.kind = 'duplicates'`, 'is duplicated by': `l.target_id = i.id AND l.kind = 'duplicates'`,
        }
        if (!dir[k]) throw bad(`linked is one of: ${Object.keys(dir).join(', ')}`)
        return `EXISTS (SELECT 1 FROM issue_links l WHERE ${dir[k]})`
      }
      return `${neg ? 'NOT ' : ''}(${values.map(one).join(' OR ')})`
    }
    case 'labels':
      if (op === 'empty') return `i.labels = '{}'`
      if (op === 'not empty') return `i.labels <> '{}'`
      return `${neg ? 'NOT ' : ''}(i.labels && ${add(values.map((v) => String(v).toLowerCase()))}::text[])`
    case 'points':
      if (op === 'empty' || op === 'not empty') return nullable('i.points', [], 'numeric')
      return cmp('i.points', add(num(value)))
    case 'due': case 'created': case 'updated': case 'resolved': {
      const col = { due: 'i.due_date', created: 'i.created_at', updated: 'i.updated_at', resolved: 'i.resolved_at' }[field]
      if (op === 'empty' || op === 'not empty') return nullable(col, [], 'timestamptz')
      return cmp(col, `${add(dateValue(value))}::timestamptz`)
    }
    case 'text': case 'title': {
      if (op !== '~' && op !== '!~') throw bad(`use ~ with ${field}`)
      const terms = [...new Set(String(value ?? '').trim().split(/\s+/).filter(Boolean))].slice(0, 8)
      if (!terms.length) return 'TRUE'
      const each = terms.map((term) => {
        const stem = koreanStem(term)
        const v = add(like(stem))
        const match = field === 'title' ? `i.title ILIKE ${v}` : `(i.title ILIKE ${v} OR i.text ILIKE ${v})`
        // Hangul syllable pairs narrow the search through their index first (see migration 002).
        const grams = hangulBigrams(stem)
        return grams.length ? `(i.grams @> ${add(grams)}::text[] AND ${match})` : match
      })
      return `${op === '!~' ? 'NOT ' : ''}(${each.join(' AND ')})`
    }
  }
  throw bad(`unknown field ${field}`)
}

// Fields whose history CHANGED can search, as issue_changes names them.
const CHANGE_FIELDS: Record<string, string> = { status: 'status', assignee: 'assignee', sprint: 'sprint', priority: 'priority', type: 'type', parent: 'parent', points: 'points', due: 'due', labels: 'labels', title: 'title' }

/** status CHANGED [FROM a] [TO b] [AFTER d] [BEFORE d] [BY person]: searches the change log. */
function changed(node: any, user: User, add: (v: unknown) => string, bad: (why: string) => Error) {
  const f = CHANGE_FIELDS[node.field]
  if (!f) throw bad(`CHANGED is not supported on ${node.field}`)
  const conds = ['ch.issue_id = i.id', `ch.field = ${add(f)}`]
  // Logged values are {id, name} for references, plain JSON otherwise: match by name, id or the plain value.
  const is = (col: 'old' | 'new', v: unknown) => {
    if (v === null) return `(ch.${col} IS NULL OR ch.${col} = 'null'::jsonb)`
    const a = add(String(v === 'me' ? user.id : v))
    return `(ch.${col}->>'name' = ${a} OR ch.${col}->>'id' = ${a} OR ch.${col} #>> '{}' = ${a})`
  }
  if ('from' in node) conds.push(is('old', node.from))
  if ('to' in node) conds.push(is('new', node.to))
  if (node.after !== undefined) conds.push(`ch.at > ${add(dateValue(node.after))}::timestamptz`)
  if (node.before !== undefined) conds.push(`ch.at < ${add(dateValue(node.before))}::timestamptz`)
  if (node.by !== undefined) {
    const by = node.by === 'me' ? user.id : node.by
    conds.push(/^\d+$/.test(String(by)) ? `ch.actor_id = ${add(Number(by))}` : `ch.actor_id IN (SELECT id FROM users WHERE name = ${add(String(by))} OR email = ${add(String(by).toLowerCase())})`)
  }
  return `EXISTS (SELECT 1 FROM issue_changes ch WHERE ${conds.join(' AND ')})`
}

const SORTS: Record<string, string> = {
  rank: 'i.rank', priority: 'i.priority', updated: 'i.updated_at', created: 'i.created_at', due: 'i.due_date', key: 'i.number',
  status: 's.position', resolved: 'i.resolved_at', points: 'i.points',
}

export async function search(db: Db, user: User, query: Node, sort: unknown, cursor: unknown, limit: unknown) {
  const projects = (await projectsFor(db, user)).map((p) => p.id)
  const params: unknown[] = [projects]
  const add = (v: unknown) => (params.push(v), `$${params.length}`)
  const where = compile(query ?? { and: [] }, user, add)
  const order = (Array.isArray(sort) ? sort : [sort ?? 'updated desc']).slice(0, 4).map((s) => {
    const [f, dir = 'asc'] = String(s).trim().split(/\s+/)
    if (!SORTS[f] || !/^(asc|desc)$/i.test(dir)) throw new HttpError(400, 'bad_query', { why: `bad sort ${s}` })
    return `${SORTS[f]} ${dir.toUpperCase()} NULLS LAST`
  })
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200)
  // shortcut: offset cursor; stable enough for 50k issues (capped at 10k deep). Switch to keyset if lists get longer.
  const offset = Math.min(Math.max(Number(cursor) || 0, 0), 10_000)
  const rows = await tx(db, async (q) => {
    // A runaway query must not hold a connection: after 3 s the database cancels it.
    await q.query(`SET LOCAL statement_timeout = '3s'`)
    return (await q.query(`${issueSelect(true)} WHERE i.deleted_at IS NULL AND i.project_id = ANY($1) AND ${where}
      ORDER BY ${order.join(', ')}, i.id LIMIT ${n + 1} OFFSET ${offset}`, params)).rows
  })
  return { issues: rows.slice(0, n), next: rows.length > n ? String(offset + n) : null }
}

export function registerSearch(app: Hono<Env>, db: Db) {
  const user = (c: any) => c.get('user') as User
  app.post('/api/search', async (c) => {
    const b = await body(c)
    // Either a filter tree (chips, boards) or TQL text; ORDER BY in the TQL wins over `sort`.
    const t = typeof b.tql === 'string' ? parseTql(b.tql) : null
    return c.json(await search(db, user(c), t ? t.query : b.query, t?.sort.length ? t.sort : b.sort, b.cursor, b.limit))
  })

  // ⌘K: a key jumps straight to the issue; anything else is a title/body search.
  app.get('/api/quick', async (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 200)
    if (!q) return c.json({ issues: [] })
    if (KEY_RE.test(q.toUpperCase())) {
      const hit = await loadIssue(db, user(c), q.toUpperCase()).catch(() => null)
      if (hit) return c.json({ issues: [hit.issue], exact: true })
    }
    return c.json(await search(db, user(c), { field: 'text', op: '~', value: q }, 'updated desc', 0, 20))
  })

  app.get('/api/filters', async (c) =>
    c.json((await db.query('SELECT id, name, query, sort, tql FROM filters WHERE owner_id = $1 ORDER BY name', [user(c).id])).rows))
  app.post('/api/filters', async (c) => {
    const b = await body(c)
    const name = String(b.name ?? '').trim().slice(0, 100)
    const t = typeof b.tql === 'string' ? parseTql(b.tql) : null
    const query = t?.query ?? b.query
    if (!name || !query) return fail(c, 400, 'bad_request')
    compile(query, user(c), () => '$0') // refuse a filter that can't run
    return c.json((await db.query('INSERT INTO filters (owner_id, name, query, sort, tql) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [user(c).id, name, JSON.stringify(query), JSON.stringify(t?.sort.length ? t.sort : b.sort ?? []), t ? b.tql : null])).rows[0], 201)
  })
  app.delete('/api/filters/:id', async (c) => {
    const r = await db.query('DELETE FROM filters WHERE id = $1 AND owner_id = $2', [Number(c.req.param('id')) || 0, user(c).id])
    return r.rowCount ? c.json({ ok: true }) : fail(c, 404, 'not_found')
  })
}
