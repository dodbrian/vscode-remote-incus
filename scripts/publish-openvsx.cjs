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

async function registryMatches(candidate, request = fetch) {
  const endpoint = `https://open-vsx.org/api/dodbrian/remote-incus/${candidate.version}`;
  const metadata = await request(endpoint, { signal: AbortSignal.timeout(30000) });
  if (metadata.status === 404) return false;
  if (!metadata.ok) throw new Error(`Registry lookup failed: HTTP ${metadata.status}`);
  const result = await metadata.json();
  const url = new URL(result.files.download);
  if (url.protocol !== 'https:') throw new Error('Registry download must use HTTPS.');
  const download = await request(url.href, { signal: AbortSignal.timeout(60000) });
  if (!download.ok) throw new Error(`Registry download failed: HTTP ${download.status}`);
  if (!Buffer.from(await download.arrayBuffer()).equals(candidate.bytes)) {
    const error = new Error(
      'Registry version exists with different bytes; refusing to overwrite it.',
    );
    error.code = 'OPENVSX_INTEGRITY';
    throw error;
  }
  return true;
}

async function publishReleased(
  candidate,
  {
    request = fetch,
    upload = (filename) => execFileSync('ovsx', ['publish', filename], { stdio: 'inherit' }),
  } = {},
) {
  if (await registryMatches(candidate, request))
    return { state: 'verified', message: 'Already published; released bytes verified.' };
  try {
    await upload(candidate.filename);
  } catch (error) {
    // Reconcile an ambiguous response once, without claiming acceptance on failure.
    if (await registryMatches(candidate, request))
      return {
        state: 'verified',
        message: 'Published; registry download matches the GitHub release.',
      };
    throw error;
  }
  return {
    state: 'accepted',
    message:
      'Upload accepted; awaiting Open VSX checks. Availability will be verified automatically.',
  };
}

if (require.main === module) {
  (async () => {
    const [directory, tag] = process.argv.slice(2);
    const candidate = await verifyCandidate(directory, tag);
    if (process.env.RELEASE_VERIFY_ONLY === 'true')
      console.log('Released VSIX identity, version, checksum and contents verified.');
    else console.log((await publishReleased(candidate)).message);
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { verifyCandidate, publishReleased, registryMatches };
