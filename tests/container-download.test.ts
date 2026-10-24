import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import { downloadInContainer } from '../src/serverDownload';
import { ensureServerReady } from '../src/bootstrap';
import { withFixture } from './support/fixture';
import { defined } from './support/assert';
import { COMMIT, context, identity, installedServer } from './support/scenario';
const { spawnSync } = createRequire(process.cwd() + '/package.json')(
  'node:child_process',
) as typeof import('node:child_process');
const bytes = 'small archive';
const sha = createHash('sha256').update(bytes).digest('hex');
const metadata = (): { version: string; sha256hash: string; url: string } => ({
  version: COMMIT,
  sha256hash: sha,
  url: 'https://vscode.download.prss.microsoft.com/server.tar.gz',
});
const ref = { remote: 'offline-download', instance: 'owned' };

for (const bad of [
  'status',
  'commit',
  'sha',
  'http',
  'host',
  'malformed',
  'timeout',
  'mirror',
] as const)
  test(`container strategy rejects ${bad} without remote download or fallback`, (t) =>
    withFixture(t, async (f) => {
      if (bad === 'mirror')
        f.configuration.set('remote-incus.downloadUrlTemplate', 'https://mirror.invalid/{commit}');
      else
        f.expect('fetch', () => {
          if (bad === 'timeout') throw new Error('metadata timeout');
          if (bad === 'status') return new Response('', { status: 503 });
          if (bad === 'malformed') return new Response('not JSON');
          const m = metadata();
          if (bad === 'commit') m.version = 'b'.repeat(40);
          if (bad === 'sha') m.sha256hash = '';
          if (bad === 'http') m.url = 'http://vscode.download.prss.microsoft.com/file';
          if (bad === 'host') m.url = 'https://untrusted.invalid/file';
          return Response.json(m);
        });
      await assert.rejects(
        downloadInContainer(ref, identity, COMMIT, 'linux-x64'),
        /client download strategy|custom mirrors/,
      );
      assert.ok(!f.calls.some((c) => c.name.startsWith('child_process')));
    }));

for (const state of [
  'fresh',
  'matching',
  'corrupt',
  'curl-fails',
  'missing-curl',
  'signal',
  'symlink',
] as const)
  test(`S: container download ${state} has atomic checksum-gated publication and cleanup`, (t) =>
    withFixture(t, async (f) => {
      f.expect('fetch', (url, options) => {
        assert.ok(url.includes(`commit:${COMMIT}/server-linux-x64/stable`));
        assert.ok(options.signal instanceof AbortSignal);
        return Response.json(metadata());
      });
      const archive = `${f.directory}/vscode-server-linux-x64-${COMMIT}.tar.gz`;
      const payload = `${f.directory}/payload`;
      fs.writeFileSync(payload, state === 'corrupt' ? 'corrupt' : bytes);
      if (state === 'matching') {
        fs.writeFileSync(archive, bytes);
        fs.chmodSync(archive, 0o600);
      }
      const sentinel = `${f.directory}/sentinel`;
      fs.writeFileSync(sentinel, 'keep');
      if (state === 'symlink') fs.symlinkSync(sentinel, archive);
      let calls = 0;
      f.routes.set('child_process.execFile', (_cmd, args, _options, cb) => {
        calls++;
        const script = args.at(-1) as string;
        assert.ok(
          (args.includes('1001') && args.includes('1002') && args.includes('HOME=/home/alice')) ||
            script.startsWith('rm -f'),
        );
        const local = script
          .replaceAll('/tmp/vscode-server-', `${f.directory}/vscode-server-`)
          .replaceAll('1001:1002', `${defined(process.getuid)()}:${defined(process.getgid)()}`);
        // Stub only curl; all hash, mode, trap and rename commands really execute.
        const copy = `curl() { [ "$1" = --disable ] || return 90; while [ "$1" != --output ]; do shift; done; cp '${payload}' "$2"; };`;
        const prefix =
          state === 'matching'
            ? 'curl() { return 91; };'
            : state === 'curl-fails'
              ? 'curl() { return 22; };'
              : state === 'signal'
                ? 'curl() { kill -TERM "$$"; return 1; };'
                : state === 'missing-curl'
                  ? 'command() { return 1; };'
                  : copy;
        const result = spawnSync('/bin/sh', ['-c', prefix + '\n' + local], { encoding: 'utf8' });
        cb(
          result.status ? new Error('controlled remote failure') : null,
          result.stdout,
          result.stderr,
        );
      });
      const pending = downloadInContainer(ref, identity, COMMIT, 'linux-x64');
      if (['corrupt', 'curl-fails', 'missing-curl', 'signal'].includes(state)) {
        await assert.rejects(pending, /container download failed/);
        assert.equal(fs.existsSync(archive), false);
        assert.equal(calls, 2, 'one download attempt and one scoped cleanup attempt');
      } else {
        await pending;
        assert.equal(fs.readFileSync(archive, 'utf8'), bytes);
        assert.equal(fs.lstatSync(archive).isSymbolicLink(), false);
        assert.equal(fs.statSync(archive).mode & 0o777, 0o600);
      }
      assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
      assert.ok(!fs.readdirSync(f.directory).some((p) => p.includes('.partial-')));
    }));

