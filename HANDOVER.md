# HANDOVER — for the next agent

You are taking over **"Remote - Incus"**: a VS Code extension that adds Incus
containers (system containers; Incus = community fork of LXD) as a first-class
remote connection type — the slot Dev Containers / Remote-SSH occupy in the
Remote Explorer. Goal: "connect to a remote Incus container as seamlessly as
with a Docker container".

## Read order

1. `DESIGN.md` — **the canonical architecture document**, frozen after the
   Phase-0 spike. It contains the full design (transport, bootstrap, token,
   user policy, relay lifecycle, error taxonomy), the hands-on findings ledger,
   constraints, support matrix, open questions, and the Phase-1 plan (§12).
   Do not re-derive any of it.
2. This file — adds operational context the design doc does not carry:
   environment snapshot, dev loop, debugging traps, and exactly where to resume.

## Current state (as of commit after `cb051c7`)

- Phase 0 (spike) **COMPLETE** — every architectural hypothesis was validated
  in a real VS Code window (see DESIGN.md §8 evidence ledger):
  - resolver + `ManagedResolvedAuthority` contract works; core dialed
    `makeConnection()` twice (management + ext host) and held both channels;
    terminal PTY multiplexes over the management channel.
  - server installs & runs as unprivileged uid 1000 with **no** openssh packages;
    client-side tarball download + sha256-verified path-mode `incus file push`.
  - version mismatch is detected/reported cleanly by core
    ("Client refused: version mismatch").
  - VSIX + `enable-proposed-api` in `~/.vscode/argv.json` works on stable.
- Phase 1 item 1 (tree contract) **COMPLETE** (2026-10-19): `contribViewsRemote`
  tree view verified inside the Remote Explorer on stable 1.142.0 — container key
  `"remote"`, `group: targets@1` sorts first, no-`remoteName` view always visible,
  `vscode.newWindow` connect-from-tree worked and re-dialed the resolver ×2
  (evidence in DESIGN.md §8). Spike ext is at 0.0.2 with the tree + connect +
  start/stop/refresh commands.
- Remaining Phase 1 work: TypeScript + esbuild project structure (next), bootstrap
  module, diagnostics, tests, packaging.
- Repo: `/path/to/repository`, git `main`.

## Environment snapshot (verified facts, inc. versions)

- **incus 6.0.5** on this host (x86_64). Note: `incus port-forward` needs ≥ 7.3 —
  NOT available here; per-connection exec bridges are the transport (by design).
- **Default incus remote on this host is `fixture-remote`** (TLS daemon, 192.0.2.10:8443)
  — plain `incus list` lists fixture-remote instances. The local unix socket is NOT
  group-accessible (`incus list local:` → permission denied). Tree/extension code
  must address instances as `<remote>:<name>` and never assume `local:`.
  `incus list` takes the remote as target argument (`incus list <r>:`), NOT a
  `--remote` flag; `incus remote list --format json` + filter `Protocol === 'incus'`
  drops the simplestreams `images` remote.
- **VS Code stable 1.142.0** (commit `6d62b1d5…`) — auto-updated mid-session
  from 1.141.2; assume weekly auto-updates in the dev loop.
- `code` = `/home/developer/.local/bin/code` (wrapper adds a Wayland flag, then
  `/usr/bin/code` → electron `cli.js`). Arg chain is clean passthrough.
- Proposed-API grant already in place: `~/.vscode/argv.json` contains
  `"enable-proposed-api": ["local-spike.remote-incus-spike"]` (verified working
  for the installed VSIX on stable).
- Spike extension installed in the user's VS Code:
  `local-spike.remote-incus-spike-0.0.1` (from `spike/remote-incus-spike.vsix`).
- Companion container: **`fixture-container`** (images:ubuntu/24.04, RUNNING):
  - VS Code server at `~ubuntu/.vscode-server/bin/6d62b1d5…`, listening on
    `127.0.0.1:<port>` inside, started detached via `bin/code-server …
    --connection-token-file … --accept-server-license-terms`.
  - relay helper staged at `/home/ubuntu/.vscode-server/relay.js`.
  - **No sshd / no openssh-server by design** — keep it that way; the whole
    point is proving zero-provisioning attach.
- Host port 16080 was used by spike socat scaffolding (stopped).

## ISOLATION RULE (important)

The user's Incus daemon also runs **production instances** (`production-instance-a`,
`production-instance-b`, `production-instance-e`, `production-instance-c`, `production-instance-d` — some with Docker
inside). **Never touch, stop, or configure them.** All spike/extension testing
targets `fixture-container` only. When enumerating instances in code/tests, filter
or select explicitly; never "first instance".

## Dev loop

- `spike/redeploy.sh` — package VSIX, install, restart VS Code, reopen the
  remote window. One command per iteration.
