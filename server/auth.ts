// Accounts: first-run setup, password and SSO (OIDC) sign-in, invites, sessions, personal API tokens, admin.
import type { Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import { tx, type Db } from './db.ts'
import { mailer, mailFrom, textFor } from './mail.ts'
import { encrypting, isSealed, openSecret, sealSecret } from './secret.ts'
import { audit, body, clientIp, fail, sha256, type Env, type User } from './http.ts'

// A day by default: sign in once per working day. Applies to new sign-ins; existing sessions keep their expiry.
const SESSION_HOURS = Number(process.env.SESSION_HOURS ?? 24)
// An SSO account that hasn't signed in for this long is probably gone at the IdP (no SCIM here): its API tokens stop.
const TOKEN_SSO_GRACE_DAYS = Number(process.env.TOKEN_SSO_GRACE_DAYS ?? 30)
const b64url = (b: Buffer) => b.toString('base64url')

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}
function checkPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':')
  // Same work for unknown accounts, so timing doesn't reveal which emails exist.
  if (!hash) return (scryptSync(password, 'no-account-padding', 64), false)
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, 'hex'))
}
const validPassword = (p: unknown): p is string => typeof p === 'string' && p.length >= 8 && p.length <= 200
const validEmail = (e: unknown): e is string => typeof e === 'string' && /^[^\s@]+@[^\s@]+$/.test(e) && e.length <= 200

// Taskhouse and Pagehouse on two subdomains with shared accounts: the parent domain, so one sign-in covers both.
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined
const secure = (c: Context) => (process.env.PUBLIC_URL ?? '').startsWith('https:') || c.req.header('x-forwarded-proto') === 'https'

async function startSession(db: Db, c: Context, userId: number) {
  const token = b64url(randomBytes(32))
  await db.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))`, [sha256(token), userId, SESSION_HOURS])
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId])
  setCookie(c, 'sid', token, { httpOnly: true, sameSite: 'Lax', path: '/', secure: secure(c), maxAge: SESSION_HOURS * 3600, domain: COOKIE_DOMAIN })
}

// Guessing limits over a sliding 15 minutes: 10 failures per address and account, 50 per address (one machine trying
// many accounts), 30 per account (many machines trying one account, without locking its owner out for long).
// shortcut: per-process counters; with several app instances an attacker gets N x the attempts. Move to the DB if that matters.
const WINDOW = 15 * 60_000
const failures = new Map<string, number[]>()
const recent = (key: string) => (failures.get(key) ?? []).filter((t) => Date.now() - t < WINDOW)
const keys = (c: Context, account: string) => [`${clientIp(c)}|${account}`, clientIp(c), `account|${account}`]
export function throttled(c: Context, account: string) {
  const [both, ip, acc] = keys(c, account)
  return recent(both).length >= 10 || recent(ip).length >= 50 || recent(acc).length >= 30
}
export function failed(c: Context, account: string) {
  for (const k of keys(c, account)) failures.set(k, [...recent(k), Date.now()])
  if (failures.size > 10_000) for (const [k] of failures) if (!recent(k).length) failures.delete(k)
}
export const tooMany = (c: Context) => (c.header('Retry-After', String(WINDOW / 1000)), fail(c, 429, 'too_many_attempts'))

/** First run: no users yet. The setup token is printed to the log so only whoever runs the server can claim admin. */
// Stored as is (not hashed) so every app instance prints the same token; it only lives until the admin exists,
// and anyone who can read the database already controls the install.
export async function ensureSetupToken(db: Db) {
  if ((await db.query('SELECT 1 FROM users LIMIT 1')).rowCount) return null
  await db.query(`INSERT INTO settings (key, value) VALUES ('setup_token', $1) ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify(process.env.SETUP_TOKEN || b64url(randomBytes(18)))])
  return (await db.query(`SELECT value FROM settings WHERE key = 'setup_token'`)).rows[0].value as string
}

