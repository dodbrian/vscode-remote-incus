# DESIGN — "Remote - Incus"

A VS Code extension that adds **Incus containers** (system containers; Incus = community
fork of LXD, https://github.com/lxc/incus) as a first-class remote connection type —
the same UX slot Dev Containers / Remote-SSH occupy in the Remote Explorer.

Status: **architecture frozen after Phase-0 spike** (all hypotheses validated in a real
VS Code window). This document consolidates research, spike evidence, decisions, and
the Phase-1 plan.

---

## 1. Problem & approach

Official VS Code remote development ships fixed connection types (Remote-SSH, Dev
Containers, WSL, Tunnels). None attaches to an Incus/LXD instance. The Dev Containers
extension cannot be extended toward Incus: its runtime surface is hardcoded to a
Docker-compliant CLI (variants: Docker / Podman / wslc only; nerdctl/Singularity/crictl
requests open since 2020–2021, never acted on), and Incus does not speak the Docker
Engine API. Microsoft's remote extensions are closed source (the 2025 open-sourcing
news was Copilot Chat only), so forking is not available either.

**Chosen approach**: a standalone extension that registers itself as a remote authority
provider — the same proposed-API surface third parties already use in production
(e.g. `jeanp413/open-remote-ssh`):

- proposed APIs: `resolvers` + `contribViewsRemote` (tree view inside the Remote Explorer)
- authority prefix: `incus` → `vscode-remote://incus+<remote>/<instance>/…`
- distribution: VSIX / OpenVSX; on Microsoft stable builds the user opts in once via
  `~/.vscode/argv.json`: `"enable-proposed-api": ["<publisher>.remote-incus"]`
  (verified working in the spike; marketplace publishing of proposed-API extensions is
  not permitted — OpenVSX/VSIX is the sanctioned alternative)

## 2. Transport: exec-stdio, no SSH (frozen)

The core architectural decision, validated end-to-end:

- **No SSH anywhere**: no sshd in instances, no ssh client, no `~/.ssh/*` involvement,
  no listening network ports in instances, no published ports.
- **Auth boundary = the Incus daemon identity** (TLS client certs / trust tokens / OIDC
  via the user's existing `incus` client configuration; `incus --remote <host>` handles
  remote daemons for free).
- **Connection primitive**: `incus exec <instance> --mode non-interactive --user <uid>
  --env … -- node <staged-relay.js>` — the child's stdio is the byte transport.

Wiring through the VS Code API:

- resolver returns `new vscode.ManagedResolvedAuthority(makeConnection, connectionToken)`
- **core dials `makeConnection()` once per logical channel** — spike measured exactly
  2 dials at connect (management + extension host) and *held both open*;
- terminal/PTY traffic is **multiplexed over the management channel** (no extra dial);
- if no custom `tunnelFactory` is returned, **core synthesizes one for forwarded app
  ports** — dialing `makeConnection()` once per forwarded port and running the server's
  tunnel protocol itself. Phase 1 relies on this; phase 2 may optimize per-port via
  `incus port-forward` (Incus ≥ 7.3, not available on the 6.0.5 dev host) or hotplug
  ephemeral proxy devices.

Precedent (verified by autopsy of issue logs): the official Dev Containers "attach to
running container" flow uses exactly this architecture with `docker exec` — server
tarball piped through exec stdin, one long-lived exec per connection, inline `node -e`
relay bridging stdio ↔ the server's `127.0.0.1:port`. Known failure modes of that flow
(orphaned relays holding fds, thousands of relay processes exhausting pids.max) are
addressed below as first-class requirements.

## 3. Server bootstrap (frozen)

Default mode is **fully air-gapped** — the container never needs internet:

1. Extension resolves the server commit **from the local client** (`code --version`,
   line 2) — server and client must match by commit.
2. Download `https://update.code.visualstudio.com/commit:<sha>/server-linux-x64/stable`
   **client-side** (≈222 MB; cache under extension globalStorage; sha256 recorded).
3. `incus file push <tarball> <instance>/tmp/…` (**path mode**) — then extract inside as
   the target user into `~/.vscode-server/bin/<commit>` (`--strip-components=1`).
