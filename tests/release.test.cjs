'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { verifyRelease } = require('../scripts/verify-release.cjs');

const changelog = '## [Unreleased]\n\n## [0.2.0] - 2026-10-30\n\n- Feature.\n';

function fixture(t, changes = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'incus-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    'package.json': JSON.stringify({ version: '0.2.0' }),
    'package-lock.json': JSON.stringify({
      version: '0.2.0',
      packages: { '': { version: '0.2.0' } },
    }),
    'CHANGELOG.md': changelog,
    ...changes,
  };
  for (const [name, content] of Object.entries(files))
    fs.writeFileSync(path.join(root, name), content);
  return root;
}

test('matching release metadata passes local and publication checks', (t) => {
  const root = fixture(t);
  assert.equal(verifyRelease(root), '0.2.0');
  assert.equal(verifyRelease(root, 'refs/tags/v0.2.0'), '0.2.0');
});

for (const ref of ['refs/heads/main', 'refs/tags/v0.1.0', 'v0.2.0', '']) {
  test(`publication rejects ref ${JSON.stringify(ref)}`, (t) => {
    assert.throws(() => verifyRelease(fixture(t), ref), /Publication requires/);
  });
}

for (const lock of [
  { version: '0.1.0', packages: { '': { version: '0.2.0' } } },
  { version: '0.2.0', packages: { '': { version: '0.1.0' } } },
  { version: '0.2.0' },
]) {
  test(`release rejects inconsistent lockfile ${JSON.stringify(lock)}`, (t) => {
    const root = fixture(t, { 'package-lock.json': JSON.stringify(lock) });
    assert.throws(() => verifyRelease(root), /lockfile versions must match/);
  });
}

for (const version of ['0.2.0-beta.1', '01.2.0', '0.2', 'v0.2.0']) {
  test(`release rejects version ${version}`, (t) => {
    const root = fixture(t, { 'package.json': JSON.stringify({ version }) });
    assert.throws(() => verifyRelease(root), /stable MAJOR.MINOR.PATCH/);
  });
}

for (const [name, content, error] of [
  ['version drift', changelog.replace('0.2.0', '0.1.0'), /First dated changelog/],
  ['missing date', changelog.replace(' - 2026-10-30', ''), /First dated changelog/],
  ['impossible date', changelog.replace('2026-10-30', '2026-02-30'), /real calendar date/],
  ['invalid month', changelog.replace('2026-10-30', '2026-13-01'), /real calendar date/],
  ['empty notes', changelog.replace('- Feature.', '### Added'), /notes must not be empty/],
  ['missing Unreleased', changelog.replace('## [Unreleased]\n\n', ''), /Unreleased section/],
]) {
  test(`release rejects changelog with ${name}`, (t) => {
    const root = fixture(t, { 'CHANGELOG.md': content });
    assert.throws(() => verifyRelease(root), error);
  });
}

test('ordinary development accepts pending notes; publication rejects them', (t) => {
  const root = fixture(t, {
    'CHANGELOG.md': changelog.replace(
      '[Unreleased]',
      '[Unreleased]\n\n### Added\n\n- Next feature.',
    ),
  });
  assert.equal(verifyRelease(root), '0.2.0');
  assert.throws(() => verifyRelease(root, 'refs/tags/v0.2.0'), /Move Unreleased changes/);
});

test('publication accepts empty Unreleased categories and CRLF line endings', (t) => {
  const root = fixture(t, {
    'CHANGELOG.md': changelog
      .replace('[Unreleased]', '[Unreleased]\n\n### Added')
      .replaceAll('\n', '\r\n'),
  });
  assert.equal(verifyRelease(root, 'refs/tags/v0.2.0'), '0.2.0');
});
