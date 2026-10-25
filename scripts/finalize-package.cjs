#!/usr/bin/env node
'use strict';

// VSCE renames the root README/license. Keep source links useful in a checkout,
// and make emitted Markdown point to the literal filenames inside the VSIX.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { ZipFile } = require('yazl');
const { readArchive } = require('./verify-package.cjs');

function normalizeLinks(records) {
  const result = new Map(records);
  let count = 0;
  for (const [name, bytes] of records) {
    if (!name.endsWith('.md')) continue;
    const text = bytes
      .toString('utf8')
      .replace(/```[^\n]*\n[\s\S]*?```|\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g, (link, raw) => {
        if (!raw) return link;
        const target = raw.replace(/^<|>$/g, '');
        if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) return link;
        const file = target.split(/[?#]/)[0];
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), file));
        const replacement =
          resolved === 'extension/README.md'
            ? 'readme.md'
            : resolved === 'extension/LICENSE'
              ? 'LICENSE.txt'
              : undefined;
        if (!replacement) return link;
        count++;
        return link.replace(raw, raw.replace(/(?:README\.md|LICENSE)(?=[?#>]|$)/, replacement));
      });
    result.set(name, Buffer.from(text));
  }
  return { records: result, count };
}

async function main() {
  if (process.argv.length !== 3)
    throw new Error('Usage: node scripts/finalize-package.cjs FILE.vsix');
  const filename = process.argv[2];
  const { records, count } = normalizeLinks(await readArchive(filename));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'incus-package-finalize-'));
  try {
    const output = path.join(directory, 'final.vsix');
    const zip = new ZipFile();
    const completion = pipeline(zip.outputStream, fs.createWriteStream(output));
    for (const [name, bytes] of [...records].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
      zip.addBuffer(bytes, name, { mtime: new Date('2000-01-01T00:00:00Z'), mode: 0o100644 });
    }
    zip.end();
    await completion;
    fs.copyFileSync(output, filename);
    console.log(`Package links: ${count} root README/license references normalized.`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { normalizeLinks };
