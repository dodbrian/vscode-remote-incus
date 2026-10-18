#!/usr/bin/env bash
# Spike step 2: install VS Code server into fixture-container WITHOUT sshd.
# Client-side download (air-gap pattern) + `incus file push -` (single stdin stream).
set -euo pipefail

CONTAINER=fixture-container
DBG_USER=ubuntu
DBU_UID=1000   # incus 6.0.5 --user takes NUMERIC uid only (verified)
CACHE=/tmp/remote-incus-dev/fixture-container
STATE="$(pwd)/spike/.state"

mkdir -p "$CACHE" "$STATE"

COMMIT=$(code --version | sed -n '2p')
echo "== server commit (aligned with local VS Code client): $COMMIT"
TARBALL="$CACHE/vscode-server-linux-x64-$COMMIT.tar.gz"

if [ ! -s "$TARBALL" ]; then
  echo "== downloading client-side (232 MB) …"
  curl -fSL -o "$TARBALL" "https://update.code.visualstudio.com/commit:${COMMIT}/server-linux-x64/stable"
else
  echo "== cached tarball exists"
fi
ls -lh "$TARBALL"

# Strip any previous install (cheap; keeps spike idempotent)
echo "== wiping ~/.vscode-server (as $DBG_USER) …"
incus exec "$CONTAINER" -T --user "$DBU_UID" -- rm -rf /home/"$DBG_USER"/.vscode-server || true

echo "== pushing tarball via 'incus file push' (PATH mode — stdin mode broken on 6.0.5: died at 77%)"
incus file push "$TARBALL" "$CONTAINER"/tmp/vscode-server.tar.gz

LOCAL_SHA=$(sha256sum "$TARBALL" | cut -d' ' -f1)
REMOTE_SHA=$(incus exec "$CONTAINER" -T -- sha256sum /tmp/vscode-server.tar.gz | cut -d' ' -f1)
[ "$LOCAL_SHA" = "$REMOTE_SHA" ] || { echo "!! sha mismatch: $LOCAL_SHA vs $REMOTE_SHA"; exit 1; }
echo "== sha256 verified: $LOCAL_SHA"

echo "== extracting as $DBG_USER (uid 1000) …"
incus exec "$CONTAINER" -T --user "$DBU_UID" \
  --env HOME=/home/"$DBG_USER" --env USER="$DBG_USER" \
  -- bash -exc '
    mkdir -p ~/.vscode-server/bin/'"$COMMIT"'
    tar -xzf /tmp/vscode-server.tar.gz -C ~/.vscode-server/bin/'"$COMMIT"' --strip-components=1
    rm /tmp/vscode-server.tar.gz
    ls -l ~/.vscode-server/bin/'"$COMMIT"' | head -30
    # ---- canonical no-sshd proof:
    dpkg -l | grep openssh || echo "NO openssh packages installed"
  '

# persist commit for later steps
printf '%s' "$COMMIT" > "$STATE/server.commit"
echo "== install OK. commit saved to $STATE/server.commit"
