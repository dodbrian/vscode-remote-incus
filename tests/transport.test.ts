import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childProcess, withFixture } from './support/fixture';
import {
  execInInstance,
  getInstanceStatus,
  listRemotes,
  pushFile,
  startInstance,
  stopInstance,
  restartInstance,
} from '../src/incusCli';
import { parseAuthority, formatAuthority } from '../src/authority';
import { openBridge } from '../src/bridge';
import { COMMIT, TOKEN, identity } from './support/scenario';
import { defined } from './support/assert';
const ref = { remote: 'second', instance: 'same' };

test('C1 C2: authority, separate list filter and exact status, absence versus malformed/CLI failure', (t) =>
  withFixture(t, async (f) => {
    assert.deepEqual(parseAuthority(formatAuthority(ref)), ref);
    assert.deepEqual(parseAuthority('incus+same'), { instance: 'same' });
    assert.throws(() => parseAuthority('ssh+same'), /unsupported/);
    for (const [output, status] of [
      ['[{"name":"same-other","status":"Running"}]', undefined],
      ['[{"name":"same-other","status":"Running"},{"name":"same","status":"Stopped"}]', 'Stopped'],
    ] as const) {
      f.expect('child_process.execFile', (cmd, args, _opts, cb) => {
        assert.equal(cmd, 'incus');
        assert.deepEqual(args, ['list', 'second:', 'same', '--format', 'json']);
        cb(null, output, '');
      });
      assert.equal(await getInstanceStatus(ref), status);
    }
    f.expect('child_process.execFile', (_cmd, _args, _opts, cb) => cb(null, '{bad', ''));
    await assert.rejects(getInstanceStatus(ref), SyntaxError);
    f.expect('child_process.execFile', (_cmd, _args, _opts, cb) =>
      cb({ code: 1 }, '', 'daemon unavailable'),
    );
    await assert.rejects(getInstanceStatus(ref), /daemon unavailable/);
  }));

test('C1 C5 X8: lifecycle and exec target full remote, numeric user, HOME and noninteractive pipes', (t) =>
  withFixture(t, async (f) => {
    for (const [name, fn] of [
      ['start', startInstance],
      ['stop', stopInstance],
      ['restart', restartInstance],
    ] as const) {
      f.expect('child_process.execFile', (_cmd, args, _opts, cb) => {
        assert.deepEqual(args, [name, 'second:same']);
        cb(null, '', '');
      });
      await fn(ref);
    }
    f.expect('child_process.execFile', (_cmd, args, _opts, cb) => {
      assert.deepEqual(args, [
        'exec',
        'second:same',
        '--mode',
        'non-interactive',
        '--user',
        '1001',
        '--env',
        'HOME=/home/alice',
        '--',
        'bash',
        '-c',
        'printf ok',
      ]);
      cb(null, 'ok', '');
    });
    assert.equal(await execInInstance(ref, 'printf ok', identity), 'ok'); // uid and home are structurally compatible
  }));

test('X6: simplestreams excluded', (t) =>
  withFixture(t, async (f) => {
    f.expect('child_process.execFile', (_cmd, _args, _opts, cb) =>
      cb(
        null,
        JSON.stringify({
          good: { Protocol: 'incus', Addr: 'tls' },
          images: { Protocol: 'simplestreams' },
        }),
        '',
      ),
    );
    assert.deepEqual(
      (await listRemotes()).map((r) => r.name),
      ['good'],
    );
  }));

for (const exit of [0, 2, 'SIGTERM'] as const)
  test(`T1 T3: binary bridge and terminal event ${exit}`, (t) =>
    withFixture(t, async (f) => {
      let child!: ReturnType<typeof childProcess>;
      f.expect('child_process.spawn', (cmd, args, opts) => {
        assert.equal(cmd, 'incus');
        assert.deepEqual(opts.stdio, ['pipe', 'pipe', 'pipe']);
        assert.deepEqual(args, [
          'exec',
          'second:same',
          '--mode',
          'non-interactive',
          '--user',
          '1001',
          '--env',
          'HOME=/home/alice',
          '--env',
          'RELAY_HOST=127.0.0.1',
          '--env',
          'RELAY_PORT=4567',
          '--',
          `/home/alice/.vscode-server/bin/${COMMIT}/node`,
          '/home/alice/.vscode-server/relay.js',
        ]);
        return (child = childProcess());
      });
      const bridge = await openBridge({
        ref,
        identity,
        commit: COMMIT,
        flavor: 'linux-x64',
        port: 4567,
        token: TOKEN,
      });
      const incoming: Uint8Array[] = [];
      const outgoing: Buffer[] = [];
      const closures: unknown[] = [];
      bridge.onDidReceiveMessage((d) => incoming.push(d));
      bridge.onDidEnd(() => closures.push('end'));
      bridge.onDidClose((e) => closures.push(e));
      child.stdin.on('data', (d) => outgoing.push(d));
      const bytes = new Uint8Array([0, 255, 128, 10]);
      bridge.send(bytes);
      child.stdout.write(Buffer.from(bytes));
      child.stderr.write('diagnostic');
      assert.deepEqual([...defined(incoming[0])], [...bytes]);
      assert.deepEqual([...Buffer.concat(outgoing)], [...bytes]);
      assert.equal(incoming.length, 1);
      child.emit(
        'exit',
        typeof exit === 'number' ? exit : null,
        typeof exit === 'string' ? exit : null,
      );
      // Cleanup is required after stdio closes; bytes between exit and close
      // remain valid and are covered by the separate known-defect test.
      child.emit(
        'close',
        typeof exit === 'number' ? exit : null,
        typeof exit === 'string' ? exit : null,
      );
      assert.equal(closures.length, 1);
      if (exit === 0) assert.equal(closures[0], 'end');
      else assert.match(String(closures[0]), /bridge died/);
      child.stdout.write('late');
      assert.equal(incoming.length, 1);
    }));

