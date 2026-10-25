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
Containers, WSL, Tunnels). None provides a native Incus exec transport. The Dev Containers
extension cannot be extended toward Incus: its runtime surface is hardcoded to a
Docker-compliant CLI (variants: Docker / Podman / wslc only; nerdctl/Singularity/crictl
requests open since 2020–2021, never acted on), and Incus does not speak the Docker
Engine API. Microsoft's remote extensions are closed source (the 2025 open-sourcing
news was Copilot Chat only), so forking is not available either.

**Chosen approach**: a standalone extension that registers itself as a remote authority
provider — the same proposed-API surface third parties already use in production
(e.g. `jeanp413/open-remote-ssh`):

- proposed APIs: `resolvers`, `contribViewsRemote` (Remote Explorer tree), and
  `tunnels` (selected-row IPv4 helper)
- authority prefix: `incus` → `vscode-remote://incus+<remote>/<instance>/…`
- distribution: VSIX / OpenVSX; on Microsoft stable builds the user opts in once via
  `~/.vscode/argv.json`: `"enable-proposed-api": ["<publisher>.remote-incus"]`
  (verified working in the spike; marketplace publishing of proposed-API extensions is
  not permitted under the documented policy; VSIX sharing is documented,
  and Open VSX is a prospective additional registry)

Related-project research (2026-10-23): [ALTERNATIVES.md](ALTERNATIVES.md)
compares Workshop, ssh2incus, the LXD explorer, isx, bubble, and XPipe.
No equivalent public Incus resolver was found; similar full-development
workflows exist through SSH. Avoid "first" or "only" claims. Workshop is the
closest extension UX; ssh2incus already avoids per-instance SSH servers.
This research does not change the frozen transport decision.

## 2. Transport: exec-stdio, no SSH (frozen)

The core architectural decision, validated end-to-end:

- **No SSH anywhere**: no sshd in instances, no ssh client, no `~/.ssh/*` involvement,
  no externally exposed instance ports; the server listens on 127.0.0.1.
- **Auth boundary = the Incus daemon identity** (TLS client certs / trust tokens / OIDC
  via the user's existing `incus` client configuration; `incus --remote <host>` handles
  remote daemons for free).
- **Connection primitive**: `incus exec <instance> --mode non-interactive --user <uid>
--env … -- node <staged-relay.js>` — the child's stdio is the byte transport.

Wiring through the VS Code API:

- resolver returns `new vscode.ManagedResolvedAuthority(makeConnection, connectionToken)`
- **core dials `makeConnection()` once per logical channel** — spike measured exactly
  2 dials at connect (management + extension host) and _held both open_;
- terminal/PTY traffic is **multiplexed over the management channel** (no extra dial);
- if no custom `tunnelFactory` is returned, **core synthesizes one for forwarded app
  ports** — dialing `makeConnection()` once per forwarded port and running the server's
  tunnel protocol itself. The resolver now enables the Ports view using
  `forwardedPortsViewEnabled`; actual forwarding and manual Ports acceptance
  passed on the scoped Stable 1.143.1 fixtures. The selected-row IPv4 helper
  uses core forwarding with `::ffff:127.0.0.1` for the IPv6-only-networking
  address-resolution edge case. It does not replace the tunnel factory or
  intercept ordinary forwarding. See the current [handover](HANDOVER.md).
  Per-port `incus port-forward` or proxy devices remain future alternatives.

Precedent (verified by autopsy of issue logs): the official Dev Containers "attach to
running container" flow uses exactly this architecture with `docker exec` — server
tarball piped through exec stdin, one long-lived exec per connection, inline `node -e`
relay bridging stdio ↔ the server's `127.0.0.1:port`. Known failure modes of that flow
(orphaned relays holding fds, thousands of relay processes exhausting pids.max) are
addressed below as first-class requirements.

## 3. Server bootstrap (frozen)

The client route supports **air-gapped containers**. Default auto mode first
tries container HTTPS download and falls back to this route if needed:

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
selection is implemented but live ARM64 coverage is absent. Historical upstream
requirements are recorded in the evidence ledger; declared compatibility does
not establish runtime coverage. Missing/incomplete installations check setup
tools in the selected user's PATH before download or extraction. Startup probes
the bundled Node executable with `--version` and checks launcher permissions and
`nohup`; it does not invoke `bin/helpers/check-requirements.sh` as a separate
pre-flight or validate every kernel/library version.

