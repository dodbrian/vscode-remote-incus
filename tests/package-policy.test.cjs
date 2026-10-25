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
    Buffer.from(JSON.stringify({ main: './dist/extension.js' })),
  );
  records.set('[Content_Types].xml', Buffer.from('<Types/>'));
  records.set('extension.vsixmanifest', Buffer.from('<PackageManifest/>'));
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

test('package finalization fixes actual VSCE root aliases without weakening link validation', () => {
  const { normalizeLinks } = require('../scripts/finalize-package.cjs');
  const records = fixture();
  records.set(
    'extension/docs/README.md',
    Buffer.from(
      '[root](../README.md#heading "Title") [license](../LICENSE) [external](https://example.invalid/README.md)\n```md\n[example](../README.md)\n```',
    ),
  );
  records.set('extension/readme.md', Buffer.from('# Heading'));
  assert.equal(
    inspectRecords(records).errors.filter((error) => error.startsWith('Missing packaged link'))
      .length,
    2,
  );
  const normalized = normalizeLinks(records);
  assert.equal(normalized.count, 2);
  assert.deepEqual(inspectRecords(normalized.records).errors, []);
  assert.match(
    normalized.records.get('extension/docs/README.md').toString(),
    /https:\/\/example[.]invalid\/README[.]md/,
  );
  assert.match(records.get('extension/docs/README.md').toString(), /[.][.]\/README[.]md/);
  assert.match(
    normalized.records.get('extension/docs/README.md').toString(),
    /example\]\([.][.]\/README[.]md\)/,
  );
  assert.match(
    normalized.records.get('extension/docs/README.md').toString(),
    /readme[.]md#heading "Title"/,
  );
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
