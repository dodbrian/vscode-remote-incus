import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { downloadTarball } from '../src/bootstrap';
import { withFixture } from './support/fixture';
import { COMMIT, context } from './support/scenario';

for (const cache of ['valid', 'corrupt', 'missing-sha', 'missing-archive', 'absent'] as const)
  test(`B1: ${cache} cache and URL substitution`, (t) =>
    withFixture(t, async (f) => {
      const bytes = Buffer.from('tiny controlled tarball');
      const sha = createHash('sha256').update(bytes).digest('hex');
      const dir = `${f.directory}/server-cache`;
      mkdirSync(dir);
      const file = `${dir}/vscode-server-linux-x64-${COMMIT}.tar.gz`;
      if (cache !== 'absent' && cache !== 'missing-archive')
        writeFileSync(file, cache === 'corrupt' ? 'wrong' : bytes);
      if (cache !== 'absent' && cache !== 'missing-sha') writeFileSync(`${file}.sha256`, sha);
      f.configuration.set(
        'remote-incus.downloadUrlTemplate',
        'https://offline.invalid/{commit}/{flavor}',
      );
      if (cache !== 'valid')
        f.expect('fetch', (url) => {
          assert.equal(url, `https://offline.invalid/${COMMIT}/linux-x64`);
          return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
        });
      const result = await downloadTarball(context(f), COMMIT, 'linux-x64');
      assert.equal(result.sha256, sha);
      assert.deepEqual(readFileSync(result.file), bytes);
      assert.equal(existsSync(`${file}.partial`), false);
    }));

for (const failure of ['http', 'body', 'stream'] as const)
  test(`B1: ${failure} failure publishes no archive or partial`, (t) =>
    withFixture(t, async (f) => {
      f.expect('fetch', () =>
        failure === 'http'
          ? new Response('unavailable', { status: 503 })
          : failure === 'body'
            ? new Response(null)
            : new Response(
                new ReadableStream({
                  start(controller) {
                    controller.enqueue(new Uint8Array([1]));
                    controller.error(new Error('stream failed'));
                  },
                }),
              ),
      );
      await assert.rejects(downloadTarball(context(f), COMMIT, 'linux-x64'), /HTTP|stream failed/);
      const file = `${f.directory}/server-cache/vscode-server-linux-x64-${COMMIT}.tar.gz`;
      assert.equal(existsSync(file), false);
      assert.equal(existsSync(`${file}.partial`), false);
      assert.equal(existsSync(`${file}.sha256`), false);
    }));

for (const cached of [false, true])
  test(`publisher digest rejects client bytes before cache publication/reuse; cached=${String(cached)}`, (t) =>
    withFixture(t, async (f) => {
      const dir = `${f.directory}/server-cache`;
      mkdirSync(dir);
      const file = `${dir}/vscode-server-linux-x64-${COMMIT}.tar.gz`;
      const wrong = createHash('sha256').update('wrong').digest('hex');
      if (cached) {
        writeFileSync(file, 'wrong');
        writeFileSync(file + '.sha256', wrong);
      } else f.expect('fetch', () => new Response('wrong'));
      await assert.rejects(
        downloadTarball(context(f), COMMIT, 'linux-x64', undefined, 'a'.repeat(64)),
        /trusted server metadata SHA-256/,
      );
      assert.equal(existsSync(file), false);
      assert.equal(existsSync(file + '.sha256'), false);
      assert.equal(existsSync(file + '.partial'), false);
    }));

test('publisher-matching archive is published with its verified sidecar', (t) =>
  withFixture(t, async (f) => {
    const digest = createHash('sha256').update('archive').digest('hex');
    f.expect('fetch', () => new Response('archive'));
    const result = await downloadTarball(context(f), COMMIT, 'linux-x64', undefined, digest);
    assert.equal(result.sha256, digest);
    assert.equal(readFileSync(result.file, 'utf8'), 'archive');
    assert.equal(readFileSync(result.file + '.sha256', 'utf8').trim(), digest);
  }));
