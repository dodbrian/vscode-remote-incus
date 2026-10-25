#!/usr/bin/env node
'use strict';

// Bounded, value-redacting publication check. This supplements human review;
// it cannot recognize arbitrary private hostnames or every credential format.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const rules = [
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g],
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g],
  ['cloud access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['Slack credential', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['API credential', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ['URL credential', /https?:\/\/[^\s/@:]+:[^\s/@]+@/g],
  [
    'personal path',
    /(?:\/home\/(?!ubuntu(?:\W|$)|developer(?:\W|$)|alice(?:\W|$)|service(?:\W|$)|late(?:\W|$)|blocked(?:\W|$)|\.vscode-server(?:\W|$))[^\s/`"'{}$]+|\/Users\/[^\s/`"']+|[A-Z]:\\Users\\[^\s\\"']+)/g,
  ],
  [
    'literal secret',
    /\b(?:api[_-]?key|password|secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{20,}['"]/gi,
  ],
];

function findings(text) {
  const result = [];
  for (const [kind, regex] of rules) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      result.push({ kind, line: text.slice(0, match.index).split('\n').length });
    }
  }
  for (const match of text.matchAll(/(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g)) {
    const bytes = match[0].split('.').map(Number);
    if (bytes.some((n) => n > 255)) continue;
    const [a, b, c] = bytes;
    const allowed =
      a === 127 ||
      match[0] === '0.0.0.0' ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113);
    if (!allowed)
      result.push({
        kind: 'non-documentation IPv4 address',
        line: text.slice(0, match.index).split('\n').length,
      });
  }
  return result;
}

function git(args) {
  return cp.execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
}

function walk(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Refusing symlink in export: ' + file);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function main() {
  const args = process.argv.slice(2);
  let records;
  if (args.length === 1 && args[0] === '--history') {
    const blobs = git(['rev-list', '--objects', '--all']).toString().trim().split('\n');
    records = blobs.flatMap((entry) => {
      const [id, ...name] = entry.split(' ');
      if (git(['cat-file', '-t', id]).toString().trim() !== 'blob') return [];
      return [
        { file: id.slice(0, 12) + ':' + name.join(' '), data: git(['cat-file', 'blob', id]) },
      ];
    });
    for (const id of git(['rev-list', '--all']).toString().trim().split('\n')) {
      records.push({
        file: id.slice(0, 12) + ':commit-message',
        data: git(['show', '-s', '--format=%B', id]),
      });
    }
  } else if (args.length === 2 && args[0] === '--root') {
    records = walk(args[1]).map((file) => ({ file, data: fs.readFileSync(file) }));
  } else if (args.length === 0) {
    // The index still lists an unstaged deletion or rename's original path.
    // Scan the current checkout; --history separately audits committed content.
    const deleted = new Set(git(['ls-files', '-z', '--deleted']).toString().split('\0'));
    records = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'])
      .toString()
      .split('\0')
      .filter((file) => file && !deleted.has(file))
      .map((file) => ({ file, data: fs.readFileSync(file) }));
  } else {
    throw new Error('Usage: node scripts/audit-privacy.cjs [--history | --root DIRECTORY]');
  }
  let count = 0;
  for (const { file, data } of records) {
    if (data.includes(0)) throw new Error('Binary file requires separate review: ' + file);
    for (const { kind, line } of findings(data.toString('utf8'))) {
      console.error(`${file}:${line}: ${kind} (value redacted)`);
      count++;
    }
  }
  console.log(`Privacy patterns: ${records.length} files/objects checked, ${count} findings.`);
  if (count) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { findings };
