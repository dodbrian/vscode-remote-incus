'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { ZipFile } = require('yazl');
const { fixture } = require('./support/package-fixture.cjs');
const { verifyCandidate, publishReleased } = require('../scripts/publish-openvsx.cjs');

async function archive(t, publisher = 'dodbrian') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'incus-publish-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'remote-incus-0.1.0.vsix');
  const zip = new ZipFile();
  const done = pipeline(zip.outputStream, fs.createWriteStream(filename));
  for (const [name, bytes] of fixture({ publisher })) zip.addBuffer(bytes, name);
  zip.end();
  await done;
  const digest = createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  fs.writeFileSync(path.join(directory, 'SHA256SUMS'), `${digest}  remote-incus-0.1.0.vsix\n`);
  return directory;
}

test('release download must have matching checksum, identity, version and archive policy', async (t) => {
  const directory = await archive(t);
  assert.equal((await verifyCandidate(directory, 'v0.1.0')).version, '0.1.0');
  await assert.rejects(verifyCandidate(directory, 'v0.2.0'));
  fs.appendFileSync(path.join(directory, 'remote-incus-0.1.0.vsix'), 'corruption');
  await assert.rejects(verifyCandidate(directory, 'v0.1.0'), /checksum/);
  const wrong = await archive(t, 'wrong-publisher');
  await assert.rejects(verifyCandidate(wrong, 'v0.1.0'), /identity/);
});

function registry({ visible = false, mismatched = false, delayed = 0 } = {}) {
  const bytes = Buffer.from('released archive');
  let uploads = 0;
  let requests = 0;
  return {
    candidate: { filename: '/fixture/released.vsix', bytes, version: '0.1.0' },
    uploads: () => uploads,
    options: {
      request: async (url) => {
        if (url.endsWith('/archive.vsix'))
          return {
            ok: true,
            arrayBuffer: async () => (mismatched ? Buffer.from('different archive') : bytes),
          };
        requests++;
        if (!visible || requests <= delayed) return { status: 404 };
        return {
          status: 200,
          ok: true,
          json: async () => ({ files: { download: 'https://open-vsx.org/archive.vsix' } }),
        };
      },
      upload: () => {
        uploads++;
        visible = true;
      },
      pause: async () => {},
    },
  };
}

test('a published matching version succeeds without another upload', async () => {
  const f = registry({ visible: true });
  assert.match(await publishReleased(f.candidate, f.options), /Already published/);
  assert.equal(f.uploads(), 0);
});

test('different bytes at the same registry version stop publication', async () => {
  const f = registry({ visible: true, mismatched: true });
  await assert.rejects(publishReleased(f.candidate, f.options), /different bytes/);
  assert.equal(f.uploads(), 0);
});

test('publish uploads once and waits for registry propagation', async () => {
  const f = registry({ delayed: 3 });
  assert.match(await publishReleased(f.candidate, f.options), /matches the GitHub release/);
  assert.equal(f.uploads(), 1);
});

test('a lost upload response is reconciled before another upload', async () => {
  const f = registry();
  const upload = f.options.upload;
  f.options.upload = () => {
    upload();
    throw new Error('connection lost');
  };
  assert.match(await publishReleased(f.candidate, f.options), /matches the GitHub release/);
  assert.equal(f.uploads(), 1);
});

test('registry failures stop before upload', async () => {
  const f = registry();
  f.options.request = async () => ({ status: 503, ok: false });
  await assert.rejects(publishReleased(f.candidate, f.options), /503/);
  assert.equal(f.uploads(), 0);
});