Task 5 is complete and manually accepted; consolidated evidence and limitations
are in [TASK-05-RESULTS.md](TASK-05-RESULTS.md). The historical roughly 2 MB/s CLI
observation is not a protocol ceiling. Experimental comparisons informed the
implementation; their disposable prototypes were removed at task closure.

### Task 5 implementation flow (2026-10-24)

After resolving identity and the current client commit, two read-only execs run
in parallel: selected UID/HOME signal, architecture/libc and install checks;
and root-view process plus health-file checks. Both snapshots finish before any
repair, kill or setup mutation. The install probe splits the server-main filename
in its argv so concurrent pgrep cannot identify the probe itself as a server. Complete installations skip archive download, hashing, transfer and
extraction. This check remains independent of the client archive cache.

Token preparation and the relay probe share one selected-user exec. The probe
requires a regular, non-symlink relay with the bundled asset's SHA-256, selected
UID/GID and mode 0600. Matching state skips push; missing/changed state is pushed
in path mode and verified before returning any dialable session. Symlinks are
unlinked as the selected user before push, preserving their targets. An
unexpected directory rejects without deletion. The asset hash is computed
anew on each bootstrap; no new cross-session cache is introduced.
Token minting, sticky reuse and permission repair retain the established
regression contract (which supersedes the early rotation sketch below).

On healthy reuse with a matching relay, token/relay preparation also reads port
announcements and token contents, making three execs in two sequential waves.
Relay repair uses the same inspection snapshot and a separate verified push/read,
without re-entering bootstrap or repeating probes. Fresh startup keeps the same
inspection flow and uses separate launch/readiness operations. The
last announcement wins, and an empty token rejects. Fresh starts still remove
the old log before launch. Waiting retains the existing bounded client-side
polling and diagnostic log dump. Launch/wait batching could remove another
boundary even with one poll, but it is outside this implementation. Token contents remain
captured in memory, absent from argv, environment, logs and persistent client
state. No `.devport` file is written by this implementation.

Only fresh startup performs orphan-relay sweeping and best-effort install/cache
pruning. Healthy reconnect preserves active bridges and skips this hygiene.
The transport, within-host in-flight deduplication and unresolved identity/GID
policies are unchanged. Measurements and remaining limits are in
[TASK-05-RESULTS.md](TASK-05-RESULTS.md).

### Selectable archive acquisition

`remote-incus.downloadStrategy` defaults to `auto`: one verified container
attempt, then one visible client fallback after an expected route failure.
`client` and `container` are explicit overrides. Installed matching servers skip
all archive work for all three modes. Auto with a custom URL template goes
straight to the client route without requesting Microsoft metadata.

Container metadata has a 15-second deadline, rejects redirects and requires the
exact commit, valid SHA and supported HTTPS CDN. Existing curl ignores automatic curlrc loading (`--disable` first), and follows HTTPS-only
redirects with 10-second connect/180-second total limits inside a 210-second exec.
Only file creation explicitly supplies the selected GID; normal bootstrap and
bridge GID behavior is unchanged. Exclusive 0600 UUID partials have EXIT/INT/TERM
cleanup, full hash/ownership verification and exact-path atomic publication.

Expected container-route errors carry any verified publisher SHA into the client
fallback. Client archives must match that digest before cache publication/reuse
as well as push/extraction, and
mismatching cached bytes/sidecars are removed. If metadata cannot be obtained,
the client route retains its existing local-cache/hash/path-push/post-push gates.
The client route also retains existing mirror support. Both failures are retained
as causes if neither route succeeds; neither route is retried in a loop.

The switch is reported in progress and logs before client work. A typed cleanup
failure blocks fallback when partial cleanup cannot be confirmed. Unexpected
program/reporting errors also propagate rather than masquerading as route
failures. Explicit container mode never switches routes. This changes the earlier
manual-selection policy at the user's request; no keepalive setting is changed.

## 4. Connection token policy (frozen)

- **Purpose**: attachment gate against _other UIDs inside the instance_. It is NOT
  encryption and NOT per-user authorization; channel confidentiality rides on
  loopback/unix-socket confinement and daemon TLS.
