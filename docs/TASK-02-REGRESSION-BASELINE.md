# Task 2: Establish the passing regression baseline

Status: not started; depends on Task 1 and discussion of its result.

## Objective

Protect existing connection and Explorer behavior before changing production
sequencing. Use [REGRESSION_TEST_PLAN.md](REGRESSION_TEST_PLAN.md) and the
harness from [Task 1](TASK-01-OFFLINE-TEST-HARNESS.md).

## Scope

1. Add offline coverage for exact instance targeting, CLI list compatibility,
   identity selection, signal checks, commit/flavor selection, healthy reuse,
   stale-server handling, readiness failures, in-flight deduplication and
   non-fatal cleanup (C1–C13).
2. Cover cache/transfer decisions, token handling, relay freshness and push
   progress using controlled dependencies (B1–B6 where already implemented
   correctly). Do not require an Incus daemon or a real server download.
3. Cover bridge argument construction, byte delivery, independent channels,
   and managed lifecycle events using functional process/event fixtures.
4. Cover Explorer registration and manifest contracts, command delegation,
   current/new-window intent, history isolation/capping, active icons,
   unavailable-remote behavior, progress and error surfaces (X1–X8).
5. Map implemented tests to plan IDs and record gaps requiring executable
   scripts, real Incus or VS Code. Keep known defects explicitly separate
   from the passing baseline.

## Acceptance criteria

- Assertions protect observable outcomes and safety-critical side effects;
  they do not freeze entire shell strings, private helper calls or today's
  sequence/number of remote operations.
- Same-named instances on different remotes and identical folder paths on
  different authorities remain isolated.
- Healthy reuse performs no tarball work or server/active-relay killing;
  connect commands do not pre-run bootstrap.
- Fault cases distinguish missing instances from daemon/CLI failures.
- Known failures are documented honestly, not encoded as desired behavior
  or hidden by unexplained skips. Do not claim an offline mock proves a
  successful real handshake, rendered UX or cross-window locking.
- `npm test`, `npm run typecheck`, and `npm run compile` pass for the agreed
  baseline; report coverage, uncovered contracts and discovered defects.

## Boundaries

Do not fix production defects, decide conflicting root/token/multi-user
policies, optimize connections, run live Incus or VS Code checks, redeploy,
commit, or push. Necessary testability changes must preserve behavior and
be explained. Do not expand this task to implementing every deferred feature.

## Mandatory stopping point

Report the baseline and outstanding gaps, then **stop and wait for
discussion**. Do not begin Task 3 or any live verification automatically.