// SSO comes from environment variables (they win, and make the admin screen read-only) or from Admin → SSO
// (stored in settings, client secret encrypted with SECRET_KEY).
// autoCreate: make an account on first SSO sign-in (off: only people with an account already linked, or linkable by email).
// trustEmail: treat an email the IdP doesn't mark verified as verified when linking to an existing account or creating one,
// for IdPs that never send email_verified (some Entra ID setups). Both need a verified email, as in Pagehouse.
type SsoSettings = {
  enabled: boolean; issuer: string; clientId: string; clientSecret: string; label: string; groupsClaim: string; adminGroup: string
  passwordLogin: boolean; autoCreate: boolean; trustEmail: boolean
}
type Oidc = Omit<SsoSettings, 'enabled'> & { publicUrl: string }
const publicUrl = () => (process.env.PUBLIC_URL ?? '').replace(/\/$/, '')
const ssoFromEnv = (env = process.env): Oidc | null =>
  env.OIDC_ISSUER && env.OIDC_CLIENT_ID
    ? {
        issuer: env.OIDC_ISSUER.replace(/\/$/, ''), clientId: env.OIDC_CLIENT_ID, clientSecret: env.OIDC_CLIENT_SECRET ?? '',
        label: env.OIDC_LABEL || 'SSO', groupsClaim: env.OIDC_GROUPS_CLAIM || 'groups', adminGroup: env.OIDC_ADMIN_GROUP ?? '',
        passwordLogin: env.PASSWORD_LOGIN !== '0', autoCreate: env.OIDC_AUTO_CREATE !== '0', trustEmail: env.OIDC_TRUST_EMAIL === '1', publicUrl: publicUrl(),
      }
    : null

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; userinfo_endpoint?: string; end_session_endpoint?: string }
let discovery: { at: number; issuer: string; d: Discovery } | null = null
async function discover(issuer: string) {
  if (discovery?.issuer === issuer && Date.now() - discovery.at < 3600_000) return discovery.d
  const r = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) })
  if (!r.ok) throw new Error(`discovery answered ${r.status}`)
  const d = (await r.json()) as Discovery
  if (!d.authorization_endpoint || !d.token_endpoint) throw new Error('discovery document is missing endpoints')
  discovery = { at: Date.now(), issuer, d }
  return d
}
const redirectUri = (c: Context, cfg: Oidc) => `${cfg.publicUrl || new URL(c.req.url).origin}/api/auth/oidc/callback`