- **Fresh token per server (re)start** (MS-style auto-rotation: a leaked token dies with
  the server process; rotation coincides with the connection severing anyway).
- **File delivery mandatory**: argv exposes secrets via world-readable
  `/proc/<pid>/cmdline`; the `--connection-token-file` path (0600, atomic rename) keeps
  the secret out of argv/env/logs. Client reads the same file through the exec channel
  and forgets it after the handshake.
- **Charset**: only `[0-9a-zA-Z_-]` — the server silently rejects other characters
  (discovered in spike; raw base64 with `+/=` fails _after_ health-check OK).
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

- Helper (`relay.js`, ~30 lines of Node) is **staged inside the instance**
  (host paths don't exist in-container), checked for content/metadata on each
  bootstrap and repaired when needed. It runs with the **server's own bundled
  node** — zero extra dependencies.
- Teardown semantics: stdin EOF → `client.end()` (server sees FIN); client socket close
  → `process.exit(0)`; stdout EPIPE → exit. Spike-verified: relay gone ≤ 1 s after the
  local tree dies.
- **Orphan sweep after fresh startup only**: healthy reuse must preserve live
  bridges. Obsolete relays are cleared before new dials after server replacement.
  Sweep uses a bracketed pattern whose payload never matches its invoking shell.
  Relays self-exit on EOF; the early sweep-on-every-attach sketch is superseded
  by the established regression contract.
- Bridges are disposable; reconnect is core's re-resolve cycle, never our retry loop.
  Return `RemoteAuthorityResolverError.TemporarilyNotAvailable` only for controllable
  waits (e.g. starting a stopped instance).

## 7. Error taxonomy & UX (frozen)

Pre-flight before every resolve, from `incus list` / daemon state:

| Situation                                          | Current behavior                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Instance stopped                                   | Start during resolve with progress, then recheck state                                                             |
| Instance deleted or renamed                        | `NotAvailable`, refresh tree; never auto-recreate                                                                  |
| Instance starting, including after a start request | `TemporarilyNotAvailable`; do not issue another start for an already-starting instance                             |
| Unexpected state or daemon/transport failure       | Preserve cause in logs and wrap unexpected errors with authority and first-line detail                             |
| Stale server commit or missing install             | Detect and replace/reinstall as appropriate before reuse                                                           |
| Container stopped mid-session                      | Bridges close; core can re-resolve through the same pre-flight                                                     |
| Unsupported architecture/libc                      | Refuse with the detected constraint                                                                                |
| New server startup prerequisites                   | Check `nohup`, executable launcher and bundled `node --version` before detaching; preserve previous log on failure |

The runtime probe catches loader and executable failures, not every later
server requirement. Error classification has offline regression coverage;
error-dialog UX has not been reverified live.

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
- direct exec args expand `~` **client-side** (`<client-home>/...` leaks into container
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
  remote was a TLS daemon** and the local unix socket is NOT group-accessible
  (`incus list local:` → EACCES). The tested fixture was hosted on that TLS daemon. Tree remotes must be filtered by `Protocol === 'incus'` (drops the
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
  ("returned managed authority"). ~~Still, connect-from-tree pre-runs
  `ensureServerReady` under progress UI (§7 pre-flight slot) so resolve stays fast~~
  — **reversed 2026-10-20** when the double flow was measured (next block).
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
  - fresh start. Verified live: "lost its install (zombie) — killing and
    starting fresh" → connected.
- **install-first ordering**: `isServerInstalled` (`.incus-install-ok` marker
  written after a successful extract, OR core files for spike-era installs)
  runs BEFORE any tarball work — when the install exists, download/push/
  extract are all skipped (measured: full connect with zero transfer ≈ 16 s).
  Rationale: the local tarball was previously required just as a sha reference
  even for fully installed instances.
- **version drift / client auto-update** (user question, verified live
  2026-10-19): the client commit is read fresh at EVERY resolve
  (`vscode.env.appCommit`) — nothing is pinned to a client version inside the
  extension (`engines.vscode` is a range; proposal d.ts is dev-time only).
  On a client update the resolver computes the new commit, finds no matching
  install, fetches/installs the new commit alongside, detects the running
  server as a **stale commit → kills it → starts fresh under the new commit**
  (verified with a simulated stale server: "runs stale commit 0123456789… —
  restarting under 6d62b1d5da…" → ready → bridges dialed). The connection
  token file is sticky, so reconnect needs no re-auth. Superseded state is
  pruned automatically afterwards: in-instance `bin/<other-commit>` dirs
  (~600 MB extracted per version) and client-side cache tarballs for other
  commits. Probe hardening: commit extraction requires EXACTLY 40 hex chars
  in a `bin/<…>/` cmdline path — a 42-hex fake dir/process was ignored (tested).
  Residual risks on updates are proposal-shape changes (`resolvers` /
  `contribViewsRemote` are unstable across releases — a core change would need
  an extension fix release); `enable-proposed-api` grants survive updates
  (keyed by extension id, not version).

Phase-1 connect-affordance parity (user-requested 2026-10-20, evidence from the
official Remote Explorer extension 0.5.0 — installed manifest inspected — and
`jeanp413/open-remote-ssh` source):

- **official pattern**: `connectToRemoteInCurrentWindow` ("Connect in Current
  Window...", `$(arrow-right)`) at `inline@1` + `navigation@1`,
  `connectToRemoteInNewWindow` ("Connect in New Window...", `$(empty-window)`)
  at `inline@2` + `navigation@2`; all explorer commands hidden from the
  command palette (node-driven, `commandPalette: when false`).
- **same-window mechanism** (open-remote-ssh): host-level connect =
  `vscode.newWindow { remoteAuthority, reuseWindow: true }` (reloads the current
  window into the remote); folder-level open = `vscode.openFolder`
  on a `vscode-remote://` URI with `forceNewWindow: false`. We use the host
  form — our connect opens an empty remote window, folder choice stays native.
- our wiring (amended 2026-10-22, user decision — follow the Dev Containers
  UX, dropping the Remote-SSH row-click parity): NO connect on the row click;
  connecting is only via hover/context icons = the two connect commands
  (they still start a stopped instance first, Start & Connect §7); Start/Stop
  live in the context menu (`remote-incus@N` group sorts after `navigation`);
  remote nodes render without an icon (chevron only).

Phase-1 single-flow connect (user-driven 2026-10-20, log evidence):

- the tree-connect command pre-ran `ensureServerReady` before
  `vscode.newWindow` — but core **restarts the extension host within ~1 s**
  of the command and runs a fresh `resolver.resolve()` there (bridges are
  ext-host-owned and never survive the reload; log: click-side ensure 18 s →
  `activate` 0.8 s later → resolve-side ensure 23 s). The pre-flight never
  saved anything; the user saw the ENTIRE flow twice (both instances logged).
- decision: the connect command only delegates to `vscode.newWindow` — the
  whole bootstrap runs exactly once, inside the resolve, under the resolve's
  own progress toast (which displays in the loading/new window). A stopped
  instance is started by the resolve pre-flight. `tree.refresh()` after the
  command repairs this window's state icons.

Dev Containers folder UX (user-requested 2026-10-22; evidence from the
installed extensions' bundles — remote-explorer 0.5.0, remote-ssh 0.128,
remote-containers 0.469):

- **official pattern**: targets (SSH hosts / containers) render a nested
  list of FOLDERS ever opened on that target (`viewItem ==
remote-explorer.remoteFolder` / `attachedFolder`); folder rows carry
  three hover icons — connect in current window (`$(arrow-right)`,
  `inline@1`), connect in new window (`$(empty-window)`, `inline@2`),
  remove-from-history (`inline@3`) — plus context-menu equivalents.
- **one-go reconnect**: connecting a target with folder history lands in
  the LAST used folder directly; the open is `vscode.openFolder` on a
  `vscode-remote://<authority>/<path>` URI (shell code verified: current
  window = no force flag, new window = `!0`). The folder is the URI PATH —
  transparent to the authority resolver (an authority ends at the first
  slash; the resolver never sees it).
- **history source of truth**: the remote extension's OWN globalState, NOT
  core recents — remote-ssh `FolderHistoryManager`, key `folder.history.v1`,
  shape `{ historyData: { <authority>: [paths…] } }`; the shared shell view
  fetches it via `remote-internal.getSshFoldersHistory`. remote-ssh records
  from its resolver success path; we record at open-command time and at
  activation of windows already on an `incus+…` authority (a loading window
  has no workspace at resolve time — activation is our equivalent moment).
- **session marking + always expanded** (screenshot-verified UX): the live
  session is marked with a green check-dot on BOTH the connected container's
  icon and its connected folder row, and the tree renders expanded by
  default even when not connected. TreeItems cannot overlay badges on
  ThemeIcons; we ship unchanged public `microsoft/vscode-icons` SVGs for
  `vm-active` (connected), `folder`, and `folder-active` in
  `assets/light|dark/`. Disconnected instances use the built-in `vm-running`
  or `vm` ThemeIcon. The original Dev Containers asset copies were replaced
  on 2026-10-23 with CC BY 4.0 assets; source revision, attribution, and
  bundled license are recorded in `ThirdPartyNotices.md`. The session is
  derived per window from
  `vscode.env.remoteAuthority` + the workspace folder whose authority
  matches it.
- **our wiring**: `src/history.ts` (key `remote-incus.folder.history.v1`,
  dedup, most-recent-first, cap 10 per instance); instances with history
  render collapsible with `FolderNode` children (full path as label);
  `connectToInstance` opens `folders[0]` when present, else the empty-window
  host connect; `removeFolderFromHistory` mirrors `removeRecentFolder` /
  `deleteFolderHistoryItem`.

Incus version & packaging findings (2026-10-20 evening — the user fully
reinstalled the local daemon from the zabbly repo, CLI 6.0.5→7.5.1; planned
compat layer in §14):

- `incus list <remote>:<name>` (glued positional filter): CLI 6.0.5 matched;
  CLI 7.5.1 returns NOTHING (hint: "did you forget a space") — the resolver
  pre-flight then misread the healthy instance as deleted ("instance
  fixture-remote:fixture-container not found" error toast). Universal form
  `incus list <remote>: <name>` (separate args) verified on BOTH CLIs;
  `getInstanceStatus` now uses it plus an exact-name `find` (the positional
  filter is fuzzy — another instance must never be picked, isolation rule).
  Operational subcommands (exec/file/start/stop/restart) still accept
  `<remote>:<name>` on both — only `list`'s filter changed.
- the OLD local daemon 6.0.5 (Ubuntu-archive deb) on a Ubuntu 26.04 host
  denied EVERY in-container signal — EACCES even for root (`kill -0 $$`
  failed), breaking systemd's own service management inside the container.
  Root cause: Ubuntu 25.04+ AppArmor hardening
  (`kernel.apparmor_restrict_unprivileged_unconfined=1`) + the Ubuntu
  packaging missing the compat sysctl the zabbly packaging ships
  (`/etc/sysctl.d/50-incus.conf`; Launchpad #2109394). The host audit log
  captured `apparmor="DENIED" operation="signal"` with the STACKED peer
  label `incus-<name>//&unconfined` — the generated profile's
  `signal peer=@{profile_name}` rule doesn't match stacked peers.
- VS Code server children (ext host, pty host, file watcher) poll their
  parent with `kill(parentPid, 0)` and treat ANY error as "parent gone"
  (upstream source verified: extensionHostProcess.ts + bootstrap-fork.ts +
  native-watchdog — NO flag/env disables it) → the observed death loop:
  `ptyHost terminated unexpectedly with code 0` every ~5 s, terminals
  restarting ("connection to the shell process was lost").
- fix applied: zabbly incus 7.5.1 host-side (sysctl file present, value 0);
  the kill probe re-verified OK on the same Ubuntu 26.04 image that
  previously death-looped.
- kernel RULED OUT as the differentiator: the identical kernel build
  7.0.0-38-generic runs on the broken local host AND on the working fixture-remote
  cluster member member-b.
- new pre-flight `probeSignalSupport` (bootstrap.ts): one exec
  (`kill -0 $$` as the target user) BEFORE any transfer/start work and on
  every ensure path (a death-looping server still "runs" — the reuse path
  must be covered); failure refuses loudly with the remediation text.
- **sticky-/tmp trap in the extract flow** (found by the user's first
  fully-fresh install on `firm-buffalo`, 2026-10-20 evening): the tarball
  push ran as ROOT (`/tmp/vscode-server-….tar.gz`, root:root) while
  `ensureExtracted` runs as the target user — its final `rm -f` in sticky
  /tmp (1777) fails EPERM and aborts an otherwise complete extract (the
  marker was already written; fixture-remote never hit it because its install was
  spike-era — the extract path had never been exercised end-to-end).
  Fix: push AS THE TARGET USER (`--uid/--gid`); verified end-to-end by the
  new windowless harness `scripts/fresh-install-test.ts` against a
  throwaway 24.04 instance (download → user-push → extract → marker →
  tmp cleaned → relay/token 0600 → port → session). Measured on the local
  daemon: 217 MB push ≈ 1 s (~200 MB/s unix socket) vs fixture-remote's 2.1 MB/s
  TLS websocket ceiling.

### Task 4 real-behavior verification (2026-10-23)

Task 3 completion/discussion was confirmed before Task 4. Real generated bash
and bundled-relay checks passed, including failure propagation and bounded
cleanup. Authorized local and TLS cluster fixtures passed signed management
handshakes, ownership/mode/content assertions, healthy reuse with live parallel
channels, ordinary startup, wiped-install/token recovery, reset and synthetic
stale-process replacement. The local run also requires fresh channel traffic
after reuse returns. This does not test an actual old server binary.

Stable 1.143.1 development windows passed files, integrated/rescue terminals,
remote Restricted Mode, history removal, distinct-folder concurrent windows
and reload/one-step reconnect. At Task 4 completion, two findings remained: an already-open identical
folder is reused despite a new-window request; Ports is unavailable, so the
forwarded application path remains unverified. Runtime-source inspection and
reproductions are recorded in [TASK-04-RESULTS.md](TASK-04-RESULTS.md).

No production code or frozen policy was changed. Test fixtures/processes,
private profile and temporary artifacts were cleaned. The user subsequently
discussed the results and resolved the Task 4 discussion gate. These findings were open at Task 4 completion and were subsequently addressed
by the follow-ups below. The original results report remains historical evidence.

### Identical-folder window follow-up (2026-10-24)

The user authorized the fix and explicitly chose a separate workspace for
new-window folder requests. Core finds an existing folder window before
applying `forceNewWindow`, so a boolean-to-options change cannot solve this.
`src/workspace.ts` now creates a unique client-local `.code-workspace` file
containing exactly the target remote URI and its `remoteAuthority`, then opens
that workspace with `forceNewWindow`. The authority field is essential: a
local workspace file containing only remote folder URIs opens without the
remote filesystem provider in the tested runtime. This follows the distinct
workspace identity used by VS Code's Duplicate As Workspace action.

Both folder-row and remembered-folder instance commands use this path.
Current-window commands and instances without folder history retain their
existing delegation. Each successful request retains its private workspace
file under extension global storage for reopening; failed requests remove
only their generated directory. Automatic pruning is deliberately absent
because it could invalidate a workspace retained in VS Code's recents.
No remote project file, transport, token or user policy changes.

A separate Stable 1.143.1 development profile verified three distinct windows
on the exact same TLS/cluster fixture folder: original folder, instance-action
workspace and folder-action workspace. All three concurrently read the exact
remote marker; the path contained spaces, hash, question mark and Unicode.
The first attempt omitted remote authority metadata and failed; it is not
counted as a pass. See [HANDOVER.md](HANDOVER.md) for current status and limits.
The user manually confirmed the normal-profile identical-folder new-window
workflow on 2026-10-25. Ports controls and the IPv4 helper also subsequently
received normal-profile manual acceptance; see the handover for their scope.

## 9. Distribution & licensing constraints

- Extension source: MIT (copies may come from MIT sources: `jeanp413/open-remote-ssh`,
  `microsoft/vscode` test-resolver sample).
- **VS Code Server is proprietary**: bundling _download + install logic_ for personal
  developer use is fine; building a hosted service on it is not (server license
  aka.ms/vscode-server-license). The extension never redistributes the binary — it
  fetches from the official URL at runtime.
- Marketplace: the documented policy excludes proposed-API extensions.
  Use VSIX sharing; Open VSX is a prospective additional registry, with
  comparable proposed-API extensions already listed. Acceptance is not
  guaranteed. Stable builds need the one-time `argv.json` opt-in
  (spike-verified). See [distribution research](ALTERNATIVES.md#distribution-implications).

## 10. Support matrix (MVP)

This separates implemented selection and declared ranges from verified runtime
coverage. Earlier evidence does not establish every intermediate version.

| Dimension                    | Current evidence                                                                                               | Remaining limits                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Client OS/architecture       | Linux x64                                                                                                      | macOS, Windows and ARM64 clients unverified                                                                            |
| Client version               | Scoped Stable 1.143.1 checks; historical Stable 1.142.0 evidence                                               | Manifest range `^1.140.0` is a declaration, not full range verification; Insiders unverified; proposed APIs can change |
| Proposed APIs                | `resolvers`, `contribViewsRemote`, `tunnels`; typings pinned to 1.143.1                                        | Stable requires explicit opt-in; registry eligibility must be checked before publication                               |
| Daemon transport             | Local Unix socket and remote TLS/cluster fixtures                                                              | Restricted remotes/projects unverified                                                                                 |
| Incus CLI/server             | Scoped 7.5.1 checks; historical 6.0.5 evidence                                                                 | Packaging can block signals (§14); no exhaustive version/package matrix                                                |
| Instance architecture/libc   | Ubuntu glibc x64 and Alpine 3.24 musl x64 checks                                                               | glibc ARM64 selection implemented but unverified; musl ARM64 rejected                                                  |
| Shell/runtime                | `/bin/sh`, including BusyBox without Bash; Alpine prerequisites and normal-profile terminal workflows verified | Required runtime libraries/utilities must already be installed; rescue terminal needs util-linux `script`              |
| Ports                        | Core forwarding plus selected-row IPv4 helper; normal-profile manual acceptance on 2026-10-25                  | Ordinary IPv4-loopback forwarding can fail with IPv6-only external networking; helper needs an existing Ports row      |
| Identical-folder new windows | Isolated concurrent/reopening checks plus normal-profile manual acceptance on 2026-10-25                       | Uses retained local workspace files; no automatic pruning                                                              |
| Diagnostics                  | Resolver classification and startup prerequisite regressions; scoped live startup checks                       | Error-dialog UX has not been reverified live; runtime probe does not cover every later startup failure                 |

## 11. Open questions (recorded, with leaning)

1. Final product naming/publisher (working title "Remote - Incus") — TBD before OpenVSX.
2. ~~`contribViewsRemote` tree-view wiring~~ **Verified 2026-10-19** (see §8).
3. Per-connection `--env`/`--cwd` surface for future devcontainer.json support — Phase 3.
4. Multi-user-in-one-instance semantics (concurrent different-uid attaches) — Phase 2.
5. Download-URL override is implemented for `auto`/`client`; explicit container
   mode rejects custom mirrors. Mirrors still require a reachable endpoint.

## 12. Phase-1 implementation status and deferred work

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
   command and resolver classification are implemented. Deleted instances map to
   `NotAvailable` with tree refresh; starting states map to
   `TemporarilyNotAvailable`; unexpected failures retain their cause. Startup
   prerequisite probes and missing rescue-terminal `script` guidance are also
   implemented. Offline and scoped live evidence is in the handover; error-dialog
   UX remains unverified live.
6. Tests: Task 3's 80-test correctness gate and Task 4's real shell/relay,
   explicit-target local/TLS handshakes and Stable development-window checks
   are complete within their recorded scope. See [Task 4 results](TASK-04-RESULTS.md).
   Ports and identical-folder follow-ups have passed scoped checks and
   normal-profile manual acceptance. Alpine musl x64 and Bash-free terminal
   follow-ups also passed. Insiders, ARM64 and additional image/version
   combinations remain unverified. Private fixtures
   are manual runtime inputs, never CI dependencies. Do not begin further
   testing or optimization without explicit next-step authorization.
7. Packaging pipeline: lockfile-installed VSCE, production prepublish build,
   actual-archive policy checks and headless local-fixture CI are implemented.
   Hosted CI execution remains unverified. Final identity and distribution
   eligibility/route are deferred; registry publication is separately authorized.
8. Incus version-compat layer (design sketch §14 — NOT yet implemented):
   version probe, behavioral adapter table, per-member/per-instance feature gates.

## 13. Phase-0 archive

The original proof-of-concept implementation has been removed from the working
tree. It is preserved in sanitized Git history; it is not a runtime, build or
test dependency. Its verified architectural findings remain in §8 and the
[historical summary](spike/README.md).

Current bootstrap and relay implementations live in `src/bootstrap.ts` and
`assets/relay.js`. Current verification uses `tests/` and the opt-in verifiers
in `scripts/`. The manual development deployment helper is
`scripts/redeploy.sh`.

## 14. Incus version & packaging compatibility (centralized layer deferred)

Trigger (2026-10-20): the user's full reinstall of the local daemon from the
zabbly repo bumped the CLI 6.0.5→7.5.1 and broke two assumptions in one go
(§8). Version and PACKAGING differences must become explicit and versioned,
not rediscovered.

The centralized version probe, adapter table and feature gates below remain
unimplemented. Individual compatibility fixes are already implemented: universal
list syntax, 7.x push progress, signal probes and resolver classification. This
proposal is optional follow-up architecture, not evidence that those fixes are
missing. Later-phase multi-user and devcontainer.json work in §11 is future
scope. Current reported bugs and deferred release work are tracked in the
[handover](HANDOVER.md#current-task-status-2026-10-25).

### 14.1 Verified version-dependent behaviors

| surface                                                     | CLI 6.0.5                               | CLI 7.5.1                                                                                                                                                                                                                                                                                | universal form                                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `incus list <remote>:<name>` glued filter                   | matches                                 | no matches ("did you forget a space")                                                                                                                                                                                                                                                    | `incus list <remote>: <name>` — verified both; add exact-name find                                                                |
| `incus <op> <remote>:<name>` (exec/file/start/stop/restart) | ok                                      | ok                                                                                                                                                                                                                                                                                       | —                                                                                                                                 |
| `incus file push` progress meter                            | prints `<n>% (<speed>)` even when piped | prints NOTHING when piped — 7.x push is SFTP-based (`sftpCreateFile`), the meter is TTY-gated (`shared/cmd/progress.go` `Update()` returns unless stdout is a terminal), and a file push creates NO operation (no progress metadata to poll; verified 2026-10-22, piped and under a pty) | poll the growing target file in-instance (`stat -c %s`, 1 Hz) — the SFTP writer extends it in place; keep the meter parse for 6.x |

| host stack                                                      | in-container signals          | cause                                                                                                                                       |
| --------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Ubuntu-archive incus deb 6.0.5-8, Ubuntu 26.04 host             | ALL denied, EACCES incl. root | Ubuntu 25.04+ hardening `kernel.apparmor_restrict_unprivileged_unconfined=1`; Ubuntu packaging lacks the compat sysctl (Launchpad #2109394) |
| zabbly incus 7.5.1, kernel 7.0.0-38 (local and cluster fixture) | fine                          | zabbly ships `/etc/sysctl.d/50-incus.conf` (= 0)                                                                                            |

Gotcha: server version ≠ instance behavior. A tested cluster mixed
Ubuntu 24.04/kernel 6.8 and kernel 7.0.0-38 members; what an
instance sees depends on the member hosting it (`location`), so probes and
compat decisions must be per-instance (or per-location), never per-remote.

### 14.2 Design direction (§12 item 8)

1. **Version probe** at activation and re-probed on remote errors: client
   version + server version per remote; for clusters, per member. Stored as
   structured `IncusVersionInfo`, cached per session.
2. **Behavioral adapter table in code** (§14.1 shape), keyed by detected
   version(s); CLI calls go through named adapters
   (`listInstanceStatus`, `listRemoteInstances`, …) instead of raw strings.
   Baseline rule: ALWAYS prefer a universal form; version-gate only when no
   universal form exists.
3. **Feature gates by server version**: `incus port-forward` ≥ 7.3 (now
   REACHABLE — both daemons at 7.5.1; re-evaluates the §2 phase-2 transport
   note), proxy-device hotplug, project scoping, etc.
4. **Pre-flight guards** per instance (signal-support probe implemented
   2026-10-20; setup-tool and executable runtime probes implemented §3; future: probe host OS +
   packaging variant and warn on known-bad combos).
5. **Error taxonomy**: changed CLI semantics (empty match sets, new warnings)
   must map to precise, actionable resolver errors — never silently degrade
   into "not found" (the 2026-10-20 regression did exactly that).
