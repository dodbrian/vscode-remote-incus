# Regression coverage before connection optimization

Review date: 2026-10-23. Source baseline: `0db8e48`.

This is a test specification, not an implemented suite. It covers connection
startup and the Remote Explorer behavior that launches it. Preserve observable
outcomes and safety constraints; allow commands to be batched, probes to move,
and redundant transfers or cleanup to disappear from the reconnect path.

## Evidence and precedence

Reviewed `src/`, `assets/relay.js`, `package.json`, the two existing harnesses,
[project README](../README.md), [design](DESIGN.md),
[handover](HANDOVER.md), [alternatives](ALTERNATIVES.md), and relevant Git
patches and commit messages from the initial architecture through `0db8e48`.
The alternatives research supplies context, not a new transport requirement.

Where early design prose conflicts with subsequent verified fixes, use the
later behavior below. Do not turn discrepancies or known defects into passing
regression assertions merely because the current implementation has them.

| Topic           | Behavior to protect                                                                                                            | Evidence / discrepancy                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token lifecycle | Reuse a valid existing token across ordinary connects and server restarts; explicit reset replaces it and restarts the server. | Code and DESIGN §8 version-drift evidence / HANDOVER supersede §4's rotation-on-every-restart sentence.                                                                                        |
| Relay cleanup   | Reuse must preserve existing live bridges; fresh starts clean obsolete relays before new bridges dial.                         | `b28e38b`, current bootstrap, later DESIGN §12 supersede §6's sweep-on-every-attach wording.                                                                                                   |
| Row click       | Select only; connect through hover actions or context menu.                                                                    | `8d22af6` explicitly supersedes `5f64f05`'s row-click connect behavior.                                                                                                                        |
| State labels    | Running and Stopped descriptions are absent; tooltips retain state; other states retain useful descriptions.                   | `5f746c3`, `c0a441c`.                                                                                                                                                                          |
| Icons           | Theme icons for disconnected instances; active instance and folder SVGs with light/dark variants.                              | `5f746c3`; use the public replacements from `6ab83fe`, not the earlier proprietary-extension asset copies.                                                                                     |
| Root fallback   | Explicit root override is supported; default selection favors an unprivileged user.                                            | Code automatically falls back to root when no eligible user exists, conflicting with DESIGN §5's opt-in-only wording. Keep this fallback outside the agreed passing baseline until reconciled. |

## Test layers

- **U — offline tests:** real TypeScript logic with controlled process, network,
  clock, configuration and VS Code boundaries. No daemon or real download.
- **S — executable script/relay tests:** run actual generated shell scripts in
  temporary directories, and the real relay against a local TCP fixture. This
  catches failures hidden by command mocks.
- **I — Incus integration:** real bootstrap on an explicitly selected disposable
  fixture, with real filesystem permissions, process lifecycle and byte transport.
- **V — VS Code host/window checks:** real extension activation, proposed APIs,
  Remote Explorer switcher, current/new windows, terminal and forwarded ports.

Prefer a small process boundary or dependency injection to mocking every private
helper. Tests should observe state changes and side effects, not compare entire
shell strings or require today's number/order of CLI invocations. Exact arguments
are appropriate for compatibility and isolation contracts such as explicit
targeting, numeric UID, non-interactive mode and the list-filter syntax.

## First coverage: required before changing bootstrap sequencing

