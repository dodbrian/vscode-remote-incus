#!/bin/sh
# Opens a REAL VS Code window against the spike container through the
# exec-stdio remote authority. Proposed APIs are enabled automatically because
# the extension runs in development mode.
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec code --new-window \
  "--extension-development-path=$HERE/ext" \
  "--enable-proposed-api=local-spike.remote-incus-spike" \
  "--remote=incus-spike+fixture-container" \
  /home/ubuntu
