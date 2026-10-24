import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { withFixture } from './support/fixture';
import { context, installedServer, identity, COMMIT } from './support/scenario';
import { defined } from './support/assert';
import { ensureServerReady, uninstallServer } from '../src/bootstrap';
const { spawnSync } = createRequire(process.cwd() + '/package.json')(
  'node:child_process',
) as typeof import('node:child_process');
const hostUid = (): number => defined(process.getuid)();
const hostGid = (): number => defined(process.getgid)();
let id = 0;
for (const failure of [
  'token-mkdir',
  'token-mv',
  'token-generator',
  'launch-log',
  'prune',
  'prune-cd',
  'uninstall',
] as const)
  test(`S: ${failure} failure cannot be masked`, (t) =>
    withFixture(t, async (f) => {
      const ops = installedServer(f, { running: '' });
      const ref = { remote: `mutating-${++id}`, instance: 'same' };
      await ensureServerReady(context(f), ref);
      // Capture uninstall without executing either removal on the host.
      if (failure === 'uninstall') {
        f.expect('child_process.execFile', (_cmd, args, _opts, cb) => {
          ops.push(args);
          cb(null, '', '');
        });
        await uninstallServer(ref, identity);
      }
      const script = defined(
        ops
          .map((a) => defined(a.at(-1)))
          .find((s) =>
            failure.startsWith('token')
              ? s.includes('fresh token minted')
              : failure === 'launch-log'
                ? s.includes('nohup')
                : failure.startsWith('prune')
                  ? s.includes('cd ')
                  : s.includes('rm -f /tmp/vscode-server-'),
          ),
      );
      assert.ok(script);
      const home = `${f.directory}/home`;
      const bin = `${home}/.vscode-server/bin`;
      mkdirSync(`${bin}/${COMMIT}/bin`, { recursive: true });
      writeFileSync(`${bin}/${COMMIT}/node`, '#!/bin/sh\nprintf "v24.22.1\\n"\n', { mode: 0o700 });
      writeFileSync(`${bin}/${COMMIT}/bin/code-server`, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
      mkdirSync(`${home}/.vscode-server/data/Machine`, { recursive: true });
      writeFileSync(`${home}/.vscode-server/data/Machine/.incus-conn-token`, '');
      mkdirSync(`${bin}/old-a`);
      mkdirSync(`${bin}/old-b`);
      const local = script
        .replaceAll('/home/alice', home)
        .replaceAll('/tmp/vscode-server-', `${f.directory}/vscode-server-`);
      const prefix =
        failure === 'token-mkdir'
          ? 'mkdir() { return 31; };'
          : failure === 'token-mv'
            ? 'mv() { return 31; };'
            : failure === 'token-generator'
              ? 'tr() { return 31; };'
              : failure === 'launch-log'
                ? 'rm() { return 31; }; nohup() { return 0; };'
                : failure === 'prune-cd'
                  ? 'cd() { return 31; };'
                  : failure === 'prune'
                    ? 'rm() { case "$*" in *old-a*) return 31;; *) command rm "$@";; esac; };'
                    : 'rm() { case "$*" in *.vscode-server*) return 31;; *) return 0;; esac; };';
      const result = spawnSync('/bin/sh', ['-c', `${prefix}\n${local}`], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, `${failure} was hidden by a subsequent successful command`);
      if (failure === 'launch-log')
        assert.equal(result.status, 31, 'log failure must reach rm after prerequisites pass');
    }));

test('S B4: actual token setup mints atomically and preserves a healthy token', (t) =>
  withFixture(t, async (f) => {
    const { readFileSync, statSync, existsSync, chmodSync } = await import('node:fs');
    const ops = installedServer(f, { running: '' });
    await ensureServerReady(context(f), { remote: `token-success-${++id}`, instance: 'same' });
    const script = defined(
      ops.map((a) => defined(a.at(-1))).find((s) => s.includes('fresh token minted')),
    ).replaceAll('/home/alice', `${f.directory}/home`);
    const token = `${f.directory}/home/.vscode-server/data/Machine/.incus-conn-token`;
    assert.equal(spawnSync('/bin/sh', ['-c', script]).status, 0);
    const original = readFileSync(token, 'utf8');
    assert.ok(/^[A-Za-z0-9]{43}$/.test(original), 'token must contain 43 alphanumeric characters');
    assert.equal(statSync(token).uid, hostUid());
    assert.equal(statSync(token).mode & 0o777, 0o600);
    assert.equal(existsSync(`${token}.tmp`), false);
    chmodSync(token, 0o644);
    assert.equal(spawnSync('/bin/sh', ['-c', script]).status, 0);
    assert.ok(readFileSync(token, 'utf8') === original, 'sticky token must be unchanged');
    assert.equal(statSync(token).mode & 0o777, 0o600);
  }));

test('S B5: relay probe requires matching bytes, UID, GID, mode and regular path', (t) =>
  withFixture(t, async (f) => {
    const fs = await import('node:fs');
    const ops = installedServer(f, { running: '' });
    await ensureServerReady(context(f), { remote: `relay-state-${++id}`, instance: 'same' });
    const home = `${f.directory}/home`;
    const relay = `${home}/.vscode-server/relay.js`;
    const script = defined(
      ops.map((a) => defined(a.at(-1))).find((s) => s.includes('fresh token minted')),
    )
      .replaceAll('/home/alice', home)
      .replaceAll('1001:1002:600', `${hostUid()}:${hostGid()}:600`);
    const probe = (source = script): string | undefined => {
      const result = spawnSync('/bin/sh', ['-c', source], { encoding: 'utf8' });
      assert.equal(result.status, 0);
      return result.stdout.trim().split('\n').at(-1);
    };
    assert.equal(probe(), 'relay-repair');
    fs.copyFileSync('assets/relay.js', relay);
    fs.chmodSync(relay, 0o600);
    assert.equal(probe(), 'relay-current');
    fs.chmodSync(relay, 0o644);
    assert.equal(probe(), 'relay-repair');
    fs.chmodSync(relay, 0o600);
    assert.equal(
      probe(script.replace(`${hostUid()}:${hostGid()}:600`, `${hostUid()}:${hostGid() + 1}:600`)),
      'relay-repair',
    );
    assert.equal(
      probe(script.replace(`${hostUid()}:${hostGid()}:600`, `${hostUid() + 1}:${hostGid()}:600`)),
      'relay-repair',
    );
    fs.appendFileSync(relay, '// modified');
    assert.equal(probe(), 'relay-repair');
    const other = `${home}/unrelated.js`;
    fs.writeFileSync(other, 'unrelated data');
    fs.unlinkSync(relay);
    fs.symlinkSync(other, relay);
    assert.equal(probe(), 'relay-repair');
    assert.equal(fs.existsSync(relay), false, 'repair must unlink before push follows the link');
    fs.copyFileSync('assets/relay.js', relay);
    fs.chmodSync(relay, 0o600);
    assert.equal(fs.readFileSync(other, 'utf8'), 'unrelated data');
    assert.equal(probe(), 'relay-current');
    fs.unlinkSync(relay);
    fs.mkdirSync(relay);
    const directoryResult = spawnSync('/bin/sh', ['-c', script], { encoding: 'utf8' });
    assert.notEqual(directoryResult.status, 0, 'a directory must reject before file push');
    assert.ok(
      fs.statSync(relay).isDirectory(),
      'do not recursively delete an unexpected directory',
    );
  }));

test('S C11 B4: combined readiness read uses last port and rejects an empty token', (t) =>
  withFixture(t, async (f) => {
    const fs = await import('node:fs');
    const home = `${f.directory}/home`;
    const machine = `${home}/.vscode-server/data/Machine`;
    fs.mkdirSync(machine, { recursive: true });
    fs.writeFileSync(
      `${machine}/server.log`,
      'Extension host agent listening on 1234\nExtension host agent listening on 9876\n',
    );
    fs.writeFileSync(`${machine}/.incus-conn-token`, 'C'.repeat(43));
    installedServer(f, {
      running: '',
      hook: (args, script) => {
        if (!script.startsWith('grep -s')) return undefined;
        assert.ok(args.includes('1001'));
        assert.ok(args.includes('HOME=/home/alice'));
        const result = spawnSync('/bin/sh', ['-c', script.replaceAll('/home/alice', home)], {
          encoding: 'utf8',
        });
        assert.equal(result.status, 0);
        return result.stdout;
      },
    });
    const target = { remote: `readiness-${++id}`, instance: 'same' };
    const session = await ensureServerReady(context(f), target);
    assert.equal(session.port, 9876);
    assert.ok(session.token === 'C'.repeat(43));
    fs.writeFileSync(`${machine}/.incus-conn-token`, '');
    await assert.rejects(ensureServerReady(context(f), target), /connection token/);
  }));

test('S: healthy combined preparation/read returns the real last port and sticky token', (t) =>
  withFixture(t, async (f) => {
    const fs = await import('node:fs');
    const home = `${f.directory}/home`;
    const machine = `${home}/.vscode-server/data/Machine`;
    fs.mkdirSync(machine, { recursive: true });
    fs.writeFileSync(
      `${machine}/server.log`,
      'Extension host agent listening on 1234\nExtension host agent listening on 9876\n',
    );
    fs.writeFileSync(`${machine}/.incus-conn-token`, 'C'.repeat(43));
    fs.copyFileSync('assets/relay.js', `${home}/.vscode-server/relay.js`);
    fs.chmodSync(`${home}/.vscode-server/relay.js`, 0o600);
    installedServer(f, {
      hook: (_args, script) => {
        if (!script.includes('fresh token minted')) return undefined;
        const local = script
          .replaceAll('/home/alice', home)
          .replaceAll('1001:1002:600', `${hostUid()}:${hostGid()}:600`);
        const result = spawnSync('/bin/sh', ['-c', local], { encoding: 'utf8' });
        assert.equal(result.status, 0);
        return result.stdout;
      },
    });
    const session = await ensureServerReady(context(f), {
      remote: `combined-${++id}`,
      instance: 'same',
    });
    assert.equal(session.port, 9876);
    assert.ok(session.token === 'C'.repeat(43));
  }));
