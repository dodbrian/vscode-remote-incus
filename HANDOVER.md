# HANDOVER — for the next agent

You are taking over **"Remote - Incus"**: a VS Code extension that adds Incus
containers (system containers; Incus = community fork of LXD) as a first-class
remote connection type — the slot Dev Containers / Remote-SSH occupy in the
Remote Explorer. Goal: "connect to a remote Incus container as seamlessly as
with a Docker container".

## Read order

1. `DESIGN.md` — **the canonical architecture document**, frozen after the
   Phase-0 spike. Full design (transport, bootstrap, token, user policy, relay
   lifecycle, error taxonomy), the complete evidence ledger (§8 — including
   all Phase-1 findings), constraints, support matrix (§10 — incl. the
   client-version row), open questions (§11), and the Phase-1 plan (§12).
   Do not re-derive any of it.
2. This file — operational context: environment snapshot, dev loop,
   debugging traps, and exactly where to resume.

## Current state (session end 2026-10-20 late evening, main, clean tree)

Deltas on top of `0dcb016` (previous handover), all verified on stable
1.142.0: `5f64f05` (tree connect affordances at Remote-SSH parity +
single-flow connect), `0e61725` (exec failures diagnosable + non-fatal
prune), `d95120d` (relaunch waits for clean exit), `128621b` (signal-
support pre-flight — Ubuntu 25.04+/packaging AppArmor trap),
`41b8712` (push tarball as the target user — sticky-/tmp fix),
`67167ea` (CLI 7.x list-filter regression), `80ef6be` (windowless
fresh-install harness), `52c3e50` (DESIGN §14 version-compat sketch),
`8d22af6` (Dev Containers tree UX — no row-click connect, icon-less
remote nodes), `a7761a2` (push progress restored on CLI 7.x),
`22a336d` (ever-opened folders + one-go reconnect), `90d38c5` +
`52bb622` (green check-dot session marking; exact Dev Containers icons;
authority-aware active row).

- Phase 0 (spike) **COMPLETE** — all hypotheses validated in real windows
  (DESIGN §8). Spike extension uninstalled from the user's VS Code; source
  stays committed under `spike/` as reference.
- Phase 1 items 1–4 **COMPLETE, user-verified on stable 1.142.0**:
  1. TypeScript + esbuild project at repo root (`src/`, bundle `dist/extension.js`,
     relay as bundled asset `assets/relay.js`; proposal d.ts committed in
     `src/types/` pinned to tag 1.142.0, base types `@types/vscode@1.140.0`
     = newest on DefinitelyTyped; engines `^1.140.0`).
  2. Remote Explorer tree (switcher form, `remoteName: "incus"`,
     `group: "targets@1"`): remotes → instances, state icons, graceful
     "unavailable:" leaves; commands: connect, start, stop, restart,
     kill server, uninstall server, reset token, open terminal (exec),
     collect diagnostics, refresh. User signed off on rendered UX.
     Connect affordances now at DEV CONTAINERS UX (amended 2026-10-22,
     user-requested — replaces the 2026-10-20 Remote-SSH-parity wiring):
     row click does NOT connect (click only selects); connect happens ONLY
     via the right-side hover icons — `$(arrow-right)` = CURRENT window,
     `$(empty-window)` = NEW window (titles verbatim from the official
     Remote Explorer 0.5.0 manifest); a stopped instance is still started by
     the resolve; Start/Stop live in the context menu; connect commands
     hidden from the command palette; remote nodes show no icon.
     Ever-opened FOLDERS under each instance + one-go reconnect
     (2026-10-22, user-requested, Dev Containers UX): instance nodes with
     folder history render collapsible children (full path label, three
     hover icons: open current window / new window / remove from history);
     connecting an instance opens the LAST used folder directly
     (`vscode.openFolder` on a `vscode-remote://` URI — folder is the URI
     path, invisible to the resolver); history in extension globalState
     (`src/history.ts`, key `remote-incus.folder.history.v1`, cap 10),
     recorded at open-command time and at activation of windows already on
     an `incus+…` authority.
     Session marking + always expanded (2026-10-22, screenshot-verified
     UX): the connected instance icon and its connected folder row carry a
     green check-dot (baked into per-state SVG icons in `assets/`,
     mirroring Dev Containers — ThemeIcons cannot carry overlays), and the
     tree defaults to fully expanded even when not connected.
  3. Bootstrap module (`src/bootstrap.ts`) — client-side cached download
     (globalStorage, sha256 sidecar), sha-gated path-mode push, idempotent
     extract as target user (`.incus-install-ok` marker), sticky 0600 token,
     detached start, port discovery from server.log, stale-commit restart,
     zombie detection before reuse, orphan-relay sweep after fresh starts,
     pruning of superseded in-instance installs + client cache entries.
  4. Progress UX (user-requested): connection/setup runs under a notification
     toast with a progress bar; title embeds a clickable "(show log)" link
     → `remote-incus.showLog` command → output channel; download % from
     content-length, push % from polling the growing target file's size
     (1 Hz `stat -c %s`) with the 6.x CLI meter as a secondary source —
     CLI 7.x (≥ SFTP push) prints NO meter when piped and creates no
     operation (TTY-gated renderer; DESIGN §14.1); percent-first messages
     (collapsed-toast truncation cuts from the right). Error toasts carry
     the same link.
     **Single flow** (2026-10-20): the toast belongs to the RESOLVE now —
     the tree-connect command only delegates to `vscode.newWindow`; the
     whole bootstrap runs exactly once inside the post-reload resolve
     (core restarts the ext host ≤ 1 s after the command).
