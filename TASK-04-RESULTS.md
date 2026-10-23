# Task 4 verification evidence

Status: scoped verification complete; results discussed and the Task 4
discussion gate explicitly resolved by the user. The two findings remain open.
This is not an all-contracts-pass claim.
Task 3 completion/discussion was confirmed by the user,
who explicitly authorized Task 4. No next task is authorized by this record.

## Privacy and isolation

All portable tests use temporary filesystem or loopback TCP fixtures. No
private server belongs to CI. The manual live verifier refuses CI, missing
targets and missing destructive opt-in. Target, signing module location,
addresses, member/instance names and raw private logs are deliberately omitted
from this record and the new verification scripts. Fixture ownership,
availability and destructive-scenario permission were explicitly confirmed by
the user before live mutation. No default-remote or first-instance selection,
container creation/deletion, daemon reconfiguration or production-instance
mutation is authorized or performed.

This statement covers these new verification artifacts. It is not a public
release audit of existing repository documents or Git history.

## Runtime and evidence boundaries

- Linux x86_64 host, GNU Bash 5.3.9, GNU tar 1.35, Node 24.21.0;
  Stable VS Code 1.143.1, commit
  `e646868227c3e3a9e3f24277c8c7220be42c0be7`, x64.
- Incus CLI 7.5.1 and TLS cluster API reporting server 7.5.1. The authorized
  TLS fixture is an x86_64 Ubuntu 24.04.5 LTS container on a cluster member.
  The separately authorized local daemon reports 7.5.1 (not clustered), with
  an x86_64 Ubuntu 26.04.1 LTS fixture. Bundled server Node reports 24.22.1
  on both fixtures.
- Insiders was unavailable on PATH. No arm64, musl, other OS, other client
  version, or alternate CLI version was exercised live.
- Development Host uses temporary user data/extensions directories and this
  checkout's isolated bundle. No VSIX installation, redeploy or normal-session
  restart. The checkout's original shared `dist` symlink was replaced by an
  ignored local output directory before compiling.

## Local executable checks

`npm test`: 80 passed, none failed/skipped, including actual generated bash
against temporary filesystem fixtures. Extraction failures/interruption cannot
publish reusable incomplete installs; retry and marker cleanup pass. Essential
mutation failures propagate. Generated tokens meet the 43-alphanumeric contract,
mode 0600, current-process ownership, sticky reuse and temporary-file cleanup.
Token assertion failures no longer print token contents.

`npm run test:relay`: real bundled relay and loopback TCP fixture passed all
byte values including NUL/non-UTF8, independent simultaneous channels, ending
one while continuing the other, EOF, peer closure, connection refusal, stdout
EPIPE and five connect/disconnect cycles. The injected-failure run also passed
bounded cleanup with two open channels. Success and failure checks leave no
owned child processes/sockets. Relay stderr is not payload.

Production/test typechecking, standalone live-harness typechecking, isolated
compilation and whitespace checks passed at the recorded checkpoint.

## Live integration

Both explicit-target manual runs passed. TLS/cluster and local results are
kept distinct; neither target is a CI dependency.

| Contract | Local daemon fixture | TLS cluster fixture |
| --- | --- | --- |
| Clean install and usable returned session | Signed management handshake and invalid-token rejection passed | Same passed |
| Ownership/modes/content | Node/launcher/relay/token UID assertions, relay/token 0600, relay hash and token shape passed | Same passed |
| Healthy reuse | PID, port and sticky token unchanged; two live management channels receive new keep-alives after bootstrap returns | PID, port and sticky token unchanged; two management channels remained live through reuse |
| Installed but not running | Detached startup and signed handshake passed | Same passed |
| Missing token and wiped install | Real replacement/recovery and signed handshakes passed | Same passed |
| Explicit reset | Token changed and new authenticated session passed | Same passed |
| Stale commit | Harmless synthetic old-commit process replaced with a real current server | Same passed; no old VS Code binary compatibility claim |
| Temporary files and teardown | Marker/temp-file assertions and bounded final process/install/cache cleanup passed | Same passed |
| Loopback listener/server UID | Actual listener asserted to be only 127.0.0.1 on the discovered port; server UID asserted | Same asserted |

The local candidate initially had two live relays. The verifier refused before
mutation; only after the user closed its editor session and a fresh check found
no relays did destructive local checks proceed. Local testing was separately
authorized by the user as an exception to the historical remote-only isolation
rule; no other local instance was selected or created.

Initial verifier attempts exposed harness errors, not demonstrated production
defects: waiting for EOF after intermediate authentication, assuming HTTP
Content-Length rather than chunked encoding, then using idle HTTP keep-alive
channels for the reuse interval. Real local-server reproductions established
the signed handshake and protocol-disconnect requirements. The retained
verifier uses signed management channels with protocol keep-alives and ACKs.
Failed live attempts passed bounded cleanup. One exploratory local diagnostic
crashed while parsing a non-control packet; its owned process group and
temporary directory were then explicitly removed and checked.

No live pass is inferred from printed ports or token presence. GID policy,
root fallback, mixed-user scope, externally replaced malformed nonempty tokens,
stale ports/identity races and cross-window locking were not changed or newly
certified by these results.

## Window observations

User-assisted in the isolated Stable Development Host:

- Incus is available in the Remote Explorer selector.
- Instance row click selects/expands without connecting.
- Current/new-window actions and Start/Stop context menu are present.
- Icons render correctly in light and dark themes.
- After manually removing trust, Restricted Mode is visible and Incus still works.
  This was also repeated on the actual second remote workspace: Restricted
  Mode, the Incus tree and remote test file remained usable after reload.
