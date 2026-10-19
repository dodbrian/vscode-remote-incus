# Remote - Incus

Connect to [Incus](https://github.com/lxc/incus) containers (system containers;
Incus = community fork of LXD) as a first-class remote connection type — the
same slot Dev Containers / Remote-SSH occupy in the Remote Explorer.

**Status: Phase 1 work in progress** — architecture is frozen and spike-verified
(see `DESIGN.md`); the extension is not yet published.

## How it works (no sshd required)

- Instances are addressed via the existing `incus` client configuration
  (`incus remote list`) — the auth boundary is the Incus daemon identity (TLS
  client certs / trust tokens / OIDC). No SSH anywhere, no listening ports in
  the instance.
- The transport is `incus exec … -- node relay.js`: the child's stdio is the
  byte transport, wrapped as a VS Code managed remote connection.
- The VS Code server is downloaded client-side (cache + sha256-verified),
  pushed with `incus file push`, and started detached as the instance's
  primary unprivileged user.

## Install (VS Code stable)

Proposed APIs are not permitted on the Marketplace; install from VSIX/OpenVSX
and opt in once via `~/.vscode/argv.json`:

```json
{
  "enable-proposed-api": ["local-dev.remote-incus"]
}
```

Then install the VSIX: `code --install-extension remote-incus.vsix`.
Requires: incus ≥ 6.0, Linux client, instances with glibc (x64/arm64).

## Development

```
npm install
npm run typecheck
./redeploy.sh        # build + package + install + reopen the remote window
```
