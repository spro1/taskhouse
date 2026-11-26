#!/bin/sh
# Restores a backup folder from ./backups. The current state is backed up first (prerestore-<time>), so a restore
# can itself be undone.
#   scripts/restore.sh auto-20261126-101104
set -eu
. "$(dirname "$0")/compose.sh"
name="${1:?usage: scripts/restore.sh <backup folder name in ./backups>}"
[ -f "backups/$name/db.dump" ] || { echo "No backup named $name in ./backups" >&2; exit 1; }
compose exec -T backup sh /backup.sh once prerestore
compose stop app
compose exec -T backup sh /backup.sh restore "$name"
compose start app
echo "Restored $name."
