# Current coverage through Task 5

Task 5 is deployed and manually accepted. See
[TASK-05-RESULTS.md](../TASK-05-RESULTS.md) for consolidated evidence and limits.
127 offline tests pass with no failures/skips; typecheck and compile pass.
Manual verifiers remain separate from daemon/network-free CI tests.

- C5/C6/C7/C8/C10/C11/C12: parallel selected-user and root inspection, pre-repair
  barrier, process-search self-matching prevention, common recovery and actual
  combined preparation/readiness bash. No duplicate fallback inspection.
- B4/B5/C8/C13: sticky token, SHA/UID/GID/0600 relay freshness, safe symlink
  repair, verification before dialing, healthy-channel preservation and fresh-
  start nonfatal pruning. Three/seven-exec budgets allow future reductions
  without replacing safety assertions or imposing wall-time thresholds.
- Archive strategies: public/runtime auto default, explicit overrides, mirror
  bypass, metadata/URL/SHA gates, atomic partial publication and signal cleanup,
  one visible fallback, both-route errors, cleanup uncertainty and preservation
  of publisher SHA before client cache publication/reuse. Managed curl ignores
  curlrc. Tests cover fresh/cached mismatches and successful publication.
- Real signed-handshake, relay/channel, repair/recovery and failure-cleanup
  evidence is retained in the final report. User acceptance confirms perceived
  improvement, not an exhaustive new UI/forwarding or policy certification.

Task 4 window findings, broader support matrices and unresolved policies remain
outside this result. Earlier records below are historical.

# Regression coverage through Task 4

See [TASK-03-RESULTS.md](../TASK-03-RESULTS.md) for the current behavior and
failure-before-fix evidence. The historical Task 2 matrix below is retained as
the accepted baseline, rather than rewritten as though script checks existed
then. Its known-defect and separate-runner statements are superseded here.
Task 4 real-behavior evidence and transport/window limits are recorded in
[TASK-04-RESULTS.md](../TASK-04-RESULTS.md).

- B3: actual captured extraction/probe scripts with corrupt archives,
  interrupted complete-looking installs, real SIGTERM after unpacking, stale
  success markers, retry and complete legacy installation probes.
- C10: pre-repair lost-token/install and partial-install reuse regressions;
  healthy session preservation remains covered by the original baseline.
- B4: actual mint/reuse/0600 checks and injected mkdir/mv/generator failures.
- T3: synchronous/early rejection, published managed failure, trailing data,
  abnormal/signal termination, duplicate and post-terminal suppression.
- B6: late in-flight stat regression promoted into the passing suite.
- C13 / uninstall / startup: actual bash injected prune rm/cd, uninstall rm
  and old-log rm failures. Prune remains nonfatal at orchestration level.

Task 3 gate: 80 passed, no failures/skips; typecheck and compile passed. The
original defect tests run with `npm test`; the separate red command was removed.
Task 4 subsequently verified real shell/relay, local/TLS handshakes and scoped
Stable window behavior; see the overlay below and the evidence report. Ports
forwarding remains unverified, and identical-folder new-window behavior is an
outstanding finding. No deferred policy resolution or broader support matrix
is implied. Task 4 results have been discussed and its discussion gate resolved;
further work awaits explicit next-step authorization.

---

# Task 2 offline baseline

Task 1 acceptance was explicitly confirmed by the user in this session before
implementation. Starting commit: `49c0ac0` (Task 1 harness). The task documents
and regression plan were read from the primary checkout at
`/path/to/repository/`; they are absent from this worktree.
This report maps tests to that plan dated 2026-10-23. An ID here does **not**
mean all layers or every clause of the ID are covered.

## Passing coverage and limits

