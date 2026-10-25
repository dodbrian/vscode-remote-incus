#!/bin/sh
# Phase-1 dev loop: build, package, install, restart VS Code, reopen the
# remote window on an explicitly selected test-owned instance.
# Usage: ./scripts/redeploy.sh <remote:instance> <absolute-folder>
set -eu
umask 077
if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <remote:instance> <absolute-folder>" >&2
  exit 2
fi
case "$1" in
  -*|:*|*:|*:*:*|*[!a-zA-Z0-9:_.-]*) echo "Expected an explicit remote:instance" >&2; exit 2 ;;
  *:*) ;;
  *) echo "Expected an explicit remote:instance" >&2; exit 2 ;;
esac
case "$2" in /*) ;; *) echo "Expected an absolute remote folder" >&2; exit 2 ;; esac
REDEPLOY_TARGET=$1
REDEPLOY_FOLDER=$2
REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$REPO_ROOT"

# Build and validate a candidate before replacing the last reviewed VSIX.
# A failed quality/build/archive gate must not install or restart the editor.
npm run package
code --install-extension remote-incus.vsix --force >/dev/null
pkill -f "/usr/share/cod[e]" || true
# Launching into a half-dead instance pops the "Another instance of Code is
# running but not responding" modal (seen live 2026-10-20) — wait until every
# code process is gone before relaunching (proc/exe symlink scan: no pgrep -f
# self-match traps).
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  sleep 1
  ls -l /proc/[0-9]*/exe 2>/dev/null | grep -q 'cod[e]/code' || break
done
sleep 1

mkdir -p /tmp/remote-incus-dev/redeploy
: > /tmp/remote-incus-dev/redeploy/ext.log
REMOTE_INCUS_DEBUG_LOG=/tmp/remote-incus-dev/redeploy/ext.log setsid code --new-window \
  --remote="incus+$REDEPLOY_TARGET" "$REDEPLOY_FOLDER" \
  >/tmp/remote-incus-dev/redeploy/verbose.log 2>&1 &
echo "redeployed; window relaunching; log: /tmp/remote-incus-dev/redeploy/ext.log"
