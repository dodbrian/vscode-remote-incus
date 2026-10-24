import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withFixture } from './support/fixture';
import { COMMIT, TOKEN, context, identity, installedServer, passwd } from './support/scenario';
import { defined } from './support/assert';
import {
  ensureServerReady,
  probeFlavor,
  resolveClientCommit,
  resolveIdentity,
} from '../src/bootstrap';

let counter = 0;
const ref = (): { remote: string; instance: string } => ({
  remote: `offline-${++counter}`,
  instance: 'same',
});

test('C1 C4: identity is exact, cached per full target/override; failed override retries', (t) =>
  withFixture(t, async (f) => {
    f.routes.set('child_process.execFile', (_cmd, _args, _opts, cb) => cb(null, passwd, ''));
    const a = ref();
    const b = { ...a, remote: `${a.remote}-other` };
    assert.deepEqual(await resolveIdentity(a), identity);
    assert.deepEqual(await resolveIdentity(a), identity);
    assert.equal(f.calls.length, 1);
    await resolveIdentity(b);
    assert.equal(f.calls.length, 2);
    for (const override of ['alice', '1001']) {
      f.configuration.set('remote-incus.user', override);
      assert.deepEqual(await resolveIdentity(a), identity);
    }
    f.configuration.set('remote-incus.user', 'missing');
    await assert.rejects(resolveIdentity(a), /not found/);
    await assert.rejects(resolveIdentity(a), /not found/);
    f.configuration.set('remote-incus.user', 'root');
    assert.equal((await resolveIdentity(a)).uid, 0);
  }));

for (const [output, expected] of [
  ['x86_64\nglibc', 'linux-x64'],
  ['aarch64\nglibc', 'linux-arm64'],
  ['x86_64\nmusl', 'linux-alpine'],
  ['aarch64\nmusl', undefined],
  ['riscv64\nglibc', undefined],
] as const)
  test(`C7: flavor ${output.replace('\n', '/')}`, (t) =>
    withFixture(t, async (f) => {
      f.expect('child_process.execFile', (_cmd, args, _opts, cb) => {
        assert.ok(args.includes('1001'));
        assert.ok(args.includes('HOME=/home/alice'));
        cb(null, output, '');
      });
      if (expected) assert.equal(await probeFlavor(ref(), identity), expected);
      else await assert.rejects(probeFlavor(ref(), identity), /unsupported/);
    }));

test('C7: API commit wins, invalid API falls back, missing commit fails', (t) =>
  withFixture(t, async (f) => {
    f.state.set('commit', COMMIT.toUpperCase());
    assert.equal(await resolveClientCommit(), COMMIT);
    f.state.set('commit', 'invalid');
    f.expect('child_process.execFile', (_cmd, args, _opts, cb) => {
      assert.deepEqual(args, ['--version']);
      cb(null, `1.0\n${COMMIT}\nx64`, '');
    });
    assert.equal(await resolveClientCommit(), COMMIT);
    for (let i = 0; i < 2; i++)
      f.expect('child_process.execFile', (_cmd, _args, _opts, cb) => cb(null, 'bad', ''));
    await assert.rejects(resolveClientCommit(), /could not determine/);
  }));

test('C5 C8 C11 C12 C13 B5: installed healthy reuse skips all tarball work and kills, deduplicates, skips cleanup', (t) =>
  withFixture(t, async (f) => {
    const operations = installedServer(f, { pruneError: true });
    const target = ref();
    const ctx = context(f);
    const reports: string[] = [];
    const [a, b] = await Promise.all([
      ensureServerReady(ctx, target, (m) => reports.push(m)),
      ensureServerReady(ctx, target),
    ]);
    assert.deepEqual(a, b);
    assert.equal(a.port, 4567);
    assert.equal(a.token, TOKEN);
    assert.equal(operations.filter((a) => a[0] === 'file').length, 0);
    assert.ok(
      !operations.some((a) =>
        /nohup|pkill|tar -x|sha256sum.*vscode-server-linux/.test(defined(a.at(-1))),
      ),
    );
    assert.ok(!operations.some((a) => defined(a.at(-1)).includes('cd ')));
    assert.equal(reports.at(-1), 'ready');
    f.state.set('commit', 'b'.repeat(40));
    assert.equal((await ensureServerReady(ctx, target)).commit, 'b'.repeat(40));
    assert.equal(operations.filter((a) => a[0] === 'file').length, 0);
  }));

