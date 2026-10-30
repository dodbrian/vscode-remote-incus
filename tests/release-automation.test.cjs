'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { nextVersion, prepare, collect, publish } = require('../scripts/release.cjs');

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

function fixture(t) {
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
    '# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Friendly summary.\n\n## [0.1.0] - 2026-10-25\n\n- Initial release.\n',
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
  // Only GitHub's boundary is faked. Version commits, annotated tags, atomic
  // pushes, fresh checkouts and recovery use actual isolated Git repositories.
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const [, command, tag, ...args] = process.argv.slice(2);
const root = process.env.FAKE_GITHUB;
const record = path.join(root, 'release.json');
const read = () => JSON.parse(fs.readFileSync(record));
const write = (value) => fs.writeFileSync(record, JSON.stringify(value));
const upload = () => { for (const file of args) { if (file.startsWith('--')) break; fs.copyFileSync(file, path.join(root, path.basename(file))); } };
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

test('a failed upload resumes its own version and verifies already published assets', (t) => {
  const f = fixture(t);
  const state = fakeGitHub(t, f);
  fs.writeFileSync(path.join(state, 'fail-once'), '');
  prepare(f.root, f.options);
  fs.writeFileSync(path.join(f.root, 'remote-incus.vsix'), 'verified fixture archive');
  collect(f.root, f.options.directory);
  assert.throws(() => publish(f.root, f.options.directory));
  const releaseCommit = git(f.root, 'rev-parse', 'v0.1.1^{commit}');
  assert.equal(git(f.root, 'ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0], releaseCommit);
  git(f.root, 'checkout', '--detach', f.options.source);
  const resumed = prepare(f.root, f.options);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.version, '0.1.1');
  collect(f.root, f.options.directory);
  publish(f.root, f.options.directory);
  assert.equal(JSON.parse(fs.readFileSync(path.join(state, 'release.json'))).isDraft, false);
  publish(f.root, f.options.directory);
  assert.equal(git(f.root, 'rev-list', '--count', `${f.options.source}..origin/main`), '1');
  assert.equal(git(f.root, 'tag', '--list', 'v0.1.2'), '');
  fs.writeFileSync(path.join(state, 'remote-incus-0.1.1.vsix'), 'corrupted');
  assert.throws(() => publish(f.root, f.options.directory), /differs from the verified build/);
});

test('publication rejects a development branch before pushing', (t) => {
  const f = fixture(t);
  fakeGitHub(t, f);
  prepare(f.root, f.options);
  process.env.GITHUB_REF = 'refs/heads/development';
  assert.throws(() => publish(f.root, f.options.directory), /must run from main/);
  assert.equal(git(f.root, 'ls-remote', 'origin', 'refs/tags/v0.1.1'), '');
});

test('main changing during checks prevents a version commit and tag push', (t) => {
  const f = fixture(t);
  fakeGitHub(t, f);
  prepare(f.root, f.options);
  const other = path.join(f.directory, 'other');
  git(f.directory, 'clone', '--branch', 'main', f.remote, other);
  identity(other);
  fs.writeFileSync(path.join(other, 'new.txt'), 'concurrent change');
  git(other, 'add', '.');
  git(
    other,
    'commit',
    '-m',
    'test(release): simulate concurrent development',
    '-m',
    'Advance main during release validation.',
  );
  git(other, 'push', 'origin', 'main');
  assert.throws(() => publish(f.root, f.options.directory), /main changed during verification/);
  assert.equal(git(f.root, 'ls-remote', 'origin', 'refs/tags/v0.1.1'), '');
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.options.source);
});

test('no commits since the current release tag consumes no version', (t) => {
  const f = fixture(t);
  git(f.root, 'checkout', '--detach', 'v0.1.0');
  f.options.source = git(f.root, 'rev-parse', 'HEAD');
  assert.throws(() => prepare(f.root, f.options), /no changes since the previous release/);
  assert.equal(git(f.root, 'ls-remote', 'origin', 'refs/tags/v0.1.1'), '');
});

test('a competing tag causes the atomic push to leave remote main unchanged', (t) => {
  const f = fixture(t);
  fakeGitHub(t, f);
  prepare(f.root, f.options);
  const other = path.join(f.directory, 'other');
  git(f.directory, 'clone', '--branch', 'main', f.remote, other);
  git(other, 'tag', 'v0.1.1');
  git(other, 'push', 'origin', 'refs/tags/v0.1.1');
  assert.throws(() => publish(f.root, f.options.directory));
  assert.equal(
    git(f.root, 'ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0],
    f.options.source,
  );
});
