# Releases

When ready to release, open **Actions → Release → Run workflow**, select `main`,
choose **patch**, **minor** or **major**, and run it. No local version bump, commit,
tag or separate GitHub release creation is needed.

## Choosing a version

| Change                                        | Before 1.0                                  | From 1.0 onward |
| --------------------------------------------- | ------------------------------------------- | --------------- |
| Fixes, reliability improvements, small polish | Patch: `0.1.0` → `0.1.1`                    | Patch           |
| Compatible new capabilities                   | Minor: `0.1.0` → `0.2.0`                    | Minor           |
| Breaking configuration or behavior changes    | Minor; explicitly document breaking changes | Major           |

Choose **major** to move from `0.x.y` to `1.0.0` when the core connection workflow
is dependable and maintainers commit to compatibility for configuration and
user-visible behavior. Document breaking changes and migration steps under
`Breaking changes` in [CHANGELOG.md](../CHANGELOG.md).

## What the action does

1. Calculates the next version from `package.json` and your selected bump.
2. Updates the manifest and both root lockfile versions. Moves authored
   `Unreleased` notes into a dated changelog entry and appends the commit list
   since the current version's tag. If no such tag exists, the first automated
   release includes the existing commit history.
3. Runs type, lint and formatting checks, release tests, offline regressions,
   relay fixtures, archive-policy tests, deployment-helper tests and the privacy
   audit. Builds and validates the production VSIX.
4. Retains a CI artifact containing the versioned VSIX, `SHA256SUMS`, release
   notes and the release plan.
5. Commits the version and changelog to `main` and pushes an annotated `vX.Y.Z`
   tag together with that commit. If `main` moved during verification, the run
   stops without pushing either.
6. Creates a public entry under the repository's **Releases**, using the changelog
   entry as its notes, and attaches the verified VSIX and checksum. GitHub also
   provides source ZIP and tar archives for the tag. The action downloads the
   uploaded assets and compares them with the verified build.

Merges and ordinary CI runs never publish or change versions. The release action
uses the repository's built-in token; no new release secret is needed. `main`
branch rules must permit its generated version commit. No checks are bypassed.

## Checking it without consuming a version

Select **dry_run** in the same action. It prepares the next version, runs all
checks, and provides the preview artifact. It makes no remote commit, tag or
release and leaves the repository's numbering unchanged. Dry runs can also run
on a development branch. A real release requires `main`.

## Failures and retries

Checks finish before any version commit or tag is pushed. A failed test therefore
consumes no version. Release runs are serialized, and existing tags are never
moved or overwritten.

If uploading or publishing fails after the commit and tag were pushed, use
**Re-run failed jobs** on that same run. It recognizes its own tag, rebuilds the
same release, completes a partial draft, or verifies an already published release
without bumping again. Start a new run only when you intend a new version. A tag
belonging to a different run is rejected.

Open VSX publication remains a separate manual action: after a GitHub release,
run **Publish verified VSIX to Open VSX** on the new `vX.Y.Z` tag. It reruns
verification and publishes the verified VSIX to that registry.
