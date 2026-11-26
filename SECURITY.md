# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through
GitHub: **Security → Report a vulnerability** on this repository (private vulnerability reporting).

Include what you found, how to reproduce it, and the version you run (the image tag or `version` in `package.json`).
We aim to acknowledge reports within 3 working days and to ship a fix for confirmed issues as soon as we can,
crediting you in the release notes unless you prefer otherwise.

## Supported versions

Security fixes go into the latest release. Upgrade with `scripts/upgrade.sh` (it backs up first).

## What we do

- Dependencies are kept at their latest stable versions; `npm audit` must report nothing, and the image build stops if it does.
- The app image ships without a shell, package managers or the system OpenSSL, and runs as a non-root user.
- Permissions are checked on the server for every path (API, search, live updates, exports, notifications);
  issues you can't see answer 404.
