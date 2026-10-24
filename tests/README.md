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

## Task 5 manual startup measurements

The live verifier emits sanitized `METRIC` JSON for tree configuration plus the
selected remote's instance enumeration, resolver status lookup, and individual
bootstrap scenarios. These are separate timings, not an end-to-end VS Code
window measurement. Bootstrap identity is already resolved by the safety
preflight, so all comparisons use a warm identity cache. Each run starts with
an empty temporary client archive cache and removes the fixture installation.
Healthy reuse and installed-but-stopped scenarios retain the same install and
cache from that run's clean install.

`scripts/startup-metrics.ts` instruments the manual process's Incus execFile
calls and file-push spawns. `execs` includes transfer-progress stat calls;
`pushes` and `bytes` count pushed files and payload bytes, excluding protocol
traffic and client download bytes. Phase entries record time **since the
preceding milestone**, with the first measured from scenario start. Percentage
updates are ignored. Instrumentation never records command arguments, output,
tokens or target identifiers. Measurement hooks are restored after each sample.
New samples include an `outcome` field and derive phase intervals from rounded cumulative timestamps,
so phase totals equal wall time. The original retained artifact predates these
instrumentation refinements and reports rounding residuals explicitly. An
`outcome: success` marks bootstrap completion; require the corresponding
authentication PASS and successful cleanup/exit as well.

Use the same explicit target, signing module and destructive opt-in documented
above. Set `INCUS_TEST_RELAY_REPAIRS=yes` for final verification of missing,
symlinked, modified and incorrect ownership/mode relay states while two
authenticated channels remain open. These extra cases are deliberately omitted from the
before/after timings for the three equivalent primary states. Keep raw logs
private; publish only sanitized measurements and runtime/state descriptions.
No timing threshold is a CI gate. Offline tests enforce a deterministic maximum
operation count on the healthy path and retain safety assertions separately.
