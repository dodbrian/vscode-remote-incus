# HANDOVER — for the next agent

You are taking over **"Remote - Incus"**: a VS Code extension that adds Incus
containers (system containers; Incus = community fork of LXD) as a first-class
remote connection type — the slot Dev Containers / Remote-SSH occupy in the
Remote Explorer. Goal: "connect to a remote Incus container as seamlessly as
with a Docker container".

## Read order

1. `DESIGN.md` — **the canonical architecture document**, frozen after the
   Phase-0 spike. Full design (transport, bootstrap, token, user policy, relay
   lifecycle, error taxonomy), evidence ledger (§8, now incl. Phase-1
   findings), constraints, support matrix, open questions, Phase-1 plan (§12).
   Do not re-derive any of it.
2. This file — operational context: environment snapshot, dev loop, debugging
   traps, and exactly where to resume.

## Current state (as of the Phase-1 extension commits, 2026-10-19)

- Phase 0 (spike) **COMPLETE** — all hypotheses validated in a real window
  (DESIGN.md §8). Spike extension uninstalled from the user's VS Code (source
  stays committed under `spike/` as reference).
- Phase 1 items 1–3 **COMPLETE and user-verified on stable 1.142.0**:
  - **TypeScript + esbuild project** at repo root (`src/`, `esbuild.js`,
    `tsconfig.json`); bundle `dist/extension.js`; relay is a bundled asset
    (`assets/relay.js`); proposal d.ts committed under `src/types/` (fetched
    from the vscode repo at tag 1.142.0; base types `@types/vscode@1.140.0`
    — the newest DefinitelyTyped publishes; engines `^1.140.0`).
  - **Remote Explorer tree** (switcher form, `remoteName: "incus"`,
    `group: "targets@1"`): remotes → instances, state icons, graceful
    "unavailable:" leaves, and commands: connect, start, stop, restart,
    kill server, uninstall server, reset token, open terminal (exec),
    collect diagnostics, refresh. User signed off on rendered UX (screenshots
    matched the spike-approved layout).
  - **Bootstrap module** (`src/bootstrap.ts`): client-side cached download
    (globalStorage, sha256 sidecar), path-mode push gated by remote sha,
    idempotent extract as target user, sticky 0600 token, detached start,
    port discovery from server.log, stale-commit restart, orphan-relay sweep
    after fresh starts. Identity = primary unprivileged user via getent
    (root opt-in via `remote-incus.user`).
- Working extension id: **`local-dev.remote-incus` v0.1.0** (placeholder
  publisher — naming is DESIGN §11 open question, decide before OpenVSX).
  Installed in the user's VS Code; `~/.vscode/argv.json` grants it the
  proposed APIs (and still lists the spike id, harmless).
- Verified live: first connect ran the full 222 MB install inside resolve
  (core waited 132 s, no timeout); reconnect ≈ 17 s (cache hit, sha match,
  server reuse, 2 bridges). Connect-from-tree pre-runs `ensureServerReady`
  so resolve stays fast.
- Remaining Phase-1 work (DESIGN §12): item 4 diagnostics refinement
  (`RemoteAuthorityResolverError` taxonomy), item 5 tests (mechanics harness +
  matrix smoke), item 6 packaging pipeline (CI VSIX + OpenVSX + README).
- Repo: `/path/to/repository`, git `main`.

## Environment snapshot (verified facts, inc. versions)

- **incus 6.0.5** on this host (x86_64). `incus port-forward` needs ≥ 7.3 —
  NOT available; per-connection exec bridges are the transport (by design).
- **Default incus remote is `fixture-remote`** (TLS daemon, 192.0.2.10:8443); the
  local unix socket is NOT group-accessible (`incus list local:` → EACCES —
  the tree shows it as a graceful "unavailable" leaf, by design). Address
  instances as `<remote>:<name>`; `incus remote get-default` resolves the
  default remote at runtime.
- **VS Code stable 1.142.0** (commit `6d62b1d5…`), weekly auto-updates.
- Node v24.21.0 / npm 11.19.0 on the host; esbuild + tsc + @vscode/vsce as
  devDependencies.
- Companion container: **`fixture-container`** (images:ubuntu/24.04, RUNNING) with
  the 1.142.0 server installed under `~ubuntu/.vscode-server` and the staged
  relay at `~ubuntu/.vscode-server/relay.js`. **No sshd / no openssh — keep
  it that way.**

## ISOLATION RULE (important)

The user's Incus daemon also runs **production instances** (`production-instance-a`,
`production-instance-b`, `production-instance-e`, `production-instance-c`, `production-instance-d` — some with Docker
inside). **Never touch, stop, or configure them.** All spike/extension testing
targets `fixture-container` only. When enumerating instances in code/tests, filter
or select explicitly; never "first instance".

## Dev loop

- `./redeploy.sh` — build (esbuild --production), package VSIX, install,
  restart VS Code, reopen the remote window on
  `--remote=incus+fixture-remote:fixture-container /home/ubuntu`. One command per iteration.
- Extension log: `/tmp/remote-incus-dev/fixture-container/ext.log` (via the
  `REMOTE_INCUS_DEBUG_LOG` env the script sets — the extension mirrors its
  output-channel lines there) plus the "Remote - Incus" output channel.
