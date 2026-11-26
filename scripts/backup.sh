#!/bin/sh
# Manual backup now, into ./backups/manual-<time>/ (automatic ones run on their own).
set -eu
. "$(dirname "$0")/compose.sh"
compose exec -T backup sh /backup.sh once manual
