#!/usr/bin/env node
'use strict';

// Inspect bytes from the actual VSIX, without extracting untrusted paths.
const fs = require('node:fs');
const path = require('node:path');
const yauzl = require('yauzl');
const { crc32 } = require('node:zlib');
const { Script } = require('node:vm');
const { parseString } = require('xml2js');
const sax = require('sax');
const { findings } = require('./audit-privacy.cjs');

const required = [
  'package.json',
  'readme.md',
  'LICENSE.txt',
  'dist/extension.js',
  'assets/relay.js',
  'licenses/vscode-icons-CC-BY-4.0.txt',
  'docs/ThirdPartyNotices.md',
  ...['light', 'dark'].flatMap((theme) =>
    ['folder.svg', 'folder-active.svg', 'vm-active.svg'].map((name) => `assets/${theme}/${name}`),
  ),
];
const documentation = [
  'ALTERNATIVES.md',
  'DESIGN.md',
  'HANDOVER.md',
  'README.md',
  'RELEASE-READINESS.md',
  'REGRESSION_TEST_PLAN.md',
  'TASK-01-OFFLINE-TEST-HARNESS.md',
  'TASK-02-REGRESSION-BASELINE.md',
  'TASK-03-CONNECTION-CORRECTNESS.md',
  'TASK-03-RESULTS.md',
  'TASK-04-REAL-BEHAVIOR-VERIFICATION.md',
  'TASK-04-RESULTS.md',
  'TASK-05-CONNECTION-OPTIMIZATION.md',
  'TASK-05-MEASUREMENTS.json',
  'TASK-05-RESULTS.md',
  'tests/COVERAGE.md',
  'tests/README.md',
  'spike/README.md',
].map((name) => `docs/${name}`);
const allowed = new Set([...required, ...documentation].map((name) => `extension/${name}`));
const metadata = new Set(['[Content_Types].xml', 'extension.vsixmanifest']);

const { inspectMarkdown, resolveLocalLink } = require('./package-markdown.cjs');

function parseXml(bytes, root, namespace) {
  if (!bytes || /<!DOCTYPE/i.test(bytes.toString('utf8'))) throw new Error('Invalid XML');
  // xml2js resolves at the first closing root; validate the entire document first.
  const parser = sax.parser(true);
  let depth = 0;
  let roots = 0;
  parser.onopentag = () => {
    if (depth++ === 0) roots++;
  };
  parser.onclosetag = () => depth--;
  parser.onerror = () => {
    throw new Error('Invalid XML');
  };
  parser.write(bytes.toString('utf8')).close();
  if (roots !== 1) throw new Error('Invalid XML');
  let parsed;
  let failure;
  parseString(bytes.toString('utf8'), { async: false, strict: true }, (error, value) => {
    failure = error;
    parsed = value;
  });
  if (failure || !parsed?.[root] || parsed[root].$?.xmlns !== namespace) {
    throw new Error('Invalid XML');
  }
  return parsed[root];
}

function inspectMetadata(records, manifest, errors) {
  try {
    const xml = parseXml(
      records.get('extension.vsixmanifest'),
      'PackageManifest',
      'http://schemas.microsoft.com/developer/vsx-schema/2011',
    );
    if (xml.$.Version !== '2.0.0') throw new Error('Unsupported manifest version');
    const identities = xml.Metadata?.[0]?.Identity;
    if (xml.Metadata?.length !== 1 || identities?.length !== 1) {
      throw new Error('Expected one identity');
    }
    const identity = identities[0].$;
    for (const [attribute, key] of [
      ['Id', 'name'],
      ['Version', 'version'],
      ['Publisher', 'publisher'],
    ]) {
      if (!manifest?.[key] || identity?.[attribute] !== manifest[key]) {
        errors.push(`VSIX identity ${attribute} does not match package.json`);
      }
    }
    const assets = xml.Assets?.[0]?.Asset;
    if (xml.Assets?.length !== 1 || !Array.isArray(assets)) throw new Error('Missing assets');
    const expected = new Map([
      ['Microsoft.VisualStudio.Code.Manifest', 'extension/package.json'],
      ['Microsoft.VisualStudio.Services.Content.Details', 'extension/readme.md'],
      ['Microsoft.VisualStudio.Services.Content.License', 'extension/LICENSE.txt'],
    ]);
    const seen = new Set();
    for (const asset of assets) {
      const attributes = asset.$;
      if (!attributes?.Type || seen.has(attributes.Type)) throw new Error('Invalid asset type');
      seen.add(attributes.Type);
      if (!records.has(attributes.Path) || !allowed.has(attributes.Path)) {
        errors.push('VSIX asset points to an absent or disallowed file');
      }
      if (expected.has(attributes.Type) && expected.get(attributes.Type) !== attributes.Path) {
        errors.push('VSIX required asset points to the wrong file');
      }
    }
    for (const type of expected.keys()) {
      if (!seen.has(type)) errors.push('VSIX required asset is missing');
    }
    if (
      xml.Metadata[0].License?.length !== 1 ||
      xml.Metadata[0].License[0] !== 'extension/LICENSE.txt'
    ) {
      errors.push('VSIX license metadata points to the wrong file');
    }
  } catch {
    errors.push('Invalid VSIX manifest metadata');
  }
  try {
    const types = parseXml(
      records.get('[Content_Types].xml'),
      'Types',
      'http://schemas.openxmlformats.org/package/2006/content-types',
    );
    const extensions = new Set();
    for (const item of types.Default ?? []) {
      const extension = item.$?.Extension?.replace(/^\./, '').toLowerCase();
      if (!extension || !item.$.ContentType || extensions.has(extension))
        throw new Error('Invalid default');
      extensions.add(extension);
    }
    const overrides = new Set();
    for (const item of types.Override ?? []) {
      const file = item.$?.PartName;
      if (
        !file?.startsWith('/') ||
        !records.has(file.slice(1)) ||
        !item.$.ContentType ||
        overrides.has(file)
      ) {
        throw new Error('Invalid override');
      }
      overrides.add(file);
    }
    for (const name of records.keys()) {
      if (name === '[Content_Types].xml') continue;
      if (
        !extensions.has(path.posix.extname(name).slice(1).toLowerCase()) &&
        !overrides.has(`/${name}`)
      ) {
        errors.push('VSIX content type is missing for a packaged file');
      }
    }
  } catch {
    errors.push('Invalid VSIX content-type metadata');
  }
}

