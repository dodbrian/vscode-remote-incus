#!/bin/sh
# Opens a REAL VS Code window against the spike container through the
# exec-stdio remote authority. Proposed APIs are enabled automatically because
# the extension runs in development mode.
: "${INCUS_SPIKE_TARGET:?Set explicit test-owned remote:instance}"
case "$INCUS_SPIKE_TARGET" in
  -*|:*|*:|*:*:*|*[!a-zA-Z0-9:_.-]*) echo "Expected an explicit remote:instance" >&2; exit 2 ;;
  *:*) ;;
  *) echo "Expected an explicit remote:instance" >&2; exit 2 ;;
esac
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec code --new-window \
  "--extension-development-path=$HERE/ext" \
  "--enable-proposed-api=local-spike.remote-incus-spike" \
  "--remote=incus-spike+$INCUS_SPIKE_TARGET" \
  /home/ubuntu
