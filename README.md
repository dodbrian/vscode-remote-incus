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

## Similar projects

Canonical Workshop provides LXD development environments through Remote-SSH;
ssh2incus provides an Incus SSH gateway without per-instance SSH servers.
Remote - Incus connects through the existing Incus client using exec-stdio,
without SSH setup or a separate gateway. See `ALTERNATIVES.md` in the source
repository for the dated comparison, sources, and distribution research.

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

The offline Node suite uses the existing local dependencies. After `npm ci`:

```sh
npm test
npm run typecheck
npm run compile
```

`npm test` needs no VS Code installation, Incus binary/daemon, credentials,
network access or server download. See [tests/README.md](tests/README.md) for
fixtures and adding tests. The live `scripts/smoke.ts` and
`scripts/fresh-install-test.ts` scripts are separate, explicitly opt-in checks;
`npm test` never invokes them. Fresh-install checks require a separately
approved, test-owned target.

```
npm install
npm run typecheck
./redeploy.sh        # build + package + install + reopen the remote window
```

## Icon licensing

Bundled tree SVGs are by Microsoft and contributors, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
See `ThirdPartyNotices.md` in the extension package for source and license details.
