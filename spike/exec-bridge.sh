#!/bin/sh
# Per-connection exec bridge child, spawned by socat for every accepted TCP conn.
# Reads the CURRENT port/commit from spike state -> survives server restarts.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PORT=$(cat "$HERE/.state/server.port")
COMMIT=$(cat "$HERE/.state/server.commit")
exec incus exec fixture-container \
  --mode non-interactive \
  --user 1000 \
  --env HOME=/home/ubuntu \
  --env RELAY_HOST=127.0.0.1 \
  --env "RELAY_PORT=$PORT" \
  -- /home/ubuntu/.vscode-server/bin/"$COMMIT"/node /home/ubuntu/.vscode-server/relay.js
