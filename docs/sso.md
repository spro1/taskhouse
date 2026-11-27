# Single sign-on (OIDC)

[한국어](sso.ko.md)

Taskhouse signs people in with any OpenID Connect provider. Checked with Keycloak 26.

## Setting it up

1. At your IdP, create a client with:
   - redirect URI `$PUBLIC_URL/api/auth/oidc/callback`,
   - post-logout address `$PUBLIC_URL/`.
2. In Taskhouse, either:
   - fill in **Admin → SSO** (the client secret is stored encrypted with `SECRET_KEY`), or
   - put `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` in `.env`. Environment variables win, and the
     screen becomes read-only.

`PUBLIC_URL` must be set to the address people use.

## How accounts are matched

- Accounts are found by the IdP's `sub`.
- At the first sign-in, Taskhouse links to an existing local account with the same email, or creates one (not with
  `OIDC_AUTO_CREATE=0`). It does either only with an email the IdP marks verified (`email_verified`).
- For an IdP that never sends `email_verified`, `OIDC_TRUST_EMAIL=1` allows it. An IdP that says `false` is still
  refused.
- People already linked by `sub` sign in whatever the email claim says.

## Groups and admins

- Groups come from the `groups` claim (`OIDC_GROUPS_CLAIM`) at every sign-in. A sign-in adds and removes only the
  memberships it made itself; members added by hand stay.
- Members of `OIDC_ADMIN_GROUP` become site admins.
- Signing out also ends the IdP session.

## SSO only

With `PASSWORD_LOGIN=0`, the sign-in screen offers SSO only. An admin who has a password can still get in through
"Admin emergency sign-in" on the sign-in screen.

## Shared with Pagehouse

When accounts are shared with Pagehouse (see the [installation guide](install.md#using-taskhouse-together-with-pagehouse)),
there is one SSO setting:

- Register both products' redirect URIs and post-logout addresses on one client at the IdP.
- Keep `SECRET_KEY` the same in both.
- One SSO sign-in, in either product, signs the person in to both, and `OIDC_ADMIN_GROUP` decides who is an admin
  in both.
- `OIDC_*` in `.env` is per product: set it in both, or in neither.

## Trying it locally

`scripts/keycloak-dev.sh` starts a test Keycloak with a realm, a client, a group mapper and test users.