- Working extension id: **`local-dev.remote-incus` v0.1.0** (placeholder
  publisher — naming is DESIGN §11.1, decide before OpenVSX). Installed in
  the user's VS Code; `~/.vscode/argv.json` grants it the proposals (spike id
  entry also still listed, harmless).
- Verified live this session (all on stable 1.142.0):
  - first connect ran the full 222 MB install inside resolve; core waited
    132 s with no resolve timeout; reconnect ≈ 17 s; install-present connect
    ≈ 16 s with zero transfer.
  - untrusted workspace (Restricted Mode): with
    `capabilities.untrustedWorkspaces.supported: true` the tree works
    pre-trust, exactly like Remote-SSH (screenshot-verified by the user).
  - zombie recovery: wiped `~/.vscode-server` while the server ran → detected
    ("lost its install (zombie) — killing and starting fresh") → connected.
  - stale-commit restart: simulated old-commit server (fake dir + `exec -a`
    cmdline with a true 40-hex id) → "runs stale commit 0123456789… —
    restarting under 6d62b1d5da…" → fresh server, old dir pruned, connected.
  - 2026-10-20 session: both hover icons + tooltips + context-menu order
    verified by the user; click → current window, `$(empty-window)` → new
    window; SINGLE flow per click (click → ext-host restart ≤ 1 s → one
    resolve flow ≈ 16-20 s → bridges); stopped-instance click starts and
    connects through the resolve pre-flight; stopped instance's automatic
    re-resolve loop also verified (instance stop mid-session → bridges die
    → core re-resolves → "starting …" → fresh server, new port picked up).
  - 2026-10-22 session (on stable 1.143.0, commit `2d0b7506…`): Dev
    Containers tree UX verified by the user — row click = selection only
    (no connect), both hover icons connect, remotes render without an
    icon; CLI 7.x push progress verified end-to-end in a real window
    (server wiped → zombie kill → cache-hit push of 222 MB ≈ 2 min with
    the toast bar crawling 30→90% → extract → fresh server); ever-opened
    folders + one-go reconnect verified (folder children render with the
    three official-order hover icons, connecting lands straight in the
    last-used folder, remove-from-history works).
  - one transient exec failure seen once (prune step, ~10 s then nonzero)
    — unreproducible standalone or with 2 live bridges (daemon/link hiccup,
    suspected); it aborted the connect then — now non-fatal and diagnosable.
  - 2026-10-20 evening (after the user reinstalled the local daemon from
    the zabbly repo — CLI/daemon 6.0.5→7.5.1): connect to a fresh local
    instance verified by the user (single flow, stable terminal) on the
    signal-probe build. THEN the user's first FULLY-FRESH install exposed
    two more defects, both fixed and verified:
    - sticky-/tmp: root-pushed tarball undeletable by the extract user
      (EPERM) — fixed by pushing as the target user; verified END-TO-END
      by scripts/fresh-install-test.ts against a throwaway 24.04 instance
      (download → user-push ≈ 1 s on the local unix socket vs 2.1 MB/s
      TLS on fixture-remote → extract → marker → tmp cleaned → 0600 files →
      port → session), then user-verified in a real window on another
      fresh instance.
    - CLI 7.x list-filter regression ("instance not found" on a healthy
      instance) — universal form + exact-name find; verified via the
      harness + a real resolve.
  - the death-loop investigation itself (ptyHost terminated unexpectedly /
    kill EACCES / restarting terminals) is documented in DESIGN §8 with
    the audit-log root cause and the zabbly fix (see the environment
    snapshot above).
