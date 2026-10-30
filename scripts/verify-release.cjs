'use strict';

const fs = require('node:fs');
const path = require('node:path');

function verifyRelease(root, tag) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const version = manifest.version;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error('Release version must be a stable MAJOR.MINOR.PATCH version.');
  if (lock.version !== version || lock.packages?.['']?.version !== version)
    throw new Error('Manifest and both root lockfile versions must match.');
  const changelog = fs
    .readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
    .replaceAll('\r\n', '\n');
  const sections = changelog.split(/^## /m).slice(1);
  const [unreleased, current] = sections;
  if (!unreleased?.startsWith('[Unreleased]\n'))
    throw new Error('Changelog must start with an Unreleased section.');
  const release = current?.match(/^\[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\n([\s\S]*)$/);
  if (release?.[1] !== version)
    throw new Error('First dated changelog release must match the manifest version.');
  const date = new Date(`${release[2]}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== release[2])
    throw new Error('Changelog release date must be a real calendar date.');
  const notes = (text) => text.replace(/^#{3,6} .*$/gm, '').trim();
  if (!notes(release[3])) throw new Error('Changelog release notes must not be empty.');
  if (tag !== undefined) {
    if (tag !== `refs/tags/v${version}`)
      throw new Error(`Publication requires refs/tags/v${version}; received ${tag}.`);
    if (notes(unreleased.slice('[Unreleased]'.length)))
      throw new Error('Move Unreleased changes into the release notes before publication.');
  }
  return version;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--tag'))
      throw new Error('Usage: node scripts/verify-release.cjs [--tag refs/tags/vX.Y.Z]');
    console.log(`Release metadata verified: ${verifyRelease(path.join(__dirname, '..'), args[1])}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { verifyRelease };