test('T1 T2 U portion: channels independent; end closes only its input', (t) =>
  withFixture(t, async (f) => {
    const children: ReturnType<typeof childProcess>[] = [];
    f.routes.set('child_process.spawn', () => {
      const child = childProcess();
      children.push(child);
      return child;
    });
    const session = {
      ref,
      identity,
      commit: COMMIT,
      flavor: 'linux-x64' as const,
      port: 4567,
      token: TOKEN,
    };
    const [a, b] = await Promise.all([openBridge(session), openBridge(session)]);
    let data: Uint8Array | undefined;
    b.onDidReceiveMessage((d) => (data = d));
    a.end();
    assert.equal(defined(children[0]).stdin.writableEnded, true);
    assert.equal(defined(children[1]).stdin.writableEnded, false);
    defined(children[0]).emit('exit', 0, null);
    defined(children[1]).stdout.write(Buffer.from([255]));
    assert.deepEqual([...(data ?? [])], [255]);
  }));

for (const outcome of ['success', 'error', 'nonzero', 'timeout'] as const)
  test(`B6: meter monotonic and push ${outcome} settles with timers stopped`, (t) =>
    withFixture(t, async (f) => {
      let child!: ReturnType<typeof childProcess>;
      let killed = 0;
      f.expect('child_process.spawn', (_cmd, args) => {
        assert.deepEqual(args.slice(0, 4), [
          'file',
          'push',
          `${f.directory}/missing`,
          'second:same/tmp/archive',
        ]);
        child = childProcess();
        child.kill = () => {
          killed++;
          return true;
        };
        return child;
      });
      const values: number[] = [];
      const pending = pushFile(ref, `${f.directory}/missing`, '/tmp/archive', {
        onProgress: (p) => values.push(p),
      });
      const checked =
        outcome === 'success' ? pending : assert.rejects(pending, /failed|timeout|timed out|spawn/);
      child.stdout.write('20% 10%');
      child.stderr.write('80% 70%');
      if (outcome === 'timeout') t.mock.timers.tick(15 * 60_000);
      else if (outcome === 'error') child.emit('error', new Error('spawn failed'));
      else child.emit('close', outcome === 'success' ? 0 : 2);
      await checked;
      assert.deepEqual(values, [20, 80]);
      t.mock.timers.tick(20 * 60_000);
      assert.equal(killed, outcome === 'timeout' ? 1 : 0);
    }));

test('B6: silent push uses file sizes monotonically, tolerates stat failure, stops new polls', (t) =>
  withFixture(t, async (f) => {
    const { writeFileSync } = await import('node:fs');
    const file = `${f.directory}/archive`;
    writeFileSync(file, Buffer.alloc(100));
    let child!: ReturnType<typeof childProcess>;
    const values: number[] = [];
    let polls = 0;
    f.expect('child_process.spawn', () => (child = childProcess()));
    f.routes.set('child_process.execFile', (_cmd, args, _opts, cb) => {
      assert.equal(args[1], 'second:same');
      assert.match(args.at(-1), /stat -c %s/);
      polls++;
      if (polls === 2) cb(new Error('transient'), '', 'transient');
      else cb(null, String(polls === 1 ? 25 : polls === 3 ? 10 : 75), '');
    });
    const pending = pushFile(ref, file, '/tmp/archive', { onProgress: (p) => values.push(p) });
    for (let turn = 0; turn < 4; turn++) {
      await Promise.resolve();
      await Promise.resolve();
      t.mock.timers.tick(1000);
    }
    await Promise.resolve();
    await Promise.resolve();
    child.emit('close', 0);
    await pending;
    const completedPolls = polls;
    t.mock.timers.tick(10_000);
    await Promise.resolve();
    assert.equal(polls, completedPolls);
    assert.deepEqual(values, [25, 75]);
  }));