| ID  | Scenario and exact expected behavior                                                                                                                                                                                                                                                                                                                                  | Layer / provenance                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Explicit `incus+remote:instance` is used throughout; omitted remote is resolved from client configuration. Same instance names on two remotes cannot share identity/bootstrap state. No operation selects the first listed instance.                                                                                                                                  | U; authority, resolver, Incus wrappers; isolation rule.                                                                                                                   |
| C2  | Status lookup uses separate `remote:` and instance-filter arguments, then exact name matching. A similarly named instance alone means the requested instance is absent. CLI failure or malformed JSON remains a lookup failure, not absence.                                                                                                                          | U; `67167ea`.                                                                                                                                                             |
| C3  | Running instance proceeds without start. Stopped instance starts and is checked again before bootstrap. Still-not-running yields `TemporarilyNotAvailable`; absent instance performs no start/install/create. Unsupported proposed API fails with actionable setup guidance before any daemon mutation.                                                               | U, V; resolver. Do not freeze all other non-Running states as equivalent to Stopped.                                                                                      |
| C4  | Default identity is the lowest eligible UID in `[1000, 65534)`, under `/home`, with a login shell; service/nologin accounts are ignored. Named/numeric override selects the exact account; missing override fails. Explicit root selects UID 0. `getent` failure can fall back to passwd.                                                                             | U; bootstrap identity policy. Root-with-no-eligible-user is the discrepancy above.                                                                                        |
| C5  | Installation, token creation, startup and bridges use the selected numeric UID and explicit HOME. Tarball/relay push requests the intended UID/GID; token and relay are owned by that user with mode 0600. Do not accidentally run user setup as root when batching.                                                                                                  | U, I; `41b8712`; Incus user/environment semantics [I1, I2]. Exec currently leaves primary GID at 0: changing that is separate behavior, not an optimization prerequisite. |
| C6  | Signal-support failure is detected as the selected user on both fresh and reuse paths, per instance; it prevents transfer and server startup and explains the constraint. Another instance on the same remote must not inherit the result.                                                                                                                            | U; `128621b`; DESIGN §14.                                                                                                                                                 |
| C7  | Read client commit anew for each completed bootstrap attempt. Valid API commit wins; absent/invalid API value falls back to version output; malformed/missing commit fails. x86_64/glibc and aarch64/glibc select their matching build; unsupported architectures and musl/arm64 fail clearly. Cover existing musl/x64 mapping offline without claiming live support. | U; bootstrap; support matrix limits.                                                                                                                                      |
| C8  | Complete matching install skips tarball download, local tarball hashing, tarball push and extraction, including when the local cache is empty. Accept complete legacy installs without a marker. A healthy matching running server is reused without kill/start/orphan sweep; existing bridges survive.                                                               | U, I; `b28e38b`. Relay freshness remains required, but a relay transfer on every connect is not a contract.                                                               |
| C9  | Complete matching install with no server starts exactly one detached server, binds only to 127.0.0.1 with a dynamic port and token-file authentication, and remains alive after its launch exec exits. Returned port/token permit a real connection.                                                                                                                  | U, I; bootstrap and DESIGN §§2–4.                                                                                                                                         |
| C10 | Stale-commit process is replaced by the client commit. A matching process with lost installation/log/token must not be trusted solely because pgrep finds it. Verify actual recovery and dialability after wiping server files, not just invocation of a health-check helper.                                                                                         | U, I; `b28e38b`, DESIGN §8. See existing recovery gap below.                                                                                                              |
| C11 | Port discovery tolerates initially absent/delayed logs and chooses the last announced port. No announcement ultimately fails with useful server-log diagnostics. No successful session is returned with an empty token. Fresh startup must not accept an old server's log.                                                                                            | U, S, I. Preserve bounded waiting, not exactly 120 client-side polls or a claimed 60-second wall deadline.                                                                |
| C12 | Concurrent ensure calls for the same target share bootstrap work and outcome; different targets proceed independently. Both success and failure remove the in-flight entry, allowing later work/retry. State precisely that this is within one extension host, not a cross-window lock.                                                                               | U; `inflight` map. Compare work/results, not Promise object identity from async wrappers.                                                                                 |
| C13 | Cache/install pruning failures are logged and do not invalidate an otherwise ready session. Pruning preserves the current commit and unrelated server data. It may move off the normal reconnect path. Essential probe/install/start failures still reject.                                                                                                           | U, S; `0e61725`, `a1905a4`.                                                                                                                                               |

## Installation, interruption and token coverage

