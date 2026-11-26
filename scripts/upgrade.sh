#!/bin/sh
# Upgrade: backs up first (preupgrade-<time>), then rebuilds or loads the new images and restarts.
# .env and the data volumes are left as they are; the app applies new migrations when it starts.
#   scripts/upgrade.sh              rebuild from this folder (after replacing it with the new version)
#   scripts/upgrade.sh images.tar   load images from an offline bundle
set -eu
. "$(dirname "$0")/compose.sh"
compose exec -T backup sh /backup.sh once preupgrade
if [ -n "${1:-}" ]; then
  if command -v podman >/dev/null 2>&1; then podman load -i "$1"; else docker load -i "$1"; fi
else
  compose build
fi
compose up -d
echo "Upgraded. If something is wrong: scripts/restore.sh <the preupgrade-… folder in ./backups>"
