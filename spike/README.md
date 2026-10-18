# Phase-0 spike: VS Code server over `incus exec` stdio (no sshd)

Goal: validate the exec-stdio transport design hands-on *before* writing DESIGN.md.
Nothing here is production code — it's disposable plumbing.

## What must be proven

1. **No-sshd by construction** — the container gets the VS Code server installed and
   running *without* `openssh-server` (checked via dpkg).
2. **Least-privilege bootstrap** — server installed & run as `ubuntu` (uid 1000), not root.
3. **Exec stdio is binary-clean in practice** — the full VS Code workbench (web UI)
   served through: browser → local TCP listener → `incus exec … node -e relay → server`.
4. **Per-connection spawn works** — killing the relay mid-session and reloading still works.
5. **Token rotation semantics** — restarting the server mints a new token; the old
   connection fails, new one works.
6. **No orphaned relays** — after the local listener dies, no leftover `node -e`
   processes inside the container within ~2s.
7. **Flag-name reality on incus 6.0.5** — `--user ubuntu` vs `--user 1000`,
   `--mode/non-interactive` behavior, `incus file push` from stdin.

## Steps

| script | what it does |
|---|---|
| `02-install-server.sh` | downloads server tarball **client-side** (air-gap pattern!), pushes via `incus file push -`, extracts as `ubuntu` into `~/.vscode-server/bin/<commit>` |
| `03-start-server.sh` | writes/ensures `0600` token file, starts server detached via `bin/code-server --host 127.0.0.1 --port 0 --connection-token-file …`, parses the listening port from stdout log, writes `spike/.state/` |
| `04-relay.py` | local TCP listener on `127.0.0.1:16080`; every connection spawns its own `incus exec … node -e` relay bridging stdio ↔ the in-container server port; prints the `?tkn=` URL to open |
| `05-checklist.md` | the manual verification list |

## Hygiene

- Container name: `fixture-container` (isolated; no other instance is touched).
- Local state/cache under `spike/.state/` and `/tmp/remote-incus-dev/fixture-container/`.
- 232 MB tarball cached client-side so restarts are cheap.
- incus here is **6.0.5**: `incus port-forward` (7.3+) is NOT available — by design the
  spike relies on per-connection exec bridges only.