| ID  | Scenario and exact expected behavior                                                                                                                                                                                                                                                                                                    | Layer                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Valid cached archive plus matching SHA skips fetch; corrupt cache redownloads. Missing archive or sidecar triggers download. URL override substitutes both commit and flavor. HTTP/body/stream failure rejects, removes partial data, and never publishes a new apparently complete archive. Container internet access is never needed. | U, S; client-side download with a tiny controlled stream, not a 222 MB fixture.                                                   |
| B2  | Remote archive with matching SHA skips push; absent/mismatched archive is pushed by path, then verified. Post-transfer SHA mismatch rejects before extraction/start. User-owned archive can be deleted from sticky `/tmp` by the extraction user.                                                                                       | U, I; path mode is the repository's CLI 6 compatibility requirement even though current Incus docs also describe stdin mode [I3]. |
| B3  | Interrupted/incomplete installation is rebuilt, and only successful extraction publishes the install marker. Extraction failure cannot be hidden by a later successful command; rerun remains recoverable. Complete legacy installations need no transfer.                                                                              | S, I; desired invariant with a confirmed current defect below.                                                                    |
| B4  | Newly minted token is 43 alphanumeric characters, atomic and mode 0600; an existing valid token is unchanged and permissions are repaired. Explicit reset kills server, replaces token, and returns a usable new session. Token value never enters argv, env, logs or persistent client state.                                          | U, S, I; allow token-file path in argv. Broader invalid-existing-token handling is a gap below.                                   |
| B5  | Relay bytes match this extension's bundled relay before dial, including after an extension update with unchanged server commit. Mode/ownership remain correct. Future hash-gated staging must repair missing or changed content; unchanged content may skip transfer.                                                                   | U, S, I.                                                                                                                          |
| B6  | Push progress works with 6.x meter output and with silent output plus file-size observations. Reported percentage never decreases; transient stat failure does not fail transfer; stop polling/reporting after completion, failure or timeout. Child error/nonzero exit/timeout settles once and releases timers.                       | U with real event emitters/fake clock; `a7761a2`. No requirement for one particular polling frequency.                            |

## Byte transport and lifecycle

| ID  | Scenario and exact expected behavior                                                                                                                                                                                                                                                 | Layer                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| T1  | Each `makeConnection()` produces an independent channel using the selected remote/user, bundled server Node and staged in-instance relay. No bootstrap rerun per channel. Arbitrary bytes, including NUL and non-UTF8, pass unchanged in both directions; stderr is diagnostic only. | U, S, I; non-interactive separate pipes [I1, I2], managed API [V5].                                                     |
| T2  | Two live channels coexist. Ending one does not close the other. Input EOF reaches the socket; socket closure/connection refusal/stdout EPIPE terminates the relay. No accumulating relay processes after repeated connect/disconnect cycles.                                         | S, I. Use eventual checks with bounded tolerance, not a hard one-second CI deadline.                                    |
| T3  | Clean process completion delivers end; abnormal exit/signal and spawn failure are observable to the managed client. No data after terminal events and no dropped final bytes. Bridge does not internally retry or bootstrap after a transport failure; VS Code owns re-resolution.   | U, S, V; current spawn-error path needs investigation below.                                                            |
| T4  | Fresh server recovery clears obsolete relays before exposing new dials; reuse preserves active ones. Process matching neither kills its invoking shell nor depends on pgrep ordering; commits must be exactly 40 hex characters in the expected path shape.                          | S, I; use actual harmless process fixtures rather than only matching script text. Mixed-commit handling is a gap below. |

Do not hard-code exactly two makeConnection calls as an API guarantee: two was
the observed initial management/extension-host pattern. Forwarded ports require
additional channels. Use V checks for editor access, integrated terminal, a
forwarded loopback HTTP server, reload/reconnect and two connected windows.
Avoid asserting that the server lives forever after a graceful disconnect;
HANDOVER explicitly records normal upstream server shutdown in that case.

## Remote Explorer and command coverage

VS Code's Views guidelines favor trees, product icons and a small action set;
its Tree View API defines context values, inline actions, ordering and refresh
events [V1, V2]. These support the design but do not specify Dev Containers'
exact icon or history behavior. Those choices come from this repo's later
commits and user verification.