4. Token file: `~/.vscode-server/data/Machine/.incus-conn-token`, mode `0600`,
   owner = target user; fresh 43-char URL-safe token minted when missing.
5. Start detached (survives any single exec session):
   `~/.vscode-server/bin/<commit>/bin/code-server --host 127.0.0.1 --port 0
   --connection-token-file <token-file> --accept-server-license-terms > log 2>&1`
6. Discover port by parsing stdout log: `Extension host agent listening on <port>`
   (no lockfile needed; also persist a `.devport`-style state file like MS does).
7. Hand `connectionToken` to `ManagedResolvedAuthority`; the token travels only over
   the exec channel and is never persisted by the client.

Variants: `server-linux-alpine` (musl, **x64 only**) for Alpine instances; `arm64`
supported; armhf dropped upstream after VS Code 1.122. Requirements since VS Code
1.99: kernel ≥ 4.18, glibc ≥ 2.28, libstdc++ ≥ 3.4.25 — pre-flight via the bundled
`bin/helpers/check-requirements.sh` for clean refusals.

## 4. Connection token policy (frozen)

- **Purpose**: attachment gate against *other UIDs inside the instance*. It is NOT
  encryption and NOT per-user authorization; channel confidentiality rides on
  loopback/unix-socket confinement and daemon TLS.
- **Fresh token per server (re)start** (MS-style auto-rotation: a leaked token dies with
  the server process; rotation coincides with the connection severing anyway).
- **File delivery mandatory**: argv exposes secrets via world-readable
  `/proc/<pid>/cmdline`; the `--connection-token-file` path (0600, atomic rename) keeps
  the secret out of argv/env/logs. Client reads the same file through the exec channel
  and forgets it after the handshake.
- **Charset**: only `[0-9a-zA-Z_-]` — the server silently rejects other characters
  (discovered in spike; raw base64 with `+/=` fails *after* health-check OK).
- Explicit **"Reset server & connection token"** command for the hygiene case.

## 5. User policy (frozen default, override available)

- Default identity = the instance's **primary unprivileged user** (uid resolved inside
  the instance via `getent`; on 6.0.5 `--user` accepts **numeric uid only**).
- Note: exec as uid 1000 keeps `gid=0` (root primary group) — the token file and server
  dirs must be owned/chmod'd explicitly.
- Root attach = opt-in per connection (setting `remote-incus.user`), never default.
- `~/.vscode-server` ownership is the classic trap (root-installed → user-attach EACCES):
  bootstrap always runs **as the connect user**, never as root-then-chown.

## 6. Relay lifecycle (frozen)

