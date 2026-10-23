# Offline harness (task 1 only)

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
The verification so far is local, not a run on a hosted CI worker.

## Structure

- `build.cjs`: discovers top-level `*.test.ts` files, bundles each using esbuild
  into a temporary directory, runs Node's built-in test runner, propagates its
  exit status, and removes build output even on failure.
- `support/vscode.ts`: test-only events, disposables, subscription registration,
  and configurable workspace settings. Emitters register with the fixture for
  cleanup. It deliberately implements only the API needed for harness checks.
- `support/fixture.ts`: per-fixture AsyncLocalStorage, FIFO expectations, call
  recording, controlled children with real EventEmitter/PassThrough streams,
  temporary directories, cleanup callbacks, and fetch interception. Node's mock
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

## Adding tests after scope approval

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

Live smoke/fresh-install scripts remain separate and explicitly opt-in. This
suite does not execute shell scripts, start a relay, contact Incus, validate
application defects, or establish connection regression coverage. No production
source change is needed or proposed. Task 1 stops here for discussion before
regression coverage, correctness fixes, integration tests or optimization.
