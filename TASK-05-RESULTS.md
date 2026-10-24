# Task 5 connection startup results

Status: measurements, implementation and scoped verification complete.
**Stopped for discussion.** Task 4's
completed discussion gate was recorded before this task, and the user explicitly
authorized Task 5. No next task, deployment, commit or push is authorized.

## Measurement boundary and equivalent states

Measured on 2026-10-24 using the existing user-selected remote test fixture.
The initial local-fixture selection was superseded before any live mutation.
The fixture had no active editor relays at preflight. Private remote/instance,
addresses and member identifiers are deliberately omitted from this report and
the retained measurement artifact.

- Host Linux x86_64, Node 24.21.0; Stable VS Code 1.143.1, x64,
  commit `e646868227c3e3a9e3f24277c8c7220be42c0be7`.
- Incus client/server 7.5.1; TLS/HTTPS management transport to a remote cluster
  member, then non-interactive exec-stdio. The fixture remained on the same
  member as in the supplied baseline listing, verified again during the run.
- Container Ubuntu 24.04.5 LTS, x86_64/glibc; server Node 24.22.1;
  selected non-root UID/GID 1000/1000, same account in both runs.
- Each full run used a new empty temporary client archive cache and removed
  the server installation before clean install. Installed-but-stopped and
  healthy reuse retained that run's complete matching install and client cache.
  Both started with matching relay bytes/metadata and the sticky valid token.
  Healthy reuse held two signed management channels open. Installed-but-stopped
  explicitly killed the server first. Extra relay-repair cases restored correct
  state before the final installed-but-stopped measurement.
- Identity was already resolved for safety preflight in both runs. These are
  **warm-identity bootstrap** measurements; an uncached identity requires one
  additional exec. Commit resolution used the client's API value. The server
  version/commit and path were identical across runs.

The manual verifier measures actual production bootstrap, separately from tree
configuration/selected-remote enumeration and resolver status lookup. It does
not time VS Code activation, window rendering or the full resolver callback.
Real authentication checks run after the measured bootstrap returns. Tree
measurement uses the same CLI primitives for remote configuration/default and
one selected remote's instance list; it is not an all-remotes rendered-tree
benchmark. No unrelated instance was selected for bootstrap or mutation.

## Observed before/after

One before/after pair per state, on the same path. Times are observations, not
confidence intervals or CI thresholds. Exec counts include push-progress stat
calls; transfer counts are file-push operations/payload bytes, excluding network
protocol overhead and client-side archive download bytes. Clean install downloaded
one archive client-side in each run; the corresponding pushed archive was
222,356,453 bytes in both. This is file payload size, not wire capture.

| State | Before wall time | After wall time | Exec calls before → after | File pushes before → after | Pushed bytes before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Clean install, empty client cache | 141.096 s | 146.360 s | 64 → 66 | 2 → 2 | 222,357,564 → 222,357,564 |
| Installed, server stopped | 12.857 s | 12.494 s | 11 → 9 | 1 → 0 | 1,111 → 0 |
| Healthy running-server reuse | 14.277 s | 8.123 s | 10 → 7 | 1 → 0 | 1,111 → 0 |
| Tree primitives, selected remote | 1.761 s | 1.718 s | 3 → 3 | 0 → 0 | 0 → 0 |
| Resolver running-state lookup | 1.614 s | 1.574 s | 1 → 1 | 0 → 0 | 0 → 0 |

Healthy reuse improved by an observed 6.154 s (43.1%). The deterministic change
is four fewer CLI invocations: the relay push and its progress stat, separate
token read, and install prune disappear. The relay check shares the existing
token-preparation exec. Installed-but-stopped loses the relay push/stat and
separate token read but retains fresh-start cleanup; the observed 0.363 s
improvement is small and should not be treated as a stable speedup estimate.
No clean-install speedup is claimed. Archive transfer dominates, and progress
stat count varies with transfer duration. Fresh relay repair adds a verification
exec; combined token reading removes an exec, so no fixed-call reduction is
claimed for a missing-relay clean install.

Selected phase intervals (progress milestones bracket the work; not profiler
measurements of individual syscalls). Intervals are approximate: the baseline
rounded each percentage event before coalescing, leaving 0.402 s unallocated
in the clean-install phase sum. The total wall time is measured independently:

| Clean-install phase | Before | After |
| --- | ---: | ---: |
| Signal/flavor setup before existing-server check | 2.287 s | 2.279 s |
| Existing-state probes, client download/hash and remote archive probe | 12.881 s | 11.749 s |
| Archive push including progress observations and post-push hash | 108.698 s | 115.568 s |
| Install recheck/extraction | 8.394 s | 8.565 s |
| Token/relay preparation, push and verification | 2.402 s | 3.542 s |
| Detached launch | 1.229 s | 1.178 s |
| Readiness, token delivery and fresh-start hygiene | 4.803 s | 3.478 s |

The clean-start readiness phase needed a single port read in each run. The
healthy path still spends roughly 5.8 s in signal/flavor and pre-repair
install/process/health probes in the final sample, plus about 2.3 s preparing
session files and reading readiness. Those remaining serial remote calls,
status lookup and tree enumeration remain bottlenecks. Client archive download,
remote archive transfer and extraction dominate clean installation.

[TASK-05-MEASUREMENTS.json](TASK-05-MEASUREMENTS.json) retains sanitized counts,
wall times and milestone intervals. Baseline percentage events were coalesced
into their next milestone; durations are measured since the preceding milestone,
not durations attributed to the ending label. Instrumentation is manual-only,
records no argv/stdout/token/target, and adds no production telemetry.

## Implemented design

