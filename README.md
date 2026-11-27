# Taskhouse

English | [한국어](README.ko.md)

A lightweight issue tracker that small organizations (5–100 people) install on their own server. It runs as one app
and one PostgreSQL. Open source under the Apache-2.0 license. Report security problems privately as described in
[SECURITY.md](SECURITY.md). To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).

## What's in it

- One-time setup token (printed in the server log), invite-link accounts, password sign-in, OIDC single sign-on
  (PKCE, nonce, group sync, admin group; set up on the admin screen or with environment variables)
- Accounts shared with Pagehouse (wiki): on the same database the two share people, sign-ins, groups and SSO
  settings, and each links to the other. Roles and permissions stay per product (see "Using Taskhouse together
  with Pagehouse" below)
- Sign-in limits over 15 minutes: 10 tries per address and account, 50 per address, 30 per account (then 429 with `Retry-After`)
- Forgot password (a one-hour link, when mail is set up), reset links and temporary passwords issued by an admin
  (the person must change it at the next sign-in)
- Korean and English screens and mail (chosen per account, Korean by default)
- Secrets kept in the database (webhook signing keys, the SSO client secret) are encrypted with `SECRET_KEY`
- Personal API tokens (up to 365 days, 90 by default). Revoked when the account is disabled; SSO accounts' tokens
  stop working after 30 days without a sign-in
- Four project roles (viewer, reporter, member, admin) and three visibility levels. Issues outside your
  permissions answer 404 on every path
- Issues (epic > standard > sub-task, hierarchy checked), field-level merge (`_base`), change history, comments,
  links, attachments (deduplicated by sha256), watching
- Descriptions and comments are Tiptap rich text with @mentions (mentioned people are notified). Stored documents
  are drawn with React elements only, never HTML strings, so no script can get in
- Workflows: free movement by default. Statuses and transition rules (who, conditions, what happens after) are
  edited on the settings screen
- Board (drag to transition and reorder), backlog, sprints (unfinished issues move on start and completion)
- Live updates: board, backlog and issue screens show other people's changes right away (WebSocket +
  LISTEN/NOTIFY; only ids go over the socket)
- Search: TQL (a JQL subset with `CHANGED`, `linked`, `membersOf()` and more) and filter chips share one engine.
  The permission condition is always included, with a 3-second limit. ⌘K jumps to a key or searches text. Saved filters
- Korean search: particles are handled, and two-letter words use the index too (a GIN index of Hangul syllable pairs)
- Notifications: in-app, mail digests (with SMTP, sent after 5 quiet minutes), webhooks (HMAC-signed, retried 5
  times) and chat (Slack, Mattermost, Teams). Only ever to people who may see the issue
- Admin screen (invites, disabling, admin rights, reset links, temporary passwords, SSO, audit log); personal
  settings (language, password, notification mail, API tokens)
- Export: a whole project as JSON (descriptions, comments, links and history included), issue lists as CSV
- Security: request size limits, cross-site write requests refused, CSP and frame-blocking headers, webhooks
  registered by site admins only and never sent to loopback or link-local addresses, backup files readable by
  their owner only
- Audit log, automatic backups (attachments hard-linked, so incremental), restore, upgrade and offline-bundle
  scripts, an attachment storage limit and clean-up of unused files

Not yet: Git and CI integration, versions and releases, charts, custom fields, automation rules, an MCP server,
timelines, per-issue access restrictions.

### Performance (50,000 issues, `npx tsx scripts/perf.ts`)

| Query | Response |
|---|---|
| Backlog, board, my issues, labels, stale in-progress | 4–19 ms |
| Text search (two-letter Korean words, words) | 15–31 ms |
| Saving a 50,000-character description | 89 ms |

## Install and run (Podman or Docker)

```sh
scripts/install.sh               # write .env (random DB password and SECRET_KEY) → build images → start → print the setup token
scripts/backup.sh                # manual backup → ./backups/manual-<time>/
scripts/restore.sh <folder>      # backs up the current state to prerestore-… first, then restores
scripts/upgrade.sh               # preupgrade-… backup → new images → restart (migrations run automatically)
```

Without internet access: download `taskhouse-<version>-<amd64|arm64>.tar.gz` from the
[releases](https://github.com/spro1/taskhouse/releases), or build `taskhouse-<version>.tar.gz` (images included,
about 180 MB) with `scripts/bundle.sh` on a machine that has internet. Copy it over, then
`tar xzf … && cd taskhouse-<version> && scripts/install.sh images.tar`. Upgrade with `scripts/upgrade.sh images.tar`.

Automatic backups run every 24 hours (`BACKUP_INTERVAL_HOURS`) and keep 14 (`BACKUP_KEEP`). A backup is
`db.dump` + `files/`; attachments never change, so they are hard-linked with the previous backup. Copy `./backups`
off the server as well.