for (const mode of ['absent', 'stale', 'unhealthy'] as const)
  test(`C9 C10: ${mode} process launches selected server and sweeps obsolete relays`, (t) =>
    withFixture(t, async (f) => {
      const ops = installedServer(f, {
        running: mode === 'absent' ? '' : mode === 'stale' ? 'c'.repeat(40) : COMMIT,
        healthy: mode !== 'unhealthy',
      });
      await ensureServerReady(context(f), ref());
      const launches = ops.filter((a) => defined(a.at(-1)).includes('nohup'));
      assert.equal(launches.length, 1);
      const launch = defined(launches[0]);
      assert.ok(launch.includes('1001'));
      assert.ok(launch.includes('HOME=/home/alice'));
      for (const flag of ['--host 127.0.0.1', '--port 0', '--connection-token-file'])
        assert.ok(defined(launch.at(-1)).includes(flag));
      assert.ok(ops.some((a) => defined(a.at(-1)).includes('relay\\.js')));
      assert.equal(
        ops.filter(
          (a) => defined(a.at(-1)).startsWith('pkill') && defined(a.at(-1)).includes('main'),
        ).length,
        mode === 'absent' ? 0 : 1,
      );
    }));

test('C6 C12: signal failure precedes transfer/start; retry and a different target work independently', (t) =>
  withFixture(t, async (f) => {
    const target = ref();
    const ctx = context(f);
    const ops = installedServer(f, { signal: 'no' });
    const results = await Promise.allSettled([
      ensureServerReady(ctx, target),
      ensureServerReady(ctx, target),
    ]);
    assert.ok(
      results.every((r) => r.status === 'rejected' && String(r.reason).includes('signal syscalls')),
    );
    assert.equal(ops.filter((a) => defined(a.at(-1)).startsWith('kill -0')).length, 1);
    assert.ok(!ops.some((a) => a[0] === 'file' || defined(a.at(-1)).includes('nohup')));
    installedServer(f);
    const [a, b] = await Promise.all([
      ensureServerReady(ctx, target),
      ensureServerReady(ctx, { ...target, remote: `${target.remote}-other` }),
    ]);
    assert.notEqual(a.ref.remote, b.ref.remote);
  }));

test('C11: empty token rejects before ready', (t) =>
  withFixture(t, async (f) => {
    installedServer(f, { token: '' });
    const reports: string[] = [];
    await assert.rejects(
      ensureServerReady(context(f), ref(), (m) => reports.push(m)),
      /connection token/,
    );
    assert.ok(!reports.includes('ready'));
  }));

for (const transfer of [
  'matching',
  'missing',
  'mismatch',
  'corrupt-after-push',
  'extract-fails',
] as const)
  test(`B2 C5: archive ${transfer}`, (t) =>
    withFixture(t, async (f) => {
      const { createHash } = await import('node:crypto');
      const sha = createHash('sha256').update('archive').digest('hex');
      f.expect('fetch', () => new Response('archive'));
      const ops = installedServer(f, {
        installed: false,
        running: '',
        remoteSha: transfer === 'matching' ? sha : transfer === 'mismatch' ? 'wrong' : '',
        pushedSha: transfer === 'corrupt-after-push' ? 'wrong' : sha,
        extractionError: transfer === 'extract-fails',
      });
      const pending = ensureServerReady(context(f), ref());
      if (transfer === 'corrupt-after-push' || transfer === 'extract-fails') {
        await assert.rejects(
          pending,
          transfer === 'extract-fails' ? /extract failed/ : /corrupted in transit/,
        );
        assert.ok(!ops.some((a) => defined(a.at(-1)).includes('nohup')));
        if (transfer === 'corrupt-after-push')
          assert.ok(!ops.some((a) => defined(a.at(-1)).includes('tar -xzf')));
      } else {
        await pending;
        const extract = defined(ops.find((a) => defined(a.at(-1)).includes('tar -xzf')));
        assert.ok(extract.includes('1001'));
        assert.ok(extract.includes('HOME=/home/alice'));
      }
      const pushes = ops.filter((a) => a[0] === 'file' && defined(a[2]).endsWith('.tar.gz'));
      assert.equal(pushes.length, transfer === 'matching' ? 0 : 1);
    }));

