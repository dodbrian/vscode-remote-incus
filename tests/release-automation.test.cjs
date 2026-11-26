'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const {
  nextVersion,
  inferBump,
  chooseVersion,
  prepare,
  collect,
  restore,
  ensureReleasePullRequest,
  awaitReleaseMerge,
  publish,
} = require('../scripts/release.cjs');

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function identity(root) {
  git(root, 'config', 'user.name', 'Release Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
}

function fixture(t, notes = '### Fixed\n\n- Friendly summary.') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'incus-release-flow-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'checkout');
  const remote = path.join(directory, 'remote.git');
  fs.mkdirSync(root);
  git(directory, 'init', '--bare', remote);
  git(root, 'init', '-b', 'main');
  identity(root);
  fs.writeFileSync(path.join(root, '.gitignore'), '*.vsix\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  fs.writeFileSync(
    path.join(root, 'package-lock.json'),
    JSON.stringify({ version: '0.1.0', packages: { '': { version: '0.1.0' } } }),
  );
  fs.writeFileSync(
    path.join(root, 'CHANGELOG.md'),
    `# Changelog\n\n## [Unreleased]\n\n${notes}\n\n## [0.1.0] - 2026-10-25\n\n- Initial release.\n`,
  );
  git(root, 'add', '.');
  git(
    root,
    'commit',
    '-m',
    'test(release): establish fixture baseline',
    '-m',
    'Create isolated release metadata.',
  );
  git(root, 'tag', 'v0.1.0');
  fs.writeFileSync(path.join(root, 'runtime.txt'), 'fixed\n');
  git(root, 'add', '.');
  git(
    root,
    'commit',
    '-m',
    'fix(fixture): repair connection',
    '-m',
    'Provide a change for the release simulation.',
  );
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-u', 'origin', 'main', '--tags');
  const options = {
    directory: path.join(directory, 'output'),
    source: git(root, 'rev-parse', 'HEAD'),
    runId: '12345',
    bump: 'patch',
    date: '2026-10-30',
  };
  return { directory, root, remote, options };
}

function environment(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const old = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (old === undefined) delete process.env[key];
      else process.env[key] = old;
    });
  }
}

