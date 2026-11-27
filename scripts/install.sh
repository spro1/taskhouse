#!/bin/sh
# First install: writes .env with a random database password, builds or loads the images, starts everything,
# waits until the app answers and prints the one-time setup token.
#   scripts/install.sh              build images from this folder
#   scripts/install.sh images.tar   load images from an offline bundle first (no internet needed)
#   scripts/install.sh --share-with /path/to/pagehouse [images.tar]
#                                   add Taskhouse to a running Pagehouse install on this machine: it uses
#                                   Pagehouse's database, so both share accounts (README, "Pagehouse와 함께 쓰기")
#                                   (web port: 3000, or 3001 when Pagehouse has 3000; PORT=N in front chooses one)
set -eu
share=
[ "${1:-}" = "--share-with" ] && { share=$(cd "${2:?--share-with needs the Pagehouse folder}" && pwd); shift 2; }
. "$(dirname "$0")/compose.sh"
if [ -n "$share" ]; then
  [ ! -f .env ] || { echo "This folder already has an install (.env exists). Two installs that both have accounts can't be joined." >&2; exit 1; }
  grep -qs pagehouse "$share/docker-compose.yml" && [ -f "$share/.env" ] || { echo "$share is not a Pagehouse install folder." >&2; exit 1; }
  if command -v podman >/dev/null 2>&1; then cli=podman; else cli=docker; fi
  db=$(cd "$share" && $cli compose ps -q db 2>/dev/null | head -n 1)
  [ -n "$db" ] || { echo "Pagehouse in $share is not running, or does not have its own database." >&2; exit 1; }
  net=$($cli inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "$db" | head -n 1)
  their() { sed -n "s/^$1=//p" "$share/.env" | tail -n 1; }
  # Next to Pagehouse's port unless PORT is given: PORT=8081 scripts/install.sh --share-with …
  their_port=$(their PORT); port=${PORT:-3000}
  [ "$port" != "${their_port:-3000}" ] || port=$((port + 1))
  # Pagehouse's database password and SECRET_KEY (the SSO client secret is stored once, for both).
  grep -vE '^(POSTGRES_PASSWORD|SECRET_KEY|PORT)=' .env.example > .env
  printf '\n# Added to the Pagehouse install in %s: its database, shared accounts.\nPOSTGRES_PASSWORD=%s\nSECRET_KEY=%s\nPORT=%s\nCOMPOSE_FILE=docker-compose.shared.yml\nSHARED_NETWORK=%s\n' \
    "$share" "$(their POSTGRES_PASSWORD)" "$(their SECRET_KEY)" "$port" "$net" >> .env
  chmod 600 .env
  echo ".env written: Taskhouse will use the database of the Pagehouse install in $share, on port $port."
fi
if [ ! -f .env ]; then
  cp .env.example .env
  pw=$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')
  key=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
  sed -i.bak -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$pw/" -e "s/^SECRET_KEY=.*/SECRET_KEY=$key/" .env && rm -f .env.bak
  chmod 600 .env
  echo ".env written with a random database password and SECRET_KEY (keep a copy of .env: backups do not contain it)."
fi
mkdir -p backups
if [ -n "${1:-}" ]; then
  if command -v podman >/dev/null 2>&1; then podman load -i "$1"; else docker load -i "$1"; fi
else
  compose build
fi
compose up -d
port=$(grep -E '^PORT=' .env | cut -d= -f2); port=${port:-3000}
printf 'Waiting for the app'
i=0
until curl -sf "http://127.0.0.1:$port/healthz" >/dev/null 2>&1; do
  i=$((i + 1)); [ $i -gt 90 ] && { echo; echo "The app did not come up; see: compose logs app" >&2; exit 1; }
  printf '.'; sleep 2
done
echo
echo "Taskhouse is running on port $port."
[ -z "$share" ] || { echo "Sign in with your Pagehouse account. The first Pagehouse administrator who opens Taskhouse becomes its administrator."; exit 0; }
compose logs app 2>/dev/null | grep -A2 'setup token' | tail -1 | sed 's/.*| *//' | { read -r t && [ -n "$t" ] && echo "Setup token: $t" || true; }