async function settleTurn(): Promise<void> {
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });
}

test('C11: delayed logs eventually succeed; no announcement fails with diagnostics', (t) =>
  withFixture(t, async (f) => {
    for (const announce of [true, false]) {
      let polls = 0;
      installedServer(f, {
        running: '',
        hook: (_args, script) =>
          script.startsWith('grep -s')
            ? ++polls >= 3 && announce
              ? 'Extension host agent listening on 9876\nINCUS_TOKEN\n' + TOKEN
              : ''
            : undefined,
      });
      const pending = ensureServerReady(context(f), ref());
      let done = false;
      const observed = pending.then(
        (value) => {
          done = true;
          return value;
        },
        (error: unknown) => {
          done = true;
          throw error;
        },
      );
      // Attach rejection before advancing clocks; source filesystem I/O uses real
      // event loop turns while its bounded port waiting uses the fixture clock.
      const checked = announce
        ? observed.then((s) => {
            assert.equal(s.port, 9876);
          })
        : assert.rejects(observed, /server did not announce.*\nfixture startup diagnostic/);
      for (let turn = 0; !done && turn < 1000; turn++) {
        t.mock.timers.tick(500);
        await settleTurn();
        // fs operations need a real event-loop turn, outside intercepted timers.
        await new Promise<void>((resolve) => {
          process.nextTick(resolve);
        });
        if (turn % 10 === 0) await (await import('node:fs/promises')).stat(f.directory);
      }
      assert.equal(done, true, 'bounded fixture completion');
      await checked;
      assert.ok(polls >= (announce ? 3 : 120));
    }
  }));

test('B4: sticky token remains out of process args; explicit reset kills, removes token and bootstraps', (t) =>
  withFixture(t, async (f) => {
    const { resetToken } = await import('../src/bootstrap');
    let removed = false;
    const ops = installedServer(f, {
      running: '',
      hook: (_args, script) => {
        if (script.startsWith('rm -f ') && script.includes('.incus-conn-token')) {
          removed = true;
          return '';
        }
        return undefined;
      },
    });
    const target = ref();
    const session = await resetToken(context(f), target);
    assert.equal(removed, true);
    assert.equal(session.token, TOKEN);
    assert.ok(
      ops.some((a) => defined(a.at(-1)).startsWith('pkill') && defined(a.at(-1)).includes('main')),
    );
    assert.ok(ops.every((a) => !a.join(' ').includes(TOKEN)));
    const tokenSetup = defined(ops.find((a) => defined(a.at(-1)).includes('fresh token minted')));
    assert.ok(tokenSetup.includes('1001'));
    assert.ok(tokenSetup.includes('HOME=/home/alice'));
    // Script invocation only: actual minting, mode and atomic rename require S/I.
  }));

test('C1 C12: another remote progresses while same-named target identity is pending', (t) =>
  withFixture(t, async (f) => {
    installedServer(f);
    const dispatch = defined(f.routes.get('child_process.execFile'));
    const a = ref();
    const b = { ...a, remote: `${a.remote}-independent` };
    let release!: () => void;
    f.routes.set('child_process.execFile', (cmd, args, opts, cb) => {
      if (args[1] === `${a.remote}:${a.instance}` && defined(args.at(-1)).startsWith('getent'))
        release = () => dispatch(cmd, args, opts, cb);
      else dispatch(cmd, args, opts, cb);
    });
    const ctx = context(f);
    const pending = ensureServerReady(ctx, a);
    const independent = await ensureServerReady(ctx, b);
    assert.deepEqual(independent.ref, b);
    assert.equal(typeof release, 'function');
    release();
    assert.deepEqual((await pending).ref, a);
  }));

