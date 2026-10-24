# Additional Task 5 performance experiments

Status: authorized experiments complete; stopped for discussion. No experimental
runtime change was applied to production source or normal client configuration.
No deployment, normal-user VS Code restart, commit, push or next task occurred.

## What changed the assessment

The earlier description of roughly 2 MB/s as a "WebSocket ceiling" was an
unsupported explanation of an observation. On this connection, changing the
upload mechanism moved the same verified archive much faster. Batching and
native connection reuse also produced independent healthy-reconnect benefits.
The original Task 5 observations remain unchanged in TASK-05-MEASUREMENTS.json.

## Healthy reconnect matrix

Three observations per cell, interleaved by condition; the implementation order
was reversed in the middle round. All used the same matching server installation,
relay, sticky token and live server. Both implementations had warm identity
caches and two signed management channels already open. Status lookup, tree
rendering and VS Code window startup are outside these bootstrap measurements.

| Implementation | Keepalive disabled | Enabled, cold proxy | Enabled, warm proxy |
| --- | ---: | ---: | ---: |
| Current: 7 execs, 0 pushes | **8.503 s** (8.380–8.739) | **6.378 s** (6.303–6.438) | **5.974 s** (5.675–6.698) |
| Experimental: 3 execs, 0 pushes | **2.872 s** (2.738–3.969) | **2.549 s** (2.547–2.653) | **2.065 s** (2.045–2.067) |

Bold values are medians; parentheses show observed ranges, not confidence
intervals. These are small samples with no CI timing threshold. Combined batching
and a warm native proxy reduced observed median bootstrap time by 75.7% relative
to the current implementation with keepalive disabled. It does not establish
an equivalent reduction in end-to-end editor startup.

Each result authenticated successfully and preserved server PID, port and token.
Both original management channels remained live and exchanged subsequent traffic.
A separate check opened two channels through the keepalive proxy and verified
that they survived another batched bootstrap.

