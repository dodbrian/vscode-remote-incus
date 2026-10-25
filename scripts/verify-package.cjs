#!/usr/bin/env node
'use strict';

// Inspect bytes from the actual VSIX, without extracting untrusted paths.
const fs = require('node:fs');
const path = require('node:path');
const yauzl = require('yauzl');
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

function markdownAnchors(text) {
  const seen = new Map();
  const anchors = new Set();
  const markdown = text.replace(/```[^\n]*\n[\s\S]*?```/g, '');
  for (const match of markdown.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = match[1]
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_ -]/gu, '')
      .replace(/ /g, '-');
    let anchor = slug;
    let index = seen.get(slug) ?? 0;
    while (anchors.has(anchor)) anchor = `${slug}-${++index}`;
    seen.set(slug, index);
    anchors.add(anchor);
  }
  for (const match of markdown.matchAll(/<a\s+(?:name|id)=["']([^"']+)["']/gi))
    anchors.add(match[1]);
  return anchors;
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
  }
  for (const name of metadata) {
    if (!records.has(name)) errors.push(`Required VSIX metadata missing: ${name}`);
  }
  const manifest = records.get('extension/package.json');
  if (manifest) {
    try {
      const parsed = JSON.parse(manifest.toString('utf8'));
      if (parsed.main !== './dist/extension.js') errors.push('Unexpected extension entry point');
    } catch {
      errors.push('Invalid extension package.json');
    }
  }
  let links = 0;
  for (const [name, data] of records) {
    if (!name.endsWith('.md')) continue;
    // Inline Markdown file links, including images. Local file anchors
    // are checked against packaged headings; no network access is performed.
    const markdown = data.toString('utf8').replace(/```[^\n]*\n[\s\S]*?```/g, '');
    for (const match of markdown.matchAll(/\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      let target = match[1].replace(/^<|>$/g, '');
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const fragment = target.includes('#') ? target.slice(target.indexOf('#') + 1) : '';
      target = target.split(/[?#]/)[0];
      try {
        target = decodeURIComponent(target);
      } catch {
        errors.push(`Invalid link encoding in ${name}`);
        continue;
      }
      const resolved = target
        ? path.posix.normalize(path.posix.join(path.posix.dirname(name), target))
        : name;
      links++;
      if (!resolved.startsWith('extension/') || !records.has(resolved)) {
        errors.push(`Missing packaged link target in ${name}: ${target}`);
      } else if (fragment && resolved.endsWith('.md')) {
        let anchor;
        try {
          anchor = decodeURIComponent(fragment);
        } catch {
          errors.push(`Invalid anchor encoding in ${name}`);
          continue;
        }
        if (!markdownAnchors(records.get(resolved).toString('utf8')).has(anchor)) {
          errors.push(`Missing packaged anchor in ${name}: ${target}#${fragment}`);
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
      const fail = (failure) => {
        zip.close();
        reject(failure);
      };
      zip.on('error', fail);
      zip.on('end', () => resolve(records));
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        if (name.endsWith('/')) return zip.readEntry();
        if (
          records.has(name) ||
          name.includes('\\') ||
          name.startsWith('/') ||
          name.split('/').includes('..')
        ) {
          return fail(new Error('Duplicate or unsafe archive path'));
        }
        total += entry.uncompressedSize;
        if (
          entry.uncompressedSize > 16 * 1024 * 1024 ||
          total > 64 * 1024 * 1024 ||
          records.size >= 1000
        ) {
          return fail(new Error('Archive exceeds inspection limits'));
        }
        if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) {
          return fail(new Error('Archive symlinks are forbidden'));
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail(streamError);
          const chunks = [];
          stream.on('error', fail);
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => {
            records.set(name, Buffer.concat(chunks));
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
module.exports = { inspectRecords, readArchive, required, documentation, markdownAnchors };