### Upgrading an existing install

- Add `SECRET_KEY` (a long random string) to `.env` and restart. Webhook signing keys already stored are encrypted
  at start; receivers don't need to change anything. Without `SECRET_KEY` everything works as before (stored as is).
  If you lose it after setting it, webhook signing keys and the SSO client secret must be made again.
- The default sign-in session is now 24 hours. Existing installs keep 12 hours because `.env` has
  `SESSION_HOURS=12`. To use the new default, change that line to `24` or remove it and restart (applies to new sign-ins).
- Creating an account through SSO now needs an email the IdP marks verified (the same rule as Pagehouse). With an
  IdP that never sends `email_verified`, new people can't sign in through SSO after the upgrade (`no_email`).
  For such an IdP, put `OIDC_TRUST_EMAIL=1` in `.env` or turn on "Trust emails the provider doesn't mark verified"
  under Admin → SSO. People who already have an account are not affected.
- `TRUST_PROXY` is the number of proxies in front. An existing `1` still means one proxy. `X-Forwarded-For` is now
  counted from the right, so a client can't get around the sign-in limits by faking that header.

- The account tables (`users`, `sessions`, `groups`, `group_members`) move to the `accounts` schema at the first
  start, with their rows, and the SSO setting moves to `accounts.settings`. Nothing changes in use. The database
  user needs the `CREATE` privilege on the database (a default install and the database owner have it). SQL you run
  by hand must name the schema (`accounts.users`). An older version can't read the new layout: to go back, restore
  the `preupgrade-…` backup.
- Groups that came from SSO can now be edited on the admin screen. An SSO sign-in adds and removes only the
  memberships it made itself and leaves the ones added by hand (the same rule as Pagehouse).

### Using Taskhouse together with Pagehouse

Taskhouse and [Pagehouse](https://github.com/spro1/pagehouse) (wiki) are separate products that can share their
accounts, the way two products of one suite do. They share them when both use **the same PostgreSQL database**
(the same `DATABASE_URL`). Each product keeps its own tables in its own schema (`taskhouse`, `pagehouse`); people,
passwords, sign-ins, groups and the SSO settings live once, in the `accounts` schema.

| Shared | Per product |
|---|---|
| Accounts (name, email, password, disabled or not) | Who is an admin, project roles and every other permission |
| Sign-ins: signing in or out of one does the same in the other | API tokens |
| Groups and their members | Issues, pages, attachments, webhooks, audit log, every other setting |
| SSO settings (Admin → SSO in either product) | |

- **Installing the two together (one server)**: install either product the usual way, then add the other with its
  installer and `--share-with`, naming the folder of the first. It does not matter which comes first, and for a
  new server the steps are the same.
  ```sh
  # Pagehouse is installed in /opt/pagehouse. Add Taskhouse (run in this folder):
  scripts/install.sh --share-with /opt/pagehouse            # port 3000, or 3001 when Pagehouse has 3000
  PORT=8081 scripts/install.sh --share-with /opt/pagehouse  # choose the port

  # Taskhouse is installed in /opt/taskhouse. Add Pagehouse:
  curl -fsSL https://github.com/spro1/pagehouse/releases/latest/download/install.sh | sh -s -- --share-with /opt/taskhouse --port 3001
  ```
  The added product starts no database of its own: it joins the first product's compose network and uses its
  database (`docker-compose.shared.yml`). The installer copies that install's database password and `SECRET_KEY`
  into the new `.env`. The first product keeps running, and its accounts, passwords, groups, signed-in people and
  content stay as they are. The added product has no setup step and no setup token: sign in with an account you
  already have. Nobody is its admin yet; the first admin of the other product who opens it becomes one. Afterwards
  set `PUBLIC_URL` in the `.env` of both and apply it with `compose up -d` in each folder, which puts the link to
  the other product in each menu.
- **Running the two**: the added product needs the first one running (its database is there). Each product's
  backups hold the whole shared database (both products) and that product's own attachments; restoring one takes
  the accounts and both products back to that moment. Before `scripts/restore.sh`, stop the other product
  (`compose stop app` in its folder) and start it again afterwards. A backup from before the second product was
  added is refused, and nothing is changed.
- **Removing the added product again**: `compose down -v` in its folder, then drop its tables and its menu link
  from the shared database. For an added Taskhouse, in the Pagehouse folder:
  `docker compose exec db psql -U pagehouse -c "DROP SCHEMA taskhouse CASCADE" -c "DELETE FROM accounts.settings WHERE key = 'url:taskhouse'"`.
  For an added Pagehouse, in this folder:
  `docker compose exec db psql -U taskhouse -c "DROP SCHEMA pagehouse CASCADE" -c "DELETE FROM accounts.settings WHERE key = 'url:pagehouse'"`.
  The accounts stay.
- **The settings involved** (the installer takes care of `SECRET_KEY`): the same `SECRET_KEY` in both (both must
  read the SSO client secret), `PUBLIC_URL` (the link to the other product), and `COOKIE_DOMAIN` only when the two
  run on different subdomains: the parent domain (`example.com` for `tasks.example.com` and `wiki.example.com`).
  On the same host name leave it empty. The sign-in cookie then goes to every site under that domain, so use it
  only when all of them are yours.
- **SSO**: register both callback addresses on the one client at your IdP. A changed setting reaches the other
  product within 30 seconds. With `OIDC_ADMIN_GROUP` set, that group decides who is an admin in both products at
  each SSO sign-in.
- An account created in one product is an ordinary member of the other. Disabling an account closes both.
  Deleting a group in Pagehouse also removes the project roles given to that group.
- Two installs that **both already have accounts** can't be joined by pointing them at one database: the second
  one refuses to start and changes nothing. Merging existing accounts is not supported yet.
- On separate servers or with your own PostgreSQL there is no installer option: give both products the same
  `DATABASE_URL` and the same `SECRET_KEY`, and back that database up yourself. One dump holds both products.
- To keep the two apart, give each its own database, as a default install does. Nothing is shared then.
- Migrations that change the account tables use `ADD COLUMN IF NOT EXISTS` with a default, and the same change
  goes into Pagehouse (`PAGEHOUSE_ACCOUNTS` in `server/app.test.ts` is the copy of its side).

### Images and vulnerabilities

| Image | Base | Trivy | Grype |
|---|---|---|---|
| `taskhouse` (app, 186 MB) | node:26-alpine without npm, a shell or the system OpenSSL | 0 | 0 |
| `taskhouse-postgres` (302 MB) | postgres:17-alpine, OS patched, gosu removed | 0 | 17 (below) |

Grype's findings in the DB image have no fixed version in alpine yet: busybox wget (CVE-2025-60876; wget is not
used) and OpenSSL 3.5.9 items in QUIC, DTLS, CMS, DANE and Suite B (PostgreSQL runs without TLS inside the compose
network, so those paths aren't reached). When alpine ships fixes, rebuild with `scripts/upgrade.sh` (`apk upgrade`).

The database is initialized with a UTF-8 locale (`en_US.UTF-8`). Under the `C` locale or PG17's builtin `C.UTF-8`,
`pg_trgm` makes no Hangul trigrams and Korean search can't use the index (measured; fine on alpine and Debian with
a UTF-8 libc locale). The app checks this at start and warns.

