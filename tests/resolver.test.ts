import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IncusAuthorityResolver } from '../src/resolver';
import { childProcess, withFixture } from './support/fixture';
import { context, installedServer, progress } from './support/scenario';
import { defined } from './support/assert';

for (const status of ['Running', 'Stopped', 'still-stopped', 'absent', 'daemon-failure'] as const)
  test(`C1 C2 C3 X7: resolver ${status}`, (t) =>
    withFixture(t, async (f) => {
      const operations = installedServer(f);
      const bootstrap = defined(f.routes.get('child_process.execFile'));
      const reports = progress(f);
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
    await assert.rejects(
      new IncusAuthorityResolver(context(f)).resolve('incus+selected:same', {} as any),
      /enable-proposed-api/,
    );
    assert.deepEqual(f.calls, []);
  }));