function fakeGitHub(t, f) {
  const bin = path.join(f.directory, 'bin');
  const state = path.join(f.directory, 'github');
  fs.mkdirSync(bin);
  fs.mkdirSync(state);
  // GitHub API calls are faked. Branches, commits and tags use real, isolated Git repositories.
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const [group, command, tag, ...args] = process.argv.slice(2);
const root = process.env.FAKE_GITHUB;
const record = path.join(root, 'release.json');
const read = () => JSON.parse(fs.readFileSync(record));
const write = (value) => fs.writeFileSync(record, JSON.stringify(value));
const upload = () => { for (const file of args) { if (file.startsWith('--')) break; fs.copyFileSync(file, path.join(root, path.basename(file))); } };
const prFile = path.join(root, 'pr.json');
const setPr = (pr) => fs.writeFileSync(prFile, JSON.stringify(pr));
if (group === 'api') {
  console.log(!fs.existsSync(path.join(root, 'disable-auto-merge')));
  process.exit(0);
}
if (group === 'pr') {
  const pr = fs.existsSync(prFile) ? JSON.parse(fs.readFileSync(prFile)) : null;
  if (command === 'list') console.log(JSON.stringify(pr ? [pr] : []));
  else if (command === 'create') {
    if (fs.existsSync(path.join(root, 'fail-pr-create'))) process.exit(1);
    const head = args[args.indexOf('--head') + 1];
    const headRefOid = require('node:child_process').execFileSync(
      'git', ['ls-remote', 'origin', 'refs/heads/' + head], { encoding: 'utf8' },
    ).split(/\\s/)[0];
    const url = 'https://example.invalid/pull/15';
    setPr({ number: 15, url, state: 'OPEN', headRefOid });
    console.log(url);
  } else if (command === 'view' && pr) console.log(JSON.stringify(pr));
  else if (command === 'merge' && pr?.state === 'OPEN') {
    if (!args.includes('--auto') || !args.includes('--rebase') ||
        args[args.indexOf('--match-head-commit') + 1] !== pr.headRefOid) process.exit(2);
    setPr({ ...pr, autoMergeRequest: { enabledAt: 'now' } });
  } else process.exit(2);
  process.exit(0);
}
if (command === 'view') {
  if (!fs.existsSync(record)) process.exit(1);
  console.log(args.includes('--jq') ? 'https://example.invalid/releases/' + tag : JSON.stringify(read()));
} else if (command === 'create') {
  write({ isDraft: true });
  if (fs.existsSync(path.join(root, 'fail-once'))) { fs.unlinkSync(path.join(root, 'fail-once')); process.exit(1); }
  upload(); write({ isDraft: false });
} else if (command === 'upload') upload();
else if (command === 'edit') write({ isDraft: false });
else if (command === 'download') {
  const name = args[args.indexOf('--pattern') + 1];
  const destination = args[args.indexOf('--dir') + 1];
  fs.copyFileSync(path.join(root, name), path.join(destination, name));
} else process.exit(2);
`,
    { mode: 0o755 },
  );
  environment(t, {
    PATH: bin + path.delimiter + process.env.PATH,
    FAKE_GITHUB: state,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_RUN_ID: f.options.runId,
    GITHUB_SHA: f.options.source,
  });
  return state;
}

for (const [version, bump, expected] of [
  ['0.1.0', 'patch', '0.1.1'],
  ['0.1.7', 'minor', '0.2.0'],
  ['0.4.7', 'major', '1.0.0'],
  ['1.4.7', 'major', '2.0.0'],
]) {
  test(`${bump} changes ${version} to ${expected}`, () =>
    assert.equal(nextVersion(version, bump), expected));
}

for (const [name, authored, expected] of [
  [
    'reversed',
    '### Fixed\n\n- Repair.\n\n### Added\n\n- Feature.',
    '### Added\n\n- Feature.\n\n### Fixed\n\n- Repair.',
  ],
  [
    'already ordered',
    '### Added\n\n- Feature.\n\n\n### Fixed\n\n- Repair.',
    '### Added\n\n- Feature.\n\n\n### Fixed\n\n- Repair.',
  ],
  ['only fixes', '### Fixed\n\n- Repair.', '### Fixed\n\n- Repair.'],
  ['only additions', '### Added\n\n- Feature.', '### Added\n\n- Feature.'],
  [
    'other sections',
    'Release overview.\n\n### Fixed\n\n- Repair.\n\n### Security\n\n- Protect.\n\n### Added\n\n- Feature.',
    'Release overview.\n\n### Added\n\n- Feature.\n\n### Fixed\n\n- Repair.\n\n### Security\n\n- Protect.',
  ],
]) {
  test(`preparation preserves release note content with ${name} sections`, (t) => {
    const f = fixture(t, authored);
    const historical = fs
      .readFileSync(path.join(f.root, 'CHANGELOG.md'), 'utf8')
      .split('## [0.1.0]')[1];
    prepare(f.root, f.options);
    for (const filename of [
      path.join(f.root, 'CHANGELOG.md'),
      path.join(f.options.directory, 'release-notes.md'),
    ]) {
      const text = fs.readFileSync(filename, 'utf8');
      assert.ok(text.includes(`${expected}\n\n### Commits\n`), text);
    }
    assert.equal(
      fs.readFileSync(path.join(f.root, 'CHANGELOG.md'), 'utf8').split('## [0.1.0]')[1],
      historical,
    );
  });
}

test('approved preparation restores the exact version and notes before any build', (t) => {
  const f = fixture(t);
  const original = git(f.root, 'rev-parse', 'HEAD');
  const plan = prepare(f.root, f.options);
  const changelog = fs.readFileSync(path.join(f.root, 'CHANGELOG.md'), 'utf8');
  const notes = fs.readFileSync(path.join(f.options.directory, 'release-notes.md'), 'utf8');
  git(f.root, 'reset', '--hard', original);
  environment(t, { GITHUB_RUN_ID: f.options.runId, GITHUB_SHA: original });
  restore(f.root, f.options.directory);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.root, 'package.json'))).version,
    plan.version,
  );
  assert.equal(fs.readFileSync(path.join(f.root, 'CHANGELOG.md'), 'utf8'), changelog);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), original);
  assert.equal(git(f.root, 'tag', '--list', plan.tag), '');
  assert.ok(!fs.existsSync(path.join(f.root, 'remote-incus.vsix')));
  fs.writeFileSync(path.join(f.root, 'remote-incus.vsix'), 'verified fixture archive');
  collect(f.root, f.options.directory);
  assert.equal(fs.readFileSync(path.join(f.options.directory, 'release-notes.md'), 'utf8'), notes);
  environment(t, { GITHUB_RUN_ID: '99999' });
  assert.throws(() => restore(f.root, f.options.directory), /does not belong/);
});

