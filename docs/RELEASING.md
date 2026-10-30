# Build, release and publish

Every push to `main` starts **Actions → Build, release and publish**. One run
carries the candidate through the complete chain:

1. **Build and test candidate** runs automatically. It calculates a candidate
   version, prepares the changelog, runs all checks, and retains the verified
   VSIX, checksum, release notes and exact version metadata as one artifact.
2. **Approve GitHub release** waits for your approval of the `release`
   environment. In the run, choose **Review deployments**, select **release**,
   then **Approve and deploy**. It uses that run's candidate to commit the version
   and changelog, push an annotated tag, and create the GitHub release.
3. **Approve Open VSX publication** then waits for a separate approval of the
   `open-vsx` environment. It downloads the VSIX from the GitHub release created
   by this chain, verifies its identity and checksum, and publishes those exact
   bytes. It never rebuilds or chooses a different release.

You do not enter version numbers or select artifacts at either approval gate.
You can inspect or install the candidate before release, and inspect the GitHub
release before publishing to the registry. The README is inside the VSIX and
source archives; release notes also link to the README at that release's tag.

## Automatic versions and optional overrides

CI reads conventional commit subjects and breaking-change footers since the
current version's tag:

| Changes                                                 | Before 1.0 | From 1.0 onward |
| ------------------------------------------------------- | ---------- | --------------- |
| Fixes, maintenance, documentation, other changes        | Patch      | Patch           |
| `feat:` or `feat(scope):`                               | Minor      | Minor           |
| `type!:` / `type(scope)!:` or `BREAKING CHANGE:` footer | Minor      | Major           |

The largest applicable bump wins. When there is no existing version tag, the
first automated release includes the existing commit history. Authored
`Unreleased` changelog notes are preserved and supplemented with the commit list.
Breaking changes should include migration instructions in those notes.

Normally, leave version selection automatic. For an intentional override, use
**Run workflow** on `main` and choose an optional **bump**, or enter an exact
**version**. An exact version takes precedence and must increase. For example,
explicitly choose `1.0.0` once the core connection workflow is dependable and you
commit to configuration and behavior compatibility. CI does not infer readiness
for 1.0 from a breaking change during the pre-1.0 period.

To exercise the build without requesting either approval, select **dry_run**.
The build prepares a candidate locally but consumes no version. You can also run
a dry run on a development branch. Real releases require `main`.

## Identity, failures and retries

The build artifact is associated with its source commit and workflow run. Both
approval stages receive their tag and artifacts automatically through job
outputs. No registry secret is passed to the build or GitHub release steps.

Approval environments require the repository owner's review and allow only
`main`. They must remain configured in **Settings → Environments**. This is what
makes the two later jobs manual. Merely naming an environment in YAML does not
establish an approval requirement.

A candidate version is consumed only when the GitHub release step atomically
pushes its version commit and tag. If `main` changes while a candidate awaits
approval, releasing that stale candidate fails without pushing either. Approve
the candidate from the newer run instead. Build artifacts are retained for 30
days; after expiry, build a new candidate.

Use **Re-run failed jobs** to recover the same chain. A failed GitHub upload
recognizes the tag created by its own run and completes the release without
bumping again. Retrying publication accepts an already published version only
when its downloaded bytes match the GitHub release. Different bytes fail;
published versions and tags are never overwritten. Registry propagation is
checked before reporting an upload failure.

GitHub provides source ZIP and tar archives automatically. The release also
contains the versioned VSIX, `SHA256SUMS` and changelog-based notes. `main` rules
must permit the action's generated version commit. Open VSX publication requires
the existing `OVSX_PAT` repository secret.
