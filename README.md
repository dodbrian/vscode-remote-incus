# Remote - Incus

Connect to [Incus](https://github.com/lxc/incus) containers (system containers;
Incus = community fork of LXD) as a first-class remote connection type — the
same slot Dev Containers / Remote-SSH occupy in the Remote Explorer.

**Status: Phase 1 work in progress** — architecture is frozen and spike-verified
(see [design](docs/DESIGN.md)); the extension is not yet published.

## How it works (no sshd required)

- Instances are addressed via the existing `incus` client configuration
  (`incus remote list`) — the auth boundary is the Incus daemon identity (TLS
  client certs / trust tokens / OIDC). No SSH or externally exposed instance
  ports are required; the VS Code server listens only on instance loopback.
- The transport is `incus exec … -- node relay.js`: the child's stdio is the
  byte transport, wrapped as a VS Code managed remote connection.
- By default, server setup tries verified container download, then visibly
  falls back once to client download and `incus file push` if needed. The
  server starts detached as the instance's primary unprivileged user.

## Similar projects

Canonical Workshop provides LXD development environments through Remote-SSH;
ssh2incus provides an Incus SSH gateway without per-instance SSH servers.
Remote - Incus connects through the existing Incus client using exec-stdio,
without SSH setup or a separate gateway. See the [alternatives comparison](docs/ALTERNATIVES.md)
for dated findings, sources, and distribution research.

## Install (VS Code stable)

Proposed APIs are not permitted on the Marketplace; install from VSIX/OpenVSX
and opt in once via `~/.vscode/argv.json`:

```json
{
  "enable-proposed-api": ["local-dev.remote-incus"]
}
```

Then install the VSIX: `code --install-extension remote-incus.vsix`.
Target requirements: incus ≥ 6.0, Linux client, instances with glibc (x64/arm64).
Task 4 verified Linux x64 with Stable 1.143.1 and Incus 7.5.1; arm64 and
Insiders were not exercised in that verification.

## Server download strategy

`remote-incus.downloadStrategy` defaults to `auto`. No selection is required
before installation: setup tries container download first and visibly switches
to client download/transfer once if that route fails. A matching installation
skips downloading altogether.

| Setting | Behavior |
| --- | --- |
| `auto` (default) | Container first, one visible client fallback; custom mirrors use client transfer directly. |
| `client` | Always download on the client and transfer through Incus. |
| `container` | Container download only; failure is reported without fallback. |

To force a route, explicitly set `remote-incus.downloadStrategy` to `client` or
`container`. Container downloading requires existing curl and outbound HTTPS to
Microsoft's update/CDN endpoints. No package is installed automatically, and
attempts have bounded timeouts. Managed curl ignores `.curlrc` options so they cannot introduce implicit retries or override those limits. Client transfer supports containers without
internet access; explicit client mode also avoids waiting for a failed container
attempt in environments known to be offline.

Container archives use client-obtained commit/SHA metadata, private partials and
hash verification before publication. If that route fails after obtaining a
trusted digest, the client fallback must match it before publishing or reusing its cache too. When metadata is
unavailable, fallback retains the existing client-side hash and transfer checks.
If partial cleanup cannot be confirmed, setup stops instead of starting another
transfer against uncertain state. Both-route failure is reported without looping.
Custom `downloadUrlTemplate` mirrors work with `auto` or `client`; explicit
container mode rejects unsupported mirrors.

The extension does not enable or change Incus keepalive configuration.

## Verification status

Task 4 verification is complete; its results have been discussed and the user
has resolved the discussion gate. Real shell/relay
checks and explicitly authorized local/TLS integration passed, along with
user-assisted files, terminals, Restricted Mode, distinct-folder concurrent
windows and reload/folder reconnect. See [the evidence report](docs/TASK-04-RESULTS.md)
for versions, cleanup and exact limits.

Two findings remain: requesting a new window for an already-open remembered
folder focuses its existing window, and the Ports view is unavailable, leaving
actual VS Code port forwarding unverified. No production fixes were made in
Task 4. The findings remain open; further work requires explicit next-step
authorization.

## Development

The offline Node suite uses the existing local dependencies. After `npm ci`:

```sh
npm test
npm run test:relay
npm run typecheck
npm run compile
```

`npm test` needs no VS Code installation, Incus binary/daemon, credentials,
internet access or server download. `npm run test:relay` additionally needs
local loopback TCP sockets and runs the bundled relay as real child processes.
These portable checks can run in CI without private infrastructure.

The manual `scripts/verify-live.ts` verifier is separate: it refuses CI and
requires an explicit runtime target, destructive opt-in and the installed
client's signing-module path. Establish that the fixture is test-owned and idle
before use. No instance is created/deleted automatically, and target values or
raw private logs belong outside tracked artifacts. See
[testing guide](docs/tests/README.md) for commands and boundaries. The older
smoke/fresh-install scripts are not CI entry points.

```
npm install
npm run typecheck
./redeploy.sh        # build + package + install + reopen the remote window
```

## Icon licensing

Bundled tree SVGs are by Microsoft and contributors, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
See the [third-party notices](docs/ThirdPartyNotices.md) in the extension package
for source and license details.

## Documentation

See the [documentation index](docs/README.md) for architecture, testing, task plans,
verification results, and project history.
