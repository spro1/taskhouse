#!/bin/sh
# Offline bundle for air-gapped servers: this folder's deploy files plus both images in one tar.gz.
# On the server: tar xzf taskhouse-<version>.tar.gz && cd taskhouse-<version> && scripts/install.sh images.tar
#   scripts/bundle.sh              build the images here and save them
#   scripts/bundle.sh images.tar   use images saved elsewhere (the release workflow, one per architecture)
set -eu
. "$(dirname "$0")/compose.sh"
version=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' package.json | head -n 1)
out="taskhouse-$version"
mkdir -p "dist-bundle/$out/scripts" "dist-bundle/$out/docker/postgres"
cp docker-compose.yml docker-compose.shared.yml .env.example README.md README.ko.md "dist-bundle/$out/"
cp scripts/compose.sh scripts/install.sh scripts/backup.sh scripts/restore.sh scripts/upgrade.sh "dist-bundle/$out/scripts/"
cp docker/backup.sh "dist-bundle/$out/docker/"
cp docker/postgres/Dockerfile "dist-bundle/$out/docker/postgres/"
if [ -n "${1:-}" ]; then
  cp "$1" "dist-bundle/$out/images.tar"
else
  compose build
  if command -v podman >/dev/null 2>&1; then save="podman save -m"; else save="docker save"; fi
  $save -o "dist-bundle/$out/images.tar" localhost/taskhouse:latest localhost/taskhouse-postgres:17
fi
tar -C dist-bundle -czf "$out.tar.gz" "$out"
echo "Wrote $out.tar.gz"