function inspectRecords(records) {
  const errors = [];
  for (const name of records.keys()) {
    if (!allowed.has(name) && !metadata.has(name)) errors.push(`Unexpected archive file: ${name}`);
    const data = records.get(name);
    if (
      name === 'extension/dist/extension.js' &&
      data.toString('utf8').includes('sourceMappingURL=')
    ) {
      errors.push('Production bundle contains a source map reference');
    }
    if (data.includes(0)) errors.push(`Unexpected binary content: ${name}`);
    for (const { kind, line } of findings(data.toString('utf8'))) {
      errors.push(`${name}:${line}: ${kind} (value redacted)`);
    }
  }
  for (const name of [...required, ...documentation].map((file) => `extension/${file}`)) {
    if (!records.has(name)) errors.push(`Required archive file missing: ${name}`);
    else if (!records.get(name).toString('utf8').trim())
      errors.push(`Required archive file empty: ${name}`);
  }
  for (const name of metadata) {
    if (!records.has(name)) errors.push(`Required VSIX metadata missing: ${name}`);
    else if (!records.get(name).toString('utf8').trim())
      errors.push(`Required VSIX metadata empty: ${name}`);
  }
  let manifest;
  if (records.has('extension/package.json')) {
    try {
      manifest = JSON.parse(records.get('extension/package.json').toString('utf8'));
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
        throw new Error('Invalid manifest');
      for (const field of ['name', 'publisher', 'version']) {
        if (typeof manifest[field] !== 'string' || !manifest[field].trim())
          throw new Error('Missing identity');
      }
      if (manifest.main !== './dist/extension.js') errors.push('Unexpected extension entry point');
    } catch {
      errors.push('Invalid extension package.json');
    }
  }
  inspectMetadata(records, manifest, errors);
  for (const name of ['extension/dist/extension.js', 'extension/assets/relay.js']) {
    if (!records.has(name)) continue;
    try {
      new Script(records.get(name).toString('utf8'), { filename: name });
    } catch {
      errors.push(`Invalid JavaScript runtime file: ${name}`);
    }
  }
  let links = 0;
  for (const [name, data] of records) {
    if (!name.endsWith('.md')) continue;
    for (const href of inspectMarkdown(data.toString('utf8')).links) {
      let resolved;
      try {
        resolved = resolveLocalLink(name, href);
      } catch {
        errors.push(`Invalid link encoding in ${name}`);
        continue;
      }
      if (!resolved) continue;
      const { target, fragment } = resolved;
      links++;
      if (!target.startsWith('extension/') || !records.has(target)) {
        const targetLabel = findings(href).length ? '(value redacted)' : href;
        errors.push(`Missing packaged link target in ${name}: ${targetLabel}`);
      } else if (fragment && target.endsWith('.md')) {
        if (!inspectMarkdown(records.get(target).toString('utf8')).anchors.has(fragment)) {
          const targetLabel = findings(href).length ? '(value redacted)' : href;
          errors.push(`Missing packaged anchor in ${name}: ${targetLabel}`);
        }
      }
    }
  }
  return { errors, links };
}

function readArchive(filename) {
  return new Promise((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(error);
      const records = new Map();
      let total = 0;
      let entryCount = 0;
      const names = new Set();
      const fail = (failure) => {
        zip.close();
        reject(failure);
      };
      zip.on('error', fail);
      zip.on('end', () => resolve(records));
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        if (
          names.has(name) ||
          name.includes('\\') ||
          name.startsWith('/') ||
          name.split('/').includes('..')
        ) {
          return fail(new Error('Duplicate or unsafe archive path'));
        }
        names.add(name);
        entryCount++;
        total += entry.uncompressedSize;
        if (
          entry.uncompressedSize > 16 * 1024 * 1024 ||
          total > 64 * 1024 * 1024 ||
          entryCount > 1000
        ) {
          return fail(new Error('Archive exceeds inspection limits'));
        }
        if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) {
          return fail(new Error('Archive symlinks are forbidden'));
        }
        if (name.endsWith('/')) {
          if (entry.uncompressedSize !== 0 || entry.compressedSize !== 0 || entry.crc32 !== 0) {
            return fail(new Error('Archive directory contains hidden data'));
          }
          return zip.readEntry();
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail(streamError);
          const chunks = [];
          stream.on('error', fail);
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => {
            const bytes = Buffer.concat(chunks);
            if (crc32(bytes) !== entry.crc32) return fail(new Error('Archive entry CRC mismatch'));
            records.set(name, bytes);
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

async function main() {
  if (process.argv.length !== 3 || !fs.statSync(process.argv[2]).isFile()) {
    throw new Error('Usage: node scripts/verify-package.cjs FILE.vsix');
  }
  const records = await readArchive(process.argv[2]);
  const { errors, links } = inspectRecords(records);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    `Package policy: ${records.size} files, ${links} local documentation links, no findings.`,
  );
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = {
  inspectRecords,
  readArchive,
  required,
  documentation,
  markdownAnchors: (text) => inspectMarkdown(text).anchors,
};
