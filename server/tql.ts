// TQL: a subset of JQL, parsed into the filter tree that search.ts compiles (so it gets the same validation,
// parameter binding and permission filter).
//   query   := or_expr [ORDER BY field [ASC|DESC] {, ...}]
//   or_expr := and_expr {OR and_expr};  and_expr := unary {AND unary};  unary := [NOT] ( "(" or_expr ")" | clause )
//   clause  := field op value | field [NOT] IN (v, ...) | field IS [NOT] EMPTY
//            | field CHANGED [FROM v] [TO v] [AFTER v] [BEFORE v] [BY v]
import { HttpError } from './http.ts'

type Tok = { t: 'word' | 'str' | 'op' | 'punct' | 'end'; v: string; at: number }

function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '"' || c === "'") {
      let j = i + 1, v = ''
      while (j < src.length && src[j] !== c) v += src[j] === '\\' && j + 1 < src.length ? src[++j] : src[j], j++
      if (j >= src.length) throw err('unterminated string', i)
      out.push({ t: 'str', v, at: i })
      i = j + 1
      continue
    }
    const op = /^(!=|>=|<=|!~|=|>|<|~)/.exec(src.slice(i))
    if (op) { out.push({ t: 'op', v: op[0], at: i }); i += op[0].length; continue }
    if ('(),'.includes(c)) { out.push({ t: 'punct', v: c, at: i }); i++; continue }
    const w = /^[^\s"'(),=!<>~]+/.exec(src.slice(i))
    if (!w) throw err(`unexpected ${c}`, i)
    out.push({ t: 'word', v: w[0], at: i })
    i += w[0].length
  }
  out.push({ t: 'end', v: '', at: src.length })
  return out
}
const err = (why: string, at: number) => new HttpError(400, 'bad_query', { why: `${why} (위치 ${at + 1})`, at })

// TQL / JQL field names -> filter fields.
const FIELDS: Record<string, string> = {
  project: 'project', key: 'key', issuekey: 'key', type: 'type', issuetype: 'type', status: 'status', statuscategory: 'statusCategory',
  priority: 'priority', assignee: 'assignee', reporter: 'reporter', parent: 'parent', sprint: 'sprint', labels: 'labels', label: 'labels',
  points: 'points', storypoints: 'points', due: 'due', duedate: 'due', created: 'created', updated: 'updated', resolved: 'resolved',
  text: 'text', title: 'title', summary: 'title', linked: 'linked',
}
const PRIORITY: Record<string, number> = { 긴급: 0, 높음: 1, 보통: 2, 낮음: 3, 최저: 4, highest: 0, high: 1, medium: 2, low: 3, lowest: 4 }
const CATEGORY: Record<string, string> = { todo: 'todo', 'to do': 'todo', '할 일': 'todo', doing: 'doing', 'in progress': 'doing', 진행: 'doing', done: 'done', 완료: 'done' }
const SORT: Record<string, string> = { rank: 'rank', priority: 'priority', updated: 'updated', created: 'created', due: 'due', duedate: 'due', key: 'key', status: 'status', resolved: 'resolved', points: 'points' }

function startOf(unit: string, now: Date) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  if (unit === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // Monday
  if (unit === 'month') d.setDate(1)
  return d.toISOString()
}

