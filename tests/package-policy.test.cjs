'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { inspectRecords, required, documentation } = require('../scripts/verify-package.cjs');

function fixture() {
  const records = new Map(
    [...required, ...documentation].map((name) => [`extension/${name}`, Buffer.from('fixture')]),
  );
  records.set(
    'extension/package.json',
    Buffer.from(
      JSON.stringify({
        name: 'remote-incus',
        publisher: 'local-dev',
        version: '0.1.0',
        main: './dist/extension.js',
      }),
    ),
  );
  records.set(
    '[Content_Types].xml',
    Buffer.from(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${['js', 'json', 'md', 'svg', 'txt', 'vsixmanifest'].map((extension) => `<Default Extension="${extension}" ContentType="text/plain"/>`).join('')}</Types>`,
    ),
  );
  records.set(
    'extension.vsixmanifest',
    Buffer.from(
      '<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Id="remote-incus" Version="0.1.0" Publisher="local-dev"/><License>extension/LICENSE.txt</License></Metadata><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/readme.md"/><Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt"/></Assets></PackageManifest>',
    ),
  );
  return records;
}

test('package policy accepts required runtime, licenses and documentation', () => {
  assert.deepEqual(inspectRecords(fixture()).errors, []);
});

test('package policy rejects missing runtime and licenses', () => {
  for (const name of [
    'dist/extension.js',
    'assets/relay.js',
    'LICENSE.txt',
    'licenses/vscode-icons-CC-BY-4.0.txt',
  ]) {
    const records = fixture();
    records.delete(`extension/${name}`);
    assert.ok(
      inspectRecords(records).errors.some((error) =>
        error.includes('Required archive file missing'),
      ),
    );
  }
});

test('package policy refuses private and development files anywhere in archive', () => {
  for (const name of [
    '.env',
    'docs/credentials.pem',
    'dist/extension.js.map',
    'src/extension.ts',
    '.github/workflows/ci.yml',
    'assets/private.log',
    'docs/unreviewed.md',
  ]) {
    const records = fixture();
    records.set(`extension/${name}`, Buffer.from('fixture'));
    assert.ok(
      inspectRecords(records).errors.some((error) => error.startsWith('Unexpected archive file:')),
    );
  }
});

test('package privacy audit redacts matched credentials from errors', () => {
  const records = fixture();
  const credential = 'gh' + 'p_' + 'A'.repeat(36);
  records.set('extension/readme.md', Buffer.from(credential));
  const errors = inspectRecords(records).errors;
  assert.ok(errors.some((error) => error.includes('GitHub credential')));
  assert.ok(errors.every((error) => !error.includes(credential)));
});

test('package link check resolves relative encoded files and rejects absent or escaping targets', () => {
  const records = fixture();
  records.set(
    'extension/readme.md',
    Buffer.from('[docs](docs/README.md#topic) [web](https://example.invalid/)'),
  );
  records.set('extension/docs/README.md', Buffer.from('# Topic\n[back](../readme.md)'));
  assert.deepEqual(inspectRecords(records), { errors: [], links: 2 });
  records.set(
    'extension/readme.md',
    Buffer.from('[missing](docs/missing.md) [escape](../private.md)'),
  );
  assert.equal(
    inspectRecords(records).errors.filter((error) => error.startsWith('Missing packaged link'))
      .length,
    2,
  );
});

test('package link check rejects bad anchors and production source map references', () => {
  const records = fixture();
  records.set('extension/readme.md', Buffer.from('[bad](docs/README.md#missing)'));
  records.set('extension/dist/extension.js', Buffer.from('//# sourceMappingURL=extension.js.map'));
  const errors = inspectRecords(records).errors;
  assert.ok(errors.some((error) => error.startsWith('Missing packaged anchor')));
  assert.ok(errors.some((error) => error.includes('source map reference')));
});

// A small stored ZIP fixture exercises the actual parser without external tools.
function storedZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, data = 'fixture', mode = 0o100644, declaredSize } of entries) {
    const filename = Buffer.from(name);
    const bytes = Buffer.from(data);
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(declaredSize ?? bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, bytes);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE((3 << 8) | 20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(bytes.length, 20);
    record.writeUInt32LE(declaredSize ?? bytes.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE((mode << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

test('archive parser reads real ZIP bytes and rejects duplicates, traversal and symlinks', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { readArchive } = require('../scripts/verify-package.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'incus-package-policy-'));
  const filename = path.join(root, 'fixture.vsix');
  try {
    fs.writeFileSync(filename, storedZip([{ name: 'extension/readme.md', data: '# Hello' }]));
    assert.equal((await readArchive(filename)).get('extension/readme.md').toString(), '# Hello');
    for (const entries of [
      [{ name: 'same' }, { name: 'same' }],
      [{ name: '../outside' }],
      [{ name: '/outside' }],
      [{ name: 'extension/link', mode: 0o120777 }],
      [{ name: 'huge', declaredSize: 17 * 1024 * 1024 }],
    ]) {
      fs.writeFileSync(filename, storedZip(entries));
      await assert.rejects(readArchive(filename));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('anchor check handles repeated headings, same-file links and fenced examples', () => {
  const records = fixture();
  records.set(
    'extension/readme.md',
    Buffer.from(
      '# Title\n# Title\n[second](#title-1)\n```md\n[example](missing.md)\n# Example\n```\n',
    ),
  );
  assert.deepEqual(inspectRecords(records).errors, []);
  records.set('extension/readme.md', Buffer.from('# Title\n[bad](#title-1)'));
  assert.ok(
    inspectRecords(records).errors.some((error) => error.startsWith('Missing packaged anchor')),
  );
});