test('C13: local cache pruning preserves current commit and unrelated data', (t) =>
  withFixture(t, async (f) => {
    const { mkdirSync, writeFileSync, existsSync } = await import('node:fs');
    const dir = `${f.directory}/server-cache`;
    mkdirSync(dir);
    const keep = `${dir}/vscode-server-linux-x64-${COMMIT}.tar.gz`;
    const old = `${dir}/vscode-server-linux-x64-${'d'.repeat(40)}.tar.gz`;
    const unrelated = `${dir}/notes.txt`;
    for (const file of [keep, old, unrelated]) writeFileSync(file, 'fixture');
    installedServer(f, { running: '' });
    await ensureServerReady(context(f), ref());
    assert.equal(existsSync(keep), true);
    assert.equal(existsSync(unrelated), true);
    assert.equal(existsSync(old), false);
  }));

for (const broken of [false, true])
  test(`B5: relay repair is verified before ready (verification failure=${String(broken)})`, (t) =>
    withFixture(t, async (f) => {
      const ops = installedServer(f, { relayCurrent: false, relayVerifyError: broken });
      const pending = ensureServerReady(context(f), ref());
      if (broken) await assert.rejects(pending, /relay verification failed/);
      else await pending;
      assert.equal(ops.filter((a) => a[0] === 'file').length, 1);
      assert.ok(
        ops.some(
          (a) => defined(a.at(-1)).startsWith('test -f') && defined(a.at(-1)).includes('sha256sum'),
        ),
      );
      if (broken) assert.ok(!ops.some((a) => defined(a.at(-1)).startsWith('grep -s')));
    }));

test('C13: fresh startup tolerates install prune failure', (t) =>
  withFixture(t, async (f) => {
    const ops = installedServer(f, { running: '', pruneError: true });
    const session = await ensureServerReady(context(f), ref());
    assert.equal(session.port, 4567);
    assert.ok(ops.some((a) => defined(a.at(-1)).includes('cd ')));
  }));

for (const [running, budget] of [
  [COMMIT, 3],
  ['', 7],
] as const)
  test(`performance: installed server (${running ? 'healthy' : 'stopped'}) stays within exec budget without transfers`, (t) =>
    withFixture(t, async (f) => {
      const ops = installedServer(f, { running });
      const target = ref();
      const ctx = context(f);
      await resolveIdentity(target);
      ops.length = 0;
      await ensureServerReady(ctx, target);
      // Deterministic budgets with warm identity, independent of daemon speed.
      // Safety tests independently protect identity, signals, health and lifecycle.
      assert.ok(ops.length <= budget);
      assert.ok(ops.every((a) => a[0] === 'exec'));
    }));

test('batched inspection preserves UID boundaries and waits for both snapshots before repair', (t) =>
  withFixture(t, async (f) => {
    const ops = installedServer(f);
    const dispatch = defined(f.routes.get('child_process.execFile'));
    let release!: () => void;
    f.routes.set('child_process.execFile', (cmd, args, opts, cb) => {
      const script = args.at(-1) as string;
      if (script.startsWith('pgrep')) {
        assert.ok(!args.includes('--user'));
        release = () => dispatch(cmd, args, opts, cb);
      } else {
        if (script.includes('INCUS_INSTALL')) {
          assert.ok(args.includes('1001') && args.includes('HOME=/home/alice'));
          assert.ok(
            !script.includes('server-main.js'),
            'parallel probe must not resemble a running server',
          );
        }
        dispatch(cmd, args, opts, cb);
      }
    });
    const pending = ensureServerReady(context(f), ref());
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.equal(typeof release, 'function');
    assert.ok(!ops.some((a) => /fresh token minted|nohup|pkill/.test(defined(a.at(-1)))));
    release();
    await pending;
  }));

test('malformed inspection cannot become server absence or allow setup', (t) =>
  withFixture(t, async (f) => {
    const ops = installedServer(f, {
      hook: (_args, script) => (script.startsWith('pgrep') ? 'malformed' : undefined),
    });
    await assert.rejects(ensureServerReady(context(f), ref()), /invalid server inspection/);
    assert.ok(
      !ops.some((a) => a[0] === 'file' || /fresh token minted|nohup|pkill/.test(defined(a.at(-1)))),
    );
  }));
