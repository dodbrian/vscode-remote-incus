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

## Current state (session end 2026-10-19/20, main @ `3f96859`, clean tree)

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
  3. Bootstrap module (`src/bootstrap.ts`) — client-side cached download
     (globalStorage, sha256 sidecar), sha-gated path-mode push, idempotent
     extract as target user (`.incus-install-ok` marker), sticky 0600 token,
     detached start, port discovery from server.log, stale-commit restart,
     zombie detection before reuse, orphan-relay sweep after fresh starts,
     pruning of superseded in-instance installs + client cache entries.
  4. Progress UX (user-requested): connection/setup runs under a notification
     toast with a progress bar; title embeds a clickable "(show log)" link
     → `remote-incus.showLog` command → output channel; download % from
     content-length, push % parsed from the `incus file push` CLI meter
     (it prints even when piped); percent-first messages (collapsed-toast
     truncation cuts from the right). Error toasts carry the same link.
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
- Remaining Phase-1 work (DESIGN §12): item 5 diagnostics refinement
  (`RemoteAuthorityResolverError` taxonomy polish), item 6 tests (mechanics
  harness + resolver contract + x64/arm64 matrix smoke), item 7 packaging
  (CI VSIX + OpenVSX + README). Naming decision (§11.1) before publishing.
- Repo: `/path/to/repository`, git `main`.

## Environment snapshot (verified facts)

- **incus 6.0.5** on this host (x86_64). `incus port-forward` needs ≥ 7.3 —
  NOT available; per-connection exec bridges are the transport (by design).
- **Default incus remote is `fixture-remote`** (TLS daemon, 192.0.2.10:8443); the
  local unix socket is NOT group-accessible (`incus list local:` → EACCES —
  shown as a graceful "unavailable" leaf by design). Address instances as
  `<remote>:<name>`; `incus remote get-default` resolves the default at runtime.
- **VS Code stable 1.142.0** (commit `6d62b1d5…`), weekly auto-updates.
- Node v24.21.0 / npm 11.19.0; esbuild + tsc + @vscode/vsce devDependencies.
- Companion container: **`fixture-container`** (images:ubuntu/24.04, RUNNING):
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
- **Collapsed progress toasts truncate title+message as one line** — put the
  percentage at the START of progress messages.
- CLI flags only apply to NEW windows; restart to a single fresh instance
  when debugging resolver flows (`ls -l /proc/[0-9]*/exe | grep -c 'code/code'`).
- Direct `incus exec` args expand `~` on the CLIENT — pass absolute paths.
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
2. Diagnostics refinement (§12.5): per-bridge structured logs exist; polish
   `RemoteAuthorityResolverError` usage for the §7 taxonomy (deleted instance
   → NotAvailable unresolvable, starting → TemporarilyNotAvailable, …).
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
