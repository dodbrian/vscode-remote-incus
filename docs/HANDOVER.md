# HANDOVER — for the next agent

You are taking over **"Remote - Incus"**: a VS Code extension that adds Incus
containers (system containers; Incus = community fork of LXD) as a first-class
remote connection type — the slot Dev Containers / Remote-SSH occupy in the
Remote Explorer. Goal: "connect to a remote Incus container as seamlessly as
with a Docker container".

## Read order

1. [Design](DESIGN.md) — **the canonical architecture document**, frozen after the
   Phase-0 spike. Full design (transport, bootstrap, token, user policy, relay
   lifecycle, error taxonomy), the complete evidence ledger (§8 — including
   all Phase-1 findings), constraints, support matrix (§10 — incl. the
   client-version row), open questions (§11), and the Phase-1 plan (§12).
   Do not re-derive any of it.
2. This file — operational context: environment snapshot, dev loop,
   debugging traps, and exactly where to resume.

3. [Alternatives](ALTERNATIVES.md) — related projects, sources, search limits, and
   Marketplace/VSIX/Open VSX distribution findings (2026-10-23).

## Current stopping point: Open VSX release available (2026-10-25)

The user authorized a public repository and Open VSX publication, completed
the account/agreement setup and configured the `OVSX_PAT` repository secret.
The public repository is https://github.com/dodbrian/vscode-remote-incus.
The first hosted verification run, `40226291218`, passed; its downloaded VSIX
passed archive validation (33 files, 86 local documentation links).

Commit `42262de` introduces a manual, main-only publishing workflow. It reuses
the full verification workflow, downloads the artifact from that same run,
validates it again and uses pinned `ovsx@1.3.0`. The token is exposed only to
the namespace/upload step. Publication run `40229238587` passed all checks,
created namespace `dodbrian`, verified publishing access and reported
`Published dodbrian.remote-incus v0.1.0`.

The public version API initially returned 404, then exposed version `0.1.0` as
downloadable. The public VSIX passed archive validation (33 files, 86 links) and
is byte-identical to the publishing run's artifact. The listing is
https://open-vsx.org/extension/dodbrian/remote-incus.
Next release-administration step: claim verified namespace ownership through
Open VSX's documented public issue process. No ownership claim has been filed.
Namespace verification is separate from publication; the namespace API reports
`verified: false`. Future publication remains manual; a new version requires a
version bump and fresh authorization. Do not rerun upload for version `0.1.0`.
The identity build has not been installed or live-tested locally.

