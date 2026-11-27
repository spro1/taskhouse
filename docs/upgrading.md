# Upgrade guide

[한국어](upgrading.ko.md)

1. Copy the new version's files over the install folder (a `git pull`, or the unpacked new bundle). Keep `.env`
   and `backups/`.
2. Run `scripts/upgrade.sh` (or `scripts/upgrade.sh images.tar` with a bundle). It backs up to `preupgrade-…`
   first, keeps `.env` and all data, and the database migrations run at start.

To go back, restore that backup with `scripts/restore.sh` and start the older version.

Things to know when upgrading an existing install:

## Accounts move to the `accounts` schema

- The account tables (`users`, `sessions`, `groups`, `group_members`) move to the `accounts` schema at the first
  start, with their rows, and the SSO setting moves to `accounts.settings`. Nothing changes in use.
- The database user needs the `CREATE` privilege on the database (a default install and the database owner have it).
- SQL you run by hand must name the schema (`accounts.users`).
- An older version can't read the new layout: to go back, restore the `preupgrade-…` backup.
- Groups that came from SSO can now be edited on the admin screen. An SSO sign-in adds and removes only the
  memberships it made itself and leaves the ones added by hand (the same rule as Pagehouse).

## SSO needs a verified email to create an account

Creating an account through SSO now needs an email the IdP marks verified (the same rule as Pagehouse). With an
IdP that never sends `email_verified`, new people can't sign in through SSO after the upgrade (`no_email`). For
such an IdP, put `OIDC_TRUST_EMAIL=1` in `.env` or turn on "Trust emails the provider doesn't mark verified" under
**Admin → SSO**. People who already have an account are not affected.

## `SECRET_KEY`

Add `SECRET_KEY` (a long random string) to `.env` and restart. Webhook signing keys already stored are encrypted
at start; receivers don't need to change anything. Without `SECRET_KEY` everything works as before (stored as is).
If you lose it after setting it, webhook signing keys and the SSO client secret must be made again.

## Sign-in sessions last 24 hours

The default is now 24 hours. Existing installs keep 12 hours because `.env` has `SESSION_HOURS=12`. To use the
new default, change that line to `24` or remove it and restart (applies to new sign-ins).

## `TRUST_PROXY` counts proxies

`TRUST_PROXY` is the number of proxies in front. An existing `1` still means one proxy. `X-Forwarded-For` is now
counted from the right, so a client can't get around the sign-in limits by faking that header.

## Backups visible to the app

The current `docker-compose.yml` mounts `./backups` read-only into the app container (`BACKUP_DIR`), for the
overdue-backup warning under **Admin → Monitoring**. Copying the new files over the install folder brings it along.
