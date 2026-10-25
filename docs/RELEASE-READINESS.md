# Release-readiness review — 2026-10-25

The extension has scoped functional acceptance. The private content identified
in this review has since been cleaned from the checkout, rewritten reachable
history and rebuilt VSIX. Final identity, repeatable packaging and distribution
decisions still prevent publication. The table below preserves the initial
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
systems and additional version/image combinations. Error-dialog UX has not
been reverified live. Ordinary forwarding retains the IPv4-loopback lookup
limitation on IPv6-only-networked containers; the accepted helper works from an
existing Ports row. None of these is evidence of failure on an untested system.

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

## Proposed packaging sequence after the decisions

1. Prepare the agreed public source/documentation set and final identity.
2. Make packaging use the lockfile-installed VSCE and build production output.
3. Run `npm ci`, `npm test`, `npm run test:relay` and production packaging in a
   headless Linux CI job with no Incus daemon, credentials or private targets.
4. Inspect the archive against an explicit file policy: entry point and relay
   present; licenses and linked user docs present; no private identifiers,
   personal paths, source maps or development-only artifacts.
5. Upload the reviewed VSIX as a CI artifact. Keep registry publication separate
   until the chosen route and credentials are explicitly authorized.

No live instance checks or expanded platform tests are needed to resolve the
source privacy and identity decisions. Those tests remain separately scoped.

## Validation

Final checks passed: `npm test` (177 tests, none failed or skipped, plus strict
TypeScript, ESLint and formatting), `npm run test:relay` (all six reported
checks), production build and local VSIX packaging. Relative file links in the
changed documentation were checked against the checkout. Final formatting and
`git diff --check` also passed. Production behavior is unchanged; the archive
policy was hardened as described below. CI implementation remains follow-up work.

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
Remaining release work is final identity, repeatable CI packaging, package-file
minimization and distribution eligibility. No push or publication is authorized.

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
