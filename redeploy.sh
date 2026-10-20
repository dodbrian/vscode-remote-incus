#!/bin/sh
# Phase-1 dev loop: build, package, install, restart VS Code, reopen the
# remote window on the test instance (fixture-container on the `fixture-remote` remote).
# Usage: ./redeploy.sh
set -e
cd "$(dirname "$0")"

node esbuild.js --production
npx --yes @vscode/vsce@latest package --allow-missing-repository -o remote-incus.vsix >/dev/null
code --install-extension remote-incus.vsix >/dev/null
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

mkdir -p /tmp/remote-incus-dev/fixture-container
: > /tmp/remote-incus-dev/fixture-container/ext.log
REMOTE_INCUS_DEBUG_LOG=/tmp/remote-incus-dev/fixture-container/ext.log setsid code --new-window \
  --remote=incus+fixture-remote:fixture-container /home/ubuntu \
  >/tmp/remote-incus-dev/fixture-container/verbose.log 2>&1 &
echo "redeployed; window relaunching; log: /tmp/remote-incus-dev/fixture-container/ext.log"
