# Contributing

Thanks for helping. Bug reports, fixes, translations and docs are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Security problems: see [SECURITY.md](SECURITY.md), not the issue tracker.

## Setup

Node 22.18 or later. No Docker needed for development: the dev and test databases are an embedded PostgreSQL 17.

```sh
npm ci
npm run dev:db        # PostgreSQL 17 on port 55432 (data in .devdb)
DATABASE_URL=postgres://taskhouse:taskhouse@localhost:55432/taskhouse npm run dev
npm test              # starts its own throwaway PostgreSQL; set TEST_DATABASE_URL to use one you run
npm run typecheck
```

A PostgreSQL you run yourself must use a UTF-8 locale (`--locale=en_US.UTF-8`), or Korean search can't use its
index (see [docs/install.md](docs/install.md#images-and-vulnerabilities)).

## How changes get in

1. Fork the repository (or create a branch, if you're a maintainer) and open a pull request against `main`.
2. CI (`test` and `image`) must pass, and the branch must be up to date with `main`.
3. A maintainer (see `.github/CODEOWNERS`) reviews it, and every review thread must be resolved. Approvals aren't
   enforced yet because there is one maintainer; raise `required_approving_review_count` in the ruleset when
   there are more.
4. It's merged as one squashed commit. Direct pushes and force pushes to `main` are refused, `main` can't be
   deleted, and only maintainers create release tags (`v*`).
5. To release, a maintainer sets `version` in `package.json` and pushes a tag `v<version>`. The release workflow
   publishes the images to ghcr.io and the offline bundles to GitHub Releases.

The rules are kept in `.github/rulesets/`. A maintainer applies them with:

```sh
gh api -X POST repos/spro1/taskhouse/rulesets --input .github/rulesets/main.json
gh api -X POST repos/spro1/taskhouse/rulesets --input .github/rulesets/tags.json
```

## AI tools

You may use AI coding tools. Whoever opens the pull request is responsible for it: understand every line, test it,
and make sure nothing in it comes from code you aren't allowed to use.

## Pull requests

- `npm run typecheck` and `npm test` must pass. Add a test for server changes.
- Permissions are checked on the server for every path (API, search, live updates, exports, notifications), and
  anything a user can't see answers 404. New paths do the same; `server/access.ts` has the checks.
- Never lose user data: migrations only add. They live in `server/migrations/NNN_name.sql`; never edit one that
  was released.
- Every UI string goes in `web/i18n.ts`, in both `ko` and `en` (the type check fails if a key is missing, and a test checks the `{placeholders}` match).
- Settings go in `.env.example` with a comment, and behaviour changes in the README or `docs/`, always in both the English and the Korean file.
- Keep it small: prefer what the platform, PostgreSQL or an existing dependency already does over new code or
  packages. New dependencies must be the latest stable version, and `npm audit` must report nothing.