for (const installed of [true, false])
  test(`strategy routing skips client archive work; installed=${String(installed)}`, (t) =>
    withFixture(t, async (f) => {
      f.configuration.set('remote-incus.downloadStrategy', 'container');
      const ops = installedServer(f, {
        installed,
        running: installed ? COMMIT : '',
        hook: (_args, script) => (script.includes('curl --disable --fail') ? '' : undefined),
      });
      if (!installed) f.expect('fetch', () => Response.json(metadata()));
      await ensureServerReady(context(f), {
        remote: `container-${String(installed)}`,
        instance: 'owned',
      });
      assert.ok(!ops.some((a) => a[0] === 'file' && defined(a[2]).endsWith('.tar.gz')));
      assert.equal(fs.existsSync(`${f.directory}/server-cache`), false);
    }));

for (const strategy of ['invalid', 'container'])
  test(`failed ${strategy} strategy never extracts, starts or switches to client transfer`, (t) =>
    withFixture(t, async (f) => {
      f.configuration.set('remote-incus.downloadStrategy', strategy);
      const ops = installedServer(f, {
        installed: false,
        running: '',
        hook: (_args, script) => {
          if (script.includes('curl --disable --fail')) throw new Error('download unavailable');
          if (script.startsWith('rm -f -- ') && script.includes('.partial-')) return '';
          return undefined;
        },
      });
      if (strategy === 'container') f.expect('fetch', () => Response.json(metadata()));
      await assert.rejects(
        ensureServerReady(context(f), { remote: 'failed-' + strategy, instance: 'owned' }),
        /invalid remote-incus.downloadStrategy|container download failed/,
      );
      assert.ok(
        !ops.some(
          (a) => a[0] === 'file' || /tar -xzf|nohup|fresh token minted/.test(defined(a.at(-1))),
        ),
      );
    }));

test('public configuration preserves auto default and application scope', () => {
  const setting = JSON.parse(fs.readFileSync('package.json', 'utf8')).contributes.configuration
    .properties['remote-incus.downloadStrategy'];
  assert.equal(setting.default, 'auto');
  assert.equal(setting.scope, 'application');
  assert.deepEqual(setting.enum, ['auto', 'client', 'container']);
});

test('failed container cleanup is reported without another download attempt', (t) =>
  withFixture(t, async (f) => {
    f.expect('fetch', () => Response.json(metadata()));
    for (let i = 0; i < 2; i++)
      f.expect('child_process.execFile', (_cmd, _args, _opts, cb) =>
        cb(new Error('connection unavailable'), '', 'unavailable'),
      );
    await assert.rejects(
      downloadInContainer(ref, identity, COMMIT, 'linux-x64'),
      /partial cleanup could not be confirmed/,
    );
    assert.equal(f.calls.filter((c) => c.name === 'child_process.execFile').length, 2);
  }));

for (const installed of [true, false])
  test(`default auto uses only container route when successful; installed=${String(installed)}`, (t) =>
    withFixture(t, async (f) => {
      const ops = installedServer(f, {
        installed,
        running: installed ? COMMIT : '',
        hook: (_args, script) => (script.includes('curl --disable --fail') ? '' : undefined),
      });
      f.configuration.delete('remote-incus.downloadStrategy');
      if (!installed) f.expect('fetch', () => Response.json(metadata()));
      await ensureServerReady(context(f), {
        remote: `auto-success-${String(installed)}`,
        instance: 'owned',
      });
      assert.equal(
        ops.filter((a) => a[0] === 'file' && defined(a[2]).endsWith('.tar.gz')).length,
        0,
      );
      assert.equal(fs.existsSync(`${f.directory}/server-cache`), false);
    }));

