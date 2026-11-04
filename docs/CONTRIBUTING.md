# Contributing

Use Node 22.13 or later and install dependencies with `npm ci` from the
repository root. See the [testing guide](tests/README.md) for the complete
portable checks, packaging validation and manual integration procedures, and
the [release guide](RELEASING.md) for publication.

## Issue workflow

Create a dedicated branch for each issue, commit the reviewed changes there,
and open a pull request against `main`. Never push issue changes directly to
`main`. Include the issue reference, validation results and any remaining
verification limits in the PR description.

## Quality gates

Linting (strict, type-checked rules), code formatting and the strict
TypeScript compiler settings are enforced as one gate — `npm run check` — and
every diagnostic is a failure, including anything set to "warn" (`--max-warnings 0`).
`npm test` and `npm run package` run this gate first; a `pre-commit` hook
(installed automatically by `npm install`) blocks non-conforming commits.

```sh
npm run check          # typecheck + lint + formatting verification
npm run lint           # ESLint only (warnings fail)
npm run lint:fix       # auto-fix lint findings
npm run format         # Prettier --write
npm run format:check   # Prettier --check (fails on unformatted files)
```

Formatting is Prettier's (single quotes, print width 100, defaults otherwise);
`.vscode/settings.json` applies the same on save. Rules that only make sense
for shipped code (the unsafe-`any` family, strict nullish/condition checks) run
at full strength under `src/`, with a documented carve-out for the test
fixture's opaque stub boundary in `eslint.config.mjs`.

## Manual deployment

For a manual deployment, replace the quoted placeholders with your test-owned
fixture and absolute remote folder. This installs the build, restarts normal
VS Code and reopens that folder. Quote paths containing spaces. The helper
resolves the checkout root itself, so it can also be invoked by absolute path
from another working directory.

```sh
npm install
npm run typecheck
./scripts/redeploy.sh '<remote:instance>' '<absolute-folder>'
```

## Publication privacy

Run `npm run audit:privacy` on the checkout and
`node scripts/audit-privacy.cjs --history` on reachable Git history. For an
extracted VSIX or source export, use
`node scripts/audit-privacy.cjs --root <directory>`. Findings report file, line
and category without printing the matched value. This bounded pattern check
supplements manual review; it cannot recognize arbitrary private hostnames or
every secret format. Keep fixture identities in runtime inputs and keep raw
logs, token files and credentials out of tracked files and published archives.

Binary images require visual privacy review. The audit recognizes the exact
reviewed README screenshots by SHA-256 in `scripts/audit-privacy.cjs`; new or
modified images require another review before updating those checksums.