- Helper (`relay.js`, ~30 lines of Node) is **staged inside the instance** once per
  install (host paths don't exist in-container) and run with the **server's own bundled
  node** — zero extra dependencies.
- Teardown semantics: stdin EOF → `client.end()` (server sees FIN); client socket close
  → `process.exit(0)`; stdout EPIPE → exit. Spike-verified: relay gone ≤ 1 s after the
  local tree dies.
- **Orphan sweep on every attach** (mandatory, not paranoia): broken half-connected
  bridges leave immortal relays (spike produced one specimen; MS's Docker attach
  produced 2,200+ and pid exhaustion). Sweep = pkill by bracketed pattern (pattern AND
  payload text must never self-match — `pkill -f` matches the whole `bash -c` string,
  including comments) + age-based heuristic on staged relays.
- Bridges are disposable; reconnect is core's re-resolve cycle, never our retry loop.
  Return `RemoteAuthorityResolverError.TemporarilyNotAvailable` only for controllable
  waits (e.g. starting a stopped instance).

## 7. Error taxonomy & UX (frozen)

Pre-flight before every resolve, from `incus list` / daemon state:

| situation | behavior |
|---|---|
| instance stopped | offer "Start & connect" (progress UI), then proceed |
| instance deleted (404) | distinct error + tree refresh; never auto-recreate |
| recreated instance (stale `~/.vscode-server`, wrong commit) | detect, restart server under correct commit |
| container stopped mid-session | all bridges die at once → fatal "Connection lost" + "Start and reconnect" action |
| glibc/musl/arch mismatch | refusal names the exact constraint (via check-requirements) |

Parity commands (with official Remote-SSH): Kill VS Code Server on Instance, Uninstall
from Instance, plus an escape-hatch **open terminal over exec** (no sshd → no plain
`ssh` fallback for users; the extension must provide the rescue path).

State ownership: **the Incus daemon is the source of truth** (discover via
`incus list --format json`, `incus remote list`); the extension keeps only session
metadata in its `globalStorage` (never `~/.ssh/config`, never per-instance config).

## 8. Spike evidence ledger (all hands-on verified, incus 6.0.5, VS Code 1.141.2→1.142.0)

Transport & API:
- resolver accepted, `makeConnection` dialed ×2 and held; PTY multiplexed over
  management (2 live bridges during terminal use)
- version mismatch → core reports "Client refused: version mismatch" cleanly
- `enable-proposed-api` via `~/.vscode/argv.json` works for installed VSIX on stable

Incus specifics:
- `incus file push -` (stdin) **broken on 6.0.5** — died at 77% (`connection lost`);
  path-mode push works at ~2.1 MB/s websocket ceiling (222 MB ≈ 110 s) — production
  transfers must be resumable/cached with sha256 verification
- `--user` numeric-only; `--mode` mutually exclusive with `-t/-T`; `--cwd`, `--env`,
  `--disable-stdin` available; non-interactive exec = raw binary pipes (no PTY mangling)
- exec has **no reconnect**: daemon restart / TLS blip / instance stop sever all
  sessions at once; child-process fate on daemon restart unverified → relays must be
  respawned idempotently and stale servers detected before reuse

Shell hygiene traps (spike-caused, now codified):
- `pkill -f` self-match twice over: the pattern AND any comment text inside the same
  `bash -c` payload are matchable — bracket-class every pattern, keep payloads free of
  plain names
- direct exec args expand `~` **client-side** (`/home/developer/...` leaks into container
  paths) — always pass absolute in-container paths
- installed-VSIX `extensionPath` lives in `~/.vscode/extensions/<id>` — never derive
  repo/script paths from it

VS Code CLI/instance lessons:
- CLI flags apply only to **newly created windows**; handoff to a running window
  silently drops dev-path/enable-proposed flags and reuses stale resolution state
- two main processes (pre/post auto-update) cause confusing window/session routing;
  always restart to a single instance before debugging resolver flows
- argv.json for stable lives at `~/.vscode/argv.json` (not `~/.config/Code/User/`)

Remote Explorer tree (`contribViewsRemote`, verified on stable 1.142.0, spike ext
0.0.2/0.0.3 — tree rendered, connect-from-tree resolved and dialed ×2):
- `contributes.views` container key is **`"remote"`** (= viewlet `workbench.view.remote`);
  without the `contribViewsRemote` proposal the contribution is silently dropped with
  a warning in the extension-host log (`viewsExtensionPoint.ts` gates on the proposal)
- a view **without `remoteName`** renders as an always-visible stacked section
  (0.0.2 behavior); a view **with `remoteName`** joins the Remote Explorer's
  "Switch Remote" dropdown (`SwitchRemoteViewItem`, explorerViewItems.ts):
  dropdown label = view `name`, selection key = `remoteName`; the selected view
  takes over the whole viewlet; choice persists per workspace
  (`remote.explorerType` storage); auto-selects in windows whose authority
  prefix (`remoteAuthority.split('+')[0]`) equals `remoteName`.
  **Decision (user, 2026-10-19): Incus uses the switcher form** — same UX slot
  as Dev Containers / Remotes (Tunnels/SSH); verified with 0.0.3 (third dropdown
  entry, full-viewlet takeover, auto-select in the connected window)
- `group: "targets@N"` is required for switcher participation (and sorts views)
- connect from tree: `vscode.commands.executeCommand('vscode.newWindow',
  { remoteAuthority, reuseWindow })` — the open-remote-ssh pattern, works for
  third-party authorities; extension activates via `onView:<viewId>`
- env fact discovered during verification: on this dev host the **default incus
  remote is `fixture-remote` (TLS daemon)** and the local unix socket is NOT group-accessible
  (`incus list local:` → EACCES). All instances incl. `fixture-container` live on
  `fixture-remote`. Tree remotes must be filtered by `Protocol === 'incus'` (drops the
  simplestreams `images` remote) and per-remote listing must degrade gracefully.

Phase-1 extension (TypeScript + esbuild, verified on stable 1.142.0, 2026-10-19 —
resolver + full tree + commands + bootstrap live in a real window):
- authority is `incus+<remote>:<instance>` — the separator must be `:` (not `/`):
  the authority component of a `vscode-remote://` URI ends at the first slash,
  so a slash-embedded instance would vanish from the authority the resolver sees
- `vscode.env.appCommit` (resolvers proposal) yields the client commit directly —
  no CLI parsing needed; `code --version` line-2 parse kept as fallback
- first resolve ran the whole install inline (download 217 MB ≈ 6 s client-side;
  path-push ≈ 117 s; extract) and **core waited 132 s without a resolve timeout**
  ("returned managed authority"). Still, connect-from-tree pre-runs
  `ensureServerReady` under progress UI (§7 pre-flight slot) so resolve stays fast.
- idempotent re-resolve measured ≈ 17 s: tarball cache hit (sha re-verified),
  remote sha match → push skipped, running server under matching commit reused,
  port rediscovered from server.log, 2 bridges dialed
- **untrusted-workspace trap**: a window on a never-trusted remote folder starts
  in Restricted Mode; the extension is "disabled because the current workspace is
  not trusted" and its **views contribution is dropped** → `registerTreeDataProvider`
  fires the toast "No view is registered with id: …" — while the **resolver still
  activates** (core special-cases resolver activation; the connection itself works).
  Fix: manifest `capabilities.untrustedWorkspaces.supported: true` — exactly what
  Remote-SSH and ms-vscode.remote-explorer declare. With it, Restricted Mode
  behaves like Remote-SSH (tree + connect available pre-trust); verified working.
- escape-hatch terminal: Pseudoterminal over pipes + util-linux `script -qec` in
  the instance allocates a real PTY (verified: prompt, colors, interactive bash
  as the target user). Resize propagation not implemented (rescue-path tradeoff).

Phase-1 progress UX + reuse hardening (2026-10-19, same day, user-driven):
- **progress toast parity** (Dev Containers/Remote-SSH): notification-location
  `withProgress` renders its TITLE as markdown — embed a `command:` link there:
  `[Connecting to <instance> (show log)](command:remote-incus.showLog "…")`
  (verified in the Dev Containers bundle: `title: Hu` where Hu is exactly that
  form; Remote-SSH uses the same link form in error toasts). Live detail goes
  into `progress.report({ message })` under the title.
- **collapsed toasts truncate title+message as one line from the right** — the
  percentage must LEAD the message (`89% — pushing to instance`), never trail
  it (user feedback after the first iteration).
- **`incus file push` prints its own meter even when piped** ("<n>% (2.0MB/s)",
  verified over a full 217 MB push): stream-parse it for exact transfer
  progress; no stat-polling needed (the remote file also grows during push,
  verified — fallback available).
- **zombie servers**: a running server whose ~/.vscode-server was wiped keeps
  running from memory; a process-only reuse check (pgrep commit match) then
  "reuses" a server with no token file, no log, no install → 60 s port-wait
  and failure (seen live: "still waiting for port"). Fix: on-disk health check
  (code-server binary + server.log + token file) before reuse; failure → kill
  + fresh start. Verified live: "lost its install (zombie) — killing and
  starting fresh" → connected.
- **install-first ordering**: `isServerInstalled` (`.incus-install-ok` marker
  written after a successful extract, OR core files for spike-era installs)
  runs BEFORE any tarball work — when the install exists, download/push/
  extract are all skipped (measured: full connect with zero transfer ≈ 16 s).
  Rationale: the local tarball was previously required just as a sha reference
  even for fully installed instances.

## 9. Distribution & licensing constraints

- Extension source: MIT (copies may come from MIT sources: `jeanp413/open-remote-ssh`,
  `microsoft/vscode` test-resolver sample).
- **VS Code Server is proprietary**: bundling *download + install logic* for personal
  developer use is fine; building a hosted service on it is not (server license
  aka.ms/vscode-server-license). The extension never redistributes the binary — it
  fetches from the official URL at runtime.
- Marketplace: proposed-API extensions can't be published there → OpenVSX + VSIX;
  stable builds need the one-time `argv.json` opt-in (spike-verified).

## 10. Support matrix (MVP)

| dimension | MVP | later |
|---|---|---|
| client OS | Linux | macOS, Windows (upstream client builds exist; CLI discovery TBD) |
| daemon | local unix socket, remote TLS (`--remote`) | restricted remotes/projects |
| instance arch | x64, arm64 (glibc) | alpine-musl x64 |
| explicit non-goals | musl-arm64 server (doesn't exist upstream) | — |
| Incus version | ≥ 6.0 (flags verified on 6.0.5) | port-forward on ≥ 7.3 |

## 11. Open questions (recorded, with leaning)

1. Final product naming/publisher (working title "Remote - Incus") — TBD before OpenVSX.
2. ~~`contribViewsRemote` tree-view wiring~~ **Verified 2026-10-19** (see §8).
3. Per-connection `--env`/`--cwd` surface for future devcontainer.json support — Phase 3.
4. Multi-user-in-one-instance semantics (concurrent different-uid attaches) — Phase 2.
5. Download-URL override setting for fully offline environments (mirror support).

## 12. Phase-1 plan (next work package)

1. ~~TypeScript + esbuild project; extension skeleton from spike (inline bootstrap, no
   script shell-outs; relay.js as bundled asset).~~ **DONE 2026-10-19** — repo-root
   project (`src/`, esbuild bundle, relay as `assets/relay.js`); verified on stable.
2. ~~Remote Explorer tree view (`contribViewsRemote`): remotes → instances (state icons:
   running connectable / stopped startable), commands: connect, start, stop, restart,
   kill server, uninstall server, reset token, open terminal.~~ **DONE 2026-10-19** —
   user-verified on stable incl. switcher form, graceful per-remote degradation,
   and the untrusted-workspace capability (§8).
3. ~~Bootstrap module: client-side cached download + resumable verified push + extract +
   token + start + port discovery (idempotent; safe against commit mismatch).~~
   **DONE 2026-10-19** (cached+sha-verified download, sha-gated idempotent push,
   extract/token/start/port discovery, stale-commit restart, orphan sweep after
   fresh starts; "resumable" = interruption-safe re-entry, not byte-range resume —
   `incus file push` has no resume on 6.0.5). Reuse hardened same day: on-disk
   health check before reuse (zombie detection), install-first ordering (§8).
4. ~~Connection progress UX (user-requested 2026-10-19): toast with progress bar +
   "(show log)" link during download/push, like Dev Containers/Remote-SSH.~~
   **DONE 2026-10-19** — title-embedded command link, real download/push
   percentages, percent-first messages (see §8).
5. Diagnostics: output channel, per-bridge structured logs, "collect diagnostics"
   command; sensible `RemoteAuthorityResolverError` usage. *(output channel +
   per-bridge logs + collect-diagnostics exist; error-taxonomy refinement open)*
6. Tests: mechanics harness (install/start/dial against `fixture-container`), resolver
   contract test on Insiders + stable, matrix smoke on x64/arm64 Ubuntu/Debian images.
7. Packaging pipeline: CI-built VSIX + OpenVSX publish + README with the argv.json step.

## 13. Spike artifact inventory (`spike/`)

| file | role | keep? |
|---|---|---|
| `02-install-server.sh` | verified install flow (path-push, sha, extract, no-sshd proof) | reference for Phase-1 module |
| `03-start-server.sh` | verified token+start+discovery flow | reference |
| `relay.js` / `relay-child` semantics | the stdio↔TCP relay | becomes bundled asset |
| `exec-bridge.sh`, `04-relay.py` | socat/poc scaffolding | disposable |
| `ext/` (extension.js, package.json, VSIX) | resolver proof | becomes Phase-1 skeleton |
| `redeploy.sh` | dev loop helper | keep while Phase 1 iterates |
| `.state/` | port/token/commit cache | dev-loop artifact |
