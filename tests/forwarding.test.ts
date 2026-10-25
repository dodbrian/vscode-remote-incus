import { test } from 'node:test';
import type * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerCommands } from '../src/commands';
import { FolderHistory } from '../src/history';
import { InstancesTree } from '../src/tree';
import { withFixture, Fixture } from './support/fixture';
import { context } from './support/scenario';
import { defined } from './support/assert';

const commandId = 'remote-incus.forwardPortIPv4';
function setup(f: Fixture): {
  run: (row?: unknown) => Promise<void>;
  ctx: ReturnType<typeof context>;
} {
  f.state.set('authority', 'incus+second:same');
  const ctx = context(f);
  const history = new FolderHistory(ctx);
  registerCommands(ctx, new InstancesTree(history, 'assets'), history);
  const callbacks = f.state.get('commands') as Map<string, (row?: unknown) => Promise<void>>;
  assert.ok(callbacks.has(commandId), 'the detected-port command must be registered');
  return { run: defined(callbacks.get(commandId)), ctx };
}
const row = { tunnelType: 'Candidate', remoteHost: '127.0.0.1', remotePort: 8123 };
function tunnel(): vscode.TunnelDescription & { dispose(): void } {
  return {
    remoteAddress: { host: '::ffff:127.0.0.1', port: 8123 },
    localAddress: { host: '127.0.0.1', port: 18123 },
    dispose() {
      /* fixture-owned tunnel */
    },
  };
}

for (const host of ['127.0.0.1', 'localhost', '0.0.0.0']) {
  test(`IPv4 helper uses detected ${host} port without prompting`, (t) =>
    withFixture(t, async (f) => {
      const { run, ctx } = setup(f);
      f.expect('vscode.tunnels', () => Promise.resolve([]));
      const opened = tunnel();
      f.expect('vscode.openTunnel', (options) => {
        assert.deepEqual(options, {
          remoteAddress: { host: '::ffff:127.0.0.1', port: 8123 },
          privacy: 'private',
        });
        return Promise.resolve(opened);
      });
      await run({ ...row, remoteHost: host });
      assert.ok(ctx.subscriptions.includes(opened));
      assert.ok(!f.calls.some((call) => /child_process|input|quickPick/i.test(call.name)));
    }));
}

test('IPv4 helper keeps forwarded-row metadata without replacing the old tunnel', (t) =>
  withFixture(t, async (f) => {
    const { run } = setup(f);
    f.expect('vscode.tunnels', () =>
      Promise.resolve([
        { remoteAddress: { host: '127.0.0.1', port: 8123 }, localAddress: '127.0.0.1:8123' },
      ]),
    );
    f.expect('vscode.openTunnel', (options) => {
      assert.deepEqual(options, {
        remoteAddress: { host: '::ffff:127.0.0.1', port: 8123 },
        localAddressPort: 8123,
        label: 'web',
        protocol: 'https',
        privacy: 'private',
      });
      return Promise.resolve(tunnel());
    });
    await run({ ...row, tunnelType: 'Forwarded', localPort: 8123, name: 'web', protocol: 'https' });
  }));

for (const invalid of [
  undefined,
  {},
  { ...row, remotePort: 0 },
  { ...row, remotePort: 65536 },
  { ...row, remotePort: '8123' },
  { ...row, remoteHost: '::1' },
  { ...row, remoteHost: '192.0.2.1' },
  { ...row, tunnelType: 'Add' },
]) {
  test(`IPv4 helper rejects invalid or non-IPv4 selection ${JSON.stringify(invalid)}`, (t) =>
    withFixture(t, async (f) => {
      const { run } = setup(f);
      f.expect('vscode.error', (message) => {
        assert.match(message, /Ports view|IPv4 loopback/);
      });
      await run(invalid);
    }));
}

test('IPv4 helper refuses a different remote window', (t) =>
  withFixture(t, async (f) => {
    const { run } = setup(f);
    f.state.set('authority', 'ssh-remote+other');
    f.expect('vscode.error', (message) => {
      assert.match(message, /Incus/);
    });
    await run(row);
  }));

test('IPv4 helper reuses an existing mapped tunnel and reopens after UI closure', (t) =>
  withFixture(t, async (f) => {
    const { run } = setup(f);
    f.expect('vscode.tunnels', () => Promise.resolve([tunnel()]));
    await run(row);
    f.expect('vscode.tunnels', () => Promise.resolve([]));
    f.expect('vscode.openTunnel', () => Promise.resolve(tunnel()));
    await run(row);
  }));

test('IPv4 helper surfaces core failure and permits retry', (t) =>
  withFixture(t, async (f) => {
    const { run } = setup(f);
    f.routes.set('vscode.tunnels', () => Promise.resolve([]));
    f.expect('vscode.openTunnel', () => Promise.reject(new Error('forwarding refused')));
    f.expect('vscode.error', (message) => {
      assert.match(message, /forwarding refused/);
    });
    await run(row);
    f.expect('vscode.openTunnel', () => Promise.resolve(undefined));
    f.expect('vscode.error', (message) => {
      assert.match(message, /did not create/);
    });
    await run(row);
    f.expect('vscode.openTunnel', () => Promise.resolve(tunnel()));
    await run(row);
  }));

test('IPv4 helper is attached to a single selected Incus Ports row', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.ok(manifest.enabledApiProposals.includes('tunnels'));
  const menu = manifest.contributes.menus['ports/item/context'].find(
    (item: any) => item.command === commandId,
  );
  assert.match(menu.when, /remoteName == incus/);
  assert.match(menu.when, /tunnelType/);
  assert.match(menu.when, /tunnelViewSelection/);
  const hostPattern = new RegExp(defined(/tunnelViewSelection =~ \/(.*)\/$/.exec(menu.when)?.[1]));
  for (const selected of ['127.0.0.1:8123', 'localhost:8123', '0.0.0.0:8123'])
    assert.ok(hostPattern.test(selected));
  for (const selected of ['::1:8123', '192.0.2.1:8123', '127x0x0x1:8123', '::ffff:127.0.0.1:8123'])
    assert.ok(!hostPattern.test(selected));
  // Manifest equality parses undefined as a string; absence uses negation.
  assert.doesNotMatch(menu.when, /==\s*undefined/);
  assert.match(menu.when, /!tunnelViewMultiSelection/);
  assert.ok(
    manifest.contributes.menus.commandPalette.some(
      (item: any) => item.command === commandId && item.when === 'false',
    ),
  );
});

test('IPv4 helper deduplicates overlapping clicks for the same detected port', (t) =>
  withFixture(t, async (f) => {
    const { run } = setup(f);
    let release: () => void = () => {
      assert.fail('tunnel list was not requested');
    };
    f.expect(
      'vscode.tunnels',
      () =>
        new Promise<never[]>((resolve) => {
          release = () => {
            resolve([]);
          };
        }),
    );
    f.expect('vscode.openTunnel', () => Promise.resolve(tunnel()));
    const first = run(row);
    const second = run(row);
    release();
    await Promise.all([first, second]);
  }));

test('IPv4 helper rejects a remote change while the tunnel list is pending', (t) =>
  withFixture(t, async (f) => {
    const { run } = setup(f);
    f.expect('vscode.tunnels', () => {
      f.state.set('authority', 'incus+different:instance');
      return Promise.resolve([]);
    });
    f.expect('vscode.error', (message) => {
      assert.match(message, /remote changed/);
    });
    await run(row);
  }));
