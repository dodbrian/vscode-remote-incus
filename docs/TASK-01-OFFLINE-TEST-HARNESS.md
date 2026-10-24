# Task 1: Establish the offline test harness

Status: ready for implementation; not started.

## Objective

Provide a reliable way to test the extension's real TypeScript logic under
Node without VS Code, an Incus daemon, or external network access. This is
step 1 of the regression-first connection optimization plan; use
[REGRESSION_TEST_PLAN.md](REGRESSION_TEST_PLAN.md) as context.

## Scope

1. Add an `npm test` entry using Node's built-in test runner. Reuse the
   existing TypeScript/esbuild toolchain where practical; avoid introducing
   an additional test framework without a concrete need.
2. Provide a test-only VS Code substitute with functional events,
   subscriptions and disposal, controllable configuration, and isolated
   state between tests. Extend its API only as required by harness checks.
3. Provide controlled process and network boundaries so tests can simulate
   command results, child-process streams, errors, exit and close events,
   and fetch responses. Unexpected external calls must fail immediately.
4. Add only the minimal harness checks needed to demonstrate event delivery,
   disposal, fixture isolation, interception of external calls, and loading
   a real source module through the test build.
5. Document how to run the offline suite and add future tests. Keep existing
   live smoke/fresh-install scripts separate and explicitly opt-in.

Prefer test-only module substitution or a small dependency boundary. Do not
restructure bootstrap merely to accommodate tests. If a production-source
change is necessary, keep it behavior-preserving and explain why.

## Acceptance criteria

- `npm test` runs after dependencies are installed, without an Incus binary,
  VS Code installation, daemon, credentials, downloads, or external network.
- Harness checks exercise real event behavior rather than no-op emitters.
- Each test starts with isolated fixtures; mocks, listeners, timers and
  temporary files are cleaned up, including on failure.
- An unexpected process invocation or external request produces a clear
  test failure rather than falling through to the host environment.
- Production bundling continues to use the real `vscode` module; test
  substitutes do not enter the extension bundle.
- `npm test`, `npm run typecheck`, and `npm run compile` pass.
- The completion report explains the harness structure, verification,
  limitations, and any proposed production-source changes.

## Boundaries

Do not implement the step-2 behavioral regression suite, fix application
defects, optimize connections, run live Incus tests, modify containers,
restart VS Code, redeploy, commit, or push as part of this task.

## Mandatory stopping point

Once the harness and its minimal checks are ready, report the result and
**stop and wait for discussion**. Do not proceed to regression coverage,
correctness fixes, integration testing, or optimization until the user
explicitly authorizes the next step. If a design decision blocks this
task's narrow scope, present the concrete tradeoff for discussion instead
of expanding the task.
