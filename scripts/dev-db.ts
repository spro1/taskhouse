// Local PostgreSQL 17 for development without Docker: data in .devdb, port 55432. Ctrl-C stops it.
// Then: DATABASE_URL=postgres://taskhouse:taskhouse@localhost:55432/taskhouse npm run dev
import EmbeddedPostgres from 'embedded-postgres'
import { existsSync } from 'node:fs'

const pg = new EmbeddedPostgres({ databaseDir: '.devdb', user: 'taskhouse', password: 'taskhouse', port: 55432, persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=en_US.UTF-8'] })
const fresh = !existsSync('.devdb')
if (fresh) await pg.initialise()
await pg.start()
if (fresh) await pg.createDatabase('taskhouse')
console.log('dev database: postgres://taskhouse:taskhouse@localhost:55432/taskhouse')
process.on('SIGINT', () => pg.stop().then(() => process.exit(0)))
