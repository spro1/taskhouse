## What and why

<!-- What changes, and the problem it solves. Link the issue: "Fixes #123". -->

## How it was checked

<!-- Tests added or run, and what you tried by hand (screenshots for UI changes). -->

## Checklist

- [ ] `npm run typecheck` and `npm test` pass
- [ ] Server changes have a test
- [ ] New UI text is in `web/i18n.ts` in both `ko` and `en`
- [ ] Permissions: anything a user can't see still answers 404 (API, search, live updates, exports, notifications)
- [ ] No user data can be lost: migrations only add (never edit a released one)
- [ ] Docs updated if behaviour or settings changed (README and `docs/`, in English and Korean; `.env.example`)
