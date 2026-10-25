#!/bin/sh
# Per-connection exec bridge child, spawned by socat for every accepted TCP conn.
# Reads the CURRENT port/commit from spike state -> survives server restarts.
set -eu
case "$INCUS_SPIKE_TARGET" in
  -*|:*|*:|*:*:*|*[!a-zA-Z0-9:_.-]*) echo "Expected an explicit remote:instance" >&2; exit 2 ;;
  *:*) ;;
  *) echo "Expected an explicit remote:instance" >&2; exit 2 ;;
esac
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PORT=$(cat "$HERE/.state/server.port")
COMMIT=$(cat "$HERE/.state/server.commit")
: "${INCUS_SPIKE_TARGET:?Set explicit test-owned remote:instance}"
exec incus exec "$INCUS_SPIKE_TARGET" \
  --mode non-interactive \
  --user 1000 \
  --env HOME=/home/ubuntu \
  --env RELAY_HOST=127.0.0.1 \
  --env "RELAY_PORT=$PORT" \
  -- /home/ubuntu/.vscode-server/bin/"$COMMIT"/node /home/ubuntu/.vscode-server/relay.js
