# Task 5: Measure and optimize remote connection startup

Status: not started; depends on Task 4 and discussion of its evidence.

## Objective

Reduce avoidable remote startup work while preserving the established
regression contracts. Use [REGRESSION_TEST_PLAN.md](REGRESSION_TEST_PLAN.md)
and the verified baseline from
[Task 4](TASK-04-REAL-BEHAVIOR-VERIFICATION.md).

## Scope

1. Measure before changing behavior: phase timings, remote operation counts
   and transfers for clean install, installed-but-stopped server and healthy
   running-server reuse. Separate tree enumeration from resolver/bootstrap.
2. Record client/server versions, transport, instance location, cache state
   and server state so before/after comparisons describe equivalent cases.
   Use existing explicitly authorized test fixtures for live measurements.
3. Reduce sequential remote setup by batching compatible probes/operations,
   preserving identity, signal, install, token and health guarantees.
4. Avoid relay transfer when its content and required metadata already match;
   repair missing/changed relay state before dialing.
5. Combine readiness/token reads where sound, and avoid unnecessary cleanup
   on healthy reconnect. Consider in-instance readiness polling for fresh
   startup while retaining bounded waiting and actionable failures.
6. Make small reviewable changes. Run affected regressions after each coherent
   change; repeat the relevant real-behavior checks on the final result.

## Acceptance criteria

- Before/after results show which operations/transfers disappeared and how
  startup time changed on the same connection path and equivalent states.
- Performance claims distinguish observed wall time from deterministic
  operation-count or injected-latency tests; no brittle CI timing threshold.
- Tests allow fewer remote calls while preserving essential safeguards.
- No extra container internet dependency, SSH setup, published server port,
  token exposure, active-bridge killing, duplicate bootstrap or hidden retry
  loop is introduced.
- `npm test`, `npm run typecheck`, and `npm run compile` pass; relevant real
  connection/recovery checks pass or limitations are explicitly reported.
- Report the final design, measured benefit, correctness evidence and remaining
  bottlenecks. Update technical docs where the implemented flow changes.

## Boundaries

Do not redesign the frozen exec-stdio transport, introduce cross-session caches
without invalidation evidence, relax correctness checks to meet a timing target,
or change unresolved policies. No production-instance mutation, normal-user
VS Code restart, deployment, commit, or push as part of this task.

## Mandatory stopping point

Once measurements, changes and scoped verification are complete, **stop and
wait for discussion**. Present the concrete result for review; do not deploy
or start further optimization rounds automatically.