Keepalive used separate private copies of client configuration with timeout 0 or
30 seconds. Cold samples terminated only the isolated proxy before measurement;
warm samples primed it outside measurement. Proxy startup is included in cold
sample time. Logical exec counts exclude the native CLI's internal proxy/API
activity. The normal configuration remained byte-identical to the disabled copy.
No normal keepalive setting was enabled. Native keepalive is documented by
[Incus](https://linuxcontainers.org/incus/docs/main/remotes/#enabling-keepalive).

### Experimental batching design and limitation

1. In parallel, take selected-user signal/flavor/install and root-view
   process/health snapshots.
2. Wait for both before permitting any repair or setup mutation.
3. On the fully healthy path, combine selected-user token/relay preparation
   and readiness/token reading in one exec.

A concrete concurrency hazard surfaced during prototyping: the install probe's
argv originally contained `server-main.js`, so the parallel root process search
could identify the probe itself as a running server. Splitting that shell path
token avoids the false match without changing the file checked.

The prototype is deliberately a healthy-path experiment. Other states fall back
to the unchanged baseline and repeat two or three read-only probes. It is not a
production-ready replacement or a stopped/fresh-start optimization. Live relay
repair, stopped-server, missing-token and wiped-install fallback checks passed.
The wiped-install case used a verified preseeded archive, so it is not another
cold-transfer timing. Strict prototype typechecking, build, offline orchestration
checks and executable selected-user shell checks passed before live use.

## Full archive transfer comparison

The same 222,356,453-byte server-linux-x64 archive was used in each case. Expected
SHA-256 came from Microsoft metadata for client commit
`e646868227c3e3a9e3f24277c8c7220be42c0be7`:
`5cc911f00c7fd762afa1f978485d9604ceac5984f2b5e6607d981092f894326a`.

| Transfer method | Observed caller wall time | Payload rate |
| --- | ---: | ---: |
| Installed CLI path-mode push | 106.071 s | 2.10 MB/s |
| SDK sequential SFTP | 103.062 s | 2.16 MB/s |
| SDK concurrent SFTP writes | 32.936 s | 6.75 MB/s |
| SDK HTTP file upload | 25.566 s | 8.70 MB/s |
| Direct container CDN download | 7.139 s | 31.15 MB/s |

These are **one full-archive observation per method**, run sequentially in table
order with keepalive disabled and client progress polling disabled. Caller time
includes connection/process setup; external verification time is excluded.
Different SDK/CLI setup details and time-varying network conditions prevent an
exact causal attribution of every difference. The two helper SFTP variants use
the same copy algorithm and metadata handling, changing the concurrent-write
option. The helper omits some stock CLI metadata/progress work; it is not a
bit-for-bit recreation of the CLI. No claim about polling overhead is inferred.

Every output was initially a disposable `.partial` artifact. Independent checks
verified full SHA-256, size, selected UID/GID 1000/1000, mode 0600 and absence of a
symlink before acceptance or reuse. Temporary transfer files were removed.
The direct-download artifact then seeded the real installation, whose ownership,
marker, bundled relay and signed authentication checks passed.

Direct download used the container's existing curl, the exact metadata URL,
HTTPS-only redirects, bounded connection/overall timeouts and umask 077. Its
file-creation exec explicitly supplied the selected GID to match the archive's
metadata contract; the existing server/bootstrap GID behavior was not changed.
No package installation, SSH setup or published server port was needed.
**7.139 seconds is transfer time, not clean-install or window-startup time.**

### Interpretation

The inspected [Incus 7.5.1 SFTP constructor](https://github.com/lxc/incus/blob/v7.5.1/client/incus_instances.go#L1787-L1804)
uses 128 KiB packets without enabling the library's concurrent-write option.
The controlled helper comparison supports investigating that serialization on
this path. Concurrent writes require careful failure handling: the library
warns about holes after errors, reinforcing the need for full hash verification
before extraction. [Library contract](https://pkg.go.dev/github.com/pkg/sftp#UseConcurrentWrites)

The HTTP route removes client-to-daemon SFTP request/ack serialization over the
WAN; it does not eliminate SFTP entirely. The daemon still uses local SFTP to
write the file. [Incus HTTP file handler](https://github.com/lxc/incus/blob/v7.5.1/cmd/incusd/instance_file.go)

An optional remote-download mode can obtain an expected SHA from a small
client-side metadata request, avoiding a duplicate full client download. This
experiment's client archive download was preparation for comparing all methods,
not a proposed requirement of that mode. Microsoft tooling uses this metadata
API, and Remote-SSH provides precedent for selectable remote/local downloading.
[Microsoft metadata client](https://github.com/microsoft/vscode-test/blob/main/lib/util.ts),
[Remote development connectivity](https://code.visualstudio.com/docs/remote/faq)
Custom mirrors still need a checksum contract, and metadata failures must not
silently disable verification. No downloader/backend was added to production.

## Runtime, retained artifacts and verification

Same authorized TLS cluster fixture/member as Task 5; private identifiers and
addresses are omitted. Incus client/server 7.5.1, VS Code Stable 1.143.1 at the
commit above, Linux x86_64, Ubuntu 24.04.5 LTS container, host Node 24.21.0.
The helper used Go 1.27.3, Incus SDK v7.5.1 and pkg/sftp v1.13.11. The archive
and source-baseline hashes, raw samples, summary and assertions are retained in
[TASK-05-EXPERIMENTS.json](TASK-05-EXPERIMENTS.json).

Experimental sources are under [scripts/experiments/task5](scripts/experiments/task5/README.md).
The batching change is an **unapplied patch**; its import alias resolves to a
private temporary source copy when building the harness. The Go helper is a
separate experimental module, not an extension dependency or CI requirement.
No credentials, target defaults, private addresses or binaries are retained.

All 88 existing tests, `npm run typecheck` and `npm run compile` pass. The helper
build, vet, refusal checks and experimental harness builds pass. Real connection,
channel-preservation and fallback checks passed; bounded cleanup removed owned
server/relay processes, installation, temporary archives, client cache and the
isolated proxy. Temporary private configuration copies/builds were removed after
collecting the sanitized artifacts.

No new rendered VS Code window, editor, terminal or forwarding check is claimed.
Progress UX, interrupted-backend/resume behavior, custom mirrors, proxy failures,
other architectures and other CLI versions are not certified by these experiments.
The prototype's fallback sequencing needs a coherent implementation and full
regression review before adoption. No global proxy/sysctl/cluster routing,
member affinity, shared storage, new cache policy or default internet requirement
was introduced.

## Recommended discussion

The strongest next implementation candidate is coherent three-call healthy
batching, with native keepalive as an optional operational complement. Direct
container download is the fastest tested transfer option, but should be an
explicit strategy that retains client transfer for offline containers. HTTP
upload is a promising offline-compatible candidate, subject to the cost of
supporting another Incus client/backend. Neither should silently replace the
existing default based on these experiments alone.

Member-affinity, shared-cache, prebuild and parallel-chunk ideas were not pursued:
the tested changes already address the dominant measured costs without requiring
cluster/storage changes. No further exploration or adoption starts automatically.
**Stop for discussion.**