At publication, GitHub reported five open development-dependency advisories: one high in
`@azure/msal-node` and four moderate/low in `fast-uri`. These dependencies are
excluded from the validated VSIX. The subsequent `fast-uri` lockfile update and
scoped MSAL `7.1.1` override resolve those dependencies; a clean locked install
reports zero npm audit vulnerabilities. See
[dependency security follow-up](RELEASE-READINESS.md#dependency-security-follow-up).
CodeQL alerts 1 and 2 were fixed by `b5939e7`, removing account identity from
connection logs and replacing every newline in the flavor test label.
No editor restart, live fixture operation or Marketplace publication occurred.

## Previous checkpoint: release identity reviewed (2026-10-25)

The user selected display name **Remote - Incus**, package name `remote-incus`,
publisher namespace `dodbrian` and planned GitHub repository
`https://github.com/dodbrian/vscode-remote-incus`. The extension ID is
`dodbrian.remote-incus`. The authenticated GitHub account was verified with `gh`;
the planned repository returned 404. Publisher registration/availability remains
unverified. No repository creation, push, registry publication or deployment was
authorized by this decision.

The user accepted keeping the name pending any objection from Incus maintainers.
No Incus-specific naming permission was established, and no maintainer was
contacted. The README identifies the extension as independent; Incus logo use
is not authorized by this naming decision. See the
[identity research](RELEASE-READINESS.md#release-identity-decision-2026-10-25).
The user's locally installed build still has the development ID
`local-dev.remote-incus`; the newly packaged identity has not been installed.
Resolver opt-in diagnostics derive the ID from the running extension metadata.

The identity changes were reviewed and improved. Runtime opt-in guidance uses
`context.extension.id`, with an existing regression strengthened to verify a
synthetic publisher ID before any external work. Package-policy fixtures also
use a synthetic publisher. The public README describes local VSIX installation,
links the build instructions and does not imply an existing Open VSX listing.
There are no external users to migrate; no migration feature or public migration
guidance is needed.

Validation passed: `npm test` (16 offline test-file entries and strict quality
gates), `npm run test:package` (three test-file entries), `npm run package` and
`git diff --check`. The rebuilt production VSIX passed archive policy and privacy
checks with 33 files and 86 local documentation links. This identity build was
not installed or live-tested; prior connection acceptance applies to the
previously deployed build recorded in the checkpoint below.

Recommended next release step: create the planned GitHub repository, then push
and inspect the first hosted CI run and its VSIX artifact. Repository visibility
must be selected before creation. These external actions require a separate user
instruction; this checkpoint authorizes only the local commit. Publisher
namespace availability/registration and distribution eligibility remain pending.

## Previous checkpoint: reviewed build deployed and connection-verified (2026-10-25)

The user accepted the completed deployment/verification result and requested
this handover checkpoint. The deployment helper fix is committed as `2b49bd9`;
live evidence and support-matrix updates are committed as `c5c8af0`. The scoped
Ubuntu/Rocky connection and missing-tool task is complete; do not reopen it as
pending or expand acceptance beyond the checks recorded below.

The release identity is now selected above; publication remains deferred.
A focused next technical candidate is Linux x64 Insiders compatibility verification in an isolated profile, keeping
the normal Stable session intact. Broader platform coverage, hosted CI and
optional future architecture remain separate workstreams in the current task
status below. No additional test, client installation, push or publication is
authorized merely by this recommendation.

The user explicitly authorized deployment and connection/error verification,
including the reported Rocky Linux target, then separately approved installing
`tar` there. The normal-profile VSIX was installed and VS Code restarted through
`scripts/redeploy.sh`. The installed extension bundle was SHA-256 verified
byte-identical to the reviewed production build.

The deployment helper was found to bypass the reviewed packaging pipeline. It
now runs `npm run package` before installation or restart, preserving staged
archive validation and last-good-artifact handling. Three mocked shell tests
cover refusal before installation/restart on package failure, argument guards,
checkout paths with spaces, external working directories and CDPATH. The
headless CI workflow runs these tests without a real editor or Incus target.

The existing Ubuntu connection reused its healthy server. On Rocky Linux 9.8
x64, read-only checks confirmed that the `tar` RPM was absent, rather than just
unavailable through PATH. The deployed build refused setup with actionable
selected-user prerequisite guidance. The user's screenshot confirms the actual
VS Code error dialog; installation directory/marker metadata remained unchanged.
Only the explicitly approved `tar` package was installed, with no additional
packages in that transaction. Retrying completed setup and opened both exec
bridges in a normal-profile remote workspace. Core logs confirm remote agent
initialization. The existing root fallback policy was unchanged.

Connection-only live checks on both targets passed complete signed management
handshakes, invalid-token rejection, runtime/relay/token ownership and modes,
relay content verification, and healthy reuse with unchanged server processes.
The temporary verifier used only the connection/check helpers from the manual
harness; destructive scenarios and server cleanup were excluded. It closed only
its own relay channels. Existing server installations and normal editor channels
remain running. A private client-local workspace for the Rocky retry remains
available for reopening; no workspace file was written into the remote project.

Scope: VS Code Stable 1.143.1, client/server commit `e646868227…`, Incus 7.5.1,
Linux x64, and the selected Ubuntu/Rocky fixtures. Rocky's bundled Node reports
24.22.1. This verifies normal connection and missing-tool error behavior, not
all Rocky terminal/UI workflows or every resolver error dialog. Private target
identifiers, addresses, raw logs, marker snapshots and the temporary verifier
remain outside tracked files. No production instance was used, and no token
reset, manual server wipe, networking change, push or publication was performed.

## Previous state: offline tooling reviewed and committed (2026-10-25)

The user authorized setup prerequisite diagnostics, repeatable packaging,
headless CI, archive validation, documentation reconciliation and local commits,
including parallel implementation and independent review. Naming remains
provisional. No deployment, editor restart, live fixture, publication or push is
part of this work.

Missing/incomplete installations now check setup tools in the selected user's
PATH before download or stale-server replacement, and again before destructive
extraction. Missing `tar`, `gzip` or required file/checksum utilities produces
an actionable prerequisite error. Complete installed-server reuse skips these
setup requirements. This addresses the reported missing-`tar` diagnostic;
it does not install tools, repair PATH or establish Rocky Linux acceptance.

Packaging uses lockfile-installed VSCE with an explicit production prepublish
build and automatic actual-archive validation. The file policy requires runtime,
licenses and linked documentation, rejects unexpected/development files and
scans privacy patterns. Synthetic archive tests exercise rejection behavior.
The headless GitHub Actions workflow runs locked installation, offline/relay
and package checks, and retains the verified VSIX as an artifact. Hosted CI
has not run; implementing the workflow does not establish hosted execution.

Initial validation completed from a clean temporary source copy after locked dependency
installation: 16 offline test-file entries and strict quality gates, six relay
checks, nine archive-policy tests, checkout privacy audit and a 33-file
production VSIX with 82 valid local documentation links/anchors. Independent
review found no remaining blockers after musl status and packaged README-link
fixes. Release readiness records the evidence and sandbox boundary.

A second adversarial review hardened executable utility checks and reports a
missing/unusable `uname` before flavor probing. Archive verification now checks
CRC corruption, nonempty runtime files, JavaScript syntax and metadata
consistency. Parsed inline/reference Markdown links replace regex-only
validation. Packaging stages each candidate and replaces the previous VSIX
only after all checks pass. All 16 offline test-file entries and quality gates,
26 package regressions, checkout privacy audit and a 33-file production VSIX
with 82 local links/anchors passed. Review results are recorded in release readiness.
Review follow-up commits are `6e279a4` (utility guards), `d635af0` (verified
artifact preservation and validation) and `f5422bd` (review evidence). No
unresolved implementation defect was identified within this reviewed scope.
These changes have not been deployed or live-accepted. No push or publication
is part of the authorization.

## Current task status (2026-10-25)

Release identity is selected above; publication remains deferred. The accepted
Linux x64 MVP includes resolver classification, startup prerequisite diagnostics,
Alpine/Bash-free support, the IPv4 forwarding helper and identical-folder new
windows. These are completed features, not pending implementation tasks.
Current verification evidence is recorded in [release readiness](RELEASE-READINESS.md).
Reviewed-build deployment, normal Ubuntu/Rocky connections and Rocky's missing-tool
dialog are now verified within the scope above.

Remaining project-wide work is separated by purpose. Completed offline tooling
is not an open implementation task:

| Workstream                          | Pending result                                                                                                       | Scope or prerequisite                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Release identity and distribution   | Create planned GitHub repository, verify/register publisher namespace and confirm distribution eligibility/route     | Identity selected above; registry publication separately authorized                                                      |
| Hosted CI                           | First actual workflow execution and artifact inspection                                                              | Requires an authorized repository push; local clean-copy validation is complete                                          |
| Other live acceptance               | Resolver errors other than missing `tar`, additional Rocky terminal/UI workflows and broader image/platform behavior | The missing-tool dialog and scoped Ubuntu/Rocky connection/reuse checks are complete; further tests need a defined scope |
| Broader support coverage            | Insiders, ARM64, macOS/Windows clients, restricted remotes/projects and more Incus/image versions                    | Scope fixtures and platform access before testing; untested is not failed                                                |
| Optional compatibility architecture | Centralized version probe, adapter table and per-instance feature gates (DESIGN §14)                                 | Future architecture; existing list syntax, 7.x transfer progress, signal probes and resolver classification already work |
| Later-phase product features        | Concurrent different-user attaches and per-connection environment/working-directory support toward devcontainer.json | Future scope, not unfinished accepted MVP requirements                                                                   |

Ordinary IPv4-loopback forwarding on IPv6-only-networked containers retains a
known limitation; the selected-row IPv4 helper is implemented and manually
accepted. Automatic workspace-file pruning is deliberately absent because it
could break retained workspace references. Neither is an unaccepted helper or
window fix. See [release readiness](RELEASE-READINESS.md) and DESIGN's support
matrix for the scoped evidence. No next implementation or live test starts
merely because it appears in this list.

## Reported target issue: tar unavailable (2026-10-25)

Resolved on the tested target. Live inspection confirmed `tar` was not installed.
The reviewed error was verified in VS Code before the user-approved installation
of `tar`; setup and normal connection then succeeded. The original evidence and
pre-repair stopping point below are historical.

User-reported screenshot evidence: connecting fails to resolve the Incus remote
authority and VS Code reports "Failed to connect to the remote extension host
server". The failing `incus exec` runs `/bin/sh` as user 0 with `HOME=/root`;
the inline script exits 127 with `/bin/sh: line 5: tar: command not found`.
Private remote and instance identifiers are intentionally omitted.

Original report status (before the deployment above): unverified, recorded from
the screenshot only, without reproduction or live inspection. The evidence establishes that `tar` was unavailable to that
script, but does not establish whether it is absent from the image or missing
from the script's PATH. The user identified the target as Rocky Linux 9,
amd64; installation state was not verified at the time of that report.

Offline handling is now implemented: missing/incomplete installation checks
report unavailable setup tools in the selected user's PATH before download,
and extraction repeats the guard before removing an old directory. Controlled
shell regressions cover the missing-tool error and preservation of an existing
installation. Subsequent live reproduction, RPM/PATH inspection and the
explicitly approved `tar` installation are complete as recorded above. This
resolution does not authorize package changes on other targets.

## Previous state: development tooling cleanup complete (2026-10-25)

The user approved moving the manual deployment helper to `scripts/redeploy.sh`
and removing the obsolete root `spike/` implementation, then requested committing
the reviewed changes. Historical deployment records retain the former
`./redeploy.sh` path used at the time. Current commands and file maps use the
new location. The helper resolves the checkout root from its own location and
still requires explicit fixture and absolute-folder arguments.

The spike implementation remains in sanitized Git history. Its short historical
summary lives in `docs/spike/README.md`, with canonical findings in DESIGN.
Production build, runtime and tests did not depend on the removed files.
Obsolete tooling exclusions and retention instructions were removed.

Review also fixed the privacy audit crashing on unstaged deletions/renames.
A temporary Git fixture verified that a renamed destination is scanned and
that an untracked synthetic credential is detected without printing its value.

Validation passed: 177 offline tests including typecheck/lint/format gates,
checkout privacy scan, production build and a 33-entry local VSIX. All 78 local
documentation file links and the new historical-summary anchors resolve.
The archive retains the summary, runtime and licenses while excluding the
removed implementation and deployment helpers. Mocked checks verified checkout
paths with spaces, external working directories/CDPATH, command arguments,
stop-on-failure, input guards and executable mode. No deployment, live instance
access, editor restart, push or publication was performed.

## Previous state: privacy cleanup complete (2026-10-25)

The user authorized thorough privacy cleanup and a separate independent agent
check, then explicitly requested rewriting the existing history without
flattening, rebasing or changing its chronological structure. Private content
was sanitized across the checkout and historical snapshots. The rewrite preserved
the original 82 commits and 15 refs, ordered parents, timestamps and attribution;
commit IDs changed. Historical reports can quote original IDs. Runtime logs, fixture
identities and credentials must stay outside tracked artifacts. The user then
explicitly approved permanent reflog expiration and pruning, including the 61
additional unreachable recovery commits. That cleanup is complete: repository
integrity, the preserved graph and absence of old mapped objects, unreachable
objects and reflog entries were verified.

Dev scripts now require runtime fixture inputs rather than a private target;
the old spike relay no longer prints the connection token. The obsolete local
spike token and pre-cleanup VSIX were removed. The user subsequently requested
committing the cleanup and this handover. No deployment, live instance access,
credential rotation, push or publication was performed.

Final independent verification confirmed that all 83 replaced old mapped
objects are unavailable and no unreachable objects or reflog entries remained
at cleanup completion. The original 82-commit graph and 15 refs retained their
verified structure and metadata. Subsequent normal commits add to that history.
The local evidence map lives only in Git metadata and is not packaged.

Validation passed: 177 offline tests, strict typecheck/lint/format gates, all
six relay checks, shell target guards and syntax checks, 75 local documentation
file links, repository integrity and checkout/history/package privacy scans.
The independently reviewed 33-entry VSIX retains the entry point, relay and
licenses; eight synthetic probes confirmed private-file archive exclusions.
These are scoped audit results, not a universal secret-detection guarantee.

Next step: decide the final display name, extension name, publisher and public
repository, then update the manifest and opt-in guidance consistently. After
that, implement repeatable CI VSIX packaging using the lockfile-installed
packager and an explicit production build. Keep CI limited to local fixtures;
registry publication is a separate decision and authorization. The current
manifest still uses placeholder identity/repository metadata and the package
command still requests `vsce@latest` without compiling first.

See [release readiness](RELEASE-READINESS.md) for evidence and the remaining
client/platform coverage limits. No next implementation task or publication
is authorized merely by this handover.

## Previous state: release-readiness review (2026-10-25)

The user confirmed manual normal-profile identical-folder new-window acceptance,
then authorized proceeding with the release-readiness review. README and DESIGN
now reflect the completed resolver, Alpine/shell, diagnostics, Ports and folder
work, with tested coverage separated from declared compatibility.

[Release-readiness findings](RELEASE-READINESS.md) record publication blockers:
private details in tracked files, reachable history and the inspected VSIX;
placeholder identity/repository metadata; and packaging that uses an unpinned
packager without an automatic build. A production VSIX was built for local
inspection only. Initial sandbox file enumeration failed; the same operations
outside the sandbox succeeded. No private targets were contacted.

Next decisions: choose final name/publisher/repository and the public source
route (sanitized export versus separately authorized history cleanup), then
prepare repeatable CI packaging and the distribution route. Do not publish the
current archive or history. No commit, push, deployment, history rewrite or
publication occurred during this review. Detailed validation is recorded in
the review report.

## Previous state: IPv4 helper deployed and accepted (2026-10-25)

The user accepted the normal-profile IPv4 helper workflow and requested
committing the implementation, regression coverage and documentation together.
The helper is deployed; no push or publication was requested.

`remote-incus.forwardPortIPv4` (`src/forwarding.ts`, registered by
`src/commands.ts`) contributes "Forward over IPv4" to the Ports-row context
menu for a single Incus IPv4-loopback row. It takes the selected port
automatically, with no number prompt. Core forwards that same port using
`::ffff:127.0.0.1`, bypassing the problematic localhost/ADDRCONFIG lookup.
The standard resolver, core tunnel factory and Incus exec-stdio transport
remain in use; there is no automatic interception of ordinary forwarding.

The helper validates row/remote/port inputs, accepts `localhost`, `127.0.0.1`
and `0.0.0.0`, retains label/protocol/local-port preferences, requests private
forwarding, reuses existing mapped tunnels and deduplicates concurrent clicks.
An original ordinary forward is retained; core chooses another available local
port if necessary. Core manages closing and local-port changes; extension
handles are disposed with the context. The production manifest enables the
`tunnels` proposal, with typings pinned to VS Code 1.143.1.

Important discovery limitation: Ports displays forwarded/environment-detected
entries, not every raw listening-port candidate. The user's `hybrid` setting
uses terminal-output URLs to initiate forwarding. The initial externally
started test service produced no row until its URL was printed in the
integrated terminal. The helper acts on the resulting row; it adds no service
scanner and changes no discovery settings. README documents this flow.

The first manual context-menu check also exposed a condition bug:
`tunnelViewMultiSelection == undefined` compares to the string "undefined".
The corrected condition is `!tunnelViewMultiSelection`; regression coverage
rejects the mistaken literal comparison. A temporary bundle of the exact
upstream VS Code parser/scanner verified old false/new true for the single-row
context and new false for multiselection or another remote. No parser copy or
new parser dependency was added to production or CI.

Verification: all 15 offline test-file entries pass, including typecheck, lint
and formatting; compile and `git diff --check` pass. Failure-first command tests
cover port reuse without prompting, metadata, validation, remote changes,
existing forwards, concurrent clicks, error/retry and menu conditions. An
isolated Stable 1.143.1 development profile verified exact HTTP traffic through
the helper, duplicate suppression, core close and helper reopening on the
IPv6-only-networked fixture. That temporary profile/listener/relays were cleaned
up; networking was unchanged.

For manual acceptance, `./redeploy.sh` built, packaged and installed the helper
and restarted normal VS Code. Installed bundle and corrected manifest were
verified. The normal fixture window resolved and started both exec bridges.
The user showed the helper-created mapped-address entry beside the original
auto-forward, then confirmed the exact HTTP marker through the new local
address. Core correctly selected an available local port when the preferred
port was occupied. This accepts the menu-to-HTTP workflow on the tested Linux
x64 / Stable 1.143.1 / Incus 7.5.1 fixture, not additional clients or platforms.

After acceptance the exact test-owned HTTP process was identity-checked and
stopped; its exec session exited successfully. User-created forwarded entries
and ordinary editor relays were left alone. The user can remove the unused
test forwards in Ports. No container networking, packages, token policy or
upstream server code changed. Private fixture identifiers and raw logs remain
outside the repository.

Recommended next task: a release-readiness review. Reconcile README/DESIGN and
the support matrix with the completed resolver, Alpine/shell, diagnostics and
Ports work; audit tracked files/history and the VSIX contents for publication
privacy; and decide the final extension name/publisher before publication.
Then prepare repeatable CI VSIX packaging and the chosen distribution route.
This is a recommendation, not authorization to publish or begin another task.
The user manually tested and confirmed the normal-profile identical-folder
new-window workflow on 2026-10-25; that acceptance check is complete. The
untested client/platform matrix remains an explicit limitation.

## Previous state: IPv4 forwarding investigation (2026-10-25)

The user authorized investigating the remaining IPv4-only loopback forwarding
failure on the previously designated IPv6-only-networked local fixture.
Fresh read-only checks confirmed IPv4 exists only on loopback and the external
interface has IPv6 only. No container networking was changed.

Reproduction with the fixture's bundled Node 24.22.1 and a bounded temporary
HTTP service bound only to `127.0.0.1`:

- Unfiltered `dns.lookup('localhost', {all:true})` returned both `::1` and
  `127.0.0.1`; adding `dns.ADDRCONFIG` returned only `::1`.
- Direct IPv4 returned the exact HTTP marker. Normal `localhost` connection
  failed with ECONNREFUSED. An unfiltered custom lookup and literal
  `::ffff:127.0.0.1` both returned the marker.
- A separate Stable 1.143.1 development profile using the unchanged production
  resolver and actual core-created tunnels reproduced failure for remote
  `127.0.0.1`, then returned the exact IPv4-only service marker for remote
  `::ffff:127.0.0.1`. Only the temporary verification manifest enabled the
  tunnels proposal. Production has not gained that proposal or any new command.

The temporary extension host exited with code 0; fresh process checks found no
owned HTTP listener or relay processes. The temporary development profile was
removed after confirming no processes referenced it. Interface addresses
remained unchanged. The preexisting server installation was retained. Private
targets and raw logs remain outside the repository. This is API-created tunnel
and actual HTTP traffic evidence, not manual Ports-input acceptance.

Exact-version source inspection confirms the cause and available API:
[core loopback normalization](https://github.com/microsoft/vscode/blob/1.143.1/src/vs/platform/tunnel/node/tunnelService.ts),
[server family selection](https://github.com/microsoft/vscode/blob/1.143.1/src/vs/server/node/remoteExtensionHostAgentServer.ts),
[Node ADDRCONFIG injection](https://github.com/nodejs/node/blob/v24.22.1/lib/net.js),
[resolver factory selection](https://github.com/microsoft/vscode/blob/1.143.1/src/vs/workbench/api/common/extHostTunnelService.ts).
The supported resolver `tunnelFactory` replaces core's synthesized managed
factory; returning undefined is not a reliable way to delegate individual
requests back to that default. DESIGN section 2 currently specifies core
forwarding, so replacing this component needs an explicit direction decision.

At the end of this investigation no production forwarding change had been made.
The user subsequently selected the detected-port helper described above,
resolving the architecture question without replacing core forwarding.
No commit, deployment, normal-profile restart, push or publication occurred
during the investigation itself.

## Previous state: early startup prerequisite diagnostics (2026-10-25)

The deployment and terminal acceptance record below is committed as `a795b5d`.
The user then authorized proceeding with prerequisite diagnostics.

Implemented in `src/bootstrap.ts`: before detaching a new server, the selected
user checks for `nohup`, an executable server launcher, and successful bundled
`node --version`. Runtime failures immediately name the loader/permission
failure with installation or permission guidance; the original exit status
and multiline diagnostics propagate through the existing Incus/resolver errors.
Checks run before removing the previous server log, so failed prerequisites
preserve that diagnostic file and never enter readiness polling. They share
the existing launch exec, and healthy reuse does not run a new runtime probe.
This detects basic runtime loading failures, not every later server/module
requirement or application startup failure.

`src/terminal.ts` checks for util-linux `script` through `/bin/sh` before
opening the rescue PTY and prints installation guidance if it is missing.
The existing Bash preference and `/bin/sh` fallback remain in the PTY command.
No packages are installed automatically.

Failure-first offline regressions execute the generated startup shell script
against local fixtures: missing C++ libraries, missing/non-executable Node,
missing/non-executable launcher, missing nohup and successful startup. They
check preserved logs, original failure statuses and refusal before polling or
background launch. Rescue-terminal tests execute its outer shell wrapper and
check missing-script guidance as well as Bash preference/fallback. The existing
log-removal failure regression now supplies valid runtime prerequisites so it
still exercises the intended rm failure.

Validation: `npm test` passes all 14 test-file entries, including typecheck,
lint and format checks; compile and `git diff --check` pass. No test files fail
or skip.

The user requested committing these diagnostics and proceeding with deployment.
Implementation, tests and documentation are committed as `be8da26`.
`./redeploy.sh` installed that build and restarted normal VS Code. The installed
bundle was SHA-256 verified byte-identical to the production build. Stable
1.143.1 logs confirmed healthy server reuse, resolution and both exec bridges
for the established remote and the Bash-free Alpine window.

Scoped live diagnostics checks passed on the named Alpine/BusyBox fixture.
A temporary harness exposed the private startup function in its temporary
bundle only; repository exports were unchanged. It ran the production startup
script against per-case temporary homes: controlled missing-library diagnostics,
non-executable runtime and missing launcher all refused before background
launch and preserved the previous log. The success case used a symlink to the
actual installed Alpine Node binary and a harmless fixture launcher. This is
live shell/control-flow evidence with injected failures, not a second test
with genuinely removed system libraries. The temporary directories were
removed; installed libraries and the active server installation were unchanged.

The updated production rescue terminal passed a real util-linux PTY, BusyBox
fallback, marker command and clean exit using a small host-API adapter.
Missing-nohup and missing-script failures remain offline test evidence. Normal
window reconnection is log-verified; no new manual terminal UI acceptance or
error-dialog screenshot is claimed for this diagnostics build. The user's
prior two-terminal acceptance below remains scoped to the preceding build.

Current stopping point: prerequisite diagnostics are committed, deployed and
verified within the boundaries above. No push or publication occurred. Further
implementation needs a selected next task: the IPv6-only-network fixture's
IPv4-loopback issue remains open; publication still needs naming/publisher
decisions and a privacy audit. Do not remove libraries or stop the active
Alpine session to extend failure coverage.

## Previous state: resolver classification and shell portability (2026-10-25)

The user authorized the recommended resolver classification task. Implemented
in `src/resolver.ts`, with tree-refresh wiring in `src/extension.ts`:

- Successful daemon lookup with no exact instance match returns
  `RemoteAuthorityResolverError.NotAvailable` and refreshes the tree. This also
  applies if the instance disappears after a start request. No recreation.
- `Starting` waits return `TemporarilyNotAvailable` without issuing another
  start. `Stopped` retains inline start-and-connect; a post-start Stopped or
  Starting state is retryable. Other states fail with the actual state and
  do not issue a start or bootstrap.
- The formerly unused error mapper now runs at the resolver boundary. Explicit
  resolver errors pass through unchanged; other failures retain their first-line
  diagnostic and the original error as `cause`, with full error logging.
  Text such as "not found" or "No such file" alone never implies deletion.
- Offline regressions cover missing instances before/after start, startup waits,
  unsupported states, daemon/socket/CLI/TLS/permission/timeout failures, start
  and bootstrap failures, and preservation of explicit taxonomy and causes.
  New regressions failed against the original implementation.

The user also reported containers without Bash. `src/incusCli.ts` now uses
`/bin/sh -c` for generated POSIX scripts and transfer-size polling. The rescue
terminal in `src/terminal.ts` gives util-linux `script` a known `/bin/sh`
wrapper, prefers Bash if available, and otherwise executes `/bin/sh`. Shell
selection happens before execution; script failures never trigger a rerun
under another shell. No packages are installed automatically.

New `tests/shell.test.ts` checks execution with no Bash on PATH, propagation
of script failures without retry, and rescue-terminal Bash preference/fallback.
Existing actual-script tests for installation recovery, token/relay handling,
mutation failures and container download now execute under `/bin/sh` (dash on
this host). The offline checks alone do not establish full minimal-image
compatibility; server/runtime utilities and util-linux `script` remain requirements for their
respective paths. Scoped live BusyBox evidence follows.

`npm test` passes all 13 test-file entries, including typecheck, lint and
format checks. Compile and `git diff --check` pass.

At the user's request, live shell verification ran against their explicitly
named idle Alpine 3.24 x86_64 fixture over TLS/cluster Incus 7.5.1, using Stable
1.143.1's server commit. Bash remained absent and `/bin/sh` was BusyBox. Original
Bash execution failed; production sh execution, identity lookup, musl detection
and signals passed. The image had no unprivileged login user, so the existing
root fallback applied; no user-policy change was made.

Initial fresh bootstrap reached installation but server startup failed because
`libstdc++.so.6` and `libgcc_s.so.1` were missing. Cleanup succeeded. The user
explicitly approved installing `libstdc++`, `libgcc` and `util-linux-misc` plus
their dependencies, and rerunning. The repeat passed fresh Alpine bootstrap,
relay/token 0600 checks, the full signed management handshake, invalid-token
rejection, healthy reuse and a second signed handshake. Separately, production
rescue-terminal code passed through a real util-linux PTY with BusyBox fallback,
command output and clean exit. Its VS Code host API used a test adapter; no
editor-window or rendered terminal UI claim is made.

Test-created server installation, archives and processes were removed; approved
system prerequisites remain installed. No Bash was installed. Private targets
and raw logs stay outside the repository. The ordinary loopback relay suite
also passed outside the sandbox, which blocks TCP listeners. Full installation
and cleanup, followed by prerequisite installation and a rerun, were explicitly
approved by the user.

The user accepted the live results and requested committing the fixes,
regressions and documentation. Resolver classification is `aee3bc5`; shell
portability and live evidence are `15ba764`. No push was requested.

The user then authorized redeployment and the normal-window smoke check.
`./redeploy.sh` built, packaged and installed the committed extension, restarted
normal VS Code and reopened its designated remote window. The installed bundle
was SHA-256 verified byte-identical to the production build. Logs confirm the
existing remote reused its healthy server and started both exec bridges.
A separate normal-profile window opened the named Bash-free Alpine fixture at
its root home. Container download fell back to client transfer because curl is
absent; fresh install completed, the resolver returned a ready session and both
exec bridges started on Stable 1.143.1. The window's normal server installation
is retained for use; the earlier test-run cleanup remains separate.

Current stopping point: deployment and normal-window terminal smoke checks
accepted. Asked to run `echo shell-ok` in both New Terminal and Open Terminal
(exec), the user confirmed "both work" on the Bash-free Alpine fixture. This is
manual acceptance of those two terminal workflows on the tested runtime, not
broader image/platform coverage. Resolver error taxonomy has offline regression
evidence; error-dialog UX has not been reverified live. Ports acceptance and
identical-folder evidence below remain scoped to their previously tested build.

Next implementation candidate: detect missing server runtime prerequisites
before the readiness poll, with a direct actionable error naming the missing
libraries or utilities. The Alpine run exposed this diagnostic gap; no
prerequisite detection or automatic package installation has been implemented.
The IPv6-only fixture edge case, normal-profile new-window acceptance, and
naming/publisher plus publication-privacy prerequisites remain open.

## Previous state: deployed fixes and Ports acceptance (2026-10-25)

The user manually checked the Ports feature after redeploy and reported
“everything works.” Record this as user acceptance of the tested Ports workflow;
individual controls were not enumerated, so do not invent a control-by-control
checklist or extend this result to other runtimes/network configurations.
Manual Ports testing is no longer deferred.

Both fixes are committed: Ports activation `3c80096` and identical-folder
new-window workspaces `2e5b68b`. At the user's request, `./redeploy.sh` built,
packaged and installed the extension, restarted VS Code and reopened the
designated remote window. The installed bundle was byte-verified against the
build. Post-redeploy logs confirmed successful resolution, healthy server
reuse and both exec transport bridges starting on Stable 1.143.1. These are
prior-turn deployment observations, not fresh live checks during this update.
No further redeploy, live mutation, push or publication occurred here.

The identical-folder fix passed the isolated three-window and workspace
reopening checks below. Normal-profile identical-folder UX acceptance was
subsequently completed by the user's manual test on 2026-10-25. The
IPv6-only-networked local fixture's IPv4-loopback resolution edge case also
remains open; successful IPv4 forwarding on the TLS/cluster fixture and the
user's Ports acceptance do not resolve it for that different environment.

Recommended next task: resolver error classification against DESIGN §7.
Establish offline regressions for deleted/unavailable instances, retryable
starting states and daemon/transport failures, then refine the production
error mapping without losing the underlying cause. No implementation of this
next task has started or been authorized. Naming/publisher decisions and a
publication privacy audit remain prerequisites to packaging/publication work.

## Previous state: identical-folder new windows (2026-10-24)

The user authorized fixing identical-folder new-window behavior and explicitly
approved opening the folder in a separate workspace. Manual Ports testing is
deferred by the user until later; do not start it automatically.

Implemented in `src/commands.ts` and new `src/workspace.ts`: folder-row and
remembered-folder instance new-window commands create a unique client-local
workspace containing exactly the chosen remote folder plus its
`remoteAuthority`, then open it with `forceNewWindow`. This bypasses core's
existing-folder window match. Current-window delegation and empty-history
instance connections retain their existing behavior. No bootstrap is added
to the commands; transport, token and user policies are unchanged.

Successful workspace files are retained under extension global storage in
`window-workspaces` for reload/reopening and VS Code recents. Each request
gets a unique directory (0700) and workspace file (0600). Failed opens remove
their generated directory and report the error. No remote project files or
settings are written. The title shows a workspace containing the folder,
which is the user-approved UX tradeoff. Automatic pruning is not implemented
because it could break retained workspace references.

Verification: offline tests cover repeated folder/instance requests, unique
workspace identities, exact remote authority and URI with significant path
characters, unchanged current-window delegation and failure cleanup. A separate
Stable 1.143.1 development profile invoked both production command entry points
with actual tree nodes against the designated idle TLS/cluster fixture. The
original folder and two separate workspaces all had distinct session identities
and concurrently read the exact remote marker from the same path containing
spaces, hash, question mark and Unicode. After closing all test windows, reopening
a retained workspace reconnected to the exact folder and read its marker.

The first live attempt omitted workspace `remoteAuthority`, so its new window
had no remote filesystem provider (also observed by the user's screenshot).
Adding the metadata fixed it; the failed attempt is not counted as a pass.
No general cross-platform or other-client-version claim is made.

`npm test` (12 passing test-file entries, including typecheck, lint and full
format checking), compile and `git diff --check` pass. The isolated windows,
temporary remote workspace, profile and test artifacts were cleaned up.
The normal installed extension and user session were not redeployed or
restarted. The user accepted the result and authorized committing the fix,
regression coverage and documentation together. The prior Ports fix is
`3c80096`. No push or publication was requested.

Recommended next implementation task: refine resolver error classification
against DESIGN §7, with offline regressions for deleted/unavailable instances,
retryable starting states and underlying daemon/transport failures. This is
a recommendation only; no next task is authorized by this handover.
Manual Ports controls and normal-profile acceptance of the new-window UX can
be checked at the user's chosen time after a separately requested redeploy.
The IPv6-only-networked fixture's IPv4 loopback-resolution edge case remains
a separate follow-up. Packaging follows naming/publisher decisions and a
publication privacy audit. No deployment or further live task is implied.

## Previous state: Ports activation and forwarding (2026-10-24)

The user authorized fixing the missing Ports view and verifying forwarding.
`src/resolver.ts` now awaits `setContext('forwardedPortsViewEnabled', true)`
during resolve. Core retains its default forwarding implementation; no custom
tunnel factory, transport, token or user-policy changes were introduced.
Resolver regression expectations failed before the fix and pass afterwards.

Live verification used Stable 1.143.1 in a separate temporary development
profile and an explicitly named idle local fixture. The Ports focus command
(`~remote.forwardedPorts.focus`) succeeded, and a tunnel opened with the
proposed workspace tunnel API returned the exact fixture HTTP response through
a host-local forwarded port. Only the temporary verification manifest enabled
the `tunnels` proposal; production does not need it. This verifies view-command
registration and actual forwarding, not a user-observed screenshot or manual
Ports input interaction.

**Remaining fixture-specific limitation:** an IPv4-only service bound to
`127.0.0.1` failed through core forwarding because it attempted container
`::1`. An IPv6 loopback listener on the same port made forwarding pass.
Follow-up source/runtime checks established the cause: core normalizes
loopback destinations to `localhost`, and the installed server already uses
`autoSelectFamily: true`. However, bundled Node adds `dns.ADDRCONFIG` during
connection lookup. This fixture has only IPv6 on its external interface;
IPv4 exists only on loopback. Unfiltered `dns.lookup('localhost', {all:true})`
returns both families, while adding `ADDRCONFIG` returns only `::1`, leaving
no IPv4 fallback candidate. A bounded direct connection to `127.0.0.1` with
the same bundled Node succeeded and returned the exact test payload.

IPv4 connectivity is supported; this is a loopback name-resolution edge case
on the tested IPv6-only-networked fixture, not a general Incus or forwarding
protocol restriction. IPv4-only forwarding through core subsequently passed
on the designated TLS/cluster fixture with external IPv4 networking (see
below). Investigate preserving the explicit IPv4 destination or another
narrowly scoped remedy before declaring full support.
Do not change container network configuration to make a test pass.
The identical-folder finding remains open.

Sources checked through Context7 and the web:
[core destination normalization](https://github.com/microsoft/vscode/blob/main/src/vs/platform/tunnel/node/tunnelService.ts),
[server family fallback](https://github.com/microsoft/vscode/blob/main/src/vs/server/node/remoteExtensionHostAgentServer.ts),
and [historical dual-family fix](https://github.com/microsoft/vscode/issues/191945).
The installed server bundle was inspected separately to confirm family fallback
is present in the tested version.

`npm test` (12 passing test-file entries, including typecheck, lint and
repository formatting) and compile passed. Temporary HTTP listeners, tunnels
and development windows were cleaned up. The user subsequently authorized
committing the resolver fix, regression coverage and this handover together.
No normal-session restart, VSIX installation, push or publication was performed;
the fix is not deployed to the normal installed extension.

Follow-up on the user-requested fixture-remote fixture: its external interface has
IPv4 and IPv6 addresses, and it had no active editor relays before testing.
A temporary unprivileged HTTP service was asserted to listen only on
`127.0.0.1`. In a separate Stable 1.143.1 development profile, the Ports focus
command succeeded and a workspace tunnel requested for container
`127.0.0.1` returned the exact service marker through host `127.0.0.1`.
This proves actual IPv4-only service forwarding over the TLS/cluster Incus
transport in that environment. The IPv6-only-networked local fixture's
address-filtering edge case remains distinct. Normal bootstrap recovered
preexisting incomplete server state during the test; no manual reset or
uninstall was performed. The HTTP listener, test tunnel and development
window were cleaned up; the normal user profile was not restarted or modified.

Recommended next step: verify manual Ports interaction in an isolated
window (Forward a Port, HTTP response, Change Local Address Port and Stop
Forwarding Port). Automated view focus and API-created tunnels do not prove
these controls. Then discuss the identical-folder new-window behavior and
whether to address the IPv6-only-networked fixture's IPv4-loopback edge case.
Resolver error-taxonomy polish and packaging remain later work; publishing
requires the naming/publisher decision and a separate privacy audit.
No further implementation, deployment or live verification starts without
explicit user instruction.

## Previous state: mandatory quality gates (2026-10-24)

Task 5 was closed earlier the same day (previous state below). The prior session,
at the user's request, introduced mandatory linting, code formatting and
strict language checks, conformed the entire codebase to them, and
live-verified the running extension afterwards. No feature work; transport,
token and user policies are untouched.

- Gates (`1b2034c`): ESLint 10 flat config (`eslint.config.mjs`) with
  typescript-eslint strictTypeChecked + stylisticTypeChecked via
  projectService; Prettier owns formatting (single quotes, width 100,
  `.prettierrc.json`) with eslint-config-prettier disabling conflicting
  rules; strict tsconfig flags across all three projects — src, tests and
  a new `scripts/tsconfig.json` (dev scripts were never type-checked
  before): noUncheckedIndexedAccess, noUnusedParameters, noImplicitOverride,
  noImplicitReturns, noFallthroughCasesInSwitch,
  forceConsistentCasingInFileNames.
- Warnings are errors everywhere: `npm run lint` passes `--max-warnings 0`;
  `npm run check` = typecheck + lint + format:check, and it gates
  `npm test` and `npm run package`; a `pre-commit` hook (`.githooks/`,
  installed automatically by `npm install` via the `prepare` script through
  `core.hooksPath`) runs the same check on every commit; `.vscode/` settings
  format on save and apply ESLint fixes.
- Conformance landed in reviewable order, each commit green: `769c7f9`
  (src), `1c4e93a` (tests; adds `tests/support/assert.ts` with a
  `defined()` helper — the replacement for every non-null assertion),
  `85b4bee` (scripts), then the gates themselves, `0faf905` (docs + README
  gates section). Final state: 127 offline tests, `test:relay` 5/5,
  compile and a live `./redeploy.sh` all pass.
- Deliberate behavior deltas, all in failure/edge paths with unchanged
  messages: the auto-fallback download failure now throws
  `AggregateError([containerFailure], msg, { cause })` (was `Error` with an
  AggregateError cause); verify-\* scripts record cleanup failures for the
  final assert instead of throwing inside `finally`;
  `withProgressReport`/`measureStartup`/`withRef` accept sync callbacks
  (some command handlers are sync now).
- Rule tuning and carve-outs are documented inline in `eslint.config.mjs`
  (interpolating uids/ports into shell commands → allowNumber; boolean
  `||` falsy logic → ignorePrimitives; the test fixture's opaque-any
  boundary; captured state mutated across awaits defeats
  no-unnecessary-condition).
  Only two code suppressions exist, each with a justification comment: the
  resolver's runtime guard for the proposed API and require.cache
  invalidation in one test.
- Formatting scope decided by the user (2026-10-24): Prettier covers the
  whole repo INCLUDING docs/. Doc edits must stay prettier-clean; list
  continuation lines reflow to column 0 (rendering is preserved via lazy
  continuation) — reword lines that read badly instead of fighting the
  formatter.
- Prior-session live check after the overhaul (stable 1.143.1, commit `e646868227…`):
  healthy-reuse resolve, both bridges spawned, zero errors in
  `/tmp/remote-incus-dev/fixture-container/ext.log`. The user requested the redeploy to
  verify the result themselves.

Handover completion check (2026-10-24): the gate definitions and commit IDs
above were checked against the current checkout. `npm test` passed (the current
runner reported 12 passing test-file entries); typecheck, lint, repository-wide
format checking, compile and `git diff --check` passed. The relay verifier passed
all five scenarios and bounded cleanup after rerunning outside the sandbox;
the sandbox initially denied its temporary loopback listener with `EPERM`.
The earlier 127-test count and live deployment results are retained as
prior-session evidence, not new live verification. Only this handover was edited;
no live Incus checks, redeploy or session restart were performed during completion.

Nothing was pushed or published. The Task 4 Ports and identical-folder
findings remain open exactly as recorded below. No new task, optimization
round or production change starts without explicit user instruction.

## Previous state (2026-10-24, Task 5 closure)

The implementation is deployed and manually accepted: the user reported “much
better” and authorized task closure and cleanup. See
[TASK-05-RESULTS.md](TASK-05-RESULTS.md) and
[TASK-05-MEASUREMENTS.json](TASK-05-MEASUREMENTS.json) for the consolidated result,
measurements, verification and limits. Superseded reports and experimental
prototypes were removed; reusable verifiers and regression tests remain.

Healthy reuse takes three execs; installed-stopped takes seven. Default auto
tries verified container download then visibly falls back once to client;
explicit client/container remain available. Known publisher SHA is checked before
client cache publication/reuse. Managed curl ignores curlrc, and uncertain cleanup
blocks fallback. Normal keepalive and existing identity/GID policies are unchanged.

127 tests, typecheck, compile, manual-verifier typechecks and scoped live checks
passed. The installed production bundle was byte-verified, and the normal-profile
resolver completed a fresh connection in about 30 seconds before user approval.
Leave the running user session intact; do not uninstall/reset/restart it as cleanup.
Task 4's Ports and identical-folder findings remain outside Task 5.

Checkpoints `e03dcf8` and `2a99945` exist. The user authorized committing the
final implementation and cleanup to close Task 5. Nothing was pushed or published.
No further deploy, optimization round or next task starts without user instruction.

## Current state (2026-10-23, Task 4 verification)

Task 3 completion and discussion were explicitly confirmed before Task 4.
Task 4 scoped verification is complete. **Its results have been discussed and
the user explicitly resolved the Task 4 discussion gate.** Read
[TASK-04-RESULTS.md](TASK-04-RESULTS.md) for evidence and limitations.

- 80 tests pass with no skips; generated bash and the bundled relay execute
  against local temporary fixtures. Relay binary/channel/error/EOF checks and
  injected-failure cleanup pass.
- Explicitly authorized idle local and TLS cluster fixtures pass signed
  management handshakes, healthy reuse with parallel channels, normal startup,
  missing-token/wiped-install recovery, reset and synthetic stale replacement.
  UID/modes/content, loopback listeners and temporary-file cleanup are asserted.
- User-assisted Stable development-window checks pass selection/actions,
  themes, actual remote Restricted Mode, files, integrated/rescue terminals,
  distinct-folder concurrent windows, history removal and reload/reconnect.
- Two findings remain: identical-folder new-window requests reuse the existing
  window in the tested runtime; Ports is unavailable, so actual VS Code
  forwarding remains unverified. Reproductions and runtime-source evidence are
  in the report. No production fixes were attempted.
- Ports cause confirmed by installed-runtime comparison: Dev Containers
  0.469.0 calls `setContext('forwardedPortsViewEnabled', true)` during its
  resolver setup. VS Code 1.143.1 gates Ports-view registration on this feature
  context (or its view-only counterpart). The Incus resolver does not enable
  it, explaining the missing view in the clean Incus test profile. Enabling
  the UI and proving actual forwarded-loopback connectivity are both still
  required for a complete fix; underlying forwarding remains unverified.
- Test processes, installations, temporary workspaces/HTTP service, private
  development profile and diagnostic/bundle files were cleaned and checked.
  Production/test and harness typechecks, isolated compile and diff checks pass.

The new manual verifier requires runtime target/opt-in/signing-module inputs
and refuses CI. Neither private fixture is a CI dependency; identifying target
values/logs are excluded from the new verification artifacts. Preexisting
repository content/history still requires a separate publication privacy audit.
No production source changes, deployment, normal-session restart, commit or
push. The two findings remain open; resolving the discussion gate does not
implement their fixes or authorize the next task. **Wait for an explicit
next-step instruction before implementation, optimization or further live work.**

## Previous state (2026-10-23, Task 3 worktree)

Task 3 is complete offline and **stopped for discussion** in
`<task-worktree>`. The user authorized
Task 3 after Task 2 acceptance and then explicitly included newly found
regressions in this session. Changes remain uncommitted.

Read [TASK-03-RESULTS.md](TASK-03-RESULTS.md) for changed behavior,
failure-before-fix evidence, the expanded script audit and remaining limits.
Final gates: 80 tests passed with no skips; typecheck, compile and diff check
passed. Extraction/interruption, recovery, bridge lifecycle and newly included
script/progress defects have retained regressions. Real handshakes remain
unverified. No live mutations, VS Code restart, deployment, commit or push.
Compilation used an isolated worktree-local dist directory.

The user-supplied review found no actionable regressions across staged,
unstaged and untracked changes, and reported all 80 offline tests and
TypeScript checking passing. Production fixes are in `src/bootstrap.ts`,
`src/bridge.ts` and `src/incusCli.ts`, with retained regression tests.
Live Incus and VS Code handshake behavior remains unverified.

**Wait for discussion. Do not begin Task 4 automatically.** Root fallback,
multi-user scope, normal token lifecycle, transport and public error policy
were not changed. The prior Task 2 record below is historical.

## Previous state (session end 2026-10-23, Task 2 worktree)

Latest stopping point: **Task 2 offline regression baseline is complete and
accepted by the user**, including the review correction below. Task 1's result
was discussed and accepted in its own session; the user explicitly confirmed
that prerequisite before Task 2 implementation. Task 1 harness commit:
`49c0ac0`. Task 2 changes remain uncommitted in
`<task-worktree>`.

- Verification after the review correction: `npm test` **59 passed, 0 failed,
  0 skipped**; `npm run typecheck`, `npm run compile` and `git diff --check`
  passed. Local Node version: 24.21.0.
- [docs/tests/COVERAGE.md](tests/COVERAGE.md) maps coverage and gaps to C1–C13,
  B1–B6, T1–T4 and X1–X8. [docs/tests/README.md](tests/README.md) explains the
  offline fixtures and commands. Coverage is partial where explicitly marked;
  mocks do not prove executable shell behavior, real handshakes, rendered UX
  or cross-window locking.
- `npm run test:known-defects` is a separate, intentionally failing command:
  **3 failures, no skips**. Intended contracts expose asynchronous bridge
  spawn errors not reaching the managed client, final stdout lost between
  process `exit` and stdio `close`, and an in-flight stat reporting push
  progress after completion. Production code remains unchanged.
- Review correction: the green transport tests now emit stdio `close` before
  checking terminal events and listener cleanup. They no longer require valid
  bytes between `exit` and `close` to be discarded; the separate red test
  retains that intended delivery contract.
- Other plan gaps remain open: extraction can falsely publish success after
  tar failure; repair-before-health can mask lost token/install state;
  mixed-user/process selection, resolver taxonomy, token validation, stale
  ports/identity and current-window folder reuse need further work. Root
  fallback and multi-user policy discrepancies remain undecided.

**Resume only when Task 3 is explicitly authorized.** Read
`TASK-03-CONNECTION-CORRECTNESS.md`, `REGRESSION_TEST_PLAN.md` and the coverage
report before correctness work; demonstrate failures before repairs. The task
documents and plan were available in the primary checkout at
`<repository-root>/`, not in this worktree. Task 3 has not
begun. No live Incus/VS Code checks, executable script/relay checks, real
downloads, redeploy, commit or push occurred during Task 2. Updating this
handover does not authorize those actions.

Previous stopping point: related-project and distribution research is recorded
in `ALTERNATIVES.md` and linked from README/DESIGN. No equivalent public
Incus exec-based resolver was found. Workshop and ssh2incus are the closest
comparisons; no publication was attempted. No public API GA timeline was found.

Tree icon parity and removal of the redundant `Running` and `Stopped` row
descriptions are deployed and user-verified. Compared against
the installed Dev Containers 0.469.0: disconnected running instances use
`ThemeIcon('vm-running')`, stopped instances use `ThemeIcon('vm')`, and the
connected instance uses the per-theme `vm-active.svg` check-dot asset.
Folder rows use per-theme `folder.svg` / `folder-active.svg`; active marking
requires BOTH authority and folder path. The original Dev Containers SVG
copies have now been replaced with unchanged
public `microsoft/vscode-icons` assets at revision
`2ca0f3225c1ecd16537107f60f109317fcfc3eb0` (CC BY 4.0).
Attribution and provenance are in `ThirdPartyNotices.md`; the full license is
in `licenses/vscode-icons-CC-BY-4.0.txt`, both included in packaging.
Unused copied `vm-default.svg` / `vm-stopped.svg` assets were removed.
The public assets have small path/color differences from Dev Containers;
runtime icon selection remains as described above.
The CC BY replacements passed typecheck/compile and were redeployed with
`./redeploy.sh`; the user approved the rendered result on 2026-10-23.
Running and Stopped row descriptions are omitted because their icons convey
the state. State remains in tooltips; other state descriptions remain.
`npm run typecheck` and `npm run compile` passed; `./redeploy.sh` completed
after each visual change, and the user approved the rendered result.

Deltas on top of `0dcb016` (previous handover), all verified on stable
1.142.0: `5f64f05` (tree connect affordances at Remote-SSH parity +
single-flow connect), `0e61725` (exec failures diagnosable + non-fatal
prune), `d95120d` (relaunch waits for clean exit), `128621b` (signal-
support pre-flight — Ubuntu 25.04+/packaging AppArmor trap),
`41b8712` (push tarball as the target user — sticky-/tmp fix),
`67167ea` (CLI 7.x list-filter regression), `80ef6be` (windowless
fresh-install harness), `52c3e50` (DESIGN §14 version-compat sketch),
`8d22af6` (Dev Containers tree UX — no row-click connect, icon-less
remote nodes), `a7761a2` (push progress restored on CLI 7.x),
`22a336d` (ever-opened folders + one-go reconnect), `90d38c5` +
`52bb622` (green check-dot session marking; exact Dev Containers icons;
authority-aware active row).

- Phase 0 (spike) **COMPLETE** — all hypotheses validated in real windows
  (DESIGN §8). Spike extension uninstalled from the user's VS Code; source
  was retained as reference at that time; its implementation is now in Git history.
- Phase 1 items 1–4 **COMPLETE, user-verified on stable 1.142.0**:
  1. TypeScript + esbuild project at repo root (`src/`, bundle `dist/extension.js`,
     relay as bundled asset `assets/relay.js`; proposal d.ts committed in
     `src/types/` pinned to tag 1.142.0, base types `@types/vscode@1.140.0`
     = newest on DefinitelyTyped; engines `^1.140.0`).
  2. Remote Explorer tree (switcher form, `remoteName: "incus"`,
     `group: "targets@1"`): remotes → instances, state icons, graceful
     "unavailable:" leaves; commands: connect, start, stop, restart,
     kill server, uninstall server, reset token, open terminal (exec),
     collect diagnostics, refresh. User signed off on rendered UX.
     Connect affordances now at DEV CONTAINERS UX (amended 2026-10-22,
     user-requested — replaces the 2026-10-20 Remote-SSH-parity wiring):
     row click does NOT connect (click only selects); connect happens ONLY
     via the right-side hover icons — `$(arrow-right)` = CURRENT window,
     `$(empty-window)` = NEW window (titles verbatim from the official
     Remote Explorer 0.5.0 manifest); a stopped instance is still started by
     the resolve; Start/Stop live in the context menu; connect commands
     hidden from the command palette; remote nodes show no icon.
     Ever-opened FOLDERS under each instance + one-go reconnect
     (2026-10-22, user-requested, Dev Containers UX): instance nodes with
     folder history render collapsible children (full path label, three
     hover icons: open current window / new window / remove from history);
     connecting an instance opens the LAST used folder directly
     (`vscode.openFolder` on a `vscode-remote://` URI — folder is the URI
     path, invisible to the resolver); history in extension globalState
     (`src/history.ts`, key `remote-incus.folder.history.v1`, cap 10),
     recorded at open-command time and at activation of windows already on
     an `incus+…` authority.
     Session marking + always expanded (2026-10-22, screenshot-verified
     UX): the connected instance icon and its connected folder row carry a
     green check-dot (baked into active SVG icons in `assets/light/` and
     `assets/dark/`, mirroring Dev Containers), and the
     tree defaults to fully expanded even when not connected.
  3. Bootstrap module (`src/bootstrap.ts`) — client-side cached download
     (globalStorage, sha256 sidecar), sha-gated path-mode push, idempotent
     extract as target user (`.incus-install-ok` marker), sticky 0600 token,
     detached start, port discovery from server.log, stale-commit restart,
     zombie detection before reuse, orphan-relay sweep after fresh starts,
     pruning of superseded in-instance installs + client cache entries.
  4. Progress UX (user-requested): connection/setup runs under a notification
     toast with a progress bar; title embeds a clickable "(show log)" link
     → `remote-incus.showLog` command → output channel; download % from
     content-length, push % from polling the growing target file's size
     (1 Hz `stat -c %s`) with the 6.x CLI meter as a secondary source —
     CLI 7.x (≥ SFTP push) prints NO meter when piped and creates no
     operation (TTY-gated renderer; DESIGN §14.1); percent-first messages
     (collapsed-toast truncation cuts from the right). Error toasts carry
     the same link.
     **Single flow** (2026-10-20): the toast belongs to the RESOLVE now —
     the tree-connect command only delegates to `vscode.newWindow`; the
     whole bootstrap runs exactly once inside the post-reload resolve
     (core restarts the ext host ≤ 1 s after the command).
- Working extension id: **`local-dev.remote-incus` v0.1.0** (placeholder
  publisher — naming is DESIGN §11.1, decide before OpenVSX). Installed in
  the user's VS Code; `~/.vscode/argv.json` grants it the proposals (spike id
  entry also still listed, harmless).
- Verified live this session (all on stable 1.142.0):
  - first connect ran the full 222 MB install inside resolve; core waited
    132 s with no resolve timeout; reconnect ≈ 17 s; install-present connect
    ≈ 16 s with zero transfer.
  - untrusted workspace (Restricted Mode): with
    `capabilities.untrustedWorkspaces.supported: true` the tree works
    pre-trust, exactly like Remote-SSH (screenshot-verified by the user).
  - zombie recovery: wiped `~/.vscode-server` while the server ran → detected
    ("lost its install (zombie) — killing and starting fresh") → connected.
  - stale-commit restart: simulated old-commit server (fake dir + `exec -a`
    cmdline with a true 40-hex id) → "runs stale commit 0123456789… —
    restarting under 6d62b1d5da…" → fresh server, old dir pruned, connected.
  - 2026-10-20 session: both hover icons + tooltips + context-menu order
    verified by the user; click → current window, `$(empty-window)` → new
    window; SINGLE flow per click (click → ext-host restart ≤ 1 s → one
    resolve flow ≈ 16-20 s → bridges); stopped-instance click starts and
    connects through the resolve pre-flight; stopped instance's automatic
    re-resolve loop also verified (instance stop mid-session → bridges die
    → core re-resolves → "starting …" → fresh server, new port picked up).
  - 2026-10-22 session (on stable 1.143.0, commit `2d0b7506…`): Dev
    Containers tree UX verified by the user — row click = selection only
    (no connect), both hover icons connect, remotes render without an
    icon; CLI 7.x push progress verified end-to-end in a real window
    (server wiped → zombie kill → cache-hit push of 222 MB ≈ 2 min with
    the toast bar crawling 30→90% → extract → fresh server); ever-opened
    folders + one-go reconnect verified (folder children render with the
    three official-order hover icons, connecting lands straight in the
    last-used folder, remove-from-history works).
  - one transient exec failure seen once (prune step, ~10 s then nonzero)
    — unreproducible standalone or with 2 live bridges (daemon/link hiccup,
    suspected); it aborted the connect then — now non-fatal and diagnosable.
  - 2026-10-20 evening (after the user reinstalled the local daemon from
    the zabbly repo — CLI/daemon 6.0.5→7.5.1): connect to a fresh local
    instance verified by the user (single flow, stable terminal) on the
    signal-probe build. THEN the user's first FULLY-FRESH install exposed
    two more defects, both fixed and verified:
    - sticky-/tmp: root-pushed tarball undeletable by the extract user
      (EPERM) — fixed by pushing as the target user; verified END-TO-END
      by scripts/fresh-install-test.ts against a throwaway 24.04 instance
      (download → user-push ≈ 1 s on the local unix socket vs 2.1 MB/s
      TLS on fixture-remote → extract → marker → tmp cleaned → 0600 files →
      port → session), then user-verified in a real window on another
      fresh instance.
    - CLI 7.x list-filter regression ("instance not found" on a healthy
      instance) — universal form + exact-name find; verified via the
      harness + a real resolve.
  - the death-loop investigation itself (ptyHost terminated unexpectedly /
    kill EACCES / restarting terminals) is documented in DESIGN §8 with
    the audit-log root cause and the zabbly fix (see the environment
    snapshot above).
- Remaining Phase-1 work (DESIGN §12): item 5 diagnostics refinement —
  error-surfacing + signal pre-flight DONE 2026-10-20 (IncusError leads
  with cause; full detail in log; prune non-fatal; kill-probe refuses
  signal-blocked instances), remaining = `RemoteAuthorityResolverError`
  taxonomy polish for the §7 table; item 6 tests — the windowless
  fresh-install harness (§12.6 mechanics base) landed, full mechanics/
  contract/matrix suites open; item 7 packaging (CI VSIX + OpenVSX +
  README). Naming decision (§11.1) before OpenVSX. Item 8 (§14 version
  compat layer) planned, not implemented.
- Repository paths are relative to the checkout root; the development branch was `main`.

## Runtime context and isolation

Verified runtime coverage and historical versions are recorded in DESIGN's
support matrix and the dated results above. Runtime state changes; no tracked
inventory, addresses, instance names or cached process state is authoritative.

- Select a test-owned idle fixture using an explicitly supplied `remote:instance`.
  Never use the default remote or the first enumerated instance as a test target.
- Never touch production instances. Confirm fixture ownership and obtain explicit
  authorization before destructive checks, daemon changes or editor restarts.
- A cluster's members may differ in kernel/packaging behavior. Check the selected
  fixture's actual behavior without recording private topology in the repository.
- Keep raw diagnostics, credentials and host-specific configuration outside tracked
  files. Do not commit runtime tokens, inventories or personal checkout paths.
- Graceful client disconnect can stop the server promptly; the reconnection grace
  after ungraceful disconnect is a different case, not a reason to change policy.

## Dev loop

- `./scripts/redeploy.sh <remote:instance> <absolute-folder>` — build, package, install,
  restart normal VS Code and reopen the selected remote folder. Quote folder
  paths containing spaces. This command installs the build and restarts editor
  windows; it is a manual deployment step, not a verification command.
- Extension log: `/tmp/remote-incus-dev/redeploy/ext.log` (via
  `REMOTE_INCUS_DEBUG_LOG`, which scripts/redeploy.sh sets) plus the
  "Remote - Incus" output channel.
- Offline smoke: `npx esbuild scripts/smoke.ts --bundle --platform=node
--alias:vscode=./scripts/vscode-stub.js --outfile=/tmp/remote-incus-dev/smoke.js &&
node /tmp/remote-incus-dev/smoke.js` (authority round-trips + read-only daemon probes).
- Chain deploy steps with `&&`, not `;` — a `;` chain once relaunched a
  window with STALE code after a failed typecheck (cost: confusing session).
- **Committing + harness-verifying is NOT deployment** — the running windows
  only pick up src changes via `./scripts/redeploy.sh` (cost one user-visible round:
  a committed, harness-verified fix was still un-deployed and the user
  re-hit the bug).
- Server commit = local client commit: `vscode.env.appCommit` (resolvers
  proposal), fallback `code --version` line 2. Do NOT parse
  `update.code.visualstudio.com/api/commits/...` (returns a JSON array).

## Debugging traps (each cost real time — don't rediscover)

- **Untrusted-workspace trap**: a window on a never-trusted remote folder
  starts in Restricted Mode; the extension is "disabled because the current
  workspace is not trusted", its views contribution is DROPPED, and
  `registerTreeDataProvider` toasts "No view is registered with id: …" —
  while the resolver still runs (core special-cases resolver activation).
  Looks like a manifest/proposal bug; the fix is
  `"capabilities": { "untrustedWorkspaces": { "supported": true } }`.
- **Authority separator is `:`, not `/`**: `vscode-remote://` URIs end the
  authority at the first slash; use `incus+<remote>:<instance>`.
- **Zombie servers**: deleting `~/.vscode-server` while the server runs leaves
  a live process with no install/token/log; a process-only reuse check
  "reuses" it and hangs 60 s in port-wait. The on-disk health check in
  `src/bootstrap.ts` handles it — do not remove it to "simplify" reuse.
- **`pkill -f`/`pgrep -f` self-match**: the pattern AND any text inside the
  same `bash -c` payload are match surface. Bracket-class every pattern and
  keep payloads name-free — including throwaway diagnostic one-liners
  ("2 relays" / "1 node proc" artifacts this session were my own payloads).
- **`pgrep -f` output order is readdir-based, not pid-sorted** — never depend
  on ordering; the running-server probe collects ALL 40-hex commits and dedups.
- **Validate test fixtures before trusting a negative result**: the first
  fake-commit simulation used a 42-hex id; the probe's `{40}` regex correctly
  ignored it, which looked like an extension bug. (Fixture lesson: count your
  fake ids.) Useful simulation trick that DID work:
  `bash -c 'exec -a "<fake cmdline>" sleep 600'` inside `incus exec`.
- **core restarts the extension host within ~1 s of `vscode.newWindow`** and
  fresh-resolves the authority there; bridges are ext-host-owned and never
  survive a reload. Consequence: bootstrap work pre-run in the connect
  command runs TWICE (log-verified ~18 s + ~23 s) — the connect command now
  only delegates; never re-add a pre-flight (DESIGN §8, 2026-10-20).
- **Error line 1 must lead with the CAUSE (stderr/status), never the command**:
  toasts and `firstLine()` cut at the first `\n`; a multi-line command joined
  into line 1 hid the stderr everywhere (cost one undiagnosable failure).
  `IncusError` now reads `incus <target> --<inline script> failed (exit N /
timed out): <stderr line 1>`; catches log the FULL message, toasts take
  `firstLine()`.
- **"Another instance of Code is running but not responding" modal**: relaunch
  raced a half-dead pkilled instance; Code processes can ignore SIGTERM
  entirely (one needed `kill -9`). `scripts/redeploy.sh` now polls `/proc/*/exe`
  until no code process remains before launching — keep that loop.
- **Collapsed progress toasts truncate title+message as one line** — put the
  percentage at the START of progress messages.
- CLI flags only apply to NEW windows; restart to a single fresh instance
  when debugging resolver flows (`ls -l /proc/[0-9]*/exe | grep -c 'code/code'`).
- Direct `incus exec` args expand `~` on the CLIENT — pass absolute paths.
- **CLI 7.x rejects the glued `incus list <remote>:<name>` filter** (empty
  result set + "did you forget a space" warning; CLI 6.x matched) — the
  resolver pre-flight then misreads a healthy instance as deleted. Always
  pass the remote and the instance filter as separate arguments and
  exact-match the result (general rule for the version-compat layer, §14).
- `PendingMigrationError: navigator is now a global in nodejs` from unrelated
  extensions — harmless noise.
- System locale is German — expect German OS/CLI error strings (incus daemon
  messages are English).
- **No CLI screenshot tooling** (GNOME Wayland). View verification is
  user-in-the-loop; log signals: activation lines in
  `~/.config/Code/logs/<session>/window*/exthost/exthost.log`, absence of the
  "No view is registered" renderer error, and the debug log file.
- `@types/vscode` stops at 1.140.0 (DefinitelyTyped lag); pull proposal d.ts
  from the vscode repo tag instead (done, committed in `src/types/`).

## Version model (client ↔ server)

- Server commit is read fresh at EVERY resolve; nothing pins the client.
- Client update → new commit → install alongside → stale-commit server
  killed → fresh start (token sticky) → superseded dirs + caches pruned.
- Proposal d.ts verified byte-identical 1.140→1.142; live-verified on 1.142.0.
- Residual risk: proposal-shape change in a future client → extension fix
  release; the runtime guard errors loudly (never silently).

## Historical Phase-1 checklist (superseded by current stopping point)

1. ~~Project / tree+commands / bootstrap / progress UX~~ **DONE 2026-10-19**.
2. Diagnostics refinement (§12.5): error-surfacing done 2026-10-20 (IncusError
   leads with stderr/exit status, catches log full detail, prune non-fatal);
   open: `RemoteAuthorityResolverError` usage for the §7 taxonomy (deleted
   instance → NotAvailable unresolvable, starting → TemporarilyNotAvailable, …).
3. Tests (§12.6): Task 3 correctness and scoped Task 4 real-behavior verification
   are complete; see `docs/tests/COVERAGE.md` and `TASK-04-RESULTS.md`. Discuss the
   identical-folder window behavior and unavailable Ports view before further
   work. Insiders, arm64 and additional version/image checks remain unverified;
   expanding that matrix requires separate authorization. Private fixtures are
   manual runtime inputs, not CI dependencies.
4. Packaging (§12.7): CI-built VSIX + OpenVSX publish + README argv step
   (README stub exists). Decide final naming/publisher (§11.1) first.

Open questions live in DESIGN §11. **Do not** reopen settled matters —
transport, token policy, and user policy are frozen after evidence.

## Conventions on this machine

- Before creating/naming ANY git commit, read `~/.agents/AGENTS.md` and
  `~/.agents/skills/commit-naming/SKILL.md` and follow them (subject
  `<type>(<scope>): <essence>`, ≤72 chars, body for detail, split logical
  changes into separate commits).
- Discuss with the user before big direction changes; they review evidence
  before code (the rhythm: research → adversarial audit → spike → freeze → build).
- Prefer parallel subagents for research bursts; require URL-cited, verified
  claims; mark UNVERIFIED explicitly.
- Phase-0 implementation is retained in sanitized Git history. DESIGN §13 and
  the historical summary preserve its findings; use current verifiers for new work.

## Quick file map

```
docs/
  README.md                documentation index
  DESIGN.md                canonical architecture + findings + plan
  HANDOVER.md              current stopping point and historical context
  TASK-*-RESULTS.md        implementation and verification evidence
  TASK-05-MEASUREMENTS.json connection optimization measurements
  tests/                   testing guide and coverage map
  spike/                   Phase-0 verification guide
package.json               extension manifest (proposals, views, commands, settings)
tsconfig.json / esbuild.js build config (bundle → dist/extension.js)
src/
  extension.ts             activate: resolver + tree + commands wiring
  authority.ts             `incus+<remote>:<instance>` parse/format
  incusCli.ts              typed incus CLI wrapper (exec, push+meter, list, lifecycle)
  bootstrap.ts             install/start/token/port (spike flow, inlined; reuse hardening)
  bridge.ts                exec-stdio → ManagedMessagePassing
  resolver.ts              RemoteAuthorityResolver + pre-flight
  tree.ts                  Remote Explorer tree (remotes → instances)
  commands.ts              tree commands (connect/start/stop/kill/uninstall/…)
  terminal.ts              escape-hatch exec terminal (script-PTY)
  progress.ts              connection progress toast (log-link title, reports)
  logging.ts               output channel (+ REMOTE_INCUS_DEBUG_LOG mirror)
  types/                   proposal d.ts pinned to vscode 1.143.1
assets/relay.js            bundled relay (staged in-instance per install)
tests/                     regression/script suite and fixtures
scripts/                   development helpers and opt-in verification
  redeploy.sh              build + package + install + restart normal VS Code
```