- Remaining Phase-1 work (DESIGN §12): item 5 diagnostics refinement —
  error-surfacing + signal pre-flight DONE 2026-10-20 (IncusError leads
  with cause; full detail in log; prune non-fatal; kill-probe refuses
  signal-blocked instances), remaining = `RemoteAuthorityResolverError`
  taxonomy polish for the §7 table; item 6 tests — the windowless
  fresh-install harness (§12.6 mechanics base) landed, full mechanics/
  contract/matrix suites open; item 7 packaging (CI VSIX + OpenVSX +
  README). Naming decision (§11.1) before OpenVSX. Item 8 (§14 version
  compat layer) planned, not implemented.
- Repo: `/path/to/repository`, git `main`.

## Environment snapshot (verified facts — updated 2026-10-20 evening)

- **incus 7.5.1 client + server on this host** (zabbly repo since the
  2026-10-20 evening reinstall; was Ubuntu-archive 6.0.5). The local unix
  socket IS group-accessible now (user `<local-user>` joined the `incus` group —
  the old EACCES note is obsolete). `incus port-forward` is available
  (≥ 7.3) but NOT used — exec-stdio bridges stay the transport (frozen).
- **Incus version/packaging trap**: Ubuntu-archive incus debs on Ubuntu
  25.04+ hosts deny every in-container signal (AppArmor hardening +
  missing compat sysctl — Launchpad #2109394); the extension pre-flights
  this (`probeSignalSupport`) and design sketch §14 plans the general
  version-compat layer. See §8 for the full evidence.
- **The default incus remote is still `fixture-remote`** — which is now known to be
  a 2-member CLUSTER: member `fixture-remote` (192.0.2.10, Ubuntu 24.04/kernel
  6.8) and member `member-b` (192.0.2.11, Tailscale, kernel 7.0.0-38).
  `fixture-container` runs on member `member-b`. Address instances as
  `<remote>:<name>`; never assume a member.
- **VS Code stable 1.143.0** (commit `2d0b7506…` as of 2026-10-22), weekly
  auto-updates.
- Node v24.21.0 / npm 11.19.0; esbuild + tsc + @vscode/vsce devDependencies.
- Companion container: **`fixture-container`** (cluster member `member-b`, Ubuntu
  24.04, RUNNING):
  - `~ubuntu/.vscode-server` holds the 1.142.0 install (commit dir +
    `.incus-install-ok` marker), the staged relay at
    `~ubuntu/.vscode-server/relay.js`, the 0600 token at
    `data/Machine/.incus-conn-token`, log at `data/Machine/server.log`.
  - Server NOT running right now: it **exits promptly after a graceful
    client disconnect** (log-verified 21:56:33) and lingers with the default
    3 h reconnection grace only after ungraceful deaths. Next connect
    re-starts it via the fast path (~15-20 s). No correctness impact; do not
    "fix" this.
  - **No sshd / no openssh — keep it that way.**
- Client-side tarball cache:
  `~/.config/Code/User/globalStorage/local-dev.remote-incus/server-cache/`
  (217 MB tarball + sha sidecar for the current commit).
- Local test instance: **`local-fixture`** (RUNNING on the local daemon,
  Ubuntu "resolute" daily image; `previous-local-fixture` was wiped — recreated
  under a new random name, presumably by the user 2026-10-22). Earlier
  test instances (`previous-local-fixture`, `previous-fixture-a`, `previous-fixture-b`,
  `signal-fixture`) were lost in the 2026-10-20 daemon reinstall.

## ISOLATION RULE (important)

The user's Incus daemon also runs **production instances** (`production-instance-a`,
`production-instance-b`, `production-instance-e`, `production-instance-c`, `production-instance-d` — some with Docker
inside). **Never touch, stop, or configure them.** All testing targets
`fixture-container` only. When enumerating instances in code/tests, filter or
select explicitly; never "first instance".

## Dev loop

- `./redeploy.sh` — build, package, install, restart VS Code, reopen the
  remote window on `--remote=incus+fixture-remote:fixture-container /home/ubuntu`.
