#!/usr/bin/env bash
# Spike step 3: start the VS Code server detached inside the container,
# with a fresh-or-existing 0600 connection token file, discover the port,
# and publish host-side state under spike/.state/.
set -euo pipefail

CONTAINER=fixture-container
DBG_USER=ubuntu
DBU_UID=1000
STATE="$(pwd)/spike/.state"

COMMIT=$(cat "$STATE/server.commit")
echo "== commit: $COMMIT"

# --- token lifecycle: reuse existing token if present; else mint one (0600, owner=ubuntu)
echo "== ensuring connection token file …"
incus exec "$CONTAINER" -T --user "$DBU_UID" \
  --env HOME=/home/"$DBG_USER" -- bash -exc '
    DIR=~/.vscode-server/data/Machine
    TOKEN=$DIR/.incus-conn-token
    mkdir -p "$DIR"
    if [ -s "$TOKEN" ]; then
      echo "  token already exists (sticky reuse)"
    else
      ( umask 077
        # URL-safe charset only: the server rejects tokens outside [0-9a-zA-Z_-] (spike finding)
        tr -dc A-Za-z0-9 < /dev/urandom | head -c 43 > "$TOKEN.tmp"
        mv "$TOKEN.tmp" "$TOKEN" )
      echo "  fresh token minted"
    fi
    chmod 600 "$TOKEN"
    stat -c "  %a %U %n" "$TOKEN"
  '

# --- stop any previous server instance
echo "== stopping previous server (if any) …"
incus exec "$CONTAINER" -T --user "$DBU_UID" \
  --env HOME=/home/"$DBG_USER" -- bash -c '
    # pkill -f self-match guard: bracketed pattern never matches this cmdline (do not spell the prog name here)
    pkill -f "serv[e]r-main.js" 2>/dev/null || true
    sleep 0.5
    exit 0'

echo "== starting server detached (nohup) …"
incus exec "$CONTAINER" -T --user "$DBU_UID" \
  --env HOME=/home/"$DBG_USER" --env USER="$DBG_USER" \
  -- bash -exc '
    BIN=~/.vscode-server/bin/'"$COMMIT"'
    DIR=~/.vscode-server/data/Machine
    LOG=$DIR/server.log
    TOKEN=$DIR/.incus-conn-token
    rm -f "$LOG"
    nohup "$BIN/bin/code-server" \
      --host 127.0.0.1 --port 0 \
      --connection-token-file "$TOKEN" \
      --accept-server-license-terms \
      > "$LOG" 2>&1 < /dev/null &
    echo "  launched pid $!"
  '

# --- poll the log for the listening line
echo "== waiting for server to announce its port …"
for i in $(seq 1 100); do
  LINE=$(incus exec "$CONTAINER" -T --user "$DBU_UID" \
    --env HOME=/home/"$DBG_USER" -- bash -c '
      grep -s "Extension host agent listening on" ~/.vscode-server/data/Machine/server.log || true' \
    2>/dev/null || true)
  if [ -n "$LINE" ]; then break; fi
  sleep 0.3
done

if [ -z "${LINE:-}" ]; then
  echo "!! server did not announce a port in time; dumping log:"
  incus exec "$CONTAINER" -T --user "$DBU_UID" \
    --env HOME=/home/"$DBG_USER" -- cat /home/"$DBG_USER"/.vscode-server/data/Machine/server.log
  exit 1
fi

PORT=$(printf '%s' "$LINE" | sed -E 's/.*Extension host agent listening on ([0-9]+).*/\1/')
TOKEN=$(incus exec "$CONTAINER" -T --user "$DBU_UID" \
  --env HOME=/home/"$DBG_USER" -- cat /home/"$DBG_USER"/.vscode-server/data/Machine/.incus-conn-token)

printf '%s' "$PORT"  > "$STATE/server.port"
printf '%s' "$TOKEN" > "$STATE/server.token"

echo "== server is listening on 127.0.0.1:$PORT (inside container)"
echo "== state files written: $STATE/server.port, $STATE/server.token"
echo "== full log:"
incus exec "$CONTAINER" -T --user "$DBU_UID" \
  --env HOME=/home/"$DBG_USER" -- cat /home/"$DBG_USER"/.vscode-server/data/Machine/server.log