for (const [mismatch, error] of [
  ['approved tag', /approved release tag/],
  ['metadata', /lockfile versions must match/],
  ['source', /does not belong/],
  ['checkout', /Checkout does not match/],
  ['plan version', /metadata does not match/],
]) {
  test(`restore rejects mismatched ${mismatch} before changing the checkout`, (t) => {
    const f = fixture(t);
    const names = ['package.json', 'package-lock.json', 'CHANGELOG.md'];
    const original = names.map((name) => fs.readFileSync(path.join(f.root, name), 'utf8'));
    prepare(f.root, f.options);
    git(f.root, 'reset', '--hard', f.options.source);
    environment(t, { GITHUB_RUN_ID: f.options.runId, GITHUB_SHA: f.options.source });
    let tag = 'v0.1.1';
    if (mismatch === 'approved tag') tag = 'v9.0.0';
    if (mismatch === 'metadata')
      fs.writeFileSync(
        path.join(f.options.directory, 'metadata', 'package.json'),
        JSON.stringify({ version: '9.0.0' }),
      );
    if (mismatch === 'source') process.env.GITHUB_SHA = 'a'.repeat(40);
    if (mismatch === 'checkout') git(f.root, 'checkout', '--detach', 'v0.1.0');
    if (mismatch === 'plan version') {
      const filename = path.join(f.options.directory, 'plan.json');
      const plan = JSON.parse(fs.readFileSync(filename));
      plan.version = '9.0.0';
      fs.writeFileSync(filename, JSON.stringify(plan));
    }
    assert.throws(() => restore(f.root, f.options.directory, tag), error);
    assert.deepEqual(
      names.map((name) => fs.readFileSync(path.join(f.root, name), 'utf8')),
      original,
    );
  });
}