| ID  | Scenario and exact expected behavior                                                                                                                                                                                                                                                                                                                                                                                    | Layer / evidence                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | Manifest contributes the Incus view to `remote`, with `remoteName: incus`, `group: targets@1`, required proposals, UI extension kind and Restricted Mode support. Registration uses the contributed view ID. Incus is selectable in a disconnected window and selected for an Incus authority; no missing-view error in Restricted Mode.                                                                                | U manifest assertions + V; platform source [V3], trust guide [V4], spike commits `027c2dc`–`d24e127`. Static JSON alone cannot prove switcher behavior.                    |
| X2  | Remotes are expanded and iconless. Instances with history are expanded, those without are leaves; folder labels retain full paths. Row selection has no connect command. Instance hover actions are current/new window; folders add remove-history third. Start/Stop stay in context menus. Node-driven connect commands are absent from the Command Palette.                                                           | U + V rendering/selection; `8d22af6`, `22a336d`; `viewItem` conditions and action ordering [V1].                                                                           |
| X3  | Current-window versus new-window action targets the clicked node. Existing history opens the latest folder in one step through a correctly encoded remote URI; no history opens an empty remote window. No pre-bootstrap/identity/start in the connect command: setup occurs only in the resolver. Preserve folder paths with spaces and URI-significant characters.                                                    | U command arguments + V actual window behavior; `5f64f05`, `22a336d`; commands [V6]. Honor the user's current-window intent, not merely today's omitted openFolder option. |
| X4  | History is scoped by full authority, deduplicated, newest-first and capped at 10. Reopening moves a folder to front; removing history does not delete remote files or disconnect. Record opens and activation of an existing Incus workspace; ignore other schemes/authorities.                                                                                                                                         | U; `22a336d`. Include cap and idempotent-update cases absent from the smoke harness.                                                                                       |
| X5  | Active instance matches the full authority. Active folder requires BOTH authority and path: identical paths on a second instance/remote are inactive. Non-Incus windows have no active Incus row. Running disconnected icon is `vm-running`, stopped is `vm`; active icons resolve to existing light/dark assets. Running/Stopped have no redundant description but tooltips retain state; other states remain visible. | U + brief V light/dark check; `52bb622`, `5f746c3`, `c0a441c`. Do not snapshot obsolete SVG bytes.                                                                         |
| X6  | One unavailable remote yields a warning child without hiding healthy remotes. Simplestreams remotes are excluded. Default-remote lookup failure does not hide successfully listed remotes. Refresh emits a tree-change event and reloads daemon state.                                                                                                                                                                  | U; tree/Incus wrappers.                                                                                                                                                    |
| X7  | Connection progress is visible with a show-log link, transfer percentages are monotonic and percentage-first, and success reaches ready only after essential work. Failure preserves its cause in the first error line and full detail in logs, without exposing tokens. Do not snapshot precise prose or intermediate percentage allocations.                                                                          | U + V link/render check; `49c21dd`, `0e61725`, `a7761a2`.                                                                                                                  |
| X8  | Kill/start/stop/restart/rescue terminal use the clicked node. Uninstall and token reset do nothing on canceled confirmation; confirmed uninstall affects only the target's server data, not the instance. Rescue exec shell works independently of bootstrap failure.                                                                                                                                                   | U; one scoped I/V rescue check. Terminal resize is explicitly unimplemented, not a regression prerequisite.                                                                |

## Existing gaps: expose them, do not bless them

1. **Extraction can publish false success (confirmed locally).** The script
   joins commands with newlines under `bash -c` without fail-fast chaining.
   With a corrupt tar, `tar` fails, `touch` and `rm` succeed, exit status is 0,
   and the success marker exists. A temporary-directory reproduction during
   this review produced exactly that result. B3 should initially fail; repair
   this separately before optimizing installation. Audit the other mutating
   scripts for the same error-masking pattern.
2. **Recovery checks happen after repair.** Relay/token/install recreation
   precedes the running-server health check. A missing token can be reminted
   before that check and thus appear healthy even though the live server
   loaded a different token; a restored install can similarly mask prior
   damage. C10 needs actual handshake assertions, not file-presence mocks.
3. **Process ownership and mixed commits.** Root-level pgrep searches every
   server in the instance and returns the first unique commit. kill/sweep
   patterns also cover all users. Test unordered/duplicate matching processes;
   record mixed-user/mixed-commit cases separately. Multi-user semantics are
   deferred in DESIGN §11: do not invent a new policy in optimization tests.
4. **Error taxonomy is incomplete.** `toResolverError` is exported but not
   called by `resolve`. Missing instance currently throws an ordinary Error;
   a live test must not claim `NotAvailable` is already wired. Generic
   “not found” text can also mean a missing executable, not a deleted instance.
5. **Token validation/readiness.** Existing nonempty tokens are not validated
   against the documented charset; malformed or mismatched tokens and stale
   log ports can fail after a session is returned. Port discovery parses
   digits without range/listener verification. Capture these as explicit
   fault cases rather than accepting arbitrary nonempty strings as healthy.
6. **Spawn failure propagation.** `openBridge` resolves immediately; its child
   error handler only rejects that already-resolved Promise. Test whether the
   managed client gets a closure/error on asynchronous spawn failure. Also
   exercise final stdout delivery because listeners are disposed on `exit`.
7. **Cached identity and concurrency scope.** Identity persists for the host
   lifetime, apart from rejection/uninstall invalidation; recreate-under-same-
   name can leave a stale UID/home. In-flight deduplication is instance-only
   and host-local; it is not a lock across windows, users or shared cache
   downloads. Include these fault cases when introducing any further cache.
