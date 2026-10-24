# Isolated Incus transfer experiment

This temporary module is an experiment, not a production transfer backend. It
makes no default-target selection, creates no instances, writes no Incus client
configuration and emits no target, address, argv, credentials or raw server errors.
The measured runs and limitations are recorded in TASK-05-EXPERIMENTS.md at the
repository root. Only an explicitly authorized disposable fixture may be used.

## Exact build

Built and vetted with Go 1.27.3 on Linux x86_64:

```
go mod tidy
go build -o incus-transfer-experiment .
go vet .
```

`go.mod` / `go.sum` pin `github.com/lxc/incus/v7 v7.5.1` and
`github.com/pkg/sftp v1.13.11`. No system CLI or daemon is replaced.

## Runtime inputs

Set these privately, then invoke the executable with an external timeout:

- `INCUS_CONF`: isolated Incus CLI configuration directory; the module uses the
  SDK's standard `cliconfig.LoadConfig("")`, which honors this variable.
- `INCUS_TEST_TARGET`: explicit `remote:instance`; no default remote fallback.
- `INCUS_TRANSFER_MODE`: `sftp-sequential`, `sftp-concurrent`, or `http`.
- `INCUS_TRANSFER_LOCAL`: the same complete regular local archive for each case.
- `INCUS_TRANSFER_REMOTE`: an owned, fresh, non-symlink
  `/tmp/incus-transfer-*.partial` destination. Only such paths are accepted.
- `INCUS_TRANSFER_UID` and `INCUS_TRANSFER_GID`: explicit numeric ownership.
- `INCUS_TRANSFER_MODE_BITS`: explicit octal mode, e.g. `600`.
- `INCUS_PROJECT`, if used: copied to the SDK's `ProjectOverride` just as the
  CLI does. Otherwise the chosen remote's configured project applies.

Use an isolated client configuration with keepalive disabled for this transfer
comparison. The SDK would otherwise honor the remote's native KeepAlive setting.
Do not change the user's normal configuration. The parent must ensure the
fixture is test-owned/idle and remove the specific destination before each run,
then validate and remove it afterward, including any timeout/failure path.

Example invocation after privately setting the required environment:

```
timeout 15m ./incus-transfer-experiment
```

## Controlled algorithm differences

- **sftp-sequential:** calls the pinned SDK's `GetInstanceFileSFTP`, whose
  constructor uses 128 KiB maximum packets and default sequential writes. It
  opens the target with create/write/truncate and copies via the same pinned
  `util.SafeCopy` used by CLI upload (4 MiB `io.CopyN` chunks).
- **sftp-concurrent:** calls `GetInstanceFileSFTPConn` and creates a client using
  the same 128 KiB packet limit plus `sftp.UseConcurrentWrites(true)`. Copying,
  metadata, close and result handling are otherwise the same as sequential.
- **http:** calls the pinned SDK's `CreateInstanceFile` with the archive as an
  `io.ReadSeeker`, file/overwrite mode and explicit UID/GID/mode headers.

Both SFTP helper variants apply ownership/mode using file-handle operations,
require those operations and close to succeed, and do not perform CLI timestamp
or StatVFS probing. The stock CLI's ownership/mode function contains additional
probes and treats some attribute failures as best effort. Therefore the helper's
sequential mode reproduces the **payload copy algorithm**, not every stock CLI
command's setup/metadata instruction. Compare the two helper SFTP variants to
isolate concurrent writes; retain the actual stock CLI as a separate baseline.

There is no application-side progress polling, progress callback or copy retry.
The stock extension's `pushFile` performs separate remote stat polling, so measure
that path separately with its polling behavior recorded. The helper writes only
a disposable `.partial` artifact; it never renames it into an accepted install or
archive path and never extracts it.

## Authentication, project and forwarding

The helper uses the official CLI configuration loader and `GetInstanceServer`,
not ad hoc certificate parsing. The pinned SDK performs configured TLS trust,
client authentication, OIDC where applicable, remote-address selection and
project query scoping. No insecure TLS option is introduced. Instance API
requests use the selected server's ordinary routes, allowing its existing
cluster forwarding; the helper does not pin or bypass a cluster member.

For HTTP, the SDK sets query attributes, metadata headers and a replayable body.
Its standard HTTP client preserves headers over redirects. `DoHTTP` includes its
own single replay on a 305 response when GetBody exists, and OIDC handling may
refresh authentication. These are inherited SDK behaviors, not a new application
retry loop. They are not counted separately by the helper, so do not claim an
exact network request count from its output. Do not generalize this experiment
to untested authentication/project/cluster configurations merely because the SDK
supports them.

Relevant pinned source locations:

- `shared/cliconfig/file.go`: LoadConfig and standard path/environment handling.
- `shared/cliconfig/remote.go`: remote trust/authentication, KeepAlive and project.
- `cmd/incus/main.go`: `INCUS_PROJECT` CLI override behavior.
- `client/incus_instances.go`: SFTP constructor, raw SFTP connection and HTTP file
  create body, query attributes and UID/GID/mode headers.
- `client/incus.go`: DoHTTP and inherited 305-body replay.
- `client/util.go`: TLS client construction and redirect-header handling.
- `cmd/incus/utils_sftp.go`: stock CLI SafeCopy and metadata behavior.
- `shared/util/io.go`: SafeCopy's 4 MiB chunks.

## Output and acceptance

Success prints one JSON object with `mode`,
`outcome: "success-unverified-partial"`, `bytes`, `connect_ms`, `upload_ms`, and
`total_ms`. Connection timing includes configuration/authenticated server setup.
Upload timing also includes SFTP channel setup where applicable, file/metadata
operations and file close. Final SDK disconnect and source close happen after
the recorded sample. Parent process launch timing can additionally capture
process startup/exit overhead.

**This result is not verification or permission to extract.** Outside the timed
section, the parent must compare full remote SHA-256 to the expected complete
local archive hash, assert byte size, UID/GID/mode and regular non-symlink state,
then delete the exact partial path. Concurrent SFTP errors can leave holes; file
size alone is insufficient. The HTTP metadata contract must also be verified
rather than inferred from a successful status.

Failures print fixed stage labels and exit nonzero. After connection and output
selection, ordinary failures attempt `DeleteInstanceFile`; cleanup is best effort
and any externally forced termination may prevent that defer. Parent teardown
must always remove/check the owned path, even after a failed helper or timeout.
No partial is ever accepted or installed by this program.
