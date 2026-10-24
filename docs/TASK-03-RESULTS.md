# Task 3 results — stop for discussion

Task 2's completed/accepted baseline is recorded in HANDOVER.md. The user's
Task 3 request authorized this step; a subsequent instruction explicitly
expanded this session to cover the additional regressions found during it.
No Task 4 work is authorized by this report.

Production fixes are implemented in `src/bootstrap.ts` (installation, recovery
and mutating scripts), `src/bridge.ts` (spawn and channel lifecycle), and
`src/incusCli.ts` (late transfer progress). The retained tests verify these
code changes.

## Changes and failure evidence

Each repaired defect first failed an intended-behavior regression against the
then-current implementation. Tests remain in the normal `npm test` gate.

| Defect | Before repair | After repair / retained evidence |
| --- | --- | --- |
| Corrupt extraction | Actual generated bash returned success after tar failed | `recovery.test.ts`: nonzero extraction, no success marker, probe rejects incomplete install; identical script retries successfully with tiny valid tar |
| Interrupted extraction | Complete-looking partial files passed the legacy probe | `.incus-installing` rejects interrupted state, even if core files exist. Actual SIGTERM after unpacking leaves no success marker; retry rebuilds successfully |
| Historical false success marker | Marker alone blessed missing files | Probe always requires launcher, Node and server-main plus no in-progress marker; complete legacy installs still work without a marker |
| Repair-before-health | Lost token/install recreated before the check; existing process reused | Pre-repair installation/health evidence decides reuse. Lost token, wiped install and incomplete install with surviving launcher/log/token force kill/start; existing healthy-session tests still require no kill/start/sweep |
| Early spawn error | Promise resolved before caller could observe error | Bridge waits for spawn; early error rejects. Synchronous spawn exceptions also reject |
| Published-channel spawn/process error | Rejection of already-resolved Promise was invisible | Managed closure observes error exactly once; subsequent close/error cannot duplicate notification |
| Final stdout | Exit disposed delivery before stdio close | Clean/nonzero/signal fixtures deliver final bytes before one terminal event, reject post-terminal data, and keep independent channels isolated |
| Late push progress | In-flight stat reported after completion | `push-progress.test.ts`: polling/report guards ignore late results; existing meter/failure/timeout coverage remains green |
| Token mutation masking | mkdir/mv/generator errors hidden by later successful chmod | Actual bash failure injection in `mutating-scripts.test.ts`: fail-fast essential steps; verify generated length before atomic rename. Actual successful mint/reuse verifies 43 alphanumerics, mode 0600, no temp residue and unchanged sticky token |
| Start script masking | Failed old-log removal hidden by launch echo | Actual bash injected removal error now fails before detached launch. Asynchronous server startup errors still use existing bounded port/log diagnostics |
| Pruning masking | Earlier rm failure hidden by later successful rm; cd failure silently ignored | Actual bash injected rm/cd failures propagate to the existing nonfatal prune logger; connection readiness remains unaffected |
| Uninstall masking | Server-directory removal failed but archive cleanup returned success | Actual bash injected first-removal error rejects rather than returning false uninstall success |

The first batch was 59 passing baseline cases plus six new failures. Expanded
script/progress/incomplete-install cases subsequently produced eight failures;
the stale-marker, early-spawn and prune-cd cases each failed separately before
repair. These are ordinary assertions, without skips or expected-failure
inversion. The three original known-defect tests have moved into the normal
suite; the obsolete separate red runner was removed.

## Verification and boundaries

Final local verification: **80 tests passed, 0 failed, 0 skipped**;
`npm run typecheck`, `npm run compile`, and `git diff --check` passed.
Script cases require local bash, tar and ordinary GNU/Linux utilities. They
execute captured production shell text with home/archive paths redirected to
temporary directories, tiny archives and scoped command failure injection.
No Incus command or server process runs on the host. Other daemon/process/API
boundaries remain modeled with EventEmitter/PassThrough fixtures.

This worktree initially shared `dist` with the primary checkout through a
symlink. Compilation output was isolated into a worktree-local ignored `dist`
directory before compilation. No shared bundle overwrite, live container
mutation, VS Code restart, deployment, commit or push was performed.

## Remaining evidence and policy boundaries

The user-supplied review found no actionable regressions in the staged,
unstaged or untracked changes. The reviewer reported all 80 offline tests and
TypeScript checking passing. Live Incus and VS Code handshake behavior remains
unverified; the review does not replace Task 4 verification or authorize it.

Task 4 still needs an explicitly authorized real handshake for fresh install,
healthy reuse, normal restart, missing token, wiped installation and explicit
reset, plus real detached survival, ownership, listener/authentication, relay
bytes/EOF/process cleanup and VS Code managed-host behavior. Offline health
checks do not prove an existing file's token equals the running process's
in-memory token. Nonempty externally replaced/malformed tokens, stale ports,
external filesystem races and cross-window synchronization remain outside this
repair. No new token rotation/validation policy was selected.

The mutating-script audit covers bootstrap token/install/start/prune/uninstall,
reset and kill/sweep helpers. Kill/sweep intentionally tolerate absent matches;
changing pkill failure taxonomy or all-user matching needs policy discussion.
The prior first/mixed-commit selection, multi-user and primary-GID scope, root
fallback, identity-cache invalidation, resolver taxonomy and current-window
folder behavior remain deferred; this session did not newly demonstrate those
older gaps. No round-trip optimization or transport change was made.

**Mandatory stopping point reached: stop and wait for discussion.** Do not
start Task 4, deploy, commit or push automatically.