export function parseTql(src: string, now = new Date()): { query: any; sort: string[] } {
  if (src.length > 2000) throw err('query too long', 0)
  const toks = lex(src)
  let p = 0
  const peek = () => toks[p]
  const kw = (k: string) => peek().t === 'word' && peek().v.toUpperCase() === k
  const take = () => toks[p++]
  const expect = (v: string) => {
    if (peek().v !== v && !(peek().t === 'word' && peek().v.toUpperCase() === v)) throw err(`expected ${v}`, peek().at)
    return take()
  }

  const value = (field: string): any => {
    const tk = take()
    if (tk.t === 'end' || tk.t === 'op' || (tk.t === 'punct' && tk.v !== '(')) throw err('expected a value', tk.at)
    if (tk.t === 'word' && peek().v === '(') {
      take()
      const args: string[] = []
      while (peek().v !== ')') {
        const a = take()
        if (a.t !== 'str' && a.t !== 'word') throw err('bad function argument', a.at)
        args.push(a.v)
        if (peek().v === ',') take()
      }
      take()
      const fn = tk.v.toLowerCase()
      if (fn === 'currentuser') return 'me'
      if (fn === 'opensprints') return 'open'
      if (fn === 'closedsprints') return 'closed'
      if (fn === 'membersof' && args[0]) return { group: args[0] }
      const m = /^startof(day|week|month)$/.exec(fn)
      if (m) return startOf(m[1], now)
      throw err(`unknown function ${tk.v}()`, tk.at)
    }
    const v = tk.v
    if (tk.t === 'word' && (v.toUpperCase() === 'EMPTY' || v.toUpperCase() === 'NULL')) return null
    if (field === 'priority' && PRIORITY[v.toLowerCase()] !== undefined) return PRIORITY[v.toLowerCase()]
    if (field === 'statusCategory') {
      const c = CATEGORY[v.toLowerCase()]
      if (!c) throw err(`statusCategory는 todo, doing, done 중 하나입니다`, tk.at)
      return c
    }
    if (tk.t === 'word' && /^-?\d+(\.\d+)?$/.test(v) && (field === 'priority' || field === 'points' || field === 'sprint' || field === 'assignee' || field === 'reporter')) return Number(v)
    return v
  }
  const list = (field: string) => {
    // "IN openSprints()": a function stands for the whole list.
    if (peek().v !== '(') return [value(field)]
    expect('(')
    const out = [value(field)]
    while (peek().v === ',') take(), out.push(value(field))
    expect(')')
    return out
  }

  const clause = (): any => {
    const f = take()
    if (f.t !== 'word' && f.t !== 'str') throw err('expected a field', f.at)
    const lower = f.v.toLowerCase()
    const field = lower.startsWith('cf.') ? null : FIELDS[lower]
    if (!field) throw err(`unknown field ${f.v}`, f.at)
    if (kw('IS')) {
      take()
      const not = kw('NOT') ? (take(), true) : false
      if (!kw('EMPTY') && !kw('NULL')) throw err('expected EMPTY', peek().at)
      take()
      return { field, op: not ? 'not empty' : 'empty' }
    }
    if (kw('NOT') || kw('IN')) {
      const not = kw('NOT') ? (take(), true) : false
      expect('IN')
      return { field, op: not ? 'not in' : 'in', value: list(field) }
    }
    if (kw('CHANGED')) {
      take()
      const node: any = { field, op: 'changed' }
      for (;;) {
        if (kw('FROM')) take(), (node.from = value(field))
        else if (kw('TO')) take(), (node.to = value(field))
        else if (kw('AFTER')) take(), (node.after = value('created'))
        else if (kw('BEFORE')) take(), (node.before = value('created'))
        else if (kw('BY')) take(), (node.by = value('assignee'))
        else break
      }
      return node
    }
    const op = take()
    if (op.t !== 'op') throw err('expected an operator', op.at)
    const v = value(field)
    if (v === null && (op.v === '=' || op.v === '!=')) return { field, op: op.v === '=' ? 'empty' : 'not empty' }
    return { field, op: op.v, value: v }
  }
  const unary = (): any => {
    if (kw('NOT')) return take(), { not: unary() }
    if (peek().v === '(') {
      take()
      const e = orExpr()
      expect(')')
      return e
    }
    return clause()
  }
  const andExpr = () => {
    const parts = [unary()]
    while (kw('AND')) take(), parts.push(unary())
    return parts.length === 1 ? parts[0] : { and: parts }
  }
  const orExpr = (): any => {
    const parts = [andExpr()]
    while (kw('OR')) take(), parts.push(andExpr())
    return parts.length === 1 ? parts[0] : { or: parts }
  }

  const query = peek().t === 'end' || kw('ORDER') ? { and: [] } : orExpr()
  const sort: string[] = []
  if (kw('ORDER')) {
    take()
    expect('BY')
    do {
      if (sort.length) take()
      const f = take()
      const s = SORT[f.v.toLowerCase()]
      if (!s) throw err(`cannot sort by ${f.v}`, f.at)
      const dir = kw('ASC') || kw('DESC') ? take().v.toLowerCase() : 'asc'
      sort.push(`${s} ${dir}`)
    } while (peek().v === ',')
  }
  if (peek().t !== 'end') throw err(`unexpected ${peek().v}`, peek().at)
  return { query, sort }
}