8. **Current-window folder command.** The current path omits openFolder
   options, while the documented API exposes `forceReuseWindow`. Verify with
   user window settings before treating current behavior as guaranteed [V6].

Keep gap tests explicitly labeled with the intended behavior and reason for
failure; do not silently skip them or mix them into a misleading green
baseline. Resolve touched gaps with small correctness changes before or
alongside the refactor, with failures demonstrated first.

## Existing harness limits and execution order

`scripts/smoke.ts` is not wholly offline: it contacts the configured default
daemon and assumes a particular companion instance/user/flavor. It provides
some authority/history/helper coverage but no controlled failure scenarios.
`scripts/fresh-install-test.ts` calls real bootstrap but does not dial the
server or assert the printed owner/mode values. Its stub discards all events,
and lacks resolver/progress APIs needed for broader contract tests. The
fresh-install script accepts arbitrary targets: do not turn it into an
unattended destructive suite without fixture ownership checks.

Recommended order:

1. Offline C1–C13 and X1–X7 contracts; script failure cases B3/B4; T1–T3 relay
   and event tests. Add faithful event emitters and controlled dependencies.
2. Demonstrate and repair confirmed failures that the optimization will touch.
   Keep unrelated policy discrepancies visible rather than deciding silently.
3. On an explicitly owned fixture, verify clean install → connect → healthy
   reuse → normal server restart → stale commit → wiped-install recovery;
   assert filesystem ownership/modes and actual byte/handshake success.
4. Real VS Code checks for single setup, switcher/Restricted Mode, two windows,
   terminal, forwarded port, and reconnect. Run the deployed stable version;
   use Insiders as an additional proposed-API compatibility check [V5, V7, V8].
5. Capture remote call/transfer counts and phase durations for fresh install,
   installed-but-stopped server and healthy reuse. Exclude tree enumeration
   from bootstrap counts. Record before/after on the same path (local vs TLS,
   cluster placement included); use deterministic injected delay for an offline
   latency experiment. Set an upper operation budget only after measuring
   the optimized design; do not lock in today's 12-ish calls or CI wall time.

Incus integration must select the full target explicitly and verify fixture
ownership before mutation. HANDOVER forbids touching production instances;
fixture identities are supplied only at runtime. Every fixture must be explicitly
identified as test-owned. No daemon reconfiguration, container
deletion/recreation, production enumeration-based selection, or VS Code
restart was performed for this review. A cluster member need not be pinned:
Incus routes instance operations through the cluster [I4]. Environment checks
must still describe the selected instance's actual behavior.

## Official sources checked

Current web docs inform CLI/API contracts; historical 6.0.5/7.5.1 quirks above
are backed by repository evidence, not inferred from today's docs. Crawl4AI
attempts could not produce pages under the local network restrictions; the
built-in web tool supplied the official documentation and source instead.

- [I1 — Incus command execution, identity, environment and pipe semantics](https://linuxcontainers.org/incus/docs/main/instance-exec/)
- [I2 — Incus exec CLI reference](https://linuxcontainers.org/incus/docs/main/reference/manpages/incus/exec/)
- [I3 — Incus file push CLI reference](https://linuxcontainers.org/incus/docs/main/reference/manpages/incus/file/push/)
- [I4 — Managing instances in a cluster](https://linuxcontainers.org/incus/docs/main/howto/cluster_manage_instance/)
- [I5 — Incus list syntax and filters](https://linuxcontainers.org/incus/docs/main/reference/manpages/incus/list/)
- [V1 — VS Code Tree View API: actions, context values and refresh](https://code.visualstudio.com/api/extension-guides/tree-view)
- [V2 — VS Code Views UX guidelines](https://code.visualstudio.com/api/ux-guidelines/views)
- [V3 — VS Code Remote Explorer contribution schema and implementation](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/viewsExtensionPoint.ts)
- [V4 — VS Code Workspace Trust extension guide](https://code.visualstudio.com/api/extension-guides/workspace-trust)
- [V5 — Managed resolver and message-passing proposal](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.resolvers.d.ts)
- [V6 — VS Code built-in window/folder commands](https://github.com/microsoft/vscode-docs/blob/main/api/references/commands.md)
- [V7 — Testing extensions in a real development host](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [V8 — Proposed API compatibility and enablement](https://code.visualstudio.com/api/advanced-topics/using-proposed-api)
