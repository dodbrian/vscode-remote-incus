# Task 3: Expose and repair connection-path defects

Status: not started; depends on Task 2 and discussion of its findings.

## Objective

Fix demonstrated correctness defects before optimizing the affected paths.
Use [REGRESSION_TEST_PLAN.md](REGRESSION_TEST_PLAN.md), especially its existing
gaps, and the baseline from [Task 2](TASK-02-REGRESSION-BASELINE.md).

## Scope

1. Reproduce failed extraction with the actual shell script and a corrupt
   archive in a temporary directory. Assert failure does not publish an
   install-success marker or make an incomplete installation reusable.
2. Repair extraction error propagation and interruption recovery with the
   smallest coherent change. Inspect other mutating scripts for the same
   error-masking pattern; report additional findings before expanding scope.
3. Demonstrate missing-token/wiped-install recovery defects. Ensure state
   repaired during bootstrap cannot falsely establish that an existing
   process still has valid installation/token state.
4. Demonstrate asynchronous bridge spawn-error propagation and final-byte
   delivery. Ensure the managed client observes failure and terminal events
   without lost trailing data or duplicate lifecycle notifications.
5. Add a failing regression before each repair and retain it afterward.
   Document any case that still needs a real handshake in Task 4.

## Acceptance criteria

- Each fix has a demonstrated failing case and passing result afterward.
- Failed extraction remains recoverable and cannot return false success.
- Recovery preserves healthy sessions but does not trust a reminted token
  merely because its file now exists.
- Spawn failures reach callers through rejection or managed closure, as
  appropriate to the channel's state; no invisible hung connection remains.
- `npm test`, `npm run typecheck`, and `npm run compile` pass.
- Report changed behavior, evidence, limitations and remaining defects.

## Boundaries

Do not optimize round trips or change the transport, root fallback,
multi-user scope, normal token lifecycle or public error policy without
discussion. Do not run live container mutations or restart VS Code here.
Do not redeploy, commit, push, or silently absorb unrelated defects.

## Mandatory stopping point

After the scoped fixes and offline/script verification, **stop and wait
for discussion**. Present any policy choices or additional fixes separately.
Do not proceed to Task 4 automatically.
