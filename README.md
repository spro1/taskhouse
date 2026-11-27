<div align="center">

<img src="docs/images/logo.svg" width="72" height="72" alt="Taskhouse logo">

# Taskhouse

**An on-premises issue tracker that small organizations and teams run on their own servers.**<br>
Backlog, sprints and a board in one place, inside your own network.<br>
An open-source, self-hosted alternative to Jira, and the sibling of [Pagehouse](https://github.com/spro1/pagehouse) (wiki).

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![CI](https://github.com/spro1/taskhouse/actions/workflows/ci.yml/badge.svg)](https://github.com/spro1/taskhouse/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/spro1/taskhouse?include_prereleases&sort=semver)](https://github.com/spro1/taskhouse/releases)
![Docker | Podman](https://img.shields.io/badge/runs%20on-Docker%20%7C%20Podman-2f6feb)
![Air-gapped](https://img.shields.io/badge/air--gapped-supported-2f6feb)

[Is it a fit?](#is-it-a-fit) · [Install](#install) · [Day one](#day-one-checklist) · [Operations](#operations) · [FAQ](#faq) · [한국어](README.ko.md)

<img src="docs/images/screenshot-board.png" alt="A Taskhouse sprint board with To do, In progress, In review and Done columns" width="100%">

</div>

## Who it's for

- **Companies and teams of 5–100 people** for whom hosted trackers are costly, or who are tired of counting seats at every renewal
- Organizations whose work **must not live on someone else's servers**: security policy, customer requirements, air-gapped networks
- Teams **without dedicated ops staff** that want something they can put on one server and mostly forget

## Is it a fit?

| | Taskhouse |
|---|---|
| **Where data lives** | Entirely on your server (PostgreSQL and a file volume). No external fonts, CDNs or telemetry; the only outbound requests are ones you turn on (SSO, email, webhooks) |
| **No internet** | Install and upgrade from an offline bundle that contains the images |
| **Cost** | Apache-2.0 open source, no seat limits |
| **What you need** | One Linux server with Docker or Podman |
| **Moving parts** | The app, PostgreSQL and a backup job: three containers, no external services |
| **Data safety** | Daily automatic backups (attachments hard-linked, so each one only adds new files), a backup before every upgrade and restore |
| **Leaving** | Export a whole project as JSON (descriptions, comments, links and history) and issue lists as CSV |
| **Sign-in** | Local accounts with invite links, or OpenID Connect SSO (tested with Keycloak; provider groups and admins come along) |
| **With a wiki** | Shares people, sign-ins, groups and SSO with [Pagehouse](https://github.com/spro1/pagehouse) when both use one database |

## Features

| | |
|---|---|
| 📋 **Issues** | Epics, stories, tasks, bugs and sub-tasks with the hierarchy checked; rich-text descriptions and comments with `@` mentions; links (blocks, relates), attachments, watching, full change history. Two people editing different fields never overwrite each other |
| 🏃 **Scrum** | Backlog with drag-and-drop ranking, sprints (unfinished issues move on when one completes), a board where dragging a card moves it to another status. Quick filters by text, assignee and "only mine" |
| 🔀 **Workflows** | Free movement by default. Statuses and transitions with who may use them, conditions (no open blockers, sub-tasks done, required fields) and what happens afterwards; choose which statuses appear on the board |
| 👆 **Fast to use** | Clicking an issue opens it in a side panel; `C` creates an issue anywhere; ⌘K jumps to a key or searches; parent issues and links are picked by searching key or title. Changes by others appear live |
| 🔎 **Search** | TQL, a JQL subset (`CHANGED`, `linked`, `membersOf()` and more), and filter chips on the same engine; saved filters. Korean particles handled and two-letter Korean words indexed. What you can't see never appears |
| 🔒 **Permissions** | Four project roles (viewer, reporter, member, admin) for people or groups, three visibility levels. Issues outside your permissions answer 404 on every path |
| 🔔 **Notifications** | In-app, email digests (SMTP), signed webhooks with retries, and Slack, Mattermost or Teams. Only ever to people who may see the issue |
| 🤖 **AI agents** | Built-in MCP server: agents search, read, create, update, move and comment on issues with a personal API token and exactly your permissions |
| 📊 **Admin** | Invites, disabling, admin rights, reset links and temporary passwords; SSO set up on a screen; monitoring (requests, errors, database, backups, storage) and Prometheus metrics; audit log |
| 🌐 **Interface** | English and Korean, light and dark themes and a profile photo, set per account. The same look and sidebar as Pagehouse |

<table>
  <tr>
    <td width="50%"><img src="docs/images/screenshot-panel.png" alt="The backlog with an issue open in the side panel"></td>
    <td width="50%"><img src="docs/images/screenshot-dark.png" alt="The board in the dark theme"></td>
  </tr>
  <tr>
    <td align="center"><sub>Backlog with the issue panel</sub></td>
    <td align="center"><sub>Dark theme</sub></td>
  </tr>
</table>

## Install

Requires Docker 24+ or Podman 4+ on Linux (amd64 or arm64).

**From a release bundle** (works without internet). Download `taskhouse-<version>-amd64.tar.gz` (or `-arm64`) and
`SHA256SUMS` from the [releases](https://github.com/spro1/taskhouse/releases), copy them to the server, then:

```sh
sha256sum -c SHA256SUMS --ignore-missing
tar xzf taskhouse-<version>-amd64.tar.gz && cd taskhouse-<version>
scripts/install.sh images.tar
```

**From source:**

```sh
git clone https://github.com/spro1/taskhouse.git && cd taskhouse
scripts/install.sh
```

The installer writes a `.env` with a random database password and `SECRET_KEY` (mode 600), starts everything,
waits until it is healthy and prints the one-time setup token. Already running Pagehouse on this server? Add
`--share-with /opt/pagehouse` to share its accounts. Details in the [installation guide](docs/install.md).

## Day-one checklist

1. **Administrator.** Open `http://<server>:3000` and create the first account with the setup token the installer
   printed (also in `docker compose logs app`). It becomes the administrator.
2. **HTTPS.** Put it behind your reverse proxy and set `PUBLIC_URL`, `BIND_ADDRESS=127.0.0.1` and `TRUST_PROXY=1`
   in `.env`. See the [example](docs/install.md#https).
3. **Invite the team.** In **Admin → People & SSO**, create invite links and send them over chat. No mail server is needed.
4. **Projects.** Create one per team or product; the creator is its admin. Add people or groups under the project's
   **Settings**, and adjust statuses there if the default (To do, In progress, In review, Done) doesn't fit.
5. **Backups.** Check that `backups/` fills up daily, then copy it off the server together with `.env`.
6. **Email (optional).** Set `SMTP_URL` in `.env` for notification digests and "Forgot your password?" links.
   Without it, admins issue reset links or temporary passwords in **Admin → People & SSO**.
7. **SSO (optional).** See the [SSO guide](docs/sso.md).

## Operations

| Task | How |
|---|---|
| Backup | Automatic every 24 h into `backups/` (14 kept). Manual: `scripts/backup.sh` |
| Restore | `scripts/restore.sh <backup>`. It backs up the current state first |
| Upgrade | Read the [notes per version](docs/upgrading.md), copy the new files over the install folder, then `scripts/upgrade.sh` (`images.tar` for a bundle). It backs up first and keeps `.env` and all data |
| Health | `curl localhost:3000/healthz`; **Admin → Monitoring** shows requests, errors, database, backups and storage; Prometheus at `/metrics` with `METRICS_TOKEN` |
| Logs | `docker compose logs app` |

Data lives in the compose volumes (database and attachments), and backups in the install folder's `backups/`.

## Security

- **Nothing leaves your network unless you say so.** No telemetry or externally loaded assets. Outbound requests
  happen only for SSO, email and webhooks you configure; webhooks never go to loopback or link-local addresses.
- **Permissions are enforced on the server.** An issue you can't see answers 404 everywhere: the API, search,
  attachments, notifications and MCP.
- **Browser hardening:** a strict Content-Security-Policy and frame blocking, cross-site write protection, request
  size limits, sign-in throttling per address and per account. Stored rich text is drawn as React elements, never
  as HTML strings.
- **Accounts:** SSO links or creates accounts only through an email the provider has verified. Secrets kept in the
  database (webhook keys, the SSO client secret) are encrypted with `SECRET_KEY`. API tokens expire and are revoked
  when an account is disabled.
- **Containers:** non-root, no package managers or shell in the app image, CI fails on any fixable CVE (Trivy),
  and Dependabot opens weekly update pull requests.

Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## FAQ

**Does it need internet access?**
No. Installing (from the release bundle), using and upgrading all work without it.

**Can it share accounts with Pagehouse?**
Yes. When both use the same PostgreSQL database they share people, sign-ins, groups and SSO settings, and each
links to the other. Roles and permissions stay per product. See
[Using Taskhouse together with Pagehouse](docs/install.md#using-taskhouse-together-with-pagehouse).

**Can AI agents work with issues?**
Yes, over MCP at `/api/mcp` with a personal API token. **My settings → API tokens** shows the command for Claude
Code. See [AI agents](docs/install.md#ai-agents-mcp).

**Can we move from Jira?**
There is no Jira importer yet. Issues can be created over the REST API or MCP.

**What if the server dies?**
Daily backups accumulate in `backups/`. Copy that folder and `.env` off the server, and you can install on a new
machine and run `scripts/restore.sh`.

## Roadmap

- Git and CI integration
- Versions and releases
- Charts (burndown, velocity)
- Custom fields and automation rules
- Timelines
- Per-issue access restrictions

## Documentation

- [Installation guide](docs/install.md): install options, HTTPS, backups, sharing with Pagehouse, monitoring, MCP, images
- [Upgrade guide](docs/upgrading.md): what changes per version and what to do
- [SSO guide](docs/sso.md): OpenID Connect setup, account matching, groups and admins
- [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md)

## Development

Node 22.18 or later (the image uses Node 26 LTS).

```sh
npm ci
npm run dev:db                  # PostgreSQL 17 without Docker (port 55432, .devdb)
DATABASE_URL=postgres://taskhouse:taskhouse@localhost:55432/taskhouse npm run dev
npm test                        # integration tests on an embedded PostgreSQL
npm run typecheck && npm audit
```

Layout:

- `server/`: API, search (TQL), jobs and migrations
- `web/`: React + Tiptap; UI text lives in `web/i18n.ts`
- `scripts/`: install, upgrade, backup, restore, offline bundle
- `docker/postgres/`: hardened PostgreSQL image

Dependencies stay at their latest stable versions and `npm audit` must report nothing. Migrations that change the
shared account tables use `ADD COLUMN IF NOT EXISTS`, and the same change goes into Pagehouse.

## License

[Apache-2.0](LICENSE): free to use inside your company, modify and redistribute.

Jira is a trademark of Atlassian. Taskhouse is not affiliated with or endorsed by Atlassian.
