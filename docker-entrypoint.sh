#!/bin/sh
set -eu

# A host-mounted volume arrives owned by root, but the desk runs unprivileged.
# Take ownership of the data directory while we still can, then drop to the
# app user for the life of the process.
DATA_DIR="${DESK_DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R 1001:1001 "$DATA_DIR"
  # setpriv ships with util-linux, which is essential in Debian.
  exec setpriv --reuid=1001 --regid=1001 --clear-groups "$@"
fi

# Already unprivileged (e.g. a host that pins the user): the volume must
# already be writable, and /api/health will report it if it is not.
mkdir -p "$DATA_DIR" 2>/dev/null || true
exec "$@"
