'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readArchive, inspectRecords } = require('./verify-package.cjs');

async function verifyCandidate(directory, tag) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
    throw new Error('Invalid release tag.');
  const version = tag.slice(1);
  const name = `remote-incus-${version}.vsix`;
  const filename = path.join(directory, name);
  const bytes = fs.readFileSync(filename);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (fs.readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8').trim() !== `${digest}  ${name}`)
    throw new Error('Released VSIX checksum does not match.');
  const records = await readArchive(filename);
  const inspection = inspectRecords(records);
  if (inspection.errors.length) throw new Error(inspection.errors.join('\n'));
  const manifest = JSON.parse(records.get('extension/package.json').toString('utf8'));
  if (
    manifest.name !== 'remote-incus' ||
    manifest.publisher !== 'dodbrian' ||
    manifest.version !== version
  )
    throw new Error('Released extension identity or version does not match.');
  return { filename, bytes, version };
}

async function publishReleased(
  candidate,
  {
    request = fetch,
    upload = (filename) => execFileSync('ovsx', ['publish', filename], { stdio: 'inherit' }),
    pause = () => new Promise((resolve) => setTimeout(resolve, 5000)),
  } = {},
) {
  const endpoint = `https://open-vsx.org/api/dodbrian/remote-incus/${candidate.version}`;
  async function present() {
    const metadata = await request(endpoint);
    if (metadata.status === 404) return false;
    if (!metadata.ok) throw new Error(`Registry lookup failed: HTTP ${metadata.status}`);
    const result = await metadata.json();
    const url = new URL(result.files.download);
    if (url.protocol !== 'https:') throw new Error('Registry download must use HTTPS.');
    const download = await request(url.href);
    if (!download.ok) throw new Error(`Registry download failed: HTTP ${download.status}`);
    if (!Buffer.from(await download.arrayBuffer()).equals(candidate.bytes))
      throw new Error('Registry version exists with different bytes; refusing to overwrite it.');
    return true;
  }
  if (await present()) return 'Already published; released bytes verified.';
  let failure;
  try {
    upload(candidate.filename);
  } catch (error) {
    failure = error;
  }
  // An upload error can still mean the registry accepted the package. Poll for
  // propagation before allowing a retry, and never submit it twice in this run.
  for (let attempt = 0; attempt < 12; attempt++) {
    if (await present()) return 'Published; registry download matches the GitHub release.';
    console.log('Waiting for registry propagation...');
    await pause();
  }
  throw (
    failure || new Error('Registry version is not visible yet. Retry the publish job to verify it.')
  );
}

if (require.main === module) {
  (async () => {
    const [directory, tag] = process.argv.slice(2);
    const candidate = await verifyCandidate(directory, tag);
    if (process.env.RELEASE_VERIFY_ONLY === 'true')
      console.log('Released VSIX identity, version, checksum and contents verified.');
    else console.log(await publishReleased(candidate));
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { verifyCandidate, publishReleased };
