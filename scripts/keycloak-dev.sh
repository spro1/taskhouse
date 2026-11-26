#!/bin/sh
# A throwaway Keycloak for trying SSO locally (dev mode, in-memory: everything is gone when it stops).
#   scripts/keycloak-dev.sh [taskhouse URL, default http://localhost:3100]
# Then start taskhouse with:
#   OIDC_ISSUER=http://localhost:8180/realms/taskhouse OIDC_CLIENT_ID=taskhouse OIDC_CLIENT_SECRET=dev-client-secret \
#   OIDC_ADMIN_GROUP=th-admins PUBLIC_URL=http://localhost:3100 ...
# Test accounts (password = username + "-dev-pw"; local testing only, never use these anywhere real):
#   alice  alice@example.test  verified  groups th-admins, th-dev   -> becomes a site admin
#   bob    bob@example.test    verified  group th-dev
#   carol  carol@example.test  NOT verified                         -> can't take over a local account with that email
# Keycloak admin console: http://localhost:8180  (admin / admin-dev-pw)
# Stop: podman rm -f taskhouse-keycloak
set -eu
APP=${1:-http://localhost:3100}
if command -v podman >/dev/null 2>&1; then run=podman; else run=docker; fi
$run rm -f taskhouse-keycloak >/dev/null 2>&1 || true
$run run -d --name taskhouse-keycloak -p 127.0.0.1:8180:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin-dev-pw \
  quay.io/keycloak/keycloak:latest start-dev >/dev/null
printf 'Waiting for Keycloak'
until curl -sf http://127.0.0.1:8180/realms/master/.well-known/openid-configuration >/dev/null 2>&1; do printf '.'; sleep 2; done
echo

kc() { $run exec taskhouse-keycloak /opt/keycloak/bin/kcadm.sh "$@"; }
kc config credentials --server http://localhost:8080 --realm master --user admin --password admin-dev-pw >/dev/null
kc create realms -s realm=taskhouse -s enabled=true >/dev/null
cid=$(kc create clients -r taskhouse -i -s clientId=taskhouse -s secret=dev-client-secret -s publicClient=false \
  -s standardFlowEnabled=true -s directAccessGrantsEnabled=false \
  -s "redirectUris=[\"$APP/api/auth/oidc/callback\"]" -s "webOrigins=[\"$APP\"]" \
  -s "attributes.\"post.logout.redirect.uris\"=$APP/" -s 'attributes."pkce.code.challenge.method"=S256')
# Groups as a flat "groups" claim, in the ID token and userinfo.
kc create "clients/$cid/protocol-mappers/models" -r taskhouse -s name=groups -s protocol=openid-connect \
  -s protocolMapper=oidc-group-membership-mapper -s 'config."claim.name"=groups' -s 'config."full.path"=false' \
  -s 'config."id.token.claim"=true' -s 'config."access.token.claim"=true' -s 'config."userinfo.token.claim"=true' >/dev/null
admins=$(kc create groups -r taskhouse -i -s name=th-admins)
dev=$(kc create groups -r taskhouse -i -s name=th-dev)

user() { # username first last verified groups...
  name=$1; first=$2; last=$3; verified=$4; shift 4
  id=$(kc create users -r taskhouse -i -s "username=$name" -s "email=$name@example.test" -s "emailVerified=$verified" \
    -s "firstName=$first" -s "lastName=$last" -s enabled=true)
  kc set-password -r taskhouse --userid "$id" --new-password "$name-dev-pw" >/dev/null
  for g in "$@"; do kc update "users/$id/groups/$g" -r taskhouse -s realm=taskhouse -s "userId=$id" -s "groupId=$g" -n >/dev/null; done
}
user alice Alice Kim true "$admins" "$dev"
user bob Bob Lee true "$dev"
user carol Carol Park false
echo "Keycloak ready: issuer http://localhost:8180/realms/taskhouse, client taskhouse"
