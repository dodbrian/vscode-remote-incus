# Documentation

Start with the [project README](../README.md) for installation and usage, or the
[handover](HANDOVER.md) for the current stopping point and project history.
Commands and code paths in these documents are relative to the repository root
unless stated otherwise.

## Architecture and research

- [Design](DESIGN.md): architecture, decisions, and spike findings.
- [Release readiness](RELEASE-READINESS.md): publication audit and remaining decisions.
- [Alternatives](ALTERNATIVES.md): related projects and distribution research.
- [Phase-0 spike](spike/README.md): historical transport findings; implementation retained in Git history.
- [Third-party notices](ThirdPartyNotices.md): bundled asset attribution and licensing.

## Testing and verification

- [Testing guide](tests/README.md): offline, relay, and live verification commands.
- [Coverage](tests/COVERAGE.md): behavioral contracts, coverage, and remaining gaps.
- [Regression test plan](REGRESSION_TEST_PLAN.md): connection behavior contracts.

## Task plans and results

| Task                          | Plan                                          | Results                                                                  |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| 1: Offline test harness       | [Plan](TASK-01-OFFLINE-TEST-HARNESS.md)       | [Testing guide](tests/README.md)                                         |
| 2: Regression baseline        | [Plan](TASK-02-REGRESSION-BASELINE.md)        | [Coverage](tests/COVERAGE.md)                                            |
| 3: Connection correctness     | [Plan](TASK-03-CONNECTION-CORRECTNESS.md)     | [Results](TASK-03-RESULTS.md)                                            |
| 4: Real behavior verification | [Plan](TASK-04-REAL-BEHAVIOR-VERIFICATION.md) | [Results](TASK-04-RESULTS.md)                                            |
| 5: Connection optimization    | [Plan](TASK-05-CONNECTION-OPTIMIZATION.md)    | [Results](TASK-05-RESULTS.md), [measurements](TASK-05-MEASUREMENTS.json) |
