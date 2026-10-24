# Regression, script and relay verification

Run `npm test` with installed dependencies and Node 22.13+ (the extension build
also targets Node 22). Verified locally with Node 24.21.0. No additional test
framework or dependency is installed. `npm run typecheck` checks production and
test TypeScript separately; `npm run compile` retains the production build.

## CI

Use Node 22.13+ with development dependencies installed, then run these steps
from the repository root. The existing lockfile supplies dependency versions:

```sh
npm ci --include=dev
npm test
npm run test:relay
npm run typecheck
npm run compile
```

Only dependency installation needs registry access (or a populated npm cache).
The suite itself needs no network, secrets, display server, VS Code or Incus
installation. It uses the system temporary directory, works without a TTY,
prints TAP for CI logs, and returns a nonzero status on build/test failure or
missing test files. Each test file has a 30-second runner timeout to bound
hangs. Normal test completion/failure cleans temporary output; forced process
termination relies on the CI runner's temporary-directory cleanup.

These commands are CI-ready; no provider-specific workflow is added in task 1.
Verification is local, not a run on a hosted CI worker. Task 2 coverage and
its exact limits are recorded in [COVERAGE.md](COVERAGE.md).

## Structure

- `build.cjs`: discovers top-level `*.test.ts` files, bundles each using esbuild
  into a temporary directory, runs Node's built-in test runner, propagates its
  exit status, and removes build output even on failure.
- `support/vscode.ts`: test-only events, disposables, subscription registration,
  and fixture-scoped workspace/authority settings, URI/tree models, command
  registration and controlled host actions. Emitters register for cleanup.
  This is a minimal host substitute, not a VS Code implementation.
- `support/fixture.ts`: per-fixture AsyncLocalStorage, FIFO expectations, call
  recording, controlled children with real EventEmitter/PassThrough streams,
  temporary directories, cleanup callbacks, and fetch interception. FIFO
  expectations take precedence over explicitly configured operation routes;
  routes model variable-count operations such as port polls. Node's mock
  clock controls Date, timeout, interval and immediate scheduling and resets in
  finally. Cleanup attempts every registered action even if another one fails.
- `harness.test.ts`: five harness checks covering events/disposal, failure-path
  fixture isolation/cleanup, real `src/incusCli.ts` loading through the test
  build, child events/bytes, fetch responses, and fail-closed process/network
  calls. These are harness checks, not the step-2 behavior contracts.

The test build substitutes `vscode`, both prefixed/unprefixed `child_process`,
`net`, `http`, `https`, `http2`, `tls`, `dns`, `dgram`, and their promises imports.
Module exports are enumerated at build time; calls route to fixture expectations
rather than real implementations. Unexpected calls throw immediately and are
recorded, so source catching the error cannot turn a fixture green. Unconsumed
expectations also fail. Fetch never delegates to the host implementation.
Production `esbuild.js` is unchanged and keeps `vscode` external. Test sources
are excluded from VSIX packaging.

## Adding offline tests

Add `tests/name.test.ts` and import real code from `../src/…`. Use:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withFixture } from './support/fixture';

