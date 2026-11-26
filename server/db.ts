import pg from 'pg'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// BIGINT ids come back as strings by default; ours stay far below 2^53.
pg.types.setTypeParser(20, Number)
// DATE stays 'YYYY-MM-DD' instead of a local-midnight Date; NUMERIC (points) becomes a number.
pg.types.setTypeParser(1082, (v) => v)
pg.types.setTypeParser(1700, Number)

export type Db = pg.Pool
const MIGRATIONS = join(import.meta.dirname, 'migrations')

export async function openDb(url: string) {
  // Postgres' default assumes spinning disks and then skips the trigram indexes for search.
  // 1.1 is the usual value for SSD and cloud storage.
  const pool = new pg.Pool({ connectionString: url, options: '-c random_page_cost=1.1' })
  await migrate(pool)
  // pg_trgm classifies letters through the database's libc locale: under C (or PG17's builtin C.UTF-8) Hangul makes
  // no trigrams, so Korean search still works but never uses its index. Say so loudly instead of being slow quietly.
  const { n } = (await pool.query(`SELECT array_length(show_trgm('가나다'), 1) AS n`)).rows[0]
  if (!n) console.warn(`WARNING: this database's LC_CTYPE has no Hangul letters; Korean search can't use its index. Create it with a UTF-8 libc locale such as en_US.UTF-8.`)
  return pool
}

// Applies migrations/NNN_*.sql in order, each once. The advisory lock keeps two
// app instances starting at the same time from applying the same file twice.
async function migrate(pool: pg.Pool) {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock(727101)')
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())')
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue
      await client.query('BEGIN')
      try {
        await client.query(readFileSync(join(MIGRATIONS, file), 'utf8'))
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw new Error(`migration ${file} failed: ${(e as Error).message}`)
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727101)').catch(() => {})
    client.release()
  }
}

export async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>) {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const r = await fn(c)
    await c.query('COMMIT')
    return r
  } catch (e) {
    await c.query('ROLLBACK')
    throw e
  } finally {
    c.release()
  }
}