| Plan IDs | Executable coverage | Remaining limits |
| --- | --- | --- |
| C1 | `transport`, `bootstrap`, `resolver`: explicit full CLI targets, authority roundtrip/default lookup, same-name identity isolation, independent bootstrap while another remote is blocked | No daemon/client configuration integration; host-local state only |
| C2 | `transport`, `resolver`: separate remote/filter args, exact name despite fuzzy neighbor, absence, malformed JSON, daemon failure | Resolver taxonomy remains incomplete; malformed schema beyond malformed JSON not covered |
| C3 | `resolver`: Running skips start, Stopped starts and rechecks, still-stopped gives temporary error, absence causes no mutation, unavailable proposed API fails before I/O | Other non-Running states deliberately not normalized; real API availability requires V |
| C4 | `bootstrap`: lowest eligible user, service/nologin ignored, named/numeric/root overrides, missing override rejects and retries, cached results isolated by target/override | getent/passwd fallback is not executed; root fallback policy and recreated-target cache remain outside baseline |
| C5 | `bootstrap`, `transport`: numeric UID/HOME on exec and launch, archive/relay UID/GID, relay mode request | Actual owner/mode and primary GID require S/I; remote hash verification intentionally retains existing root exec |
| C6 | `bootstrap`: selected-user signal denial prevents transfer/start, deduplicates failures, permits retry; successful concurrent other target | No actual kernel signal behavior; same probe runs before installed/fresh decision |
| C7 | `bootstrap`: API commit wins, invalid API fallback, malformed fallback failure, changed commit read next attempt; glibc x64/arm64, musl x64 mapping, unsupported arch/musl arm64 | musl mapping is not live support evidence |
| C8 | `bootstrap`: installed + healthy skips fetch, hash/archive push/extract, server kill/start and relay sweep, even without local cache | Installed probe response models both marker and legacy paths; shell legacy-file semantics unexecuted |
| C9 | `bootstrap`: absent process launches once, selected UID/HOME, loopback/dynamic-port/token-file args, obsolete relay sweep | Detached survival, bind/listener/authentication and actual handshake require I |
| C10 | `bootstrap`: stale commit and failed health response trigger kill/start, not reuse | Does not prove wiped-file repair/handshake; repair-before-health and mixed-user/process defects remain |
| C11 | `bootstrap`: delayed logs, last announced port, bounded no-port failure including log diagnostics, empty token rejects before ready | No port-range/listener validation, stale-log protection or token-match proof |
| C12 | `bootstrap`: simultaneous same-target work shared, success/failure entry cleared, retry, distinct remotes progress independently | No Promise identity assertion; no cross-window/user/cache-download lock claim |
| C13 | `bootstrap`: cache directory unavailable and remote prune error are nonfatal, ready follows essential work; extraction/hash failures reject | Local cache preserves current commit and unrelated data; actual remote install prune preservation and deletion boundaries require S |
| B1 | `download`: valid/corrupt/incomplete cache, tiny streamed fetch, URL substitution, HTTP/missing-body/stream failures, no newly published file/sidecar/partial on fresh failure | Interrupted publication with an older cache, concurrent writers and filesystem publication failures not covered |
| B2 | `bootstrap`: matching remote SHA skips archive push; absent/mismatched SHA pushes path, wrong post-push SHA rejects before extraction/start | Sticky-/tmp deletion and real ownership require I |
| B3 | Deliberately outside green claims; `bootstrap` checks an exec-level extraction failure rejects | Actual script masks tar failure: see known plan defects below. Mocked exec failure is not a reproduction of tar failure |
| B4 | `bootstrap`: repeated modeled token read, empty-token rejection, explicit reset kills/removes and bootstraps, token absent from process args, selected-user setup | Mint charset/length, atomic rename, repaired 0600, unchanged actual file, token replacement and working authentication require S/I; malformed/mismatched tokens remain gaps |
| B5 | `scenario` assertions in bootstrap tests: stages bundled relay path to exact target with selected UID/GID and mode 600 on each attempt | Does not prove staged bytes, on-disk permissions or successful dial; S/I required |
| B6 | `transport`: meter and silent-size progress monotonic, transient stat error tolerated, error/nonzero/timeout settle, timer kill behavior, no new polls after completion | Late in-flight stat reporting is a demonstrated defect; split meter chunks and all listener-release paths not covered |
| T1 | `transport`: exact bridge args, raw NUL/non-UTF8 both directions, stderr excluded, independent channels with no bootstrap | Resolver makeConnection also opens independent channels without repeating bootstrap; no real relay/TCP or managed-host handshake |
| T2 | `transport` U portion: ending one input leaves other channel usable | Real EOF/socket refusal/EPIPE and process accumulation require S/I |
| T3 | `transport`: clean end, nonzero/signal closure, listener disposal after stdio close | Spawn error and final stdout delivery fail separately; see defect suite |
| T4 | `bootstrap` observes sweep on fresh start and preservation on healthy reuse | Actual process matching, self-kill avoidance and ordering require S/I; mixed-user/commit policy deferred |
| X1 | `explorer`: manifest kind/trust/proposals/view attributes, activation uses contributed view and resolver prefix | Real switcher, Restricted Mode and proposed API compatibility require V |
| X2 | `explorer`: expanded iconless remotes, history branches/leaves, full folder labels, no row commands, inline action ordering, palette exclusions | Actual hover/selection/rendering require V |
| X3 | `explorer`: clicked target, empty current/new-window intent, latest-history new-window URI and significant path characters; no daemon/bootstrap calls allowed | Current-window folder force-reuse guarantee remains unresolved. URI substitute models encoding; real URI/window-settings behavior requires V |
| X4 | `explorer`: authority isolation, newest-first cap 10, reorder/dedup/idempotence, removal without I/O, activation records remote workspace and ignores local files | Activation with foreign authority in workspace folders not tested; persistence failure/cross-window updates not covered |
| X5 | `explorer`: full authority + path active matching, identical paths on second remote inactive, non-Incus inactive, icon assets exist in both themes, state descriptions/tooltips | No screenshot/rendered UX claim |
| X6 | `transport`, `explorer`: simplestreams excluded, failed default lookup preserves remotes, warning child for failed remote, healthy children intact, refresh event and subsequent requery | No live daemon refresh |
| X7 | `resolver`, `explorer`, `transport`: monotonic increments, show-log title, ready only after successful essential work, first-line cause and no ready on failures | Real links/toasts, full multiline error log assertions and comprehensive token redaction not covered |
| X8 | `explorer`, `transport`: registered lifecycle/kill/uninstall use clicked target; canceled uninstall/reset do no I/O; confirmed uninstall targets server data; rescue terminal creation independent of bootstrap | Rescue PTY spawn/resize, confirmed reset usable authentication and real uninstall effects need S/I/V |