- `npm run typecheck` (tsc), `node esbuild.js` (dev build),
  `npx esbuild scripts/smoke.ts --bundle --platform=node
  --alias:vscode=./scripts/vscode-stub.js --outfile=/tmp/remote-incus-dev/smoke.js &&
  node /tmp/remote-incus-dev/smoke.js` — offline smoke of authority/CLI-wrapper logic
  (read-only daemon probes).
- Tarball cache: `~/.config/Code/User/globalStorage/local-dev.remote-incus/server-cache/`
  (client-side; sha sidecar alongside).
- Server commit = local client commit: `vscode.env.appCommit` (resolvers
  proposal), fallback `code --version` line 2. Do NOT parse
  `update.code.visualstudio.com/api/commits/...` (returns a JSON array).

## Debugging traps (each cost real time — don't rediscover)

- **Untrusted-workspace trap (Phase-1 discovery)**: a window on a
  never-trusted remote folder starts in Restricted Mode; the extension is
  "disabled because the current workspace is not trusted", its views
  contribution is DROPPED, and `registerTreeDataProvider` then toasts
  "No view is registered with id: remote-incus.instances" — while the resolver
  still runs (core special-cases resolver activation). Symptom looks like a
  manifest/proposal bug; actual fix is
  `"capabilities": { "untrustedWorkspaces": { "supported": true } }` in
  package.json (Remote-SSH does the same). Without it, only trusted workspaces
  show the tree.
- **Authority separator is `:`, not `/`**: `vscode-remote://` URIs end the
  authority at the first slash; `incus+<remote>/<instance>` would hide the
  instance from the resolver. Use `incus+<remote>:<instance>`.
- CLI flags only apply to NEW windows. Handoff to a running window drops
  `--remote` / dev flags and reuses stale resolution state. Restart to a
  single fresh instance when debugging resolver flows
  (`ls -l /proc/[0-9]*/exe | grep -c 'code/code'` to count mains).
- `pgrep -f`/`pkill -f` match their own invoking shell — also any comment text
  inside the same `bash -c` payload counts. Bracket-class every pattern
  (`serv[e]r-main.js`) and keep payloads name-free (done in `src/bootstrap.ts`).
- Direct `incus exec` args expand `~` on the CLIENT — pass absolute
  in-container paths (target uid's home).
- `PendingMigrationError: navigator is now a global in nodejs` in windows from
  unrelated extensions — harmless noise.
- System locale is German — expect German CLI error strings from the OS
  (incus daemon messages are English).
- **No CLI screenshot tooling on this host** (GNOME Wayland; no grim/spectacle/
  scrot). View-rendering verification is user-in-the-loop: deploy, open a fresh
  window, ask the user to look. Log signals: activation line
  `onResolveRemoteAuthority:incus` / `onView:…` in
  `~/.config/Code/logs/<session>/window*/exthost/exthost.log`, absence of the
  "No view is registered" renderer error, and `/tmp/remote-incus-dev/fixture-container/ext.log`.
- `@types/vscode` publishes only up to 1.140.0 (DefinitelyTyped lag); fetch
  proposal d.ts from the vscode repo tag instead (`src/types/`), keep base
  types at 1.140.0.

## Phase 1 — remaining work (DESIGN §12)

1. ~~Project structure~~ / ~~tree + commands~~ / ~~bootstrap module~~ **DONE 2026-10-19**.
2. Diagnostics refinement (item 4): per-bridge structured logs exist; add
   sensible `RemoteAuthorityResolverError` usage for the §7 taxonomy (deleted
   instance → NotAvailable(unresolvable), starting → TemporarilyNotAvailable,
   etc.) and a "collect diagnostics" bundle beyond the current summary.
3. Tests (item 5): mechanics harness against `fixture-container` (install/start/
   dial), resolver contract on stable, matrix smoke x64/arm64
   (Ubuntu/Debian images) — mind the ISOLATION RULE.
4. Packaging (item 6): CI-built VSIX + OpenVSX publish + README argv.json
   step (README stub exists). Decide final naming/publisher (§11.1) first.

Open questions live in DESIGN.md §11. **Do not** reopen settled matters —
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
- Keep spike artifacts as reference (inventory in DESIGN.md §13); they are
  committed and deliberately NOT production code.

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
  incusCli.ts              typed incus CLI wrapper (exec, push, list, lifecycle)
  bootstrap.ts             server install/start/token/port (spike flow, inlined)
  bridge.ts                exec-stdio → ManagedMessagePassing
  resolver.ts              RemoteAuthorityResolver + pre-flight
  tree.ts                  Remote Explorer tree (remotes → instances)
  commands.ts              tree commands (connect/start/stop/kill/uninstall/…)
  terminal.ts              escape-hatch exec terminal (script-PTY)
  logging.ts               output channel (+ REMOTE_INCUS_DEBUG_LOG mirror)
  types/                   proposal d.ts pinned to vscode 1.142.0
assets/relay.js            bundled relay (staged in-instance per install)
scripts/                   smoke harness + vscode stub
spike/                     Phase-0 artifacts (reference only)
```
