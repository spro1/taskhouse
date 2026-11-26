#!/bin/sh
# Runs inside the backup container (PG* env points at the db, /data is the files volume, /backups the host folder).
#   backup.sh loop             one backup now, then every $INTERVAL hours, keeping the newest $KEEP automatic ones
#   backup.sh once <prefix>    one backup named <prefix>-<time>
#   backup.sh restore <name>   replace the database and files with backup <name> (the app must be stopped)
# A backup is a folder: db.dump (pg_dump custom format) + files/ (attachments). Attachments are content-addressed and
# never change, so each one is hard-linked to the previous backup's copy: many backups cost about one copy of them.
set -eu
# Backups hold every issue and the password hashes: readable by the owner only.
umask 077
cd /backups

backup() {
  name="$1-$(date +%Y%m%d-%H%M%S)"
  prev=$(ls -1dt auto-* manual-* preupgrade-* prerestore-* 2>/dev/null | head -n 1 || true)
  mkdir -p ".$name/files"
  # The dump first: every file it refers to already exists when the files are copied.
  pg_dump -Fc -f ".$name/db.dump"
  if [ -d /data/files ]; then
    for f in /data/files/*; do
      [ -f "$f" ] || continue
      b=${f##*/}
      if [ -n "$prev" ] && [ -f "$prev/files/$b" ]; then ln "$prev/files/$b" ".$name/files/$b"; else cp -p "$f" ".$name/files/$b"; fi
    done
  fi
  mv ".$name" "$name"
  echo "backup written: $name"
}

case "${1:-}" in
  loop)
    while true; do
      if backup auto; then
        ls -1d auto-* | sort | head -n -"${KEEP:-14}" | while read -r old; do rm -r -- "./$old"; done
      else
        echo "BACKUP FAILED" >&2
      fi
      sleep $(( ${INTERVAL:-24} * 3600 ))
    done ;;
  once)
    backup "${2:-manual}" ;;
  restore)
    src="${2:?backup name}"
    case "$src" in */*|.*) echo "bad backup name" >&2; exit 1 ;; esac
    [ -f "$src/db.dump" ] || { echo "no such backup: $src" >&2; exit 1; }
    pg_restore --clean --if-exists --no-owner -d "$PGDATABASE" "$src/db.dump"
    mkdir -p /data/files
    find /data/files -type f -delete
    cp -pR "$src/files/." /data/files/
    chown -R 1000:1000 /data/files
    echo "restored: $src" ;;
  *)
    echo "usage: backup.sh loop | once <prefix> | restore <name>" >&2; exit 2 ;;
esac