test('example', t => withFixture(t, async f => {
  f.expect('fetch', () => Promise.resolve(new Response('fixture')));
  assert.equal(await (await fetch('https://offline.invalid')).text(), 'fixture');
}));
```

Declare one expectation per invocation. Handlers receive original arguments;
execFile handlers invoke the supplied callback with controlled results/errors.
Spawn handlers can return `childProcess()` and emit stdout/stderr data, error,
exit and close independently. Responses may use tiny Response/ReadableStream
fixtures or rejected promises. Use `t.mock.timers.tick(ms)` for time advancement;
await all asynchronous work before leaving the fixture. Put files beneath
`f.directory` and register other disposables in `f.subscriptions` or `f.defer`.
Use sequential fixtures within each test file: mock clocks and fetch are global
in that test process, so concurrent fixtures are unsupported. Separate test
files run in isolated Node test processes.

## Task 3 correctness regressions

All repaired known-defect cases now run in `npm test`; the separate red command
was removed. See [Task 3 results](../TASK-03-RESULTS.md) for failure-before-fix
evidence and remaining boundaries. `recovery.test.ts` and
`mutating-scripts.test.ts` deliberately load local child_process through
createRequire to execute captured production bash in temporary directories.
They require bash, tar and ordinary GNU/Linux utilities, redirect selected home
and archive paths, and never invoke Incus or launch a real server. This is the
explicit script-test exception to the mocked process boundary.

`support/scenario.ts` supplies a temporary-storage context and semantic remote
command model. It recognizes script intent and rejects unmodeled scripts;
it does not execute scripts or prove their shell behavior. Tests use unique
instance refs to avoid identity-cache leakage across fixtures; production module
state is deliberately retained when testing retries, caching and deduplication.
Commands and VS Code env/workspace data are fixture-owned. No production-source
testability changes were necessary.

## Limits and boundary

This is a controlled module boundary, not an OS sandbox. Host filesystem APIs
remain real for temporary-file tests. Alternative transports, native addons,
workers, dynamic require bypasses and external packages that hide their own I/O
need an explicit boundary before use. Promisified/native module constants and
full ChildProcess semantics are not modeled; extend only for an agreed test.
The VS Code substitute is not a host/UI compatibility claim. esbuild resets
source module state between test files, not between fixtures in the same file;
future stateful source tests need deliberate module-state isolation or a small
reviewed dependency boundary. Fixtures isolate their own state and resources.

Live smoke/fresh-install scripts remain separate and explicitly opt-in. The
suite executes local shell cases but does not start a real relay or contact
Incus. The separate Task 4 relay/live commands and completed verification
evidence are described below. Its discussion gate has been resolved; further
work requires explicit next-step authorization.

## Task 4 portable verification and private manual integration

Scoped verification is complete; see [TASK-04-RESULTS.md](../TASK-04-RESULTS.md).
The Ports view was unavailable, so real VS Code forwarding is unverified.
Already-open identical-folder new-window requests reuse the existing window;
distinct-folder concurrent windows and reconnect passed. The results have been
discussed and the Task 4 discussion gate resolved; fixes or further testing
still require explicit next-step authorization.

`npm run test:relay` runs the bundled relay with real local TCP sockets and child
processes. `node scripts/verify-relay.cjs --exercise-failure-cleanup` also
injects a failure with two live channels and requires cleanup to pass. It checks all byte values, simultaneous independent channels, stdin
EOF, peer closure, connection refusal, stdout EPIPE and repeated teardown. Every
wait is bounded; cleanup runs after failures as well as success. It needs Node
and loopback TCP access, no Incus daemon, server download or credentials. CI may
run this alongside `npm test`; the latter includes the executable bash cases.

`scripts/verify-live.ts` is **manual and destructive**, excluded from CI and
packaging. It refuses missing/implicit targets, missing destructive opt-in and
any nonempty `CI` environment variable. There is no repository-owned remote,
address or instance. Supply `INCUS_TEST_TARGET` privately as an explicit
`remote:instance` and `INCUS_TEST_ALLOW_DESTRUCTIVE=yes` only after establishing
that the instance is test-owned, idle and permitted by local isolation rules.
It removes the selected user's server installation and replaces running server
processes on that fixture; do not use a personal workspace or active session.
It never creates/deletes instances or changes daemon configuration.

After setting the three runtime variables privately, build/run from the repo
root using installed dependencies:

```sh
task4_bundle=$(mktemp /tmp/remote-incus-live-XXXXXX.cjs)
trap 'rm -f "$task4_bundle"' EXIT
./node_modules/.bin/esbuild scripts/verify-live.ts --bundle --platform=node \
  --alias:vscode=./scripts/vscode-stub.js --outfile="$task4_bundle" &&
  node "$task4_bundle"
