# Task 5: remote connection startup

**Complete, deployed and accepted on 2026-10-24.** After manual use, the user
reported “much better” and authorized task closure. The running session is left
intact. Source changes after checkpoints `e03dcf8` and `2a99945` remain uncommitted;
nothing was pushed or published. No next task starts automatically.

## Final design

After identity and the fresh client commit are resolved, two read-only execs run
in parallel: selected UID/HOME signal, architecture/libc and complete-install
checks; and root-view process plus health-file checks. Both finish before repair,
kill, transfer or start. The install probe splits the server-main filename in
argv so concurrent pgrep cannot mistake the probe for a running server.

All branches share those snapshots. Healthy matching-relay preparation combines
token permission repair with readiness/token reading: three execs in two waves
with warm identity. Relay content/UID/GID/0600 is checked on every bootstrap;
matching state skips push, mismatches are repaired and verified before dialing.
Symlinks are unlinked without writing through them, and unexpected directories
reject without deletion. Healthy reuse preserves active bridges and skips
pruning. Fresh startup retains bounded readiness polling, orphan sweeping and
best-effort pruning; installed-but-stopped startup takes seven execs.

`remote-incus.downloadStrategy` is application-scoped:

| Setting | Behavior |
| --- | --- |
| `auto` (default) | Try verified container download, then visibly fall back once to client transfer after an expected route failure. Custom mirrors go directly to client transfer. |
| `client` | Force cached client download, path-mode Incus push and post-transfer SHA verification. |
| `container` | Force container download; failures do not switch routes. Unsupported mirrors reject. |

Matching installations skip all archive work in every mode. Container mode
obtains exact commit/flavor metadata and publisher SHA client-side, then uses
existing curl over HTTPS into an exclusive 0600 UUID partial. SHA and ownership/
mode precede atomic publication and the existing extraction/marker safeguards.
Curl ignores automatic curlrc loading, preventing personal options from adding
retries or overriding the managed transfer policy. Metadata is bounded to 15 s;
curl uses 10 s connect/180 s total limits within a 210 s exec. Normal exec GID
behavior is unchanged; only download file creation explicitly supplies the
selected GID. No package, SSH setup or published server port is introduced.

Known publisher SHA remains authoritative during client fallback, before cache
publication/reuse as well as upload/extraction. Bad cached bytes and sidecars
are removed. If metadata is unavailable, the client route retains its existing
cache/hash/transfer checks. Unconfirmed partial cleanup and unexpected program
errors stop switching. Both-route failures preserve their causes. There is no
retry loop or new cross-session route/health cache.

## Measurements

[Compact measurements](TASK-05-MEASUREMENTS.json) retain runtime/state descriptions,
selected phase timings, original samples and final assertions. All comparisons
used the same authorized TLS remote fixture and matching client/server commit,
with warm identity for bootstrap timing. Private identifiers are omitted.

| Scenario | Original baseline | Integrated result |
| --- | ---: | ---: |
| Healthy reuse | 14.277 s; 10 execs + 1 relay push | Default auto: 2.744 s; 3 execs, no push |
| Installed, stopped | 12.857 s; 11 execs + 1 push | Explicit container run: 8.084 s; 7 execs, no push |
| Clean install | 141.096 s using client transfer | Explicit client: 139.397 s; default auto: 27.956 s |

These full-run wall times are single observations, not confidence intervals or
CI thresholds. They time bootstrap, not complete editor/window startup. Exec
counts include transfer-progress stats. Cold identity and resolver status add
work; tree enumeration and bridge setup are separate. The deterministic healthy
reduction is ten to three execs with no relay transfer and no safeguard removed.

Three-run experimental medians also demonstrated separate batching and native
keepalive benefits. Keepalive remains user-controlled and was not enabled in
the normal configuration. The experiment's full-archive single passes were:
stock CLI 106.071 s, sequential SFTP 103.062 s, concurrent SFTP 32.936 s,
HTTP 25.566 s and direct container download 7.139 s. Each transferred the same
222,356,453-byte archive with independent hash/metadata validation. The observed
roughly 2 MB/s CLI rate is not a WebSocket protocol ceiling. Experimental
prototypes and duplicate snapshots were removed after consolidation; checkpoint
`2a99945` retains their historical source if needed.

The final repeated forced fallback used a prefilled verified client cache,
forced one curl exit 22, visibly switched once, uploaded the full archive and
completed signed authentication. It took 154.986 s, with variable network upload
time; cache preparation was excluded. Subsequent reuse took 2.719 s and three
execs. No additional performance claim is inferred from this verification run.

## Correctness and manual acceptance

127 offline tests pass with no failures/skips. Typecheck, compile, standalone
manual-verifier typechecks, portable real-relay checks and injected-failure
cleanup pass. Retained tests cover inspection barriers/UID boundaries, process
self-matching, malformed snapshots, deduplication, three/seven-call budgets,
actual bash framing, extraction interruption, cache/hash gates, strict explicit
routes, default auto, mirrors, visible bounded fallback, both-route failures,
cleanup uncertainty and rejection before cache publication.

Live checks passed signed positive/negative authentication, install/relay/token
ownership and modes, relay SHA/GID/non-symlink state, marker/temp assertions,
healthy PID/port/token and two-channel preservation, relay repairs, stopped
startup, missing-token/wiped-install recovery, reset and synthetic stale
replacement. Controlled corruption, curl failure and real SIGTERM leave no
accepted archive/install/partial. Managed curl also downloaded the correct owned
archive with an injected invalid CURL_HOME configuration. All harness-owned
processes, files and configuration were cleaned before deployment.

The user then authorized normal-profile redeployment. The installed bundle and
relay were byte-compared with the packaged current build; public default auto
was verified. VS Code was restarted and opened on the authorized fixture.
The activation log showed fresh resolver completion in 29.872 s and two bridges;
the user subsequently confirmed the perceived improvement. This does not
constitute a new exhaustive editor/terminal/forwarding certification. The current
manual session/server is intentionally retained and is not cleanup residue.

## Boundaries and remaining work

Task 4's missing Ports view/forwarding verification and identical-folder
new-window behavior remain separate open issues. Broader versions/architectures,
root/mixed-user/GID policy and cross-window coordination were not redesigned.
Sequential probes/status, bridge setup, archive transfer and extraction remain
costs; further optimization is outside this completed task.

No further performance work is required for Task 5. The user authorized committing
the final implementation and cleanup for task closure; no push is implied.
