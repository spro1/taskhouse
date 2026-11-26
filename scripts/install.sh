#!/bin/sh
# First install: writes .env with a random database password, builds or loads the images, starts everything,
# waits until the app answers and prints the one-time setup token.
#   scripts/install.sh              build images from this folder
#   scripts/install.sh images.tar   load images from an offline bundle first (no internet needed)
set -eu
. "$(dirname "$0")/compose.sh"
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
compose logs app 2>/dev/null | grep -A2 'setup token' | tail -1 | sed 's/.*| *//' | { read -r t && [ -n "$t" ] && echo "Setup token: $t" || true; }