- Extension log: `/tmp/remote-incus-dev/fixture-container/ext.log` (via
  `REMOTE_INCUS_DEBUG_LOG`, which redeploy.sh sets) plus the
  "Remote - Incus" output channel.
- Offline smoke: `npx esbuild scripts/smoke.ts --bundle --platform=node
  --alias:vscode=./scripts/vscode-stub.js --outfile=/tmp/remote-incus-dev/smoke.js &&
  node /tmp/remote-incus-dev/smoke.js` (authority round-trips + read-only daemon probes).
- Chain deploy steps with `&&`, not `;` — a `;` chain once relaunched a
  window with STALE code after a failed typecheck (cost: confusing session).
- **Committing + harness-verifying is NOT deployment** — the running windows
  only pick up src changes via `./redeploy.sh` (cost one user-visible round:
  a committed, harness-verified fix was still un-deployed and the user
  re-hit the bug).
- Server commit = local client commit: `vscode.env.appCommit` (resolvers
  proposal), fallback `code --version` line 2. Do NOT parse
  `update.code.visualstudio.com/api/commits/...` (returns a JSON array).

## Debugging traps (each cost real time — don't rediscover)

- **Untrusted-workspace trap**: a window on a never-trusted remote folder
  starts in Restricted Mode; the extension is "disabled because the current
  workspace is not trusted", its views contribution is DROPPED, and
  `registerTreeDataProvider` toasts "No view is registered with id: …" —
  while the resolver still runs (core special-cases resolver activation).
  Looks like a manifest/proposal bug; the fix is
  `"capabilities": { "untrustedWorkspaces": { "supported": true } }`.
- **Authority separator is `:`, not `/`**: `vscode-remote://` URIs end the
  authority at the first slash; use `incus+<remote>:<instance>`.
- **Zombie servers**: deleting `~/.vscode-server` while the server runs leaves
  a live process with no install/token/log; a process-only reuse check
  "reuses" it and hangs 60 s in port-wait. The on-disk health check in
  `src/bootstrap.ts` handles it — do not remove it to "simplify" reuse.
- **`pkill -f`/`pgrep -f` self-match**: the pattern AND any text inside the
  same `bash -c` payload are match surface. Bracket-class every pattern and
  keep payloads name-free — including throwaway diagnostic one-liners
  ("2 relays" / "1 node proc" artifacts this session were my own payloads).
- **`pgrep -f` output order is readdir-based, not pid-sorted** — never depend
  on ordering; the running-server probe collects ALL 40-hex commits and dedups.
- **Validate test fixtures before trusting a negative result**: the first
  fake-commit simulation used a 42-hex id; the probe's `{40}` regex correctly
  ignored it, which looked like an extension bug. (Fixture lesson: count your
  fake ids.) Useful simulation trick that DID work:
  `bash -c 'exec -a "<fake cmdline>" sleep 600'` inside `incus exec`.
- **core restarts the extension host within ~1 s of `vscode.newWindow`** and
  fresh-resolves the authority there; bridges are ext-host-owned and never
  survive a reload. Consequence: bootstrap work pre-run in the connect
  command runs TWICE (log-verified ~18 s + ~23 s) — the connect command now
  only delegates; never re-add a pre-flight (DESIGN §8, 2026-10-20).
- **Error line 1 must lead with the CAUSE (stderr/status), never the command**:
  toasts and `firstLine()` cut at the first `\n`; a multi-line command joined
  into line 1 hid the stderr everywhere (cost one undiagnosable failure).
  `IncusError` now reads `incus <target> --<inline script> failed (exit N /
  timed out): <stderr line 1>`; catches log the FULL message, toasts take
  `firstLine()`.
- **"Another instance of Code is running but not responding" modal**: relaunch
  raced a half-dead pkilled instance; Code processes can ignore SIGTERM
  entirely (one needed `kill -9`). `redeploy.sh` now polls `/proc/*/exe`
  until no code process remains before launching — keep that loop.
- **Collapsed progress toasts truncate title+message as one line** — put the
  percentage at the START of progress messages.
- CLI flags only apply to NEW windows; restart to a single fresh instance
  when debugging resolver flows (`ls -l /proc/[0-9]*/exe | grep -c 'code/code'`).
