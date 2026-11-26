// Load test for the phase-1 gate: 50,000 issues, 100 users, then times the common list and search queries.
// Runs against TEST_DATABASE_URL or a throwaway embedded PostgreSQL.  npx tsx scripts/perf.ts [issues]
import { openDb } from '../server/db.ts'
import { search } from '../server/search.ts'
import { testDatabase } from '../server/testdb.ts'

const N = Number(process.argv[2] ?? 50_000)
const t = await testDatabase()
const db = await openDb(t.url)

// A vocabulary of made-up Korean words (2-3 syllables), so any one word appears in only a small share of issues,
// as real terms do. Text length ~600 characters per issue.
const syl = '가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허고노도로모보소오조초코토포호구누두루무부수우주추쿠투푸후'.split('')
const rnd = (n: number) => Math.floor(Math.random() * n)
const words = [...new Set(Array.from({ length: 3000 }, () => Array.from({ length: 2 + rnd(2) }, () => syl[rnd(syl.length)]).join('')))]
const sentence = () => Array.from({ length: 8 }, () => words[rnd(words.length)] + ['을', '를', '이', '가', '', ''][rnd(6)]).join(' ') + '.'

console.time('seed')
await db.query(`INSERT INTO users (email, name) SELECT 'u' || g || '@x.test', '사용자' || g FROM generate_series(1, 100) g`)
await db.query(`UPDATE users SET is_admin = true WHERE id = 1`)
await db.query(`INSERT INTO projects (key, name, visibility) SELECT 'P' || g, '프로젝트 ' || g, 'private' FROM generate_series(1, 5) g`)
await db.query(`INSERT INTO statuses (project_id, name, category, position) SELECT p, n, c, o FROM generate_series(1, 5) p,
  unnest(ARRAY['할 일', '진행 중', '리뷰 중', '완료'], ARRAY[0, 1, 1, 2]::smallint[], ARRAY[0, 1, 2, 3]) AS x(n, c, o)`)
await db.query(`INSERT INTO sprints (project_id, name, state) SELECT g, 'S' || g, 'active' FROM generate_series(1, 5) g`)
for (let start = 0; start < N; start += 5000) {
  const n = Math.min(5000, N - start)
  const titles = Array.from({ length: n }, () => sentence().slice(0, 60))
  const texts = Array.from({ length: n }, () => Array.from({ length: 12 }, sentence).join(' '))
  // ~80% done, like a tracker in use for a while; ~1 in 7 open issues in the active sprint.
  await db.query(`INSERT INTO issues (project_id, number, type_id, title, text, status_id, priority, assignee_id, reporter_id, rank, labels, sprint_id, created_at, updated_at, resolved_at)
    SELECT p, $1::int + g, 3, ti, tx, (SELECT id FROM statuses WHERE project_id = p AND category = cat LIMIT 1), g % 5, 1 + g % 100, 1 + (g * 7) % 100,
      lpad(($1::int + g)::text, 8, '0'), ARRAY['l' || (g % 40)], CASE WHEN cat < 2 AND (g / 5) % 7 = 0 THEN p END,
      now() - make_interval(hours => ($1::int + g)::int), now() - make_interval(mins => ($1::int + g)::int), CASE WHEN cat = 2 THEN now() END
    FROM (SELECT g, 1 + g % 5 AS p, CASE WHEN (g / 5) % 10 < 8 THEN 2 WHEN (g / 5) % 10 = 8 THEN 1 ELSE 0 END AS cat, ti, tx
          FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS x(ti, tx, g)) s`, [start, titles, texts])
}
await db.query(`UPDATE projects p SET issue_seq = (SELECT max(number) FROM issues WHERE project_id = p.id)`)
await db.query('VACUUM ANALYZE')
console.timeEnd('seed')

const admin = { id: 1, email: '', name: '', isAdmin: true }
const member = { id: 2, email: '', name: '', isAdmin: false }
await db.query(`INSERT INTO project_roles (project_id, user_id, level) VALUES (1, 2, 3), (2, 2, 3)`)
const common = words[0]
const two = words.find((w) => w.length === 2)!
const cases: [string, any, any][] = [
  ['backlog (open, no sprint, rank)', { and: [{ field: 'project', value: 'P1' }, { field: 'sprint', op: 'empty' }, { field: 'statusCategory', op: '!=', value: 'done' }] }, 'rank asc'],
  ['board (active sprint)', { and: [{ field: 'project', value: 'P1' }, { field: 'sprint', value: 'open' }] }, 'rank asc'],
  ['my open issues', { and: [{ field: 'assignee', value: 'me' }, { field: 'statusCategory', op: '!=', value: 'done' }] }, ['priority asc', 'updated desc']],
  ['label', { field: 'labels', value: 'l7' }, 'updated desc'],
  ['stale in progress', { and: [{ field: 'statusCategory', value: 'doing' }, { field: 'updated', op: '<', value: '-7d' }] }, 'updated desc'],
  [`text, 2 syllables (${two})`, { field: 'text', op: '~', value: two }, 'updated desc'],
  [`text, word (${common})`, { field: 'text', op: '~', value: common }, 'updated desc'],
  ['text, no match', { field: 'text', op: '~', value: '없는단어입니다' }, 'updated desc'],
]
for (const [who, user] of [['admin', admin], ['member of 2 projects', member]] as const) {
  console.log(`\n${who} (${N} issues)`)
  for (const [name, query, sort] of cases) {
    const ms: number[] = []
    let hits = 0
    for (let i = 0; i < 7; i++) {
      const s = performance.now()
      hits = (await search(db, user, query, sort, 0, 50)).issues.length
      ms.push(performance.now() - s)
    }
    ms.sort((a, b) => a - b)
    console.log(`  ${ms[3].toFixed(1).padStart(7)} ms  ${String(hits).padStart(3)} rows  ${name}`)
  }
}
// The largest description the API accepts (~1 MB of JSON): how long one save takes with the Hangul pair index.
const big = Array.from({ length: 1500 }, sentence).join(' ').slice(0, 300_000)
const s0 = performance.now()
await db.query('UPDATE issues SET text = $1 WHERE id = 1', [big])
console.log(`\n  ${(performance.now() - s0).toFixed(1).padStart(7)} ms  saving a ${big.length.toLocaleString()}-character description`)
await db.end()
await t.stop()