```

Keep its output private; it intentionally emits fixed scenario labels and suppresses
production diagnostics. Do not put target values into scripts, workflow files,
reports or committed shell history. Delete the temporary bundle afterward.
The context, downloads and server installation created by the run are removed
at completion; inspect cleanup failures before any retry. There is no promise
to restore the fixture's preexisting server installation.

The manual harness checks fresh install, healthy reuse with two signed
management channels and live protocol traffic, installed-but-stopped startup,
missing token, wiped installation, explicit reset and a synthetic stale-commit
process. It performs a WebSocket upgrade, token authentication and signed
management handshake, requiring signature validation and `ok` for the valid token and
`error` for an invalid token. Supply the installed stable client's `vsda` module
path privately in `INCUS_TEST_VSDA_PATH`; no binary is copied into the repo.
It sends a protocol disconnect before EOF. A management handshake through the
bundled relay does not prove editor/terminal/forwarded-port behavior; those
require a real development window.

For window checks, use a fresh temporary `--user-data-dir` and
`--extensions-dir`, this checkout's isolated bundle through
`--extensionDevelopmentPath`, and `--enable-proposed-api=local-dev.remote-incus`.
Do not install a VSIX, run redeploy.sh or restart normal windows. Supply only
the authorized explicit authority at runtime. User data, logs and history may
contain private infrastructure details: keep them outside the repository and
remove them after the development windows exit. Check, with user assistance:

- Remote Explorer selector, row selection, hover/context actions and icons.
- Restricted Mode activation, progress and show-log link.
- Current/new-window intent, recent folders and one-step folder reconnect.
- Two concurrent windows, file access and integrated terminal.
- A fixture-owned loopback HTTP listener, forwarded port, reload/reconnect.

Record actual observations separately from static/offline assertions. Report
unavailable checks as unverified. Stable is primary; Insiders is additional
only when installed. Do not attach raw private logs or token values to reports.

## Task 5 startup and download verification

Task 5 is deployed and manually accepted. Consolidated results, measurement
boundaries and remaining limits are in [TASK-05-RESULTS.md](../TASK-05-RESULTS.md)
and [TASK-05-MEASUREMENTS.json](../TASK-05-MEASUREMENTS.json).

The current flow uses three healthy-reuse execs and seven installed-stopped
execs with warm identity. Tests protect the inspection barrier, numeric UID/HOME
and root boundaries, process-search self-matching, actual bash readiness/token
framing and common recovery. Performance budgets allow fewer calls; no CI wall-
time threshold replaces correctness checks.

`tests/container-download.test.ts` executes actual download bash with only curl
stubbed. It covers metadata/schema/URL failures, expected SHA, archive reuse,
missing/failing curl, corruption, SIGTERM, safe symlinks, atomic publication and
partial cleanup. Default auto, strict explicit overrides, mirrors, one visible
fallback, cached offline fallback, both-route errors and uncertain cleanup are
covered. Publisher SHA must match before client cache publication/reuse as well
as push/extraction. The curl fixture requires `--disable` first, so user curlrc
options cannot add retries. Legacy scenarios explicitly choose client; auto
tests remove that override to test the real public/runtime default.

### Manual live checks

All live checks require an explicitly authorized idle disposable fixture and
`INCUS_TEST_TARGET=remote:instance` plus `INCUS_TEST_ALLOW_DESTRUCTIVE=yes`.
They refuse CI and never choose/create an instance automatically. Use private
runtime values and keep raw logs outside Git. Never run them against the active
manual session left open for the user.

Bundle each TypeScript entry with esbuild, `--platform=node` and
`--alias:vscode=./scripts/vscode-stub.js` as shown above. The test-only stub maps
`INCUS_TEST_DOWNLOAD_STRATEGY`; production reads normal VS Code configuration.

| Verifier | Coverage and additional requirements |
| --- | --- |
| `scripts/verify-live.ts` | Full signed handshake, positive/negative authentication, ownership, reuse, recovery and teardown. Requires `INCUS_TEST_VSDA_PATH`. Leave strategy unset for auto, or set auto/client/container explicitly. `INCUS_TEST_RELAY_REPAIRS=yes` adds symlink/content/metadata repairs with two live channels. |
| `scripts/verify-auto-fallback.ts` | Linux x64, auto only, signing module required. Prefills a verified client archive, injects one curl exit 22 only through the download exec's PATH, and requires one visible switch, real upload/extraction, signed authentication and surviving channels. Cache preparation is outside timing. |
| `scripts/verify-container-download-failures.ts` | Requires no install/archive. Controlled corruption, exit 22 and actual SIGTERM/exit 143 must leave no accepted archive/install/partial. Uses a scoped fake curl, not a system binary replacement. |
| `scripts/verify-container-curl-config.ts` | Requires no install/archive. Proves ordinary curl reads an injected invalid CURL_HOME config, then verifies managed download SHA/metadata with it present. The control checks diagnostics because curl can warn and continue. |

Run verifiers sequentially and require bounded successful teardown between them.
The last two checks need client metadata access but no signing module. Owned
fake-downloader/config directories and archives are removed in finally; normal
PATH, curl config and Incus settings are not edited. These checks do not simulate
a real 180-second outage or certify unrelated policies/platforms.

### Measurement semantics

`scripts/startup-metrics.ts` temporarily instruments Incus execFile calls and
file-push spawns, restoring hooks after success/failure. It records no argv,
stdout, target or token. `execs` includes progress stat calls; pushed bytes
exclude CDN downloads and protocol overhead. Phases are elapsed since the
preceding milestone; rounded cumulative timestamps make totals equal wall time.
The earliest baseline rounded individual percentage events before coalescing,
so its retained rounding residual is explicit.

A success metric marks bootstrap completion; require subsequent authentication
PASS and final cleanup/exit as well. Tree configuration/selected-remote listing
and resolver status are separate timings, not rendered tree/window benchmarks.
Safety preflight warms identity. Each full run starts with an empty private
client context and absent install; reuse/stopped cases retain the matching
installation and cache from that run. Preserve equivalent states and distinguish
observed wall times from deterministic call counts in any later comparisons.
