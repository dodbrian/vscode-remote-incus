# Release-readiness review — 2026-10-25

## Dependency security follow-up

The `fast-uri` alerts were resolved by its lockfile update to `3.1.9`.
For [GHSA-xcx6-jx8p-x3h5](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5),
VSCE's Azure Identity `4.14.0` still requests MSAL Node `^6.0.0`, while the
advisory requires `7.1.0` or newer. A scoped npm override pins MSAL Node
`7.1.1` beneath VSCE's Azure Identity dependency. Remove the override once
upstream supports a patched MSAL dependency directly and the audit remains clean.
The [MSAL changelog](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-node/CHANGELOG.md)
identifies removal of the interactive `responseMode` option in version 7;
Azure Identity's installed client does not pass that option. Packaging is
validated separately; live Azure authentication and Marketplace publication
are outside this project's tested publishing route.
These are development dependencies excluded from the production VSIX.

## Public distribution checkpoint

The user subsequently authorized the public GitHub repository and Open VSX
publication. The [first hosted CI run](https://github.com/dodbrian/vscode-remote-incus/actions/runs/40226291218)
passed, and its downloaded VSIX passed archive policy checks. The
[publication run](https://github.com/dodbrian/vscode-remote-incus/actions/runs/40229238587)
passed the full verification suite, validated its own artifact again, created
namespace `dodbrian` and reported uploading version `0.1.0` successfully.
After an initial visibility delay, the public API confirmed version `0.1.0` is
downloadable. The public VSIX passed archive validation and is byte-identical
to the publishing run's artifact. The
[Open VSX listing](https://open-vsx.org/extension/dodbrian/remote-incus) is available;
namespace ownership verification remains pending.
See the [current handover](HANDOVER.md#current-stopping-point-open-vsx-release-available-2026-10-25).
The sections below preserve the earlier review and its dated evidence.

The extension has scoped functional acceptance. The private content identified
in this review has since been cleaned from the checkout, rewritten reachable
history and rebuilt VSIX. Release identity is selected below; distribution
decisions remain pending. Repeatable local packaging and a headless CI workflow
are now implemented; the first hosted workflow run remains unverified.
The table below preserves the initial
review findings; the cleanup status section records their remediation. It does not authorize a
push, public repository, registry upload, deployment or history rewrite.

## Documentation and accepted behavior

README and DESIGN now distinguish declared compatibility from tested coverage.
They record the completed resolver classification, Bash-free Alpine x64 work,
startup prerequisite diagnostics, Ports activation, selected-row IPv4 helper
and identical-folder workspace fix. The user manually confirmed the latter in
the normal profile on 2026-10-25. Historical task reports retain their original
scope; the current support matrix and handover supersede their open findings.

Remaining coverage limits include Insiders, ARM64, other client operating
systems and additional version/image combinations. The missing-`tar` error dialog
is now verified from the user's screenshot; other resolver error dialogs remain
unverified live. Ordinary forwarding retains the IPv4-loopback lookup
limitation on IPv6-only-networked containers; the accepted helper works from an
existing Ports row. None of these is evidence of failure on an untested system.

## Current backlog classification

Release identity is now selected below; publication remains deferred. The user
subsequently authorized offline reliability and release tooling with local
commits. Packaging now uses the lockfile-installed VSCE, a production prepublish
build, actual-VSIX policy validation and synthetic archive regression tests.
The tracked headless workflow installs locked dependencies, runs offline/relay
and archive checks, and retains a validated VSIX without publishing it. Resolver
classification, startup diagnostics, Alpine/Bash-free support, the IPv4 helper
and identical-folder windows are implemented with their recorded acceptance.
The coverage limits above are verification gaps, not missing implementations.
The centralized Incus compatibility layer and later-phase multi-user or
devcontainer.json work are separate future scope.

The current workstream backlog is maintained in the
[handover task status](HANDOVER.md#current-task-status-2026-10-25). The reviewed build is now deployed. Normal-profile Ubuntu/Rocky connection
checks, signed authentication/reuse and Rocky's missing-tool dialog passed;
other UI/error cases remain separately scoped. First hosted CI execution
is pending. Local implementation, clean-copy checks and independent review
are complete within their recorded scope.

The Rocky Linux `tar` report is resolved on the tested fixture. The package was
confirmed absent; the improved diagnostic was shown in VS Code without changing
installation markers. After separate user approval, installing only `tar`
allowed setup and normal connection to complete. See the
[handover report](HANDOVER.md#reported-target-issue-tar-unavailable-2026-10-25).
This is scoped Rocky Linux 9.8 x64 evidence, not universal image acceptance.

## Deployment and live verification (2026-10-25)

The user authorized normal-profile deployment/editor restart and live connection
checks, then separately approved the Rocky `tar` installation. The installed
bundle matches the reviewed production bundle by SHA-256. The helper now uses
the reviewed staged package pipeline; three mocked tests ensure package failure
prevents installation/restart and validate fixture arguments and checkout paths.
`npm run test:redeploy` is part of headless local-fixture CI.

Stable 1.143.1 / commit `e646868227…`, Incus 7.5.1 and Linux x64 were checked.
Ubuntu reused its healthy server. Rocky Linux 9.8 showed the actionable missing
`tar` dialog (user screenshot), preserving incomplete-install directory/marker
metadata; the approved RPM transaction installed only `tar`. A distinct normal
profile workspace forced a new resolve after VS Code initially focused the
existing failed window. Setup completed, both exec bridges started, and core
logs confirmed remote agent initialization. The installed Rocky Node is 24.22.1.

A bounded connection-only temporary harness passed signed management negotiation,
invalid-token rejection, filesystem ownership/modes, relay hash and healthy reuse
on both targets. Server process identities stayed unchanged during reuse. It
closed only its own relay channels; normal editor sessions and server installs
were retained. The destructive manual verifier was not run. No token reset,
manual server wipe, networking change, production-instance operation, push or
publication occurred. Raw evidence and target identifiers remain untracked.

Other Rocky terminal/UI workflows, other resolver dialogs and additional
platforms remain unverified. The earlier review/validation sections below record
historical evidence and do not override this deployment result.

## Initial review findings (before cleanup)

| Finding                                           | Evidence from this review                                                                                                                                                         | Required follow-up                                                                                                                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private infrastructure details are tracked        | Handover includes host addresses, cluster/instance names and production inventory. DESIGN, older scripts and other documentation include private fixture names or personal paths. | Prepare a sanitized public export or explicitly scoped cleanup; preserve private operational guidance separately.                                                                                                           |
| Private details exist in Git history              | All 82 commits reachable from local refs were checked. Known private addresses occur in 79 snapshots; fixture names and personal paths occur in all 82.                           | A working-tree cleanup alone is insufficient for publishing this history. Decide between a clean public export and a separately authorized history rewrite. Remote-only objects and unreachable objects were not inspected. |
| Current VSIX includes private documentation       | The locally built 37-entry archive contains private addresses in the handover, fixture names in four documentation files, and personal paths in three.                            | Define and verify a public package file set. Keep user documentation, working relative links, MIT license and icon attribution/license together. Excluding one document alone does not remove all findings.                 |
| Product identity is provisional                   | `package.json` uses publisher `local-dev`, `private: true` and an `example.invalid` repository. The resolver opt-in guidance also embeds the provisional extension ID.            | Choose final display name, extension name, publisher and repository; update manifest, README, runtime guidance and install instructions consistently.                                                                       |
| Packaging is not repeatable from a clean checkout | `npm run package` requests `@vscode/vsce@latest` despite a lockfile dependency and does not compile first. There is no tracked CI workflow or `vscode:prepublish` build hook.     | Use the lockfile-installed packager and an explicit production build before packaging; prove artifact contents from a clean checkout in CI.                                                                                 |
| Registry route is undecided                       | Proposed APIs `resolvers`, `contribViewsRemote` and `tunnels` remain enabled. Existing distribution research is dated.                                                            | Choose VSIX sharing or an additional registry and recheck current registry, proposal opt-in and server-license requirements before publication. No new legal or registry eligibility conclusion is made here.               |

The initial privacy scan used known private identifiers, personal path patterns and
private-key headers, plus targeted credential-related text inspection. No
private-key header was found in the reachable tracked snapshots or the built
archive. This is a bounded review, not a comprehensive secret-scanner result;
ordinary token handling and synthetic test tokens are not credential leaks.
Raw scan output and the VSIX remain outside tracked files.

## Package inspection

The initial local production build and installed VSCE 3.9.2 produced
`/tmp/remote-incus-release-review.vsix`. It contains the extension entry point,
relay, tree assets, README, documentation, MIT license, third-party notices and
CC BY 4.0 license. It excludes source, tests, scripts, spike implementation,
node_modules and source maps. It also unnecessarily includes development
configuration and the pre-commit hook. That initial artifact has been replaced with a rebuilt, sanitized inspection
artifact. Neither artifact was installed or published during this cleanup.

The initial sandboxed build/list attempt omitted files and reported a missing
entry point. Repeating the same local operations outside the sandbox produced
the expected file set and a successful package. That initial result is an
environment restriction, not evidence of a broken production build.

## Implemented offline packaging sequence

1. Install the lockfile dependencies with `npm ci --include=dev --no-audit --no-fund`.
2. Run `npm test`, `npm run test:relay`, `npm run test:package` and
   `npm run audit:privacy` without any Incus daemon, credentials or private targets.
3. Run `npm run package`: the local VSCE invokes `vscode:prepublish` for a
   production build into a temporary candidate. The validator
   checks its actual contents, local documentation links/anchors and privacy
   patterns against an explicit file allowlist. Only a successful result is
   renamed to `remote-incus.vsix`; build/finalization/validation failures preserve
   the previous verified artifact.
4. The tracked `.github/workflows/offline-ci.yml` performs these steps on a
   headless Linux runner and uploads the validated VSIX as a 14-day build
   artifact. Action revisions and the Node version are pinned.
5. Verify publisher registration and distribution eligibility/route before publication;
   no registry release or credentials are configured here.

The build sequence is repeatable from locked inputs; byte-identical ZIP output
is not promised. Hosted execution remains unverified until a repository push
and an actual GitHub Actions run. CI artifacts use the selected identity and
are review builds, not publication approval.

No live instance checks or expanded platform tests are needed to resolve the
source privacy and identity decisions. Those tests remain separately scoped.

## Review follow-up (2026-10-25)

A second review reproduced gaps in the first implementation and repaired them:

- A command found by `command -v` can still be a non-executable file in default
  Bash. Utility guards now require an executable regular file, and flavor
  probing checks `uname` before invoking it. Bash POSIX mode and Dash did not
  reproduce that lookup behavior; this is not a Rocky-specific reproduction.
- The ZIP reader previously trusted CRC values and skipped directory entries
  before checking hidden payloads. It now verifies checksums and checks every
  entry's safety, size and type before accepting it.
- Required runtime files could be empty and XML metadata could be malformed or
  disagree with `package.json`. Validation now requires nonempty files, parses
  JavaScript without executing it, checks complete XML documents and verifies
  identity, required assets and content-type coverage. These checks are not a
  full VSIX schema validator or an extension-host integration test.
- Regex-only Markdown checks missed reference links. A locked Markdown parser
  now recognizes links/headings and isolates fenced examples; parsed destination
  rewriting handles encoded root README/license links and reference definitions
  while retaining source formatting. This avoids case-colliding archive aliases.
- Failed packaging could overwrite the last verified local artifact. Builds
  now use a candidate on the destination filesystem and rename it into place
  only after finalization and all policy checks pass. Failure cleanup and
  previous-artifact preservation have regression coverage.

Review verification passes all 16 offline test-file entries and quality gates,
26 package regressions across three files, the privacy audit and a production
33-file VSIX with 82 local documentation links/anchors. Eight new prerequisite
regressions cover unusable tools and unavailable probe utilities. No deployment,
publication, hosted workflow run or Rocky Linux acceptance is claimed.

## Initial offline tooling validation (2026-10-25)

A clean temporary source copy, without existing dependencies or build output,
passed `npm ci --include=dev --no-audit --no-fund` and the complete workflow
command sequence: `npm test`, relay checks, package-policy tests, checkout
privacy audit and production packaging. Installation used registry access;
subsequent verification used local fixtures only. The copy was locally
initialized for Git-based privacy enumeration; it was not a hosted CI worker.

Results: all 16 offline test-file entries plus typecheck/lint/format passed,
all six relay checks passed, all nine archive-policy tests passed, and the
33-file VSIX passed file/runtime/license/privacy validation plus 82 local
Markdown links/anchors. A separate checkout check resolved all 82 local
Markdown links/anchors. The checkout privacy audit reported no findings.

Independent review caught and resolved musl `ldd --version` nonzero-exit handling
and VSCE's root README/license renaming. Packaged Markdown references are now
corrected to literal archive filenames, with regression coverage. The new setup
checks have 21 offline regressions covering strategies, selected users, missing
tools, preservation before extraction, healthy reuse and musl behavior.

The sandbox blocked local loopback listeners and Git child-process enumeration;
repeating those authorized local checks outside that restriction passed. This
is an environment boundary, not a relay or privacy-check failure. No live
instance, editor restart, deployment, push or publication occurred. Hosted CI,
Rocky Linux target acceptance and rendered error dialogs remain unverified.

## Historical privacy-cleanup validation

Final checks passed: `npm test` (177 tests, none failed or skipped, plus strict
TypeScript, ESLint and formatting), `npm run test:relay` (all six reported
checks), production build and local VSIX packaging. Relative file links in the
changed documentation were checked against the checkout. Final formatting and
`git diff --check` also passed. Production behavior is unchanged; the archive
policy was hardened as described below. CI was implemented in the subsequent offline tooling work; hosted execution remains unverified.

## Privacy cleanup status

The user explicitly authorized rewriting existing history while preserving its
chronological structure. The rewrite retains all 82 commits and all 15 refs,
with a one-to-one commit mapping, identical ordered parent relationships,
author/committer attribution and exact timestamps. No commits were squashed,
rebased, dropped or combined. Sanitized content changes commit IDs. Historical
reports can quote pre-cleanup IDs; the local verification map is retained only
in Git metadata, not shipped in the VSIX.

Private addresses, real fixture/cluster names, personal checkout/worktree paths
and production inventory were removed or replaced with documentation examples.
The current handover contains no host inventory or live-state assumptions.
Manual dev/harness/spike scripts require explicit runtime fixture inputs;
the fresh-install harness also requires destructive opt-in and rejects CI.
The legacy relay no longer prints the token in a URL, new spike state uses
private permissions, and the obsolete ignored spike token and old local VSIX
were removed. No live instance, server token or running editor was touched.

A reusable value-redacting pattern audit is available as `npm run audit:privacy`,
with `--history` and extracted-export `--root` modes. Known-identifier scans,
address/home-path/domain inventories and entropy triage supplement it. Dependency
integrity hashes and ordinary project IDs were reviewed as expected data.
Git author attribution is deliberately preserved, not anonymized. The tool is a
bounded audit, not proof that every possible secret format can be detected.

The initial publication blockers for private checkout/history/package content
are resolved for the checkout, reachable snapshots and rebuilt package. The
user subsequently explicitly approved permanent local recovery-object cleanup,
including 61 additional unreachable commits. Reflogs were expired and
unreachable objects pruned. Verification confirmed repository integrity, all
82 commits and 15 refs with unchanged parent relationships and metadata, no
remaining old mapped objects, no unreachable objects and no reflog entries.
Remaining release work is repository creation, publisher registration, first hosted CI verification and
distribution eligibility. Production packaging and the archive policy are implemented. No push or publication is authorized.

## Independent follow-up audit

A separate agent independently checked 362 historical blobs, 103 current files
and the then-current 38-entry VSIX. It found no remaining private infrastructure
identifiers or secret literals, and independently verified the 82-commit graph,
15 refs, ordered parents, attribution and timestamps against the original
objects and rewrite plan. It confirmed no source maps and that explicit-target
guards reject bare-instance inputs. Two stale report claims were corrected.

The reviewer recommended explicit archive exclusions for private runtime files.
Those exclusions have now been added for environment files, keys, certificates,
logs, source maps, private state and development configuration. This supplements
Git ignores; user-facing documentation and required licenses remain packaged.

Final artifact verification covered the rebuilt 33-entry VSIX. All required
runtime/license files remain present; checkout, reachable-history and archive
pattern scans are clean. Eight temporary synthetic environment/key/certificate/
log/source-map probes confirmed archive exclusions, then were removed. Shell
missing/malformed-target checks, Python/JavaScript syntax checks and 75 local
documentation file links also passed. The independent agent's final verdict
was clean within this audited scope. The subsequently approved permanent
recovery-object cleanup also passed integrity, graph and privacy checks.
No universal secret-detection claim is made.

## Release identity decision (2026-10-25)

The user selected **Remote - Incus** (`remote-incus`) under publisher namespace
`dodbrian`, with planned source repository
`https://github.com/dodbrian/vscode-remote-incus`. The manifest, README and current test instructions use `dodbrian.remote-incus`;
resolver opt-in guidance derives the ID from the running extension metadata.
The authenticated GitHub account was checked with `gh`; the planned repository
returned 404. Registry namespace availability and registration are still
unverified.
The manifest retains `private: true` to guard against accidental npm publication;
it is not evidence of extension registry eligibility.

Three parallel research agents checked project policy, governance and ecosystem
precedents. No Incus-specific third-party naming policy or explicit permission
for this name was found in the official sources searched. Incus's
[Apache 2.0 license, section 6](https://github.com/lxc/incus/blob/main/COPYING)
does not grant general trademark rights. An older
[Linux Containers maintainer discussion about LXC/LXD names](https://discuss.linuxcontainers.org/t/the-naming-of-third-party-open-source-lxc-lxd-non-canonical-managed-projects/14818)
welcomes third-party names that avoid implying official relationship/support,
but predates Incus and is not Incus-specific authorization. The official
[third-party integrations list](https://linuxcontainers.org/incus/docs/main/third_party/)
establishes ecosystem precedent, not permission for our name. This is bounded
project-policy research, not a worldwide trademark clearance.

The user chose to proceed with the current naming and reconsider if maintainers
object. No maintainer was contacted. The README states that this is an independent
project, without Incus or Linux Containers affiliation or endorsement. This
choice does not authorize Incus logo use. Repository creation, push, registry
publication and installation of the renamed extension remain separate actions.
