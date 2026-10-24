# Task 5 experimental harnesses

These are manual, destructive fixture experiments, not production features or
CI jobs. Results and limits are in [TASK-05-EXPERIMENTS.md](../../../TASK-05-EXPERIMENTS.md).
Run only against an explicitly authorized idle disposable fixture. The default
extension bootstrap, download strategy and user's normal Incus config are not
changed by these sources.

Files:

- `batch-healthy.patch`: unapplied healthy-path experiment against the source
  hash recorded in the JSON report. Copy the current `src` tree into a private
  temporary directory, then apply this patch there with `patch -p1`. Do not
  apply it to production merely to run measurements.
- `reconnect.ts`: uses the existing verifier's signed management protocol,
  instruments current/experimental bootstrap and asserts channel preservation.
  Build with the usual vscode stub plus an esbuild alias named
  `task5-batched-bootstrap` pointing to the temporary patched `src/bootstrap.ts`.
  It is intentionally not part of the extension build or normal typecheck.
- `transfer/`: pinned standalone Go helper, build/vet instructions and schema.
  Build its executable outside this checkout; no binary belongs in Git.
- `transfers.py`: sequential full-archive comparisons, external SHA/metadata
  assertions, scoped file cleanup, and verified archive seeding for reconnect
  setup. Requires explicit target/destructive opt-in and refuses CI. All five
  transfer modes use one archive. A failed mode stops this comparison rather
  than silently retrying or switching backend.

Use a new private directory with mode 0700 as `INCUS_EXPERIMENT_ROOT`. Prepare:

1. `off/` and `on/`: private copies of the existing client config/certificates,
   excluding any existing keepalive sockets. Set the selected remote's
   keepalive to 0/30 **in those copies only** via `INCUS_CONF`. Never commit
   them. These experiments used TLS, not OIDC; no OIDC behavior is certified.
2. `metadata.json`: Microsoft's exact commit/flavor metadata. Validate its
   commit and SHA fields. Download that archive client-side, verify SHA and
   place it under `cache/server-cache/vscode-server-linux-x64-COMMIT.tar.gz`,
   with the usual `.sha256` sidecar. This is experiment preparation so every
   backend can upload identical bytes; an eventual direct-download feature
   would need only metadata client-side.
3. `archive-path`: one line containing the absolute verified local archive path.
   This harness is specifically the Linux x64 experiment, not a general installer.

Required private environment:

- `INCUS_TEST_TARGET=remote:instance` and `INCUS_TEST_ALLOW_DESTRUCTIVE=yes`.
- `INCUS_EXPERIMENT_ROOT`: the private prepared directory above.
- `INCUS_TRANSFER_HELPER`: absolute path to the built Go helper.
- `INCUS_TEST_VSDA_PATH`: installed Stable signing module, as documented for
  `scripts/verify-live.ts` in tests/README.md.

First run `python3 scripts/experiments/task5/transfers.py`. It emits sanitized
JSON, writes transfer results privately and leaves a verified seed archive on
the fixture. Then build/run `reconnect.ts` from the repository root with the
vscode and batching aliases. A representative build invocation, with the
private temporary patched source path supplied separately, is:

```sh
./node_modules/.bin/esbuild scripts/experiments/task5/reconnect.ts --bundle \
  --platform=node --alias:vscode=./scripts/vscode-stub.js \
  --alias:task5-batched-bootstrap="$TASK5_PATCHED_BOOTSTRAP" \
  --outfile="$INCUS_EXPERIMENT_ROOT/reconnect.cjs"
node "$INCUS_EXPERIMENT_ROOT/reconnect.cjs"
```

The reconnect harness removes the fixture user's server installation during
setup and again in finally cleanup. It creates no instance. It requires the
verified seed marker and refuses existing server/relay processes. The matrix
uses three interleaved repeats, reversing implementation order in the middle
round. Warm proxy priming and cold proxy shutdown are outside measured windows.
Only proxies whose argv references this private `on/keepalive/` path are stopped;
no normal proxy or active normal bridge is selected.

Healthy measurements require identical PID/port/token and valid authentication.
Recovery cases deliberately fall back to baseline; their extra exploratory calls
are not performance wins. Wiped recovery is preseeded with a verified HTTP upload.
No benchmark times rendered VS Code windows or establishes a CI time threshold.

Finally, inspect successful bounded cleanup, assert absence of owned fixture
files/processes and isolated proxies, and delete the private config/build/log
folder. Preserve only sanitized samples and source artifacts. Failed/terminated
runs may require explicit removal of their known owned `.partial` files; do not
sweep arbitrary instance `/tmp` files or retry an uncertain transfer blindly.
