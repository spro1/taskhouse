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
  const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${await prepare(url)} -c random_page_cost=1.1` })
  // pg_trgm classifies letters through the database's libc locale: under C (or PG17's builtin C.UTF-8) Hangul makes
  // no trigrams, so Korean search still works but never uses its index. Say so loudly instead of being slow quietly.
  const { n } = (await pool.query(`SELECT array_length(show_trgm('가나다'), 1) AS n`)).rows[0]
  if (!n) console.warn(`WARNING: this database's LC_CTYPE has no Hangul letters; Korean search can't use its index. Create it with a UTF-8 libc locale such as en_US.UTF-8.`)
  return pool
}

// Applies migrations/NNN_*.sql in order, each once, on the connection prepare() holds (and has locked).
async function migrate(client: pg.Client, schema: string) {
  // Named with its schema: another product's schema_migrations may sit in public of the same database.
  const schema_migrations = `${schema}.schema_migrations`
  await client.query(`CREATE TABLE IF NOT EXISTS ${schema_migrations} (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  const done = new Set((await client.query(`SELECT name FROM ${schema_migrations}`)).rows.map((r) => r.name))
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue
    await client.query('BEGIN')
    try {
      await client.query(readFileSync(join(MIGRATIONS, file), 'utf8'))
      await client.query(`INSERT INTO ${schema_migrations} (name) VALUES ($1)`, [file])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw new Error(`migration ${file} failed: ${(e as Error).message}`)
    }
  }
}
// Accounts live in their own schema so that Pagehouse and Taskhouse installed into one database share them:
// one sign-in, one set of people and groups. Everything else stays in this product's schema.
const PRODUCT = 'taskhouse'
const MARKER = 'issues' // a table only this product has: found in public = an install from before schemas
const SHARED = ['users', 'groups', 'sessions', 'group_members']

/** Picks this product's schema, applies its migrations there, then moves the account tables to `accounts`. */
async function prepare(url: string) {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    await c.query('SELECT pg_advisory_lock(727000)') // one lock for both products: they change the same tables
    const legacy = (await c.query(`SELECT to_regclass('public.${MARKER}') AS t`)).rows[0].t
    const schema = legacy ? 'public' : PRODUCT
    await c.query(`CREATE SCHEMA IF NOT EXISTS accounts`)
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
    await c.query('CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public') // in public, where both products find it
    const path = `${schema},accounts,public`
    await c.query(`SET search_path = ${path}`)
    await migrate(c, schema)
    await c.query('BEGIN')
    try {
      await shareAccounts(c, schema)
      await c.query('COMMIT')
    } catch (e) {
      await c.query('ROLLBACK')
      throw e
    }
    return path
  } finally {
    await c.query('SELECT pg_advisory_unlock(727000)').catch(() => {})
    await c.end()
  }
}

// The first product in a database hands its account tables over. A later one finds them there and drops its own
// (still empty) copies, after adding the columns only it knows and pointing its foreign keys at the shared tables.
async function shareAccounts(c: pg.Client, schema: string) {
  const oid = async (name: string) => (await c.query('SELECT to_regclass($1)::oid AS oid', [name])).rows[0].oid as number | null
  const mine = new Map<string, number>()
  for (const t of SHARED) { const o = await oid(`${schema}.${t}`); if (o) mine.set(t, o) }
  for (const [t, own] of mine) {
    const shared = await oid(`accounts.${t}`)
    if (!shared) { await c.query(`ALTER TABLE ${schema}.${t} SET SCHEMA accounts`); mine.delete(t); continue }
    if ((await c.query(`SELECT 1 FROM ${schema}.${t} LIMIT 1`)).rowCount)
      throw new Error(`this database already holds accounts from another product, and ${PRODUCT} has its own ${t}: joining two installs that both have accounts is not supported`)
    const cols = (await c.query(
      `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, pg_get_expr(d.adbin, d.adrelid) AS def, a.attnotnull AS notnull
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
         AND a.attname NOT IN (SELECT attname FROM pg_attribute WHERE attrelid = $2 AND attnum > 0 AND NOT attisdropped)`, [own, shared])).rows
    for (const col of cols)
      await c.query(`ALTER TABLE accounts.${t} ADD COLUMN "${col.name}" ${col.type}${col.def ? ` DEFAULT ${col.def}${col.notnull ? ' NOT NULL' : ''}` : ''}`)
  }
  for (const [t, own] of mine) {
    const fks = (await c.query(
      `SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE contype = 'f' AND confrelid = $1 AND conrelid <> ALL($2::oid[])`, [own, [...mine.values()]])).rows
    for (const fk of fks)
      await c.query(`ALTER TABLE ${fk.tbl} DROP CONSTRAINT "${fk.conname}", ADD CONSTRAINT "${fk.conname}" ${fk.def.replace(/REFERENCES \S+?\(/, `REFERENCES accounts.${t}(`)}`)
  }
  for (const t of [...mine.keys()].reverse()) await c.query(`DROP TABLE ${schema}.${t}`)
  // Settings both products read: SSO, and each product's address (for the link to the other one).
  await c.query('CREATE TABLE IF NOT EXISTS accounts.settings (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())')
  await c.query(`INSERT INTO accounts.settings SELECT key, value, updated_at FROM ${schema}.settings WHERE key = 'sso' ON CONFLICT DO NOTHING`)
  await c.query(`DELETE FROM ${schema}.settings WHERE key = 'sso'`)
  const url = process.env.PUBLIC_URL?.replace(/\/$/, '')
  if (url) await c.query(`INSERT INTO accounts.settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [`url:${PRODUCT}`, JSON.stringify(url)])
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