test('preparation builds notes and checksum without consuming a remote version', (t) => {
  const f = fixture(t);
  const plan = prepare(f.root, f.options);
  assert.equal(plan.tag, 'v0.1.1');
  const changelog = fs.readFileSync(path.join(f.root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /## \[Unreleased\]\n\n## \[0.1.1\] - 2026-10-30/);
  assert.match(changelog, /Friendly summary/);
  assert.match(changelog, /fix\(fixture\): repair connection/);
  assert.doesNotMatch(changelog, /establish fixture baseline/);
  assert.match(changelog, /## \[0.1.0\] - 2026-10-25/);
  const bytes = Buffer.from('verified fixture archive');
  fs.writeFileSync(path.join(f.root, 'remote-incus.vsix'), bytes);
  collect(f.root, f.options.directory);
  assert.equal(
    fs.readFileSync(path.join(f.options.directory, 'SHA256SUMS'), 'utf8'),
    `${createHash('sha256').update(bytes).digest('hex')}  remote-incus-0.1.1.vsix\n`,
  );
  assert.equal(git(f.root, 'ls-remote', 'origin', 'refs/tags/v0.1.1'), '');
  assert.equal(
    git(f.root, 'ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0],
    f.options.source,
  );
});

test('first tagged release can include existing history when no baseline tag exists', (t) => {
  const f = fixture(t);
  git(f.root, 'tag', '-d', 'v0.1.0');
  prepare(f.root, f.options);
  assert.match(
    fs.readFileSync(path.join(f.root, 'CHANGELOG.md'), 'utf8'),
    /establish fixture baseline/,
  );
});

test('preparation rejects a tag owned by another release', (t) => {
  const f = fixture(t);
  git(f.root, 'tag', 'v0.1.1');
  assert.throws(() => prepare(f.root, f.options), /belongs to another release/);
});

function verifiedCandidate(f) {
  prepare(f.root, f.options);
  fs.writeFileSync(path.join(f.root, 'remote-incus.vsix'), 'verified fixture archive');
  collect(f.root, f.options.directory);
}

function simulateGitHubMerge(f, state, { extraChange = false } = {}) {
  const filename = path.join(state, 'pr.json');
  const pr = JSON.parse(fs.readFileSync(filename, 'utf8'));
  assert.ok(pr.autoMergeRequest);
  const other = path.join(f.directory, 'merge');
  git(f.directory, 'clone', '--branch', 'main', f.remote, other);
  identity(other);
  git(other, 'cherry-pick', pr.headRefOid);
  if (extraChange) {
    fs.writeFileSync(path.join(other, 'new.txt'), 'concurrent change');
    git(other, 'add', 'new.txt');
  }
  git(other, 'commit', '--amend', '--no-edit');
  const merged = git(other, 'rev-parse', 'HEAD');
  assert.notEqual(merged, pr.headRefOid);
  git(other, 'push', 'origin', 'main');
  fs.writeFileSync(
    filename,
    JSON.stringify({ ...pr, state: 'MERGED', mergeCommit: { oid: merged } }),
  );
  return merged;
}

test('release PR creation retries the same branch and waits for GitHub to merge', async (t) => {
  const f = fixture(t);
  const state = fakeGitHub(t, f);
  verifiedCandidate(f);
  const failure = path.join(state, 'fail-pr-create');
  fs.writeFileSync(failure, '');
  assert.throws(() => ensureReleasePullRequest(f.root, f.options.directory));
  fs.unlinkSync(failure);
  const branch = 'refs/heads/release/v0.1.1-12345';
  const head = git(f.root, 'ls-remote', 'origin', branch).split(/\s/)[0];
  const pr = ensureReleasePullRequest(f.root, f.options.directory);
  assert.equal(pr.headRefOid, head);
  assert.ok(ensureReleasePullRequest(f.root, f.options.directory).autoMergeRequest);
  await assert.rejects(awaitReleaseMerge(f.root, String(pr.number), 0, 0), /still open/);
  assert.equal(
    git(f.root, 'ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0],
    f.options.source,
  );
  assert.equal(git(f.root, 'ls-remote', 'origin', 'refs/tags/v0.1.1'), '');
  const merged = simulateGitHubMerge(f, state);
  assert.equal(await awaitReleaseMerge(f.root, String(pr.number)), merged);
  assert.equal(ensureReleasePullRequest(f.root, f.options.directory).state, 'MERGED');
});

test('disabled auto-merge stops before creating a release branch', (t) => {
  const f = fixture(t);
  const state = fakeGitHub(t, f);
  verifiedCandidate(f);
  fs.writeFileSync(path.join(state, 'disable-auto-merge'), '');
  assert.throws(
    () => ensureReleasePullRequest(f.root, f.options.directory),
    /Enable Allow auto-merge/,
  );
  assert.equal(git(f.root, 'ls-remote', 'origin', 'refs/heads/release/*'), '');
});

test('a failed upload resumes the same rebased release and verifies published assets', async (t) => {
  const f = fixture(t);
  const state = fakeGitHub(t, f);
  fs.writeFileSync(path.join(state, 'fail-once'), '');
  verifiedCandidate(f);
  const pr = ensureReleasePullRequest(f.root, f.options.directory);
  const merged = simulateGitHubMerge(f, state);
  assert.equal(await awaitReleaseMerge(f.root, String(pr.number)), merged);
  assert.throws(() => publish(f.root, f.options.directory, merged));
  assert.equal(git(f.root, 'rev-parse', 'v0.1.1^{commit}'), merged);
  git(f.root, 'reset', '--hard', f.options.source);
  restore(f.root, f.options.directory);
  publish(f.root, f.options.directory, merged);
  assert.equal(JSON.parse(fs.readFileSync(path.join(state, 'release.json'))).isDraft, false);
  publish(f.root, f.options.directory, merged);
  assert.equal(git(f.root, 'rev-list', '--count', `${f.options.source}..origin/main`), '1');
  assert.equal(git(f.root, 'tag', '--list', 'v0.1.2'), '');
  fs.writeFileSync(path.join(state, 'remote-incus-0.1.1.vsix'), 'corrupted');
  assert.throws(
    () => publish(f.root, f.options.directory, merged),
    /differs from the verified build/,
  );
  git(f.root, 'reset', '--hard', f.options.source);
  assert.equal(prepare(f.root, f.options).resumed, true);
});

test('a merged PR with a changed tree is never tagged', (t) => {
  const f = fixture(t);
  const state = fakeGitHub(t, f);
  verifiedCandidate(f);
  ensureReleasePullRequest(f.root, f.options.directory);
  const merged = simulateGitHubMerge(f, state, { extraChange: true });
  assert.throws(() => publish(f.root, f.options.directory, merged), /Merged release tree differs/);
  assert.equal(git(f.root, 'ls-remote', 'origin', 'refs/tags/v0.1.1'), '');
});

test('publication rejects a development branch before pushing', (t) => {
  const f = fixture(t);
  fakeGitHub(t, f);
  verifiedCandidate(f);
  process.env.GITHUB_REF = 'refs/heads/development';
  assert.throws(() => ensureReleasePullRequest(f.root, f.options.directory), /must run from main/);
  assert.throws(() => publish(f.root, f.options.directory), /must run from main/);
  assert.equal(git(f.root, 'ls-remote', 'origin', 'refs/heads/release/*'), '');
});

test('main changing during checks prevents creating a release PR', (t) => {
  const f = fixture(t);
  fakeGitHub(t, f);
  verifiedCandidate(f);
  const other = path.join(f.directory, 'other');
  git(f.directory, 'clone', '--branch', 'main', f.remote, other);
  identity(other);
  git(other, 'commit', '--allow-empty', '-m', 'test(release): simulate concurrent development');
  git(other, 'push', 'origin', 'main');
  assert.throws(
    () => ensureReleasePullRequest(f.root, f.options.directory),
    /main changed during verification/,
  );
  assert.equal(git(f.root, 'ls-remote', 'origin', 'refs/heads/release/*'), '');
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.options.source);
});

test('no commits since the current release tag consumes no version', (t) => {
  const f = fixture(t);
  git(f.root, 'checkout', '--detach', 'v0.1.0');
  f.options.source = git(f.root, 'rev-parse', 'HEAD');
  assert.throws(() => prepare(f.root, f.options), /no changes since the previous release/);
  assert.equal(git(f.root, 'ls-remote', 'origin', 'refs/tags/v0.1.1'), '');
});

test('a competing tag is preserved after the release PR merges', (t) => {
  const f = fixture(t);
  const state = fakeGitHub(t, f);
  verifiedCandidate(f);
  ensureReleasePullRequest(f.root, f.options.directory);
  const merged = simulateGitHubMerge(f, state);
  git(f.root, 'tag', 'v0.1.1', f.options.source);
  git(f.root, 'push', 'origin', 'refs/tags/v0.1.1');
  assert.throws(
    () => publish(f.root, f.options.directory, merged),
    /Existing tag belongs to another release/,
  );
  assert.equal(
    git(f.root, 'ls-remote', 'origin', 'refs/tags/v0.1.1').split(/\s/)[0],
    f.options.source,
  );
});

for (const [current, commits, expected] of [
  ['0.1.0', 'fix(connection): reconnect', 'patch'],
  ['0.1.0', 'feat(explorer): show targets', 'minor'],
  ['0.1.0', 'feat!: replace configuration', 'minor'],
  ['1.1.0', 'fix!: replace configuration', 'major'],
  ['1.1.0', 'refactor(api): improve protocol\n\nBREAKING CHANGE: remove old protocol', 'major'],
]) {
  test(`infer ${expected} from ${JSON.stringify(commits)}`, () =>
    assert.equal(inferBump(current, commits), expected));
}

test('manual bump or exact version overrides automatic inference', () => {
  assert.equal(chooseVersion('0.1.0', 'auto', '', 'feat(api): feature'), '0.2.0');
  assert.equal(chooseVersion('0.1.0', 'patch', '', 'feat(api): feature'), '0.1.1');
  assert.equal(chooseVersion('0.1.0', 'auto', '1.0.0', 'fix(api): repair'), '1.0.0');
  for (const version of ['0.1.0', '0.0.9', '01.2.0', '1.0.0-beta'])
    assert.throws(() => chooseVersion('0.1.0', 'auto', version, ''));
});

test('candidate metadata and pinned README survive the handoff to a separate release job', (t) => {
  const f = fixture(t);
  fakeGitHub(t, f);
  environment(t, { GITHUB_REPOSITORY: 'fixture/project' });
  prepare(f.root, f.options);
  fs.writeFileSync(path.join(f.root, 'remote-incus.vsix'), 'verified fixture archive');
  collect(f.root, f.options.directory);
  assert.match(
    fs.readFileSync(path.join(f.options.directory, 'release-notes.md'), 'utf8'),
    /fixture\/project\/blob\/v0\.1\.1\/README\.md/,
  );
  git(
    f.root,
    'restore',
    '--source=HEAD',
    '--staged',
    '--worktree',
    'package.json',
    'package-lock.json',
    'CHANGELOG.md',
  );
  restore(f.root, f.options.directory);
  for (const name of ['package.json', 'package-lock.json', 'CHANGELOG.md'])
    assert.equal(
      fs.readFileSync(path.join(f.root, name), 'utf8'),
      fs.readFileSync(path.join(f.options.directory, 'metadata', name), 'utf8'),
    );
  process.env.GITHUB_RUN_ID = '54321';
  assert.throws(() => restore(f.root, f.options.directory), /does not belong/);
});