for (const failure of [
  'metadata',
  'url',
  'download',
  'client-fails',
  'client-sha',
  'bad-push',
  'cleanup',
  'mirror',
] as const)
  test(`auto ${failure}: bounded visible fallback preserves verification`, (t) =>
    withFixture(t, async (f) => {
      const archiveSha = createHash('sha256').update('archive').digest('hex');
      const ops = installedServer(f, {
        installed: false,
        running: '',
        pushedSha: failure === 'bad-push' ? 'wrong' : archiveSha,
        hook: (_args, script) => {
          if (script.includes('curl --disable --fail'))
            throw new Error('controlled container failure');
          if (script.startsWith('rm -f -- ') && script.includes('.partial-')) {
            if (failure === 'cleanup') throw new Error('cleanup unavailable');
            return '';
          }
          return undefined;
        },
      });
      f.configuration.delete('remote-incus.downloadStrategy');
      if (failure === 'mirror')
        f.configuration.set(
          'remote-incus.downloadUrlTemplate',
          'https://mirror.invalid/{commit}/{flavor}',
        );
      else
        f.expect('fetch', () =>
          failure === 'metadata' || failure === 'client-fails'
            ? new Response('', { status: 503 })
            : Response.json({
                ...metadata(),
                sha256hash: archiveSha,
                ...(failure === 'url' ? { url: 'https://untrusted.invalid/server' } : {}),
              }),
        );
      if (failure !== 'cleanup')
        f.expect('fetch', (url) => {
          if (failure === 'mirror') assert.equal(url, `https://mirror.invalid/${COMMIT}/linux-x64`);
          return failure === 'client-fails'
            ? new Response('', { status: 503 })
            : new Response(failure === 'client-sha' ? 'bad archive' : 'archive');
        });
      const messages: string[] = [];
      const pending = ensureServerReady(
        context(f),
        { remote: `auto-fail-${failure}`, instance: 'owned' },
        (m) => messages.push(m),
      );
      if (['cleanup', 'client-fails', 'client-sha', 'bad-push'].includes(failure)) {
        await assert.rejects(
          pending,
          failure === 'cleanup'
            ? /partial cleanup could not be confirmed/
            : /automatic server download failed/,
        );
        assert.ok(!ops.some((a) => /tar -xzf|nohup|fresh token minted/.test(defined(a.at(-1)))));
      } else await pending;
      if (failure === 'client-sha')
        assert.ok(
          !fs
            .readdirSync(`${f.directory}/server-cache`)
            .some((p) => p.endsWith('.tar.gz') || p.endsWith('.sha256')),
        );
      const switches = messages.filter((m) => m.includes('switching to client'));
      assert.equal(switches.length, failure === 'cleanup' || failure === 'mirror' ? 0 : 1);
      assert.equal(
        ops.filter((a) => defined(a.at(-1)).includes('curl --disable --fail')).length,
        ['metadata', 'url', 'client-fails', 'mirror'].includes(failure) ? 0 : 1,
      );
      assert.equal(
        ops.filter((a) => a[0] === 'file' && defined(a[2]).endsWith('.tar.gz')).length,
        ['cleanup', 'client-fails', 'client-sha'].includes(failure) ? 0 : 1,
      );
    }));

test('auto metadata outage can use the verified client cache without another fetch', (t) =>
  withFixture(t, async (f) => {
    const archiveSha = createHash('sha256').update('archive').digest('hex');
    installedServer(f, { installed: false, running: '', remoteSha: archiveSha });
    f.configuration.delete('remote-incus.downloadStrategy');
    fs.mkdirSync(`${f.directory}/server-cache`);
    const file = `${f.directory}/server-cache/vscode-server-linux-x64-${COMMIT}.tar.gz`;
    fs.writeFileSync(file, 'archive');
    fs.writeFileSync(file + '.sha256', archiveSha);
    f.expect('fetch', () => new Response('', { status: 503 }));
    await ensureServerReady(context(f), { remote: 'auto-cached', instance: 'owned' });
    assert.equal(f.calls.filter((c) => c.name === 'fetch').length, 1);
  }));

test('auto does not disguise unexpected progress errors as a download failure', (t) =>
  withFixture(t, async (f) => {
    const ops = installedServer(f, {
      installed: false,
      running: '',
      hook: (_args, script) => (script.includes('curl --disable --fail') ? '' : undefined),
    });
    f.configuration.delete('remote-incus.downloadStrategy');
    f.expect('fetch', () => Response.json(metadata()));
    const failure = new Error('controlled reporting failure');
    await assert.rejects(
      ensureServerReady(context(f), { remote: 'auto-reporting', instance: 'owned' }, (message) => {
        if (message === 'container archive checksum verified') throw failure;
      }),
      (error) => error === failure,
    );
    assert.ok(!ops.some((a) => a[0] === 'file' || /tar -xzf|nohup/.test(defined(a.at(-1)))));
    assert.equal(fs.existsSync(`${f.directory}/server-cache`), false);
  }));