### Single sign-on (OIDC)

Set it up under Admin → SSO (the client secret is stored encrypted with `SECRET_KEY`), or put `OIDC_ISSUER`,
`OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` in `.env` (environment variables win, and the screen becomes read-only).
Register the redirect URI `$PUBLIC_URL/api/auth/oidc/callback` and the post-logout address `$PUBLIC_URL/` with the
IdP. Groups come from the `groups` claim (`OIDC_GROUPS_CLAIM`) at every sign-in, and members of `OIDC_ADMIN_GROUP`
become site admins. Signing out also ends the IdP session.
Accounts are found by the IdP's `sub`. At the first sign-in Taskhouse links to an existing local account with the
same email, or creates one (not with `OIDC_AUTO_CREATE=0`), and does either only with an email the IdP marks
verified (`email_verified`). For an IdP that never sends `email_verified`, `OIDC_TRUST_EMAIL=1` allows it (an IdP
that says `false` is still refused). People already linked by `sub` sign in whatever the email claim says.
When accounts are shared with Pagehouse there is one SSO setting: register both products' redirect URIs and
post-logout addresses on one client at the IdP, and keep `SECRET_KEY` the same in both. One SSO sign-in, in either
product, signs the person in to both, and `OIDC_ADMIN_GROUP` decides who is an admin in both. `OIDC_*` in `.env`
is per product: set it in both, or in neither.
Even with `PASSWORD_LOGIN=0` (SSO only), an admin who has a password can get in through "Admin emergency sign-in"
on the sign-in screen.

Checked with Keycloak 26. To try it locally, `scripts/keycloak-dev.sh` starts a test Keycloak (realm, client,
group mapper and test users).

## Development

Node 22.18 or later (the image uses Node 26 LTS).

```sh
npm ci
npm run dev:db                  # PostgreSQL 17 without Docker (port 55432, .devdb)
DATABASE_URL=postgres://taskhouse:taskhouse@localhost:55432/taskhouse npm run dev
npm test                        # integration tests on an embedded PostgreSQL
npm run typecheck && npm audit
# Scan the images: podman save -o app.tar localhost/taskhouse:latest && trivy image --input app.tar && grype docker-archive:app.tar
```

Dependencies stay at their latest stable versions and `npm audit` must report nothing. The image build also stops
if `npm audit --omit=dev` fails.
