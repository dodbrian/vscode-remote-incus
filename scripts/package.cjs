#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { finalizePackage } = require('./finalize-package.cjs');
const { readArchive, inspectRecords } = require('./verify-package.cjs');

// Keep staging on the destination filesystem so publication is one rename.
// A failed build, finalization or validation must retain the last good VSIX.
async function stagePackage(destination, produce) {
  const directory = fs.mkdtempSync(path.join(path.dirname(destination), '.remote-incus-package-'));
  try {
    const candidate = path.join(directory, 'candidate.vsix');
    await produce(candidate);
    fs.renameSync(candidate, destination);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function runVsce(candidate, root) {
  const result = spawnSync(
    process.execPath,
    [
      require.resolve('@vscode/vsce/vsce'),
      'package',
      '--no-dependencies',
      '--no-rewrite-relative-links',
      '--allow-missing-repository',
      '-o',
      candidate,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`VSCE packaging failed (${result.signal ?? `exit ${result.status}`})`);
}

async function packageExtension(root = process.cwd(), build = runVsce) {
  const destination = path.join(root, 'remote-incus.vsix');
  await stagePackage(destination, async (candidate) => {
    await build(candidate, root);
    await finalizePackage(candidate);
    const records = await readArchive(candidate);
    const { errors, links } = inspectRecords(records);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(
      `Package policy: ${records.size} files, ${links} local documentation links, no findings.`,
    );
  });
  console.log('Verified VSIX: remote-incus.vsix');
}

if (require.main === module)
  packageExtension().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { stagePackage, packageExtension };
