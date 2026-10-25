import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IncusAuthorityResolver, toResolverError } from '../src/resolver';
import { childProcess, withFixture } from './support/fixture';
import { COMMIT, context, installedServer, progress } from './support/scenario';
import * as vscode from 'vscode';
import { defined } from './support/assert';

for (const status of ['Running', 'Stopped', 'still-stopped', 'absent', 'daemon-failure'] as const)
  test(`C1 C2 C3 X7: resolver ${status}`, (t) =>
    withFixture(t, async (f) => {
      const logs: string[] = [];
      t.mock.method(console, 'log', (...args: unknown[]) => logs.push(args.join(' ')));
      const operations = installedServer(f);
      const bootstrap = defined(f.routes.get('child_process.execFile'));
      const reports = progress(f);
      f.expect('vscode.execute', (...args) => {
        assert.deepEqual(args, ['setContext', 'forwardedPortsViewEnabled', true]);
        return Promise.resolve();
      });
      let checks = 0;
      let starts = 0;
      f.routes.set('child_process.execFile', (cmd, args, opts, cb) => {
        if (args[0] === 'remote') {
          assert.deepEqual(args, ['remote', 'get-default']);
          cb(null, 'selected\n', '');
        } else if (args[0] === 'list') {
          assert.deepEqual(args, ['list', 'selected:', 'same', '--format', 'json']);
          checks++;
          if (status === 'daemon-failure') cb(new Error('daemon refused'), '', 'daemon refused');
          else
            cb(
              null,
              JSON.stringify(
                status === 'absent'
                  ? []
                  : [
                      {
                        name: 'same',
                        status:
                          status === 'Running' || (checks > 1 && status === 'Stopped')
                            ? 'Running'
                            : 'Stopped',
                      },
                    ],
              ),
              '',
            );
        } else if (args[0] === 'start') {
          assert.deepEqual(args, ['start', 'selected:same']);
          starts++;
          cb(null, '', '');
        } else bootstrap(cmd, args, opts, cb);
      });
      const pending = new IncusAuthorityResolver(context(f)).resolve('incus+same', {} as any);
      if (status === 'absent' || status === 'daemon-failure' || status === 'still-stopped') {
        await assert.rejects(pending, (err: any) => {
          if (status === 'still-stopped') assert.equal(err.code, 'TemporarilyNotAvailable');
          else assert.match(err.message, status === 'absent' ? /not found/ : /daemon refused/);
          return true;
        });
        assert.equal(operations.length, 0);
        assert.ok(!reports.some((r) => r.message === 'ready'));
      } else {
        const result = (await pending) as any;
        assert.equal(typeof result.makeConnection, 'function');
        assert.equal(result.connectionToken.length, 43);
        const readyLog = defined(logs.find((line) => line.includes('server ready on ')));
        const resolvedLog = defined(logs.find((line) => line.includes('resolved incus+same:')));
        for (const line of [readyLog, resolvedLog]) {
          assert.doesNotMatch(line, /alice|1001|1002|\/home\/|user |uid /);
          assert.ok(!line.includes(result.connectionToken));
        }
        assert.equal(reports.at(-1)?.message, 'ready');
        const bootstrapOperations = operations.length;
        const bridges: unknown[] = [];
        f.routes.set('child_process.spawn', (_cmd, args) => {
          assert.equal(args[0], 'exec');
          assert.equal(args[1], 'selected:same');
          const child = childProcess();
          bridges.push(child);
          return child;
        });
        const first = await result.makeConnection();
        const second = await result.makeConnection();
        assert.notEqual(first, second);
        assert.equal(bridges.length, 2);
        assert.equal(
          operations.length,
          bootstrapOperations,
          'makeConnection must not bootstrap again',
        );
        assert.ok(
          operations.every((a) =>
            a[0] === 'file'
              ? defined(a[3]).startsWith('selected:same/')
              : defined(a[1]) === 'selected:same',
          ),
        );
      }
      assert.equal(starts, status === 'Stopped' || status === 'still-stopped' ? 1 : 0);
    }));

test('C3: unsupported proposed API fails with setup guidance before external work', (t) =>
  withFixture(t, async (f) => {
    const { setManagedApiAvailable } = await import('./support/vscode');
    setManagedApiAvailable(false);
    f.defer(() => {
      setManagedApiAvailable(true);
    });
    const extensionContext = context(f);
    const extensionId = 'fixture-publisher.remote-incus';
    Object.assign(extensionContext.extension, { id: extensionId });
    await assert.rejects(
      new IncusAuthorityResolver(extensionContext).resolve('incus+selected:same', {} as any),
      (err: Error) => {
        assert.ok(
          err.message.includes(`"enable-proposed-api": ["${extensionId}"]`),
          'setup guidance must identify the running extension',
        );
        return true;
      },
    );
    assert.deepEqual(f.calls, []);
  }));

