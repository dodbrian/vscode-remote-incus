#!/bin/sh
# Redeploy the spike extension and reopen the remote window.
# Usage: spike/redeploy.sh
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$HERE/ext" || exit 1
npx --yes @vscode/vsce@latest package --allow-missing-repository -o ../remote-incus-spike.vsix >/dev/null 2>&1 || exit 1
code --install-extension ../remote-incus-spike.vsix >/dev/null 2>&1
pkill -f "/usr/share/cod[e]"
sleep 3
rm -f /tmp/remote-incus-dev/fixture-container/ext.log
setsid code --new-window --remote=incus-spike+fixture-container /home/ubuntu >/tmp/remote-incus-dev/fixture-container/verbose.log 2>&1 &
echo "redeployed; window relaunching; log: /tmp/remote-incus-dev/fixture-container/ext.log"
