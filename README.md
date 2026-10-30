# Remote - Incus

Connect to [Incus](https://github.com/lxc/incus) containers (system containers;
Incus = community fork of LXD) as a first-class remote connection type — the
same slot Dev Containers / Remote-SSH occupy in the Remote Explorer.

**Status: Phase 1 work in progress** — architecture is frozen and spike-verified
(see [design](docs/DESIGN.md)); version 0.1.0 is available on
[Open VSX](https://open-vsx.org/extension/dodbrian/remote-incus).

This is an independent project, not affiliated with or endorsed by the Incus
project or Linux Containers.

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

Download the VSIX from [Open VSX](https://open-vsx.org/extension/dodbrian/remote-incus)
or build it locally (see [Development](#development)), and opt in once via VS Code's
**Preferences: Configure Runtime Arguments**
command (`argv.json`; preserve any existing entries):

```json
{
  "enable-proposed-api": ["dodbrian.remote-incus"]
}
```

Then install the downloaded VSIX:

```sh
code --install-extension dodbrian.remote-incus-0.1.0.vsix
```

For a local build, the filename is `remote-incus.vsix`.
Restart VS Code after changing the runtime arguments. The extension ID is
`dodbrian.remote-incus`. Open VSX hosting does not change VS Code's default
extension marketplace. The Open VSX namespace is currently unverified;
ownership verification is pending.

Open the Command Palette and run **Remote - Incus: Show Incus** to reveal the
Incus view, including when Remote Explorer is hidden or another target is
selected. You can also open **Remote Explorer** in the Activity Bar and select
**Incus** from its target dropdown. The Remote Explorer container is built into
VS Code; Microsoft's separate `ms-vscode.remote-explorer` extension is not
required. If the Incus view is unavailable, check that Remote - Incus is enabled
and that the proposed-API runtime argument above is configured, then restart
VS Code.

Current verified configuration: Linux x64 client, Stable VS Code 1.143.1 and
Incus 7.5.1, with scoped Ubuntu/Rocky Linux 9.8 glibc x64 and Alpine musl x64
instance checks.
The manifest declares VS Code `^1.140.0`, and bootstrap implements glibc arm64
selection, but these are not evidence that every matching version or architecture
works. ARM64, Insiders, macOS and Windows remain unverified. Incus 6.0.5 has
historical evidence with packaging-specific signal restrictions; see the
[design support matrix](docs/DESIGN.md#10-support-matrix-mvp).

Bootstrap requires `/bin/sh`; Bash is optional. Before a missing or incomplete
installation is downloaded or extracted, setup checks `tar`, `gzip` and its
required file/checksum utilities in the selected user's PATH. A missing tool
produces a direct prerequisite error; install it or make it available in that
user's PATH before reconnecting. The checks require executable utility files;
flavor detection reports an unavailable `uname` directly. The extension does not repair PATH or install
packages automatically. The rescue terminal additionally
requires util-linux `script`. Minimal Alpine x64 images need `libstdc++` and
`libgcc` for the musl server runtime; installing Bash does not supply those
libraries. Install prerequisites explicitly; the extension does not install
system packages. Before launching a new server, bootstrap probes the bundled
runtime and reports loader or permission failures immediately; it also checks
for `nohup` and an executable launcher. The rescue terminal names a missing
`script` utility directly.

## Incus setup

Follow the [official Incus installation guide](https://linuxcontainers.org/incus/docs/main/installing/)
to install the Incus CLI on the computer running VS Code. Configure either a local
Incus server or a remote server; a local daemon is optional when using remotes.

- For a local server, ensure the Incus service is running. On a new installation,
  run `incus admin init` in a terminal and follow its prompts. Ensure your user
  has permission to access the Incus socket; group changes may require signing
  out and back in.
- For a remote server, configure its address and authentication with
  `incus remote add`, following your server administrator’s instructions.
- Check `incus remote list` and `incus list <remote>:` in a terminal. Replace
  `<remote>` with the configured remote name, such as `local`.

If a server is unavailable, expand its node for setup guidance, **Try again**,
and **Show connection details**. Once the server is ready, select **Try again**
or the view’s **Refresh** button; an editor restart is unnecessary. Listing
failures do not prevent browsing other configured servers.

## IPv4 forwarding on IPv6-only containers

If an IPv4-only service fails through ordinary forwarding on an IPv6-only
container, right-click its existing row in the Ports view and choose
**Forward over IPv4**. The action uses that row's port automatically; it does
not ask for a port number. VS Code manages the resulting forward as usual.

The helper uses an existing forwarded or environment-detected row; it does not
make all listening services appear in Ports. VS Code's discovery settings still
apply. With `hybrid` discovery, run the service in the integrated terminal so
its startup URL can trigger automatic forwarding. An externally started service
may have no row until its URL appears in terminal output or it is forwarded.

The action supports IPv4 loopback rows in an Incus remote window. If the port
already has an ordinary forward, the helper creates a separate entry; stop the
original when it is no longer needed. Existing forwarding and automatic port
detection continue to use VS Code's core behavior.

## Server download strategy

`remote-incus.downloadStrategy` defaults to `auto`. No selection is required
before installation: setup tries container download first and visibly switches
to client download/transfer once if that route fails. A matching installation
skips downloading altogether.

| Setting          | Behavior                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `auto` (default) | Container first, one visible client fallback; custom mirrors use client transfer directly. |
| `client`         | Always download on the client and transfer through Incus.                                  |
| `container`      | Container download only; failure is reported without fallback.                             |

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

The reviewed build was deployed on 2026-10-25 and verified byte-identical to its
production bundle. Normal Ubuntu/Rocky connections, signed authentication,
invalid-token rejection and healthy reuse passed. Rocky's missing-`tar` error
was verified in VS Code before an explicitly approved `tar` installation;
setup then completed. Other Rocky terminal/UI and error cases remain unverified.

Task 4 verification is complete; its results have been discussed and the user
has resolved the discussion gate. Real shell/relay
checks and explicitly authorized local/TLS integration passed, along with
user-assisted files, terminals, Restricted Mode, distinct-folder concurrent
windows and reload/folder reconnect. See [the evidence report](docs/TASK-04-RESULTS.md)
for versions, cleanup and exact limits.

The Ports view is now enabled; actual forwarding passed with an IPv4-only
service on the TLS/cluster fixture and an IPv6-loopback service locally.
After redeploy, the user manually verified Ports and reported it working
on 2026-10-25. A local fixture with IPv6-only external networking exposed a
separate IPv4-loopback address-resolution edge
case. The **Forward over IPv4** helper above passed isolated HTTP checks and
manual acceptance in the normal installed profile on 2026-10-25; ordinary
forwarding still has that address-resolution limitation. See
[the handover](docs/HANDOVER.md) for the evidence.

“Connect in New Window” opens a separate workspace containing the chosen or
last-used remote folder. Each request has its own workspace identity, so an
already-open folder gets a second window. “Connect in Current Window” continues
to open the folder directly. Instances without folder history open an empty
remote window. The small workspace files live in the extension's local storage
(`window-workspaces`), remain available for reload/reopening, and do not modify
the remote project. Successful files are retained rather than automatically
pruned; failed open requests remove their generated workspace. Isolated
three-window and reopening checks passed; the user also manually confirmed the
normal-profile identical-folder new-window workflow on 2026-10-25.

## Development

See the [release policy and process](docs/RELEASING.md) and [changelog](CHANGELOG.md)
for versioning and publication.

The offline Node suite uses the existing local dependencies. After `npm ci`:

```sh
npm test
npm run test:relay
npm run typecheck
npm run compile
npm run test:package
npm run test:redeploy
npm run package
```

`npm test` needs no VS Code installation, Incus binary/daemon, credentials,
internet access or server download. `npm run test:relay` additionally needs
local loopback TCP sockets and runs the bundled relay as real child processes.
These portable checks are configured in the tracked offline CI workflow (`.github/workflows/offline-ci.yml`)
without private infrastructure. CI installs locked dependencies, runs the checks,
and retains a verified VSIX as a build artifact, then finishes. The separately
started [Release workflow](docs/RELEASING.md) builds a numbered candidate, creates
a GitHub release, then waits for manual approval to publish it to Open VSX.

`npm run package` uses the lockfile-installed VSCE. Its `vscode:prepublish` hook
builds minified production output and removes stale source maps. The package
validator inspects the actual ZIP contents against an explicit file policy,
checks nonempty runtime/licenses, JavaScript syntax, matching VSIX metadata,
ZIP checksums and documentation links, and scans privacy patterns. Packaging adjusts root README/license references to VSCE's emitted
filenames so the archive's relative links remain valid. A new build replaces `remote-incus.vsix` only after finalization and validation
succeed; failures preserve the previous artifact and remove the rejected
candidate. `npm run test:package` covers archive policy, Markdown handling and
build-failure preservation with local fixtures.
Local validation does not establish that the workflow has run on GitHub.

### Mandatory quality gates

Linting (strict, type-checked rules), code formatting and the strict
TypeScript compiler settings are enforced as one gate — `npm run check` — and
every diagnostic is a failure, including anything set to "warn" (`--max-warnings 0`).
`npm test` and `npm run package` run this gate first; a `pre-commit` hook
(installed automatically by `npm install`) blocks non-conforming commits.

```sh
npm run check          # typecheck + lint + formatting verification
npm run lint           # ESLint only (warnings fail)
npm run lint:fix       # auto-fix lint findings
npm run format         # Prettier --write
npm run format:check   # Prettier --check (fails on unformatted files)
```

Formatting is Prettier's (single quotes, print width 100, defaults otherwise);
`.vscode/settings.json` applies the same on save. Rules that only make sense
for shipped code (the unsafe-`any` family, strict nullish/condition checks) run
at full strength under `src/`, with a documented carve-out for the test
fixture's opaque stub boundary in `eslint.config.mjs`.

The manual `scripts/verify-live.ts` verifier is separate: it refuses CI and
requires an explicit runtime target, destructive opt-in and the installed
client's signing-module path. Establish that the fixture is test-owned and idle
before use. No instance is created/deleted automatically, and target values or
raw private logs belong outside tracked artifacts. See
[testing guide](docs/tests/README.md) for commands and boundaries. The older
smoke/fresh-install scripts are not CI entry points. Smoke runs only pure checks
without a target argument; live smoke requires an explicit `remote:instance`.
Fresh-install checks also require `INCUS_TEST_ALLOW_DESTRUCTIVE=yes`. Run these
manual harnesses from the repository root against a test-owned idle fixture.

For a manual deployment, replace the quoted placeholders with your test-owned
fixture and absolute remote folder. This installs the build, restarts normal
VS Code and reopens that folder. Quote paths containing spaces. The helper
resolves the checkout root itself, so it can also be invoked by absolute path
from another working directory.

```sh
npm install
npm run typecheck
./scripts/redeploy.sh '<remote:instance>' '<absolute-folder>'
```

## Publication privacy

Run `npm run audit:privacy` on the checkout and
`node scripts/audit-privacy.cjs --history` on reachable Git history. For an
extracted VSIX or source export, use
`node scripts/audit-privacy.cjs --root <directory>`. Findings report file, line
and category without printing the matched value. This bounded pattern check
supplements manual review; it cannot recognize arbitrary private hostnames or
every secret format. Keep fixture identities in runtime inputs and keep raw
logs, token files and credentials out of tracked files and published archives.

## Icon licensing

Bundled tree SVGs are by Microsoft and contributors, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
See the [third-party notices](docs/ThirdPartyNotices.md) in the extension package
for source and license details.

## Documentation

See the [documentation index](docs/README.md) for architecture, testing, task plans,
verification results, and project history. The
[release-readiness review](docs/RELEASE-READINESS.md) records hosted CI,
publication evidence and remaining verification work.
