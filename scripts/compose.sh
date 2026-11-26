#!/bin/sh
# `podman compose` if Podman is installed, else `docker compose`. Sourced by the other scripts.
cd "$(dirname "$0")/.." || exit 1
if command -v podman >/dev/null 2>&1; then compose() { podman compose "$@"; }
elif command -v docker >/dev/null 2>&1; then compose() { docker compose "$@"; }
else echo "Podman or Docker is required." >&2; exit 1; fi
