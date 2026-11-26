// A throwaway PostgreSQL 17 for tests: TEST_DATABASE_URL if given (CI), else an embedded server under .testdb.
// UTF-8 locale on purpose: under LC_CTYPE=C, pg_trgm drops Hangul and Korean search silently gets no index.
import EmbeddedPostgres from 'embedded-postgres'
import { existsSync, rmSync } from 'node:fs'

export async function testDatabase(): Promise<{ url: string; stop: () => Promise<void> }> {
  if (process.env.TEST_DATABASE_URL) return { url: process.env.TEST_DATABASE_URL, stop: async () => {} }
  const dir = '.testdb'
  if (existsSync(dir)) rmSync(dir, { recursive: true })
  const port = 55400 + Math.floor(Math.random() * 90)
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'taskhouse', password: 'taskhouse', port, persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=en_US.UTF-8'], onLog: () => {} })
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('taskhouse_test')
  return { url: `postgres://taskhouse:taskhouse@localhost:${port}/taskhouse_test`, stop: () => pg.stop() }
}