for (const scenario of [
  { state: undefined, code: 'NotAvailable', starts: 0 },
  { state: 'Starting', code: 'TemporarilyNotAvailable', starts: 0 },
  { state: 'Freezing', code: undefined, starts: 0 },
  { state: 'Frozen', code: undefined, starts: 0 },
  { state: 'Stopped', after: undefined, code: 'NotAvailable', starts: 1 },
  { state: 'Stopped', after: 'Starting', code: 'TemporarilyNotAvailable', starts: 1 },
  { state: 'Stopped', after: 'Error', code: undefined, starts: 1 },
]) {
  test(`resolver taxonomy: ${String(scenario.state)} / ${String(scenario.after)}`, (t) =>
    withFixture(t, async (f) => {
      progress(f);
      f.routes.set('vscode.execute', () => Promise.resolve());
      let checks = 0;
      let starts = 0;
      let refreshes = 0;
      f.routes.set('child_process.execFile', (_cmd, args, _opts, cb) => {
        if (args[0] === 'list') {
          const state = checks++ === 0 ? scenario.state : scenario.after;
          cb(null, JSON.stringify(state ? [{ name: 'same', status: state }] : []), '');
        } else if (args[0] === 'start') {
          starts++;
          cb(null, '', '');
        } else assert.fail(`unexpected operation: ${String(args)}`);
      });
      const resolver = new IncusAuthorityResolver(context(f), () => {
        refreshes++;
      });
      await assert.rejects(resolver.resolve('incus+selected:same', {} as any), (err: any) => {
        assert.equal(err.code, scenario.code);
        assert.match(err.message, /selected:same/);
        return true;
      });
      assert.equal(starts, scenario.starts);
      assert.equal(refreshes, scenario.code === 'NotAvailable' ? 1 : 0);
    }));
}

for (const message of [
  'daemon socket: No such file or directory',
  'incus executable not found',
  'TLS handshake failed',
  'permission denied',
  'timed out',
]) {
  test(`resolver preserves underlying failure: ${message}`, (t) =>
    withFixture(t, async (f) => {
      progress(f);
      f.routes.set('vscode.execute', () => Promise.resolve());
      f.routes.set('child_process.execFile', (_cmd, _args, _opts, cb) => {
        cb(new Error(message), '', message + '\nfull diagnostic detail');
      });
      await assert.rejects(
        new IncusAuthorityResolver(context(f)).resolve('incus+selected:same', {} as any),
        (err: any) => {
          assert.equal(err.code, undefined);
          assert.ok(err.cause instanceof Error);
          assert.match(err.cause.message, /full diagnostic detail/);
          assert.ok(err.message.includes(message));
          return true;
        },
      );
    }));
}

test('resolver mapping preserves explicit taxonomy and cause without guessing from text', () => {
  const original = new Error('dependency not found\nfull detail');
  const mapped = toResolverError(original, 'incus+selected:same');
  assert.equal(mapped.cause, original);
  assert.match(mapped.message, /dependency not found/);
});

test('resolver mapping leaves explicit taxonomy errors intact', () => {
  for (const original of [
    vscode.RemoteAuthorityResolverError.NotAvailable('instance deleted'),
    vscode.RemoteAuthorityResolverError.TemporarilyNotAvailable('starting'),
  ])
    assert.equal(toResolverError(original, 'incus+selected:same'), original);
});

for (const stage of ['start', 'bootstrap'] as const) {
  test(`resolver retains ${stage} failure without retrying`, (t) =>
    withFixture(t, async (f) => {
      progress(f);
      f.routes.set('vscode.execute', () => Promise.resolve());
      f.state.set('commit', COMMIT);
      const failedOperations = new Set<string>();
      f.routes.set('child_process.execFile', (_cmd, args, _opts, cb) => {
        if (args[0] === 'list') {
          cb(
            null,
            JSON.stringify([{ name: 'same', status: stage === 'start' ? 'Stopped' : 'Running' }]),
            '',
          );
        } else {
          const operation = JSON.stringify(args);
          assert.ok(!failedOperations.has(operation), 'failed operation must not be retried');
          failedOperations.add(operation);
          cb(new Error('failure'), '', 'permission denied\nfull detail');
        }
      });
      await assert.rejects(
        new IncusAuthorityResolver(context(f)).resolve('incus+selected:same', {} as any),
        (err: any) => {
          assert.equal(err.code, undefined);
          assert.ok(err.cause instanceof Error);
          assert.match(err.cause.message, /full detail/);
          return true;
        },
      );
      assert.ok(failedOperations.size > 0);
    }));
}