- The explicit local fixture connects in the same development window; connection
  progress and its show-log link work after accepting the fresh-profile trust
  dialog for that fixture.
- The temporary remote folder containing spaces and `#` opens; its marker file
  is readable and the integrated terminal reports the correct remote folder.
- Removing its history entry leaves the actual file and terminal usable.
- With that history empty, Connect in New Window creates a second connected
  empty window while the first terminal survives. Opening a distinct second
  folder in the new window leaves both windows and their distinct folders
  usable.
- Reloading the second window restores its test file. Closing only that remote
  connection and invoking Connect in Current Window reopens its remembered
  second folder directly in that same window; the first terminal survives.
- A transient unavailable-remote warning was rendered while a local remote
  remained visible; a later CLI list and user screenshot showed recovery.
  Its cause is unverified.

Extension-host logs confirm activation without a missing-view error; this log
observation alone is not treated as rendering proof. After the user closed both
test remote connections and a fresh no-relays assertion passed, the test server
installation was removed. Open Terminal (exec) then worked independently of
bootstrap and reported UID 1000. The user exited it and closed the test windows. Forwarding could not be exercised: Ports is absent from both
the panel and View: Open View, as confirmed by the user. The fixture-owned HTTP
service's response, loopback binding, UID and restrictive temporary-file modes
were asserted during setup; this does not verify the VS Code forwarded path.
Static manifest/offline tests do not substitute for window observations.

## Observed window issue: already-open folder and new-window intent

Reproduction in the isolated Stable Development Host:

1. Connect the authorized fixture and open a folder F, recording its history.
2. Leave F open and invoke the instance's Connect in New Window action.
3. No additional window appears; the user reports the action does nothing.
4. Close the remote connection and repeat: the remembered folder opens.

The private command log confirms the extension requested a new-window folder
open. The installed 1.143.1 `vscode.openFolder` command accepts the boolean
`true` and maps it to `forceNewWindow`. Its main-process window manager
(`out/mainImpl.js`, `doOpen`, folder lookup `Uo`) searches for an existing window
with that folder and focuses it before creating a new window. This explains
the observed identical-folder behavior; it is not evidence that the boolean
argument was ignored or that the Incus transport failed.

The plan's unconditional new-window expectation is not met in this tested
context. Normal installed-extension profile behavior was not tested and no
workaround or production fix was attempted. This finding was included in the
completed discussion; the expected behavior remains an open implementation
decision for a separately authorized step. Concurrent-window testing with
different folders passed after clearing the remembered-folder entry; it does
not make the identical-folder new-window expectation pass.

## Observed integration gap: Ports view unavailable

Reproduction in the clean Stable Development Host: connect the authorized
Incus fixture, open a remote folder, and verify file/terminal access. The panel
has no Ports tab, and View: Open View does not offer Ports. The fixture's
loopback HTTP listener independently returns the expected marker, with its
loopback binding, UID and temporary-directory modes asserted.

The installed runtime's `enableForwardedPortsFeatures` registers the view only
when `forwardedPortsViewEnabled` or `forwardedPortsViewOnlyEnabled` is true.
The current extension does not explicitly enable those contexts or return
tunnel information/features from its resolver. Installed Dev Containers 0.469.0 explicitly calls
`setContext('forwardedPortsViewEnabled', true)` during resolver setup. Comparing
that call with the VS Code registration gate and its absence in Incus confirms
the missing UI activation step in the clean test profile. This does not verify
or demonstrate failure of the underlying TCP tunnel.
The pinned resolver proposal documents a default core forwarding path when
`tunnelFactory` is omitted; that path was not exercised here.

Actual VS Code forwarded-port connectivity remains **unverified**. No flags
were forced, no supporting extension installed, and no production code changed
to make this check pass. The reproduction and activation cause have now been
discussed; an integration fix still requires explicit next-step authorization.

## Final cleanup and remaining limits

Both manual harnesses passed bounded final teardown. Additional end-of-task
checks confirmed the TLS and local fixtures contain no test server/relay
processes, tested archive or owned temporary workspace. The local HTTP fixture
and rescue shell exited. Bootstrap/authentication scratch directories, isolated
development profile and its owned processes, temporary bundles and private
diagnostic files were removed. The worktree-local ignored build output is
retained for review; the primary checkout's shared bundle was not overwritten.

Private target identifiers were checked against the new verification scripts
and report and are absent. This does not sanitize preexisting documentation,
scripts or Git history for publication.

Insiders, other architectures/CLIs, a normal installed-extension profile,
explicit multi-user/GID/root policies, cross-window installation locking,
externally malformed tokens and actual old-server binaries remain unverified.
Container Start/Stop/Restart and destructive command confirmation UI were not
executed live; their menu presence and offline command coverage are separate.
The missing Ports view prevented real VS Code forwarding verification.

Final checks: 80 tests passed with no skips; portable relay success and injected
failure cleanup passed; production/test and standalone harness typechecking,
isolated compilation and final diff/whitespace checks passed. No hosted CI run
is claimed. No production source/assets/build configuration were changed.

## Discussion gate resolved

The mandatory Task 4 stopping point was reached before further work. The user
subsequently discussed the missing Ports view and its Dev Containers comparison,
then explicitly instructed that the Task 4 discussion gate be resolved.
Both findings remain open and actual VS Code forwarding is unverified.
No production fixes, optimization, deployment, commit or push were performed.
No next task has begun; further implementation/live work requires explicit
next-step authorization.