export function registerAuth(app: Hono<Env>, db: Db) {
  const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0]

  const storedSso = async (): Promise<SsoSettings | null> => {
    const s = (await one(`SELECT value FROM accounts.settings WHERE key = 'sso'`))?.value as SsoSettings | undefined
    if (!s) return null
    // Saved before SECRET_KEY was set: encrypt it now.
    if (s.clientSecret && !isSealed(s.clientSecret) && encrypting()) await saveSso(s)
    try {
      return { ...s, clientSecret: openSecret(s.clientSecret ?? '') }
    } catch (e) {
      // Wrong or missing SECRET_KEY: carry on without the secret (sign-in fails) so an admin can enter it again.
      console.error('sso:', (e as Error).message)
      return { ...s, clientSecret: '' }
    }
  }
  const saveSso = (s: SsoSettings) => db.query(`INSERT INTO accounts.settings (key, value) VALUES ('sso', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ ...s, clientSecret: sealSecret(s.clientSecret) })])
  // shortcut: other app instances notice a change within 30 seconds; fine for a setting changed once in a while.
  let ssoCache: { at: number; cfg: Oidc | null } | null = null
  const oidc = async (): Promise<Oidc | null> => {
    const env = ssoFromEnv()
    if (env) return env
    if (ssoCache && Date.now() - ssoCache.at < 30_000) return ssoCache.cfg
    const s = await storedSso()
    // Settings saved before these options existed get their defaults.
    const cfg = s?.enabled && s.issuer && s.clientId
      ? { ...s, label: s.label || 'SSO', groupsClaim: s.groupsClaim || 'groups', autoCreate: s.autoCreate ?? true, trustEmail: s.trustEmail ?? false, publicUrl: publicUrl() }
      : null
    ssoCache = { at: Date.now(), cfg }
    return cfg
  }
  // Password sign-in can only be turned off while SSO is on.
  const passwordLogin = async () => (await oidc())?.passwordLogin ?? true

  app.get('/api/auth/state', async (c) => {
    const cfg = await oidc()
    return c.json({
      setupRequired: !(await one('SELECT 1 AS x FROM users LIMIT 1')),
      // "Forgot password" needs mail; without it the sign-in screen says to ask an admin.
      forgot: !!mailer(),
      passwordLogin: cfg?.passwordLogin ?? true,
      sso: cfg ? { label: cfg.label } : null,
    })
  })

  app.post('/api/auth/setup', async (c) => {
    const b = await body(c)
    if (!validEmail(b.email) || !validPassword(b.password) || typeof b.name !== 'string' || !b.name.trim()) return fail(c, 400, 'bad_request')
    if (throttled(c, 'setup')) return tooMany(c)
    const user = await tx(db, async (q) => {
      // One setup at a time; whoever is second sees a user already there.
      await q.query('SELECT pg_advisory_xact_lock(727102)')
      if ((await q.query('SELECT 1 FROM users LIMIT 1')).rowCount) return 'done'
      const want = (await q.query(`SELECT value FROM settings WHERE key = 'setup_token'`)).rows[0]?.value
      if (!want || typeof b.token !== 'string' || sha256(b.token) !== sha256(want)) return null
      await q.query(`DELETE FROM settings WHERE key = 'setup_token'`)
      return (await q.query('INSERT INTO users (email, name, password_hash, is_admin) VALUES ($1, $2, $3, true) RETURNING id',
        [b.email.toLowerCase(), b.name.trim().slice(0, 100), hashPassword(b.password)])).rows[0]
    })
    if (user === 'done') return fail(c, 409, 'already_set_up')
    if (!user) return failed(c, 'setup'), audit(db, c, 'auth.setup', null, false).then(() => fail(c, 403, 'bad_setup_token'))
    await startSession(db, c, user.id)
    await audit(db, c, 'auth.setup', null, true, undefined, user.id)
    return c.json({ ok: true })
  })

  app.post('/api/auth/login', async (c) => {
    const b = await body(c)
    const email = String(b.email ?? '').toLowerCase()
    if (!(await passwordLogin())) {
      // SSO-only mode still lets admins with a password in (break-glass), so an IdP outage can be fixed.
      // Linking the account to SSO later doesn't take that away.
      const u = await one(`SELECT id FROM users WHERE email = $1 AND is_admin AND password_hash <> ''`, [email])
      if (!u) return fail(c, 403, 'sso_only')
    }
    if (throttled(c, email)) return tooMany(c)
    const u = await one('SELECT id, password_hash, disabled_at FROM users WHERE email = $1', [email])
    if (!checkPassword(String(b.password ?? ''), u?.password_hash ?? '') || u.disabled_at) {
      failed(c, email)
      await audit(db, c, 'auth.login', email, false, undefined, u?.id ?? null)
      return fail(c, 401, 'bad_credentials')
    }
    failures.delete(`${clientIp(c)}|${email}`)
    await startSession(db, c, u.id)
    await audit(db, c, 'auth.login', email, true, undefined, u.id)
    return c.json({ ok: true })
  })

  // Signing out after an SSO sign-in also ends the session at the IdP (RP-initiated logout): otherwise the next
  // click on the SSO button signs the same person straight back in, which on a shared computer is someone else.
  app.post('/api/auth/logout', async (c) => {
    const token = getCookie(c, 'sid')
    if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)])
    deleteCookie(c, 'sid', { path: '/', domain: COOKIE_DOMAIN })
    const idToken = getCookie(c, 'oidc_idt')
    deleteCookie(c, 'oidc_idt', { path: '/api/auth' })
    const cfg = await oidc()
    const d = idToken && cfg ? await discover(cfg.issuer).catch(() => null) : null
    const redirect = d?.end_session_endpoint
      ? `${d.end_session_endpoint}?${new URLSearchParams({ id_token_hint: idToken!, client_id: cfg!.clientId, post_logout_redirect_uri: `${cfg!.publicUrl || new URL(c.req.url).origin}/` })}`
      : null
    return c.json({ ok: true, redirect })
  })

  // Invite links: the only way to get a local account besides setup (no open sign-up).
  app.get('/api/auth/invite/:token', async (c) => {
    const inv = await one('SELECT email FROM invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()', [sha256(c.req.param('token'))])
    return inv ? c.json({ email: inv.email }) : fail(c, 404, 'invite_invalid')
  })
  app.post('/api/auth/invite/:token', async (c) => {
    const b = await body(c)
    if (!validPassword(b.password) || typeof b.name !== 'string' || !b.name.trim()) return fail(c, 400, 'bad_request')
    const user = await tx(db, async (q) => {
      const inv = (await q.query('UPDATE invites SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING email',
        [sha256(c.req.param('token'))])).rows[0]
      if (!inv) return null
      return (await q.query(`INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id`,
        [inv.email, b.name.trim().slice(0, 100), hashPassword(b.password)])).rows[0] ?? 'exists'
    })
    if (!user) return fail(c, 404, 'invite_invalid')
    if (user === 'exists') return fail(c, 409, 'email_taken')
    await startSession(db, c, user.id)
    return c.json({ ok: true })
  })

  // Reset links (made by an admin): set a new password, which signs the person out everywhere.
  app.get('/api/auth/reset/:token', async (c) => {
    const r = await one(`SELECT u.email FROM password_resets p JOIN users u ON u.id = p.user_id
      WHERE p.token_hash = $1 AND p.used_at IS NULL AND p.expires_at > now() AND u.disabled_at IS NULL`, [sha256(c.req.param('token'))])
    return r ? c.json({ email: r.email }) : fail(c, 404, 'reset_invalid')
  })
  app.post('/api/auth/reset/:token', async (c) => {
    const b = await body(c)
    if (!validPassword(b.password)) return fail(c, 400, 'bad_request')
    const id = await tx(db, async (q) => {
      const r = (await q.query(`UPDATE password_resets p SET used_at = now() FROM users u
        WHERE p.token_hash = $1 AND p.used_at IS NULL AND p.expires_at > now() AND u.id = p.user_id AND u.disabled_at IS NULL RETURNING p.user_id`,
        [sha256(c.req.param('token'))])).rows[0]
      if (!r) return null
      await q.query('UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1', [r.user_id, hashPassword(b.password)])
      await q.query('DELETE FROM sessions WHERE user_id = $1', [r.user_id])
      return r.user_id as number
    })
    if (!id) return fail(c, 404, 'reset_invalid')
    await audit(db, c, 'auth.reset', String(id), true, undefined, id)
    await startSession(db, c, id)
    return c.json({ ok: true })
  })

  // Forgot password (only with mail set up): a one-hour reset link goes to the address. The answer is the same whether
  // or not the address has an account, so this can't be used to find out who does; every request counts toward the
  // sign-in limits, so nobody gets flooded with mail.
  app.post('/api/auth/forgot', async (c) => {
    const transport = mailer()
    if (!transport) return fail(c, 404, 'mail_off')
    const email = String((await body(c)).email ?? '').trim().toLowerCase()
    if (throttled(c, `forgot:${email}`)) return tooMany(c)
    failed(c, `forgot:${email}`)
    const u = validEmail(email) && (await one('SELECT id, locale FROM users WHERE email = $1 AND disabled_at IS NULL', [email]))
    await audit(db, c, 'auth.forgot', email, true, undefined, null)
    if (u) {
      const token = b64url(randomBytes(24))
      await db.query(`INSERT INTO password_resets (token_hash, user_id, created_by, expires_at) VALUES ($1, $2, $2, now() + interval '1 hour')`, [sha256(token), u.id])
      const L = textFor(u.locale)
      const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '') || new URL(c.req.url).origin
      await transport.sendMail({ from: mailFrom(), to: email, subject: L.resetSubject, text: `${L.resetBody}\n\n${base}/reset/${token}\n\n${L.resetIgnore}\n` })
        .catch((e: Error) => console.error('forgot-password mail failed:', e.message))
    }
    return c.json({ ok: true })
  })

  app.get('/api/auth/oidc/start', async (c) => {
    const cfg = await oidc()
    const d = cfg && (await discover(cfg.issuer).catch(() => null))
    if (!cfg || !d) return c.redirect('/?sso_error=unavailable')
    const [state, verifier, nonce] = [24, 32, 16].map((n) => b64url(randomBytes(n)))
    setCookie(c, 'oidc', `${state}.${verifier}.${nonce}`, { httpOnly: true, sameSite: 'Lax', path: '/api/auth/oidc', secure: secure(c), maxAge: 600 })
    const q = new URLSearchParams({
      response_type: 'code', client_id: cfg.clientId, redirect_uri: redirectUri(c, cfg), scope: 'openid email profile', state, nonce,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    })
    return c.redirect(`${d.authorization_endpoint}?${q}`)
  })

  app.get('/api/auth/oidc/callback', async (c) => {
    const back = async (error: string, ok = false) => {
      await audit(db, c, 'auth.sso', null, ok, ok ? undefined : { error })
      return c.redirect(ok ? '/' : `/?sso_error=${error}`)
    }
    const [state, verifier, nonce] = (getCookie(c, 'oidc') ?? '').split('.')
    deleteCookie(c, 'oidc', { path: '/api/auth/oidc' })
    const code = c.req.query('code')
    const cfg = await oidc()
    if (!cfg || !state || !code || c.req.query('state') !== state) return back('failed')
    try {
      const d = await discover(cfg.issuer)
      const tok = await fetch(d.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(c, cfg), client_id: cfg.clientId, client_secret: cfg.clientSecret, code_verifier: verifier }),
        signal: AbortSignal.timeout(10_000),
      }).then((r) => (r.ok ? r.json() : null))
      if (typeof tok?.id_token !== 'string') return back('failed')
      // The ID token came straight from the token endpoint over TLS, so its signature needs no check (OIDC Core 3.1.3.7);
      // the claims that bind it to this sign-in still do.
      const claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1] ?? '', 'base64url').toString('utf8'))
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
      if ((claims.iss ?? '').replace(/\/$/, '') !== cfg.issuer || !aud.includes(cfg.clientId) || claims.nonce !== nonce || !(claims.exp * 1000 > Date.now()))
        return back('failed')
      // Some providers (Keycloak by default) put groups and email only in userinfo.
      const info: Record<string, any> = d.userinfo_endpoint && tok.access_token
        ? await fetch(d.userinfo_endpoint, { headers: { authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : {}))
        : {}
      const all = { ...claims, ...(info?.sub === claims.sub ? info : {}) }
      const sub = String(claims.sub ?? '')
      const email = typeof all.email === 'string' ? all.email.toLowerCase() : ''
      // Needed to link an existing account by email or to create one. trustEmail covers a missing claim only: any other value that
      // isn't true / "true" (false, "false", ...) means not verified, whatever the setting.
      const verified = all.email_verified === true || all.email_verified === 'true' || (cfg.trustEmail && all.email_verified == null)
      if (!sub) return back('failed')
      const rawGroups = all[cfg.groupsClaim]
      // A claim that's missing means "this IdP doesn't send groups": keep whatever groups the account has.
      const groups = Array.isArray(rawGroups) ? [...new Set(rawGroups.map((g: unknown) => String(g).replace(/^\//, '')).filter(Boolean))].slice(0, 200) : null
      const name = String(all.name || all.preferred_username || email.split('@')[0] || sub).slice(0, 100)

      const res = await tx(db, async (q) => {
        let u = (await q.query('SELECT id, disabled_at FROM users WHERE oidc_sub = $1', [sub])).rows[0]
        // An existing local account is linked only when the IdP vouches for the email.
        if (!u && email && verified) u = (await q.query('UPDATE users SET oidc_sub = $2 WHERE email = $1 AND oidc_sub IS NULL RETURNING id, disabled_at', [email, sub])).rows[0]
        if (!u) {
          if (!cfg.autoCreate) return 'no_account'
          if (!email || !verified) return 'no_email'
          u = (await q.query(`INSERT INTO users (email, name, oidc_sub) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id, disabled_at`, [email, name, sub])).rows[0]
          if (!u) return 'email_taken'
        }
        if (u.disabled_at) return 'account_disabled'
        await q.query('UPDATE users SET last_sso_at = now() WHERE id = $1', [u.id]) // Pagehouse reads it for its tokens when accounts are shared
        if (groups) {
          // Same rule as Pagehouse (they may share these tables): sign-in only touches the memberships it made itself.
          await q.query(`DELETE FROM group_members WHERE user_id = $1 AND source = 'oidc'`, [u.id])
          if (groups.length) {
            await q.query(`INSERT INTO groups (name) SELECT unnest($1::text[]) ON CONFLICT (name) DO NOTHING`, [groups])
            await q.query(`INSERT INTO group_members (group_id, user_id, source) SELECT id, $2, 'oidc' FROM groups WHERE name = ANY($1) ON CONFLICT DO NOTHING`, [groups, u.id])
          }
          // The admin group grants admin; it never takes it from an admin with a password (the break-glass account).
          if (cfg.adminGroup) await q.query(`UPDATE users SET is_admin = $2 OR (is_admin AND password_hash <> '') WHERE id = $1`, [u.id, groups.includes(cfg.adminGroup)])
          // Accounts shared with Pagehouse: this one SSO sign-in covers both products, so the admin group sets its role too.
          if (cfg.adminGroup && (await q.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'accounts' AND table_name = 'users' AND column_name = 'role'`)).rowCount)
            await q.query(`UPDATE users SET role = CASE WHEN $2 THEN 'admin' WHEN role = 'admin' AND password_hash = '' THEN 'member' ELSE role END WHERE id = $1`, [u.id, groups.includes(cfg.adminGroup)])
        }
        return u.id as number
      })
      if (typeof res === 'string') return back(res)
      await startSession(db, c, res)
      // Kept only to end the IdP session on sign-out (sent back to the IdP as id_token_hint).
      setCookie(c, 'oidc_idt', tok.id_token, { httpOnly: true, sameSite: 'Lax', path: '/api/auth', secure: secure(c), maxAge: SESSION_HOURS * 3600 })
      c.set('user', { id: res } as User)
      return back('', true)
    } catch (e) {
      console.error('sso:', (e as Error).message)
      return back('failed')
    }
  })

  let hasAdmin = false
  // Everything below needs a signed-in user: session cookie or personal API token.
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/')) return next()
    const sid = getCookie(c, 'sid')
    const bearer = c.req.header('authorization')?.match(/^Bearer\s+(th_[A-Za-z0-9_-]+)$/)?.[1]
    const cols = `u.id, u.email, u.name, u.is_admin AS "isAdmin"`
    const user: User | undefined = sid
      ? await one(`SELECT ${cols} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now() AND u.disabled_at IS NULL`, [sha256(sid)])
      : bearer
        ? await one(
            `UPDATE api_tokens t SET last_used_at = now() FROM users u
             WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > now() AND u.id = t.user_id AND u.disabled_at IS NULL
               AND (u.oidc_sub IS NULL OR u.last_login_at > now() - make_interval(days => $2))
             RETURNING ${cols}`,
            [sha256(bearer), TOKEN_SSO_GRACE_DAYS],
          )
        : undefined
    if (!user) return fail(c, 401, 'login_required')
    // Accounts shared with Pagehouse: Taskhouse added later has no admin of its own, so a Pagehouse admin becomes one.
    if (!hasAdmin) {
      if (!user.isAdmin && (await one(
        `UPDATE users u SET is_admin = true WHERE u.id = $1 AND to_jsonb(u)->>'role' = 'admin'
           AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin AND disabled_at IS NULL) RETURNING 1 AS x`, [user.id]))) user.isAdmin = true
      hasAdmin = !!(await one(`SELECT 1 AS x FROM users WHERE is_admin AND disabled_at IS NULL`))
    }
    c.set('user', user)
    if (c.req.path.startsWith('/api/admin/') && !user.isAdmin) return fail(c, 403, 'admin_only')
    return next()
  })

  app.get('/api/me', async (c) =>
    c.json({ ...c.get('user'), ...(await one(`SELECT email_notify AS "emailNotify", password_hash <> '' AS "hasPassword",
      must_change_password AS "mustChangePassword", locale, theme, avatar IS NOT NULL AS avatar,
      (SELECT value #>> '{}' FROM accounts.settings WHERE key = 'url:pagehouse') AS "pagehouseUrl" FROM users WHERE id = $1`, [c.get('user').id])), mail: !!mailer() }))
  app.patch('/api/me', async (c) => {
    const b = await body(c)
    const notify = typeof b.emailNotify === 'boolean' ? b.emailNotify : null
    const locale = b.locale === 'ko' || b.locale === 'en' ? b.locale : null
    const theme = ['system', 'light', 'dark'].includes(b.theme) ? b.theme : null
    if (notify === null && locale === null && theme === null) return fail(c, 400, 'bad_request')
    await db.query('UPDATE users SET email_notify = COALESCE($2, email_notify), locale = COALESCE($3, locale), theme = COALESCE($4, theme) WHERE id = $1', [c.get('user').id, notify, locale, theme])
    return c.json({ ok: true })
  })

  // Changing your password signs out your other sessions. SSO-only accounts (no password yet) can set one
  // without a current password only if they have none.
  app.post('/api/me/password', async (c) => {
    const b = await body(c)
    if (!validPassword(b.password)) return fail(c, 400, 'bad_request')
    const u = await one('SELECT password_hash FROM users WHERE id = $1', [c.get('user').id])
    if (throttled(c, c.get('user').email)) return tooMany(c)
    if (u.password_hash && !checkPassword(String(b.current ?? ''), u.password_hash)) {
      failed(c, c.get('user').email)
      await audit(db, c, 'user.password', String(c.get('user').id), false)
      return fail(c, 403, 'bad_credentials')
    }
    await db.query('UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1', [c.get('user').id, hashPassword(b.password)])
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [c.get('user').id, sha256(getCookie(c, 'sid') ?? '')])
    await audit(db, c, 'user.password', String(c.get('user').id))
    return c.json({ ok: true })
  })

  app.get('/api/me/tokens', async (c) =>
    c.json((await db.query(`SELECT id, name, created_at AS "createdAt", expires_at AS "expiresAt", last_used_at AS "lastUsedAt"
      FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY id`, [c.get('user').id])).rows))
  app.post('/api/me/tokens', async (c) => {
    const b = await body(c)
    const name = String(b.name ?? '').trim().slice(0, 100)
    const days = Number(b.days ?? 90)
    if (!name || !Number.isInteger(days) || days < 1 || days > 365) return fail(c, 400, 'bad_request')
    const token = `th_${b64url(randomBytes(32))}`
    const row = await one(`INSERT INTO api_tokens (user_id, name, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(days => $4)) RETURNING id, expires_at AS "expiresAt"`,
      [c.get('user').id, name, sha256(token), days])
    await audit(db, c, 'token.create', String(row.id))
    // The only time the token is shown.
    return c.json({ ...row, token })
  })
  app.delete('/api/me/tokens/:id', async (c) => {
    const r = await db.query('UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [Number(c.req.param('id')) || 0, c.get('user').id])
    if (!r.rowCount) return fail(c, 404, 'not_found')
    await audit(db, c, 'token.revoke', c.req.param('id'))
    return c.json({ ok: true })
  })

  // People pickers (assignee, roles) need the directory; every signed-in user may read names.
  app.get('/api/users', async (c) => {
    const q = `%${(c.req.query('q') ?? '').replace(/[\\%_]/g, '\\$&')}%`
    return c.json((await db.query(`SELECT id, name, email FROM users WHERE disabled_at IS NULL AND (name ILIKE $1 OR email ILIKE $1) ORDER BY name LIMIT 50`, [q])).rows)
  })
  app.get('/api/groups', async (c) => c.json((await db.query('SELECT id, name, source FROM groups ORDER BY name')).rows))

  app.get('/api/admin/users', async (c) =>
    c.json((await db.query(`SELECT id, email, name, is_admin AS "isAdmin", oidc_sub IS NOT NULL AS sso, last_login_at AS "lastLoginAt", disabled_at AS "disabledAt"
      FROM users ORDER BY name`)).rows))
  app.patch('/api/admin/users/:id', async (c) => {
    const b = await body(c)
    const id = Number(c.req.param('id')) || 0
    if (id === c.get('user').id && (b.disabled === true || b.isAdmin === false)) return fail(c, 400, 'not_yourself')
    const r = await tx(db, async (q) => {
      const u = (await q.query(`UPDATE users SET
          is_admin = COALESCE($2, is_admin),
          disabled_at = CASE WHEN $3::boolean IS NULL THEN disabled_at WHEN $3 THEN COALESCE(disabled_at, now()) ELSE NULL END
        WHERE id = $1 RETURNING id`, [id, typeof b.isAdmin === 'boolean' ? b.isAdmin : null, typeof b.disabled === 'boolean' ? b.disabled : null])).rows[0]
      // Disabling signs the person out everywhere and kills their tokens.
      if (u && b.disabled === true) {
        await q.query('DELETE FROM sessions WHERE user_id = $1', [id])
        await q.query('UPDATE api_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id])
      }
      return u
    })
    if (!r) return fail(c, 404, 'not_found')
    await audit(db, c, 'user.update', String(id), true, { isAdmin: b.isAdmin, disabled: b.disabled })
    return c.json({ ok: true })
  })
  app.post('/api/admin/users/:id/reset-link', async (c) => {
    const id = Number(c.req.param('id')) || 0
    if (!(await one('SELECT 1 AS x FROM users WHERE id = $1 AND disabled_at IS NULL', [id]))) return fail(c, 404, 'not_found')
    const token = b64url(randomBytes(24))
    await db.query(`INSERT INTO password_resets (token_hash, user_id, created_by, expires_at) VALUES ($1, $2, $3, now() + interval '24 hours')`, [sha256(token), id, c.get('user').id])
    await audit(db, c, 'user.reset_link', String(id))
    return c.json({ token, url: `/reset/${token}` })
  })
  // A temporary password the admin passes on (by phone, in person): the old one stops working, the person is signed
  // out everywhere and must choose their own after signing in with it.
  app.post('/api/admin/users/:id/temp-password', async (c) => {
    const id = Number(c.req.param('id')) || 0
    if (id === c.get('user').id) return fail(c, 400, 'not_yourself')
    // Easy to read out loud: no 0/O, 1/l/I.
    const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const password = [...randomBytes(12)].map((x) => abc[x % abc.length]).join('')
    const r = await db.query('UPDATE users SET password_hash = $2, must_change_password = true WHERE id = $1 AND disabled_at IS NULL', [id, hashPassword(password)])
    if (!r.rowCount) return fail(c, 404, 'not_found')
    await db.query('DELETE FROM sessions WHERE user_id = $1', [id])
    await audit(db, c, 'user.temp_password', String(id))
    return c.json({ password })
  })
  app.post('/api/admin/invites', async (c) => {
    const b = await body(c)
    if (!validEmail(b.email)) return fail(c, 400, 'bad_request')
    const token = b64url(randomBytes(24))
    await db.query(`INSERT INTO invites (token_hash, email, created_by, expires_at) VALUES ($1, $2, $3, now() + interval '7 days')`, [sha256(token), b.email.toLowerCase(), c.get('user').id])
    await audit(db, c, 'user.invite', b.email.toLowerCase())
    return c.json({ token, url: `/invite/${token}` })
  })
  // Local groups (SSO groups are replaced at each sign-in, so they aren't edited here).
  app.put('/api/admin/groups/:name', async (c) => {
    const b = await body(c)
    const name = c.req.param('name').trim().slice(0, 100)
    const members = Array.isArray(b.members) ? b.members.map(Number).filter(Number.isInteger) : null
    if (!name || !members) return fail(c, 400, 'bad_request')
    const r = await tx(db, async (q) => {
      const g = (await q.query(`INSERT INTO groups (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [name])).rows[0]
      await q.query('DELETE FROM group_members WHERE group_id = $1', [g.id])
      await q.query('INSERT INTO group_members (group_id, user_id) SELECT $1, id FROM users WHERE id = ANY($2)', [g.id, members])
      return g
    })
    await audit(db, c, 'group.update', name, true, { members })
    return c.json({ id: r.id })
  })
  // Admin → SSO. The secret is never sent back, only whether there is one.
  const ssoView = async (c: Context) => {
    const env = ssoFromEnv()
    const s = env ? { ...env, enabled: true } : await storedSso()
    return {
      source: env ? 'env' : 'admin', enabled: !!s?.enabled, issuer: s?.issuer ?? '', clientId: s?.clientId ?? '', hasSecret: !!s?.clientSecret,
      label: s?.label ?? '', groupsClaim: s?.groupsClaim ?? 'groups', adminGroup: s?.adminGroup ?? '', passwordLogin: s?.passwordLogin ?? true,
      autoCreate: s?.autoCreate ?? true, trustEmail: s?.trustEmail ?? false,
      redirectUri: `${publicUrl() || new URL(c.req.url).origin}/api/auth/oidc/callback`, encrypted: encrypting(),
    }
  }
  const httpUrl = (v: unknown) => {
    try {
      const u = new URL(String(v))
      return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.toString().replace(/\/$/, '') : null
    } catch {
      return null
    }
  }
  app.get('/api/admin/sso', async (c) => c.json(await ssoView(c)))
  app.put('/api/admin/sso', async (c) => {
    if (ssoFromEnv()) return fail(c, 409, 'sso_env')
    const b = await body(c)
    const old = await storedSso()
    const issuer = b.issuer ? httpUrl(b.issuer) : ''
    if (issuer === null) return fail(c, 400, 'sso_issuer')
    const s: SsoSettings = {
      enabled: b.enabled === true, issuer, clientId: String(b.clientId ?? '').trim().slice(0, 300),
      // Left empty, the stored secret stays: the screen never receives it to send back.
      clientSecret: typeof b.clientSecret === 'string' && b.clientSecret ? b.clientSecret.slice(0, 1000) : old?.clientSecret ?? '',
      label: String(b.label ?? '').trim().slice(0, 60), groupsClaim: String(b.groupsClaim ?? '').trim().slice(0, 100) || 'groups',
      adminGroup: String(b.adminGroup ?? '').trim().slice(0, 200), passwordLogin: b.passwordLogin !== false,
      autoCreate: b.autoCreate !== false, trustEmail: b.trustEmail === true,
    }
    if (s.enabled && (!s.issuer || !s.clientId)) return fail(c, 400, 'sso_incomplete')
    // Refuse to switch on something that can't work, rather than leaving everyone with a broken sign-in button.
    if (s.enabled && !(await discover(s.issuer).then(() => true, () => false))) return fail(c, 400, 'sso_discovery')
    await saveSso(s)
    ssoCache = null
    await audit(db, c, 'settings.sso', null, true, { enabled: s.enabled, issuer: s.issuer, passwordLogin: s.passwordLogin })
    return c.json(await ssoView(c))
  })
  app.post('/api/admin/sso/test', async (c) => {
    const issuer = httpUrl((await body(c)).issuer)
    if (!issuer) return c.json({ ok: false, error: 'The issuer must be an http(s) URL.' })
    discovery = null
    try {
      const d = await discover(issuer)
      return c.json({ ok: true, issuer: d.issuer ?? issuer })
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message })
    }
  })

  app.get('/api/admin/audit', async (c) =>
    c.json((await db.query(`SELECT a.id, a.at, a.action, a.target, a.ip, a.ok, a.detail, u.name AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE ($1::bigint IS NULL OR a.id < $1) ORDER BY a.id DESC LIMIT 100`, [Number(c.req.query('before')) || null])).rows))
}