- Extension log: `/tmp/remote-incus-dev/fixture-container/ext.log` (the spike ext appends
  there AND to an output channel "Remote - Incus (Spike)").
- Server lifecycle scripts (verified, keep as reference): `spike/02-install-server.sh`
  (download+push+extract+sha+no-sshd-proof), `spike/03-start-server.sh`
  (token+start+port discovery; writes `spike/.state/server.{commit,port,token}`).
- Tarball cache (222 MB): `/tmp/remote-incus-dev/fixture-container/vscode-server-linux-x64-<commit>.tar.gz`.
- Server commit = local client commit: parse `code --version | sed -n '2p'`.
  Do NOT parse `update.code.visualstudio.com/api/commits/...` naively — it
  returns a JSON **array** (a spike script once fed the whole array into curl).

## Debugging traps (each cost real time — don't rediscover)

- **CLI flags only apply to NEW windows.** Handoff to a running window drops
  `--extension-development-path` / `--enable-proposed-api` and reuses stale
  resolution state. Always restart to a single fresh instance when debugging
  resolver flows.
- **Two VS Code main processes** (around auto-update) cause confusing
  window/session routing. Verify a single main before debugging:
  `ls -l /proc/[0-9]*/exe | grep -c 'code/code'`.
- `pgrep -f`/`pkill -f` **match their own invoking shell** when the pattern
  appears in the command line — also any comment text inside the same
  `bash -c` payload counts (the entire arg string is the match surface).
  Bracket-class every pattern (`serv[e]r-main.js`), keep payloads name-free.
- Direct `incus exec` args expand `~` **on the client** — always pass absolute
  in-container paths (know the target uid's home).
- Installed-VSIX `extensionPath` points into `~/.vscode/extensions/<id>` — never
  derive repo/script paths from it (spike hardcodes; Phase 1 inlines).
- `PendingMigrationError: navigator is now a global in nodejs` appears in
  windows from unrelated extensions — harmless noise, ignore it.
- System locale is German — expect German CLI error strings.

## Phase 1 — the work package (from DESIGN.md §12)

1. ~~Verify the one unexercised contract: `contribViewsRemote` tree view~~
   **DONE 2026-10-19** — verified on stable 1.142.0 (DESIGN.md §8); spike ext
   0.0.2 carries the working tree + connect flow.
2. **NEXT**: TypeScript + esbuild project; bootstrap module inlined (no script
   shell-outs); `relay.js` becomes a bundled asset (staged in-instance per install).
3. Tree: remotes → instances from `incus list --format json` / `incus remote list`;
   state icons (running connectable / stopped startable); commands: connect,
   start/stop/restart, kill/uninstall server, reset token, open terminal
   (escape hatch — no sshd means no user ssh fallback). Tree mechanics are
   already proven in spike ext 0.0.2 — port to TS, add server-management commands.
4. Bootstrap module: cached/resumable verified transfer (stdin push is broken;
   path push ~2.1 MB/s → design for interruption), commit-mismatch detection.
5. Diagnostics + `RemoteAuthorityResolverError` taxonomy (see DESIGN.md §7).
6. Tests: mechanics harness against `fixture-container`; resolver contract on
   stable; matrix smoke x64/arm64 (Ubuntu/Debian images).
7. Packaging: CI VSIX + OpenVSX + README with the argv.json step.

Open questions live in DESIGN.md §11 (naming/publisher TBD; per-project
support; multi-user semantics; offline mirror URL). **Do not** reopen settled
matters — transport, token policy, and user policy are frozen after evidence.

## Conventions on this machine

- Before creating/naming ANY git commit, read `~/.agents/AGENTS.md` and
  `~/.agents/skills/commit-naming/SKILL.md` and follow them (subject
  `<type>(<scope>): <essence>`, ≤72 chars, body for detail, split logical
  changes into separate commits).
- Discuss with the user before big direction changes; they review evidence
  before code (the established rhythm here: research → adversarial audit →
  spike → freeze → build).
- Prefer parallel subagents for research bursts; require URL-cited, verified
  claims; mark UNVERIFIED explicitly.
- Keep spike artifacts as reference (inventory in DESIGN.md §13); they are
  committed and deliberately NOT production code.

## Quick file map

```
DESIGN.md                  canonical architecture + findings + plan
HANDOVER.md                this file
spike/README.md            spike goals & acceptance criteria
spike/02-install-server.sh verified install flow
spike/03-start-server.sh   verified token/start/discovery flow
spike/relay.js             stdio<->TCP relay (runs on server-bundled node)
spike/ext/extension.js     working resolver proof (plain JS, hardcoded spike paths)
spike/ext/package.json     manifest: proposals [resolvers, contribViewsRemote],
                           views.remote tree, onResolveRemoteAuthority
spike/redeploy.sh          package+install+relaunch dev loop
spike/run-dev.sh           open dev window only
spike/.state/              port/token/commit cache (gitignored)
```
