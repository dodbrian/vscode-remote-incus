'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stagePackage, packageExtension } = require('../scripts/package.cjs');

async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'incus-package-build-'));
  try {
    await run(root, path.join(root, 'remote-incus.vsix'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('publish the candidate only after its producer finishes successfully', () =>
  fixture(async (root, destination) => {
    fs.writeFileSync(destination, 'previous verified artifact');
    await stagePackage(destination, async (candidate) => {
      fs.writeFileSync(candidate, 'new verified artifact');
      assert.equal(fs.readFileSync(destination, 'utf8'), 'previous verified artifact');
      assert.equal(path.dirname(path.dirname(candidate)), root);
    });
    assert.equal(fs.readFileSync(destination, 'utf8'), 'new verified artifact');
    assert.deepEqual(fs.readdirSync(root), ['remote-incus.vsix']);
  }));

test('a failed candidate preserves the previous artifact or leaves no output', async () => {
  for (const existing of [false, true])
    await fixture(async (root, destination) => {
      if (existing) fs.writeFileSync(destination, 'previous verified artifact');
      await assert.rejects(
        stagePackage(destination, async (candidate) => {
          fs.writeFileSync(candidate, 'incomplete or rejected artifact');
          throw new Error('candidate rejected');
        }),
        /candidate rejected/,
      );
      if (existing)
        assert.equal(fs.readFileSync(destination, 'utf8'), 'previous verified artifact');
      else assert.equal(fs.existsSync(destination), false);
      assert.deepEqual(fs.readdirSync(root), existing ? ['remote-incus.vsix'] : []);
    });
});

test('actual package pipeline retains the last artifact after build, ZIP or policy failure', async () => {
  for (const mode of ['build-failure', 'invalid-archive', 'policy-failure'])
    await fixture(async (root, destination) => {
      fs.writeFileSync(destination, 'previous verified artifact');
      await assert.rejects(
        packageExtension(root, async (candidate) => {
          if (mode === 'policy-failure') {
            const { ZipFile } = require('yazl');
            const { pipeline } = require('node:stream/promises');
            const zip = new ZipFile();
            const completion = pipeline(zip.outputStream, fs.createWriteStream(candidate));
            zip.addBuffer(Buffer.alloc(0), 'extension/LICENSE.txt');
            zip.end();
            await completion;
          } else {
            fs.writeFileSync(candidate, 'not a VSIX');
            if (mode === 'build-failure') throw new Error('build failed');
          }
        }),
        mode === 'build-failure'
          ? /build failed/
          : mode === 'policy-failure'
            ? /Required archive file empty/
            : /zip|signature|end of central/i,
      );
      assert.equal(fs.readFileSync(destination, 'utf8'), 'previous verified artifact');
      assert.deepEqual(fs.readdirSync(root), ['remote-incus.vsix']);
    });
});
