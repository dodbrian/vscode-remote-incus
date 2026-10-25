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

const { resolveLocalLink, rewriteMarkdownLinks } = require('./package-markdown.cjs');

function finalizeRecords(records) {
  const result = new Map(records);
  for (const [name, bytes] of records) {
    if (!name.endsWith('.md')) continue;
    const rewritten = rewriteMarkdownLinks(bytes.toString('utf8'), (href) => {
      const local = resolveLocalLink(name, href);
      if (!local) return null;
      const canonical =
        local.target === 'extension/README.md'
          ? 'extension/readme.md'
          : local.target === 'extension/LICENSE'
            ? 'extension/LICENSE.txt'
            : null;
      if (!canonical) return null;
      const suffix = href.slice(href.split(/[?#]/)[0].length);
      return path.posix.relative(path.posix.dirname(name), canonical) + suffix;
    });
    result.set(name, Buffer.from(rewritten.text));
  }
  return result;
}

async function finalizePackage(filename) {
  const records = finalizeRecords(await readArchive(filename));
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
    return records;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.length !== 3)
    throw new Error('Usage: node scripts/finalize-package.cjs FILE.vsix');
  await finalizePackage(process.argv[2]);
  console.log('Package links: root README/license references normalized.');
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { finalizeRecords, finalizePackage };
