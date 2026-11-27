# Taskhouse

English | [한국어](README.ko.md)

A lightweight issue tracker that small organizations (5–100 people) install on their own server. It runs as one app
and one PostgreSQL. Open source under the Apache-2.0 license. Report security problems privately as described in
[SECURITY.md](SECURITY.md). To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).

## What's in it

- One-time setup token (printed in the server log), invite-link accounts, password sign-in, OIDC single sign-on
  (PKCE, nonce, group sync, admin group; set up on the admin screen or with environment variables)
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