test('package policy rejects empty required files and invalid JavaScript without executing it', () => {
  for (const file of [...required, ...documentation]) {
    const records = fixture();
    records.set(`extension/${file}`, Buffer.from(' \n'));
    assert.ok(
      inspectRecords(records).errors.some((error) =>
        error.startsWith('Required archive file empty:'),
      ),
    );
  }
  const records = fixture();
  records.set('extension/dist/extension.js', Buffer.from('function ('));
  assert.ok(
    inspectRecords(records).errors.some((error) =>
      error.startsWith('Invalid JavaScript runtime file:'),
    ),
  );
});

test('package policy rejects malformed, mismatched and incomplete VSIX metadata', () => {
  for (const file of ['extension.vsixmanifest', '[Content_Types].xml']) {
    const records = fixture();
    records.set(file, Buffer.from('not XML'));
    assert.ok(inspectRecords(records).errors.some((error) => error.startsWith('Invalid VSIX')));
  }
  for (const suffix of ['junk', '<Other/>']) {
    const records = fixture();
    records.set(
      'extension.vsixmanifest',
      Buffer.from(records.get('extension.vsixmanifest').toString() + suffix),
    );
    assert.ok(inspectRecords(records).errors.includes('Invalid VSIX manifest metadata'));
  }
  for (const [before, after, expected] of [
    ['Id="remote-incus"', 'Id="other"', 'VSIX identity Id'],
    ['Version="0.1.0"', 'Version="9.0.0"', 'VSIX identity Version'],
    ['Publisher="local-dev"', 'Publisher="other"', 'VSIX identity Publisher'],
    ['Path="extension/readme.md"', 'Path="extension/missing.md"', 'VSIX asset points'],
    ['Microsoft.VisualStudio.Code.Manifest', 'Other.Manifest', 'VSIX required asset is missing'],
  ]) {
    const records = fixture();
    records.set(
      'extension.vsixmanifest',
      Buffer.from(records.get('extension.vsixmanifest').toString().replace(before, after)),
    );
    assert.ok(inspectRecords(records).errors.some((error) => error.startsWith(expected)));
  }
  const records = fixture();
  records.set(
    '[Content_Types].xml',
    Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  );
  assert.ok(
    inspectRecords(records).errors.some((error) =>
      error.startsWith('VSIX content type is missing'),
    ),
  );
});

test('archive parser refuses CRC corruption and hidden directory payloads', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { readArchive } = require('../scripts/verify-package.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'incus-package-integrity-'));
  const file = path.join(directory, 'fixture.vsix');
  try {
    const bytes = storedZip([{ name: 'extension/readme.md', data: 'original' }]);
    bytes[bytes.indexOf(Buffer.from('original'))] = 'X'.charCodeAt(0);
    fs.writeFileSync(file, bytes);
    await assert.rejects(readArchive(file), /CRC mismatch/);
    for (const entry of [
      { name: 'extension/private/', data: 'hidden-payload' },
      { name: 'extension/link/', data: '', mode: 0o120777 },
    ]) {
      fs.writeFileSync(file, storedZip([entry]));
      await assert.rejects(readArchive(file), /hidden data|symlink/);
    }
    fs.writeFileSync(file, storedZip([{ name: 'extension/', data: '', mode: 0o40755 }]));
    assert.equal((await readArchive(file)).size, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('missing-link diagnostics redact credential-like target values', () => {
  const records = fixture();
  const credential = 'gh' + 'p_' + 'A'.repeat(36);
  records.set('extension/readme.md', Buffer.from(`[missing](missing-${credential}.md)`));
  const errors = inspectRecords(records).errors;
  assert.ok(errors.some((error) => error.startsWith('Missing packaged link target')));
  assert.ok(errors.every((error) => !error.includes(credential)));
});

test('package policy checks recognized reference-style local links', () => {
  const records = fixture();
  records.set('extension/readme.md', Buffer.from('[broken][target]\n\n[target]: missing.md\n'));
  const result = inspectRecords(records);
  assert.equal(result.links, 1);
  assert.ok(result.errors.some((error) => error.startsWith('Missing packaged link target')));
});
