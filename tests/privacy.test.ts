import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as fs from 'node:fs';

const load = createRequire(__filename);

const { findings, isReviewedImage } = load(path.resolve('scripts/audit-privacy.cjs')) as {
  isReviewedImage: (data: Buffer) => boolean;
  findings: (text: string) => { kind: string; line: number }[];
};

test('publication audit detects credentials and private paths without returning matched values', () => {
  const cases: [string, string][] = [
    ['GitHub credential', 'gh' + 'p_' + 'A'.repeat(36)],
    ['private key', '-----BEGIN ' + 'PRIVATE KEY-----'],
    ['personal path', '/home/' + 'unexpected-user/project'],
    ['URL credential', 'https://' + 'user:pass@host.invalid'],
    ['literal secret', 'api_key = "' + 'A'.repeat(28) + '"'],
    ['non-documentation IPv4 address', ['10', '20', '30', '40'].join('.')],
  ];
  for (const [kind, value] of cases) {
    const result = findings(`first line\n${value}`);
    assert.ok(
      result.some((finding) => finding.kind === kind && finding.line === 2),
      kind,
    );
    assert.ok(result.every((finding) => !JSON.stringify(finding).includes(value)));
  }
});

test('publication audit accepts loopback, documentation addresses and synthetic home paths', () => {
  for (const value of [
    '127.0.0.1',
    '0.0.0.0',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '/home/alice/project',
  ]) {
    assert.deepEqual(findings(value), []);
  }
});

test('publication audit accepts only the exact reviewed screenshot bytes', () => {
  for (const name of ['incus-connected-workspace.png', 'incus-remote-explorer.png']) {
    const data = fs.readFileSync(path.resolve('docs/images', name));
    assert.equal(isReviewedImage(data), true);
    const changed = Buffer.from(data);
    changed.writeUInt8(changed.readUInt8(changed.length - 1) ^ 1, changed.length - 1);
    assert.equal(isReviewedImage(changed), false);
  }
  assert.equal(isReviewedImage(Buffer.from([0, 1, 2])), false);
});