Test filenames above refer to `tests/<name>.test.ts`. The original five harness
checks remain in `harness.test.ts`. No whole-script snapshots or remote operation
count budget is imposed. Counts used for deduplication and one launch/push test
observable duplicate side effects, rather than freezing bootstrap sequencing.

## Demonstrated defects: separate red command

Run `npm run test:known-defects`. Three tests assert intended behavior and fail
without skips or expected-failure inversion:

1. **T3 asynchronous spawn failure:** `openBridge` has already resolved when
   child `error` rejects its Promise; the managed client receives no close event.
2. **T3 final stdout:** process `exit` disposes receive listeners before stdio
   `close`; the final byte delivered between those events is lost.
3. **B6 late stat:** a size probe already in flight can still report progress
   after successful push completion. The source comment says it is ignored,
   but the callback does not check `polling` before reporting.

The event fixtures reproduce these under real EventEmitter/PassThrough
semantics. No real child or shell process is spawned by these tests.

## Other known defects and deferred decisions

The regression plan records extraction publishing success after tar failure,
repair-before-health masking lost tokens/installations, first/mixed process
selection and all-user kill patterns, incomplete resolver error taxonomy,
existing-token validation and stale ports, stale identity caching, host-local
concurrency limits, and current-window folder reuse uncertainty. These remain
unchanged. The extraction defect was demonstrated during the plan review;
Task 2 did not rerun its executable-shell reproduction. Root fallback versus
opt-in-only design and multi-user policies remain undecided.

Do not interpret the green suite as passing B3, full C10 recovery, full B4,
full B6 or full T3. No production defects were fixed. No production source or
production build configuration was changed for testability; all additions are
test fixtures, tests, documentation and an explicit defect runner command.

## Verification and stopping point

Local verification: `npm test`, `npm run typecheck`, `npm run compile`.
Result: **59 passed, 0 failed, 0 skipped, 0 todos** on Node 24.21.0.
Typecheck and compilation passed. The passing suite has no skips/todos. `npm run test:known-defects` is intentionally
nonzero and is excluded from the green gate by an explicit separate directory
and command. Its sources are still typechecked.

No live Incus/VS Code checks, real downloads, executable script/relay checks,
redeploy, commit or push were performed. Task 3 has not begun. Stop here for
discussion of coverage, gaps and defects before any correctness or live work.


## Task 4 evidence overlay

| IDs | Additional real evidence | Remaining distinction |
| --- | --- | --- |
| B3, B4, C13 | Generated bash executes against temporary filesystem fixtures; token mode/UID/content/sticky reuse and failure propagation asserted | Scoped failure injection, not a real remote permission-failure matrix |
| T1, T2 | Bundled relay runs against loopback TCP: binary bytes, independent channels, EOF, refusal, peer closure, EPIPE, repeated teardown and injected-failure cleanup | Local TCP fixture; arbitrary-byte matrix not repeated across every Incus transport |
| C5, B2, B4, B5 | Real local and TLS installs assert UID/modes/content, generated token shape, relay hash and temporary-file cleanup | GID/multi-user policy unchanged |
| C8, C9, C10 | Both manual targets pass signed management handshakes, healthy reuse with parallel channels, normal startup and wiped-state/token recovery | Synthetic stale process, not an old server binary; no cross-window locking certification |
| T3, T4 | Real protocol negotiation/disconnect and bounded cleanup; stale-process replacement | Managed-host window results are separately recorded; no multi-user sweep claim |
| X1, X2, X5, X6 | User confirms selector, selection-only click, actions/icons/themes and Restricted Mode; transient unavailable warning/recovery observed | Rendering observations are separate from manifest/unit assertions |
| X3, X4, X8 | Remote files with spaces/hash, integrated/rescue terminals, history removal, distinct-folder concurrent windows and reload/one-step reconnect pass | Already-open identical-folder new-window behavior and missing Ports are reported findings; forwarding unverified |

Manual targets and their identifying logs remain outside tracked artifacts.
Neither private fixture is a CI dependency. The standalone live harness refuses
CI and requires explicit target and destructive opt-in; no fixture is created
or deleted automatically. See tests/README.md for commands and boundaries.
