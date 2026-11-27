# Installation guide

[한국어](install.ko.md)

- [Requirements](#requirements)
- [Install](#install)
- [HTTPS](#https)
- [Backup and restore](#backup-and-restore)
- [Using Taskhouse together with Pagehouse](#using-taskhouse-together-with-pagehouse)
- [Monitoring](#monitoring)
- [AI agents (MCP)](#ai-agents-mcp)
- [Images and vulnerabilities](#images-and-vulnerabilities)

## Requirements

- One Linux server with Docker 24+ or Podman 4+ (amd64 or arm64).
- Three containers: the app, PostgreSQL 17 and a backup job. No other services.
- Measured with 50,000 issues (`npx tsx scripts/perf.ts`):

| Query | Response |
|---|---|
| Backlog, board, my issues, labels, stale in-progress | 4–19 ms |
| Text search (two-letter Korean words, words) | 15–31 ms |
| Saving a 50,000-character description | 89 ms |

## Install

### From a release bundle (works without internet)

Download `taskhouse-<version>-<amd64|arm64>.tar.gz` and `SHA256SUMS` from the
[releases](https://github.com/spro1/taskhouse/releases), copy them to the server, then:

```sh
sha256sum -c SHA256SUMS --ignore-missing
tar xzf taskhouse-<version>-amd64.tar.gz
cd taskhouse-<version>
scripts/install.sh images.tar
```

The bundle contains the container images (about 180 MB); nothing is downloaded. To make a bundle yourself on a
machine with internet, run `scripts/bundle.sh` in a clone of this repository.

### From source

```sh
git clone https://github.com/spro1/taskhouse.git && cd taskhouse
scripts/install.sh
```

The installer:

- writes `.env` with a random database password and `SECRET_KEY` (mode 600; keep a copy, backups don't contain it),
- builds or loads the images and starts everything,
- waits until the app answers and prints the one-time setup token.

Every setting is described in [`.env.example`](../.env.example). After changing `.env`, apply it with
`docker compose up -d` (or `podman compose up -d`).

## HTTPS

Put the app behind your reverse proxy (nginx, Caddy, …) and set in `.env`:

- `PUBLIC_URL=https://tasks.example.com`: links in mail and webhooks, the SSO redirect, secure cookies.
- `BIND_ADDRESS=127.0.0.1`: only the proxy reaches the app.
- `TRUST_PROXY=1`: the number of proxies in front, so sign-in limits and the audit log see real addresses.

The proxy must pass WebSocket upgrades on `/api/live` (live board updates). For nginx:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  client_max_body_size 60m;
}
```

## Backup and restore

```sh
scripts/backup.sh                # manual backup → ./backups/manual-<time>/
scripts/restore.sh <folder>      # backs up the current state to prerestore-… first, then restores
scripts/upgrade.sh               # preupgrade-… backup → new images → restart (migrations run automatically)
scripts/upgrade.sh images.tar    # the same, from a new offline bundle
```

- Automatic backups run every 24 hours (`BACKUP_INTERVAL_HOURS`) and 14 are kept (`BACKUP_KEEP`).
- A backup is `db.dump` + `files/`. Attachments never change, so they are hard-linked with the previous backup and
  each backup only adds new files.
- Copy `./backups` off the server as well, for example to a NAS, together with `.env`.
- Before upgrading, read the [notes per version](upgrading.md).

## Using Taskhouse together with Pagehouse

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

### Installing the two together (one server)

Install either product the usual way, then add the other with its installer and `--share-with`, naming the folder
of the first. It does not matter which comes first, and for a new server the steps are the same.

```sh
# Pagehouse is installed in /opt/pagehouse. Add Taskhouse (run in this folder):
scripts/install.sh --share-with /opt/pagehouse            # port 3000, or 3001 when Pagehouse has 3000
PORT=8081 scripts/install.sh --share-with /opt/pagehouse  # choose the port

# Taskhouse is installed in /opt/taskhouse. Add Pagehouse:
curl -fsSL https://github.com/spro1/pagehouse/releases/latest/download/install.sh | sh -s -- --share-with /opt/taskhouse --port 3001
```

- The added product starts no database of its own: it joins the first product's compose network and uses its
  database (`docker-compose.shared.yml`). The installer copies that install's database password and `SECRET_KEY`
  into the new `.env`.
- The first product keeps running, and its accounts, passwords, groups, signed-in people and content stay as they are.
- The added product has no setup step and no setup token: sign in with an account you already have. Nobody is its
  admin yet; the first admin of the other product who opens it becomes one.
- Afterwards set `PUBLIC_URL` in the `.env` of both and apply it with `compose up -d` in each folder. That puts
  the link to the other product in each menu.

### Running the two

- The added product needs the first one running (its database is there).
- Each product's backups hold the whole shared database (both products) and that product's own attachments.
  Restoring one takes the accounts and both products back to that moment.
- Before `scripts/restore.sh`, stop the other product (`compose stop app` in its folder) and start it again
  afterwards. A backup from before the second product was added is refused, and nothing is changed.

### Settings involved

- The same `SECRET_KEY` in both (both must read the SSO client secret). The installer takes care of it.
- `PUBLIC_URL`: the link to the other product.
- `COOKIE_DOMAIN`, only when the two run on different subdomains: the parent domain (`example.com` for
  `tasks.example.com` and `wiki.example.com`). On the same host name leave it empty. The sign-in cookie then goes
  to every site under that domain, so use it only when all of them are yours.
- SSO: register both callback addresses on the one client at your IdP. A changed setting reaches the other product
  within 30 seconds. With `OIDC_ADMIN_GROUP` set, that group decides who is an admin in both products at each SSO
  sign-in.

### Good to know

- An account created in one product is an ordinary member of the other. Disabling an account closes both.
  Deleting a group in Pagehouse also removes the project roles given to that group.
- Two installs that **both already have accounts** can't be joined by pointing them at one database: the second
  one refuses to start and changes nothing. Merging existing accounts is not supported yet.
- On separate servers or with your own PostgreSQL there is no installer option: give both products the same
  `DATABASE_URL` and the same `SECRET_KEY`, and back that database up yourself. One dump holds both products.
- To keep the two apart, give each its own database, as a default install does. Nothing is shared then.

### Removing the added product again

Run `compose down -v` in its folder, then drop its tables and its menu link from the shared database. The accounts stay.

```sh
# An added Taskhouse, in the Pagehouse folder:
docker compose exec db psql -U pagehouse -c "DROP SCHEMA taskhouse CASCADE" -c "DELETE FROM accounts.settings WHERE key = 'url:taskhouse'"
# An added Pagehouse, in the Taskhouse folder:
docker compose exec db psql -U taskhouse -c "DROP SCHEMA pagehouse CASCADE" -c "DELETE FROM accounts.settings WHERE key = 'url:pagehouse'"
```

## Monitoring

**Admin → Monitoring** shows the state of the app, refreshed every 15 seconds:

- requests, server errors and slow requests of the last 15 minutes,
- database response time, live connections, webhooks and mail waiting to go out,
- storage, a warning when backups are overdue, and usage.

The overdue-backup warning needs the app container to see `./backups` read-only (the current
`docker-compose.yml` has it).

For Prometheus, put `METRICS_TOKEN` in `.env` and scrape `/metrics` with `Authorization: Bearer <token>`. The
numbers are per instance and start from zero after a restart. `GET /healthz` answers when the app and database are up.

## AI agents (MCP)

Creating a token under **My settings → API tokens** also shows the command that adds Taskhouse to Claude Code:

```sh
claude mcp add --transport http taskhouse https://tasks.example.com/api/mcp --header "Authorization: Bearer th_…"
```

- Tools: `list_projects`, `search_issues` (TQL), `get_issue`, `create_issue`, `update_issue`, `transition_issue`,
  `get_comments`, `add_comment`.
- Descriptions and comments go back and forth as Markdown.
- Every tool calls the REST API as the token's owner, so permissions, workflow rules and the change history are
  the same as on screen.

## Images and vulnerabilities

| Image | Base | Trivy | Grype |
|---|---|---|---|
| `taskhouse` (app, 186 MB) | node:26-alpine without npm, a shell or the system OpenSSL | 0 | 0 |
| `taskhouse-postgres` (302 MB) | postgres:17-alpine, OS patched, gosu removed | 0 | 17 (below) |

- Grype's findings in the database image have no fixed version in alpine yet:
  - busybox wget (CVE-2025-60876; wget is not used),
  - OpenSSL 3.5.9 items in QUIC, DTLS, CMS, DANE and Suite B (PostgreSQL runs without TLS inside the compose
    network, so those paths aren't reached).
- When alpine ships fixes, rebuild with `scripts/upgrade.sh` (`apk upgrade`).
- The database is initialized with a UTF-8 locale (`en_US.UTF-8`). Under the `C` locale or PG17's builtin
  `C.UTF-8`, `pg_trgm` makes no Hangul trigrams and Korean search can't use the index. The app checks this at
  start and warns.
