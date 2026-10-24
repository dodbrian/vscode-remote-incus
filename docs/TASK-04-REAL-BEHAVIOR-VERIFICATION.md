# Task 4: Verify real shell, relay, Incus and VS Code behavior

Status: not started; depends on Task 3 and discussion of its result.

## Objective

Verify the contracts that mocks cannot prove, using
[REGRESSION_TEST_PLAN.md](REGRESSION_TEST_PLAN.md) and the baseline/fixes from
[Task 2](TASK-02-REGRESSION-BASELINE.md) and
[Task 3](TASK-03-CONNECTION-CORRECTNESS.md).

## Scope

1. Run actual shell fragments against temporary filesystem fixtures, checking
   failure propagation, marker publication and token permissions/content.
2. Run the bundled relay against a local TCP fixture. Verify arbitrary binary
   bytes, independent channels, EOF, socket failure and process teardown.
3. Make live integration explicit and opt-in. Before mutation, identify the
   complete remote/instance target and establish that it is test-owned and
   available for these scenarios. Follow HANDOVER's production isolation rule.
4. On that fixture, exercise clean install, healthy reuse, installed-but-not-
   running startup, stale-commit replacement and wiped-install/token recovery.
   Verify actual connectivity/handshake, ownership, modes and temporary-file
   cleanup. Check existing parallel channels survive healthy reuse.
5. In a separate VS Code test/development profile, check Remote Explorer
   selection and actions, Restricted Mode, current/new-window behavior,
   one-step folder reconnect, two windows, terminal, forwarded loopback port
   and reconnect. Use user-assisted visual checks where automation is absent.
6. Record versions and which contracts were verified locally, over TLS,
   against a cluster, or only through fixtures. Stable is the primary runtime;
   Insiders is an additional compatibility check when available.

## Acceptance criteria

- Every live mutation is restricted to an explicitly identified test fixture;
  no default-remote/first-instance selection or production mutation occurs.
- Returned sessions actually connect; printed port/token presence alone is
  insufficient. Never print token values in reports or logs.
- Permissions/ownership are asserted, not merely displayed.
- Relay teardown uses bounded eventual checks and leaves no test processes
  or owned temporary artifacts behind on success or failure.
- Real window checks distinguish verified rendering/behavior from static
  manifest assertions. Unavailable checks are reported as unverified.
- Report results, environmental limitations and any defects without claiming
  unsupported architectures or CLI versions were tested.

## Boundaries

Do not reconfigure daemons, alter production instances, use destructive
recovery scenarios on an active user session, or restart the user's normal
VS Code session. No automatic container creation/deletion, deployment,
commit, push, or performance refactor. Establish fixture authorization and
availability before dependent live work; continue independent local checks
while any necessary clarification is pending.

## Mandatory stopping point

Report evidence and outstanding issues, then **stop and wait for discussion**.
Do not begin optimization or broaden live testing automatically. Any defect
requiring a new production change must be presented with its reproduction.
