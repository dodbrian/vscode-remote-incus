# Build, release and publish

Normal pushes run **Actions → Build and test**. That workflow verifies the source,
builds a VSIX, and finishes. It does not calculate a new version, create a release,
or wait for an approval.

When ready to release, open **Actions → Release → Run workflow** and select
`main`. The workflow calculates the version first and waits for confirmation
before starting the build. It shows five connected stages in one Actions graph:

1. **Preview release version and notes** calculates the next version and prepares
   the changelog without installing dependencies or building a package. Its run
   summary shows the proposed version, source commit and release notes.
2. **Confirm release vX.Y.Z** waits for your approval of `release-confirmation`.
   Review the preview, choose **Review deployments**, select
   **release-confirmation**, then **Approve and deploy**. This authorizes the
   build and GitHub release. Reject to stop; to change the version, start a new
   run with a different bump or exact version override.
3. **Build and test vX.Y.Z** restores the saved preview metadata without choosing
   another version, runs all checks, and retains the verified VSIX, checksum,
   release notes and exact version metadata as one artifact.
4. **Create GitHub release** runs automatically after the build succeeds. It
   uses that run's candidate to commit the version and changelog, push an
   annotated tag, and create the GitHub release.
5. **Approve Open VSX publication** waits for your approval of the `open-vsx`
   environment. In the run, choose **Review deployments**, select **open-vsx**,
   then **Approve and deploy**. It downloads the VSIX from this chain's GitHub
   release, verifies its identity and checksum, and publishes those exact bytes.
   It never rebuilds or chooses a different release. The job succeeds when Open VSX
   accepts the upload; Open VSX checks can continue afterwards.

Version numbers and artifacts flow automatically through all stages. You
can inspect or install the GitHub release before approving publication. The README
is inside the VSIX and source archives; release notes also link to its tagged copy.

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
Place `### Added` before `### Fixed` whenever both sections are present. Release
preparation enforces this order in the new changelog entry and release notes.
Breaking changes should include migration instructions in those notes.

Normally, leave version selection automatic. For an intentional override, use
**Run workflow** on `main` and choose an optional **bump**, or enter an exact
**version**. An exact version takes precedence and must increase. For example,
explicitly choose `1.0.0` once the core connection workflow is dependable and you
commit to configuration and behavior compatibility. CI does not infer readiness
for 1.0 from a breaking change during the pre-1.0 period.

GitHub's **Run workflow** dialog cannot calculate or preview the automatic
version. Its inputs are defined in the workflow file; the version is calculated
after the run starts. The preview summary and pending confirmation job name show
the calculated version before the build. GitHub controls the approval dialog;
its checkbox is named `release-confirmation`, not the version number.

To exercise the release build without creating a release or requesting either
approval, select **dry_run**. The preview runs and the build proceeds without
confirmation, but consumes no version. You can also run
a dry run on a development branch. Real releases require `main`.

## Identity, failures and retries

The build artifact is associated with its source commit and workflow run. The
release and publishing stages receive their tag and artifacts automatically
through job outputs. No registry secret is passed to the build or GitHub release
steps.

Before restoring metadata, each handoff checks the source commit, workflow run,
expected release tag, and consistency of all version metadata. Invalid candidates
fail before changing the checkout.

The `release-confirmation` environment requires the repository owner's review,
self-review allowed, admin bypass disabled, and only the `main` branch allowed.
The preview checks for the required reviewer gate before proposing a real release;
missing or weakened reviewer settings stop the run. Configure it in
**Settings → Environments** before using this flow. Naming an environment in YAML
alone does not establish an approval requirement.

The `open-vsx` environment requires the repository owner's review and allows only
`main`. Keep it configured in **Settings → Environments**. This is what makes
publication manual. Merely naming an environment in YAML does not establish an
approval requirement.

A candidate version is consumed only when the GitHub release step atomically
pushes its version commit and tag. If `main` changes during release verification,
releasing that stale candidate fails without pushing either. Start a new Release
run from current `main`. Build artifacts are retained for 30 days; after expiry,
build a new candidate.

Use **Re-run failed jobs** to recover the same chain. A failed GitHub upload
recognizes the tag created by its own run and completes the release without
bumping again. A recorded pending upload is not submitted again. Retrying
publication accepts an already visible version only when its downloaded bytes
match the GitHub release. Different bytes fail; published versions and tags are
never overwritten. An unsuccessful upload is reported as a failure unless the
registry download already proves it succeeded.

## Automatic Open VSX verification

After upload acceptance, the release commit has a pending **Open VSX availability
(vX.Y.Z)** status. The release automatically dispatches **Verify Open VSX
availability** for that tag. It waits 30 minutes through the
`open-vsx-verification-delay` environment, then checks the release once. If still
pending, it dispatches the next delayed check. There is no cron schedule or user
step; no workflow runs when no release needs verification. The dispatch trigger
is used by automation, even though GitHub also exposes it in the Actions UI.

The delay environment must have a **30-minute wait timer**, no required reviewers,
admin bypass disabled, no other protection gates, and no secrets. Its settings
are checked before upload and before each dispatch. GitHub holds the job before assigning a runner, so the delay does not occupy a
runner. `deployment: false` keeps these checks out of deployment history. The
original `open-vsx` publishing approval remains separate.

While Open VSX checks the extension, an unavailable version remains pending.
The accepted upload receipt pins the package SHA-256, original acceptance time,
and next attempt in the commit status. Once visible, the verifier downloads the
GitHub release assets, checks their checksum, identity and package policy, and compares the registry download
byte for byte, including a comparison against that pinned SHA-256. Replacing both
a release package and its checksum cannot make a different upload pass. Matching
bytes mark the commit status successful and stop the chain. Mismatched bytes fail the status and verification workflow, with no further
checks. Temporary API/network errors queue another delayed check within the same
deadline. No verification job receives the publishing secret or uploads a package.

Verification stops at success, an integrity failure, or 24 hours after upload
acceptance, whichever comes first. A hard limit of 48 checks also bounds the chain.
Queue delays and execution time can make checks later than 30-minute intervals;
the first check after the deadline reports failure without downloading anything.
The original acceptance time and attempt budget survive retries. Duplicate or
out-of-order runs stop without checking or dispatching another run. Publication
and verification share a per-release concurrency queue so status updates cannot
race, and duplicate dispatches cannot replace a pending valid successor.

Inspect the release commit status and verification workflow summaries for results;
the original upload job remains successful. A dispatch/configuration failure fails
that workflow and stops the chain rather than silently claiming verification.
Setup failures, runner cancellation, and GitHub status API failures also stop
automatic progress; they cannot be recovered by code that never gets to run.
Retrying the release publication job can resume an accepted upload without
uploading again, while keeping its original deadline and next attempt. If Open
VSX accepts an upload but saving the first receipt fails, inspect Open VSX and
the failed job before retrying: there is no atomic transaction across the two
services, and no acceptance record exists for automation to rely on. Releases
uploaded before this tracking was introduced are not automatically enrolled. Both workflow files
must be on `main` before using the new release flow.

GitHub provides source ZIP and tar archives automatically. The release also
contains the versioned VSIX, `SHA256SUMS` and changelog-based notes. `main` rules
must permit the action's generated version commit. Open VSX publication requires
the existing `OVSX_PAT` repository secret.
