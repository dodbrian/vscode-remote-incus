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
sleep 3

mkdir -p /tmp/remote-incus-dev/fixture-container
: > /tmp/remote-incus-dev/fixture-container/ext.log
REMOTE_INCUS_DEBUG_LOG=/tmp/remote-incus-dev/fixture-container/ext.log setsid code --new-window \
  --remote=incus+fixture-remote:fixture-container /home/ubuntu \
  >/tmp/remote-incus-dev/fixture-container/verbose.log 2>&1 &
echo "redeployed; window relaunching; log: /tmp/remote-incus-dev/fixture-container/ext.log"