- Direct `incus exec` args expand `~` on the CLIENT — pass absolute paths.
- **CLI 7.x rejects the glued `incus list <remote>:<name>` filter** (empty
  result set + "did you forget a space" warning; CLI 6.x matched) — the
  resolver pre-flight then misreads a healthy instance as deleted. Always
  pass the remote and the instance filter as separate arguments and
  exact-match the result (general rule for the version-compat layer, §14).
- `PendingMigrationError: navigator is now a global in nodejs` from unrelated
  extensions — harmless noise.
- System locale is German — expect German OS/CLI error strings (incus daemon
  messages are English).
- **No CLI screenshot tooling** (GNOME Wayland). View verification is
  user-in-the-loop; log signals: activation lines in
  `~/.config/Code/logs/<session>/window*/exthost/exthost.log`, absence of the
  "No view is registered" renderer error, and the debug log file.
- `@types/vscode` stops at 1.140.0 (DefinitelyTyped lag); pull proposal d.ts
  from the vscode repo tag instead (done, committed in `src/types/`).

## Version model (client ↔ server)

- Server commit is read fresh at EVERY resolve; nothing pins the client.
- Client update → new commit → install alongside → stale-commit server
  killed → fresh start (token sticky) → superseded dirs + caches pruned.
- Proposal d.ts verified byte-identical 1.140→1.142; live-verified on 1.142.0.
- Residual risk: proposal-shape change in a future client → extension fix
  release; the runtime guard errors loudly (never silently).

## Phase 1 — remaining work (DESIGN §12)

1. ~~Project / tree+commands / bootstrap / progress UX~~ **DONE 2026-10-19**.
2. Diagnostics refinement (§12.5): error-surfacing done 2026-10-20 (IncusError
   leads with stderr/exit status, catches log full detail, prune non-fatal);
   open: `RemoteAuthorityResolverError` usage for the §7 taxonomy (deleted
   instance → NotAvailable unresolvable, starting → TemporarilyNotAvailable, …).
3. Tests (§12.6): mechanics harness against `fixture-container`; resolver contract
   on stable; matrix smoke x64/arm64 (Ubuntu/Debian) — mind the ISOLATION RULE.
4. Packaging (§12.7): CI-built VSIX + OpenVSX publish + README argv step
   (README stub exists). Decide final naming/publisher (§11.1) first.

Open questions live in DESIGN §11. **Do not** reopen settled matters —
transport, token policy, and user policy are frozen after evidence.

## Conventions on this machine

- Before creating/naming ANY git commit, read `~/.agents/AGENTS.md` and
  `~/.agents/skills/commit-naming/SKILL.md` and follow them (subject
  `<type>(<scope>): <essence>`, ≤72 chars, body for detail, split logical
  changes into separate commits).
- Discuss with the user before big direction changes; they review evidence
  before code (the rhythm: research → adversarial audit → spike → freeze → build).
- Prefer parallel subagents for research bursts; require URL-cited, verified
  claims; mark UNVERIFIED explicitly.
- Keep spike artifacts as reference (inventory in DESIGN §13); committed and
  deliberately NOT production code.

## Quick file map

```
DESIGN.md                  canonical architecture + findings + plan
HANDOVER.md                this file
package.json               extension manifest (proposals, views, commands, settings)
tsconfig.json / esbuild.js build config (bundle → dist/extension.js)
redeploy.sh                dev loop: build + package + install + relaunch
src/
  extension.ts             activate: resolver + tree + commands wiring
  authority.ts             `incus+<remote>:<instance>` parse/format
  incusCli.ts              typed incus CLI wrapper (exec, push+meter, list, lifecycle)
  bootstrap.ts             install/start/token/port (spike flow, inlined; reuse hardening)
  bridge.ts                exec-stdio → ManagedMessagePassing
  resolver.ts              RemoteAuthorityResolver + pre-flight
  tree.ts                  Remote Explorer tree (remotes → instances)
  commands.ts              tree commands (connect/start/stop/kill/uninstall/…)
  terminal.ts              escape-hatch exec terminal (script-PTY)
  progress.ts              connection progress toast (log-link title, reports)
  logging.ts               output channel (+ REMOTE_INCUS_DEBUG_LOG mirror)
  types/                   proposal d.ts pinned to vscode 1.142.0
assets/relay.js            bundled relay (staged in-instance per install)
scripts/                   smoke harness + vscode stub
spike/                     Phase-0 artifacts (reference only)
```