1. Batch selected-user token preparation with a fresh relay probe. Reuse requires
   matching bundled SHA-256, numeric UID/GID, mode 0600 and a regular non-symlink
   path. Missing, changed or mismatched state is pushed in existing path mode,
   then verified before a dialable session can be returned. Local asset hashing
   runs anew per attempt, including extension asset updates under the same
   server commit. No cross-session freshness cache was added.
2. Read port announcements and token in one selected-user exec. Preserve the last
   announced port, empty-token rejection, old-log removal before fresh launch,
   bounded readiness polling and diagnostic failure output. Token values remain
   absent from argv/env/logs/persistent client state.
3. Skip client-cache and remote-install pruning on healthy reconnect. Retain
   best-effort pruning and orphan-relay sweep after fresh startup, preserving
   active channels on reuse. Existing in-flight deduplication remains unchanged.

In-instance readiness polling was considered and deferred: measured fresh
startup needed one port read, so it would not remove observed polling calls.
The existing bounded polling remains easier to compare with the regression
baseline. No signal, installation, token or pre-repair health check was removed.
No container internet dependency, SSH setup, published port, bootstrap retry,
active-bridge kill or transport redesign was introduced. Unresolved root/GID,
mixed-user, malformed-existing-token and cross-window policies remain unchanged.

## Correctness evidence and limits

The first coherent relay/token change passed 83 tests and typechecking before
readiness/pruning changes. The second passed 85 tests; final executable and
operation-budget coverage brings the suite to **87 passed, zero failures/skips**.
`npm run typecheck`, `npm run compile`, standalone live-harness typechecking and
`git diff --check` pass. Compilation uses an ignored worktree-local directory;
the primary checkout's shared dist symlink was removed before compiling.

New retained checks cover actual generated bash for relay content/UID/GID/mode
and symlink rejection, successful repair and post-repair verification failure,
last-port/empty-token behavior in the actual combined read, fresh-start nonfatal
pruning and cache preservation. Existing identity/signal/install/recovery,
deduplication, token, transport and tree contracts continue to pass. Dedicated
offline performance tests allow at most seven execs for healthy reuse and nine
for installed-but-stopped startup with warm identity; they impose no wall-time
threshold and allow future reductions without weakening safety tests.

The portable real relay passes binary duplex, independent channels, EOF,
refusal, peer close, stdout EPIPE and repeated teardown. Its injected-failure
run also passes bounded cleanup with two open channels.

Both before and final remote runs passed clean install, signed management
handshake, invalid-token rejection, ownership/modes/content/temp-file checks,
healthy reuse preserving PID/port/sticky token and two live signed channels,
installed-but-stopped startup, missing-token and wiped-install recovery,
explicit token reset and synthetic stale-commit replacement. Final missing,
changed and incorrect ownership/mode relay repairs also passed with unchanged
server identity and both channels live. Each repair pushed exactly one 1,111-byte
relay and verified it before returning ready. No old-server-binary compatibility
claim is inferred from the synthetic process.

Both runs exited successfully and passed bounded cleanup of their server/relay
processes, installation, tested archive and temporary client storage. Temporary
measurement bundles/logs were removed after extracting the sanitized artifact.
No development profile, editor window or additional fixture was created.

This is scoped bootstrap/relay evidence. No fresh VS Code window/editor/terminal
or forwarded-port test is claimed. Task 4's unavailable Ports view and
identical-folder new-window findings remain open. No broader architecture,
client version, CLI version, local-daemon, multi-user or policy certification is
implied. No production-instance mutation, normal-user VS Code restart,
deployment, commit or push occurred. Stop here for discussion; further
optimization requires separate user authorization.

## User-requested review and refinement

The original comparison above is retained as measured. It supports fewer remote
calls and an observed healthy-reconnect improvement; it does not establish a
repeatable percentage speedup or a clean-install benefit. No new optimization
round was started during review.

Review found two concrete weaknesses:

- A relay symlink failed the freshness check, but the subsequent push could
  follow it before post-push verification rejected the path. Preparation now
  unlinks a symlink as the selected user before push, preserving its target.
  An unexpected directory rejects without recursive removal. Verification
  failures after staging now identify the relay explicitly and preserve their
  original cause.
- The manual measurement helper installed process hooks at import and retained
  them for the lifetime of the verifier. Hooks now exist only during each sample
  and are restored before output on success or failure. Samples include an
  outcome field; rounded cumulative timestamps make phase totals equal wall
  time. Historical measurements and rounding residuals are preserved unchanged.

The duplicated fresh-start cleanup guard was consolidated and the handover was
shortened. The combined readiness protocol and existing polling were retained:
changing them again would add risk without a demonstrated benefit.

Review verification: 88 offline tests pass, including actual symlink unlink/repair
with an untouched target, non-destructive directory rejection and isolated
measurement instrumentation success/failure/nesting/output-error checks.
Typecheck, compile, standalone live-harness typecheck and diff checks pass.
The fresh remote run passed clean install, signed authentication and invalid-token
rejection, healthy reuse, symlink/missing/content/metadata relay repairs, stopped
startup, missing-token/wiped-install recovery, reset, synthetic stale replacement
and bounded teardown. Symlink repair preserved the linked sentinel file, the
server PID/port/token and both live signed channels. Relay GID and non-symlink
state were asserted along with the existing ownership/mode/hash checks.

Healthy reuse still used seven execs and zero pushes; installed-but-stopped used
nine execs and zero pushes. Every new metric reported success and its phase sum
matched its wall time. The original before/after artifact was not rewritten.
The review run's test installation, processes, archive, sentinel and temporary
client storage were removed; temporary local bundle/logs were also removed.
No deployment, commit, push or next task followed. **Stopped for discussion.**
