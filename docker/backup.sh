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
    # Empty the database first. pg_restore --clean only drops what the dump names, and the table layout changed in
    # 0.2 (accounts in their own schema): an older backup would leave the newer account tables beside its own, and
    # the app then refuses to start.
    toc=$(pg_restore -l "$src/db.dump")
    if [ -n "$(psql -Atc "SELECT coalesce(to_regclass('pagehouse.pages'), to_regclass('public.pages'))")" ] &&
       ! echo "$toc" | grep -Eq ' TABLE (public|pagehouse) pages '; then
      echo "Pagehouse shares this database and is not in backup $src: restoring it would delete Pagehouse's accounts. Nothing was changed." >&2
      exit 3
    fi
    { echo 'SET client_min_messages = warning; DROP SCHEMA IF EXISTS accounts, taskhouse CASCADE;'
      psql -Atc "SELECT format('DROP TABLE IF EXISTS public.%I CASCADE;', tablename) FROM pg_tables WHERE schemaname = 'public'"
    } | psql -q -v ON_ERROR_STOP=1 -1
    pg_restore --clean --if-exists --no-owner -d "$PGDATABASE" "$src/db.dump"
    mkdir -p /data/files
    find /data/files -type f -delete
    cp -pR "$src/files/." /data/files/
    chown -R 1000:1000 /data/files
    echo "restored: $src" ;;
  *)
    echo "usage: backup.sh loop | once <prefix> | restore <name>" >&2; exit 2 ;;
esac
