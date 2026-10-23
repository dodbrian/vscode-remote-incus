import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { withFixture } from './support/fixture';
import { context, installedServer, identity, COMMIT } from './support/scenario';
import { ensureServerReady, uninstallServer } from '../src/bootstrap';
const { spawnSync } = createRequire(process.cwd() + '/package.json')('node:child_process') as typeof import('node:child_process');
let id = 0;
for (const failure of ['token-mkdir', 'token-mv', 'token-generator', 'launch-log', 'prune', 'prune-cd', 'uninstall'] as const) test(`S: ${failure} failure cannot be masked`, t => withFixture(t, async f => {
  const ops = installedServer(f, { running: '' });
  const ref = { remote: `mutating-${++id}`, instance: 'same' };
  await ensureServerReady(context(f), ref);
  // Capture uninstall without executing either removal on the host.
  if (failure === 'uninstall') {
    f.expect('child_process.execFile', (_cmd, args, _opts, cb) => { ops.push(args); cb(null, '', ''); });
    await uninstallServer(ref, identity);
  }
  const script = ops.map(a => a.at(-1)!).find(s => failure.startsWith('token') ? s.includes('fresh token minted') : failure === 'launch-log' ? s.includes('nohup') : failure.startsWith('prune') ? s.includes('cd ') : s.includes('rm -f /tmp/vscode-server-'))!;
  assert.ok(script);
  const home = `${f.directory}/home`;
  const bin = `${home}/.vscode-server/bin`;
  mkdirSync(`${bin}/${COMMIT}`, { recursive: true });
  mkdirSync(`${home}/.vscode-server/data/Machine`, { recursive: true });
  writeFileSync(`${home}/.vscode-server/data/Machine/.incus-conn-token`, '');
  mkdirSync(`${bin}/old-a`); mkdirSync(`${bin}/old-b`);
  const local = script.replaceAll('/home/alice', home).replaceAll('/tmp/vscode-server-', `${f.directory}/vscode-server-`);
  const prefix = failure === 'token-mkdir' ? 'mkdir() { return 31; };' : failure === 'token-mv' ? 'mv() { return 31; };' : failure === 'token-generator' ? 'tr() { return 31; };' : failure === 'launch-log' ? 'rm() { return 31; }; nohup() { return 0; };' : failure === 'prune-cd' ? 'cd() { return 31; };' : failure === 'prune' ? 'rm() { case "$*" in *old-a*) return 31;; *) command rm "$@";; esac; };' : 'rm() { case "$*" in *.vscode-server*) return 31;; *) return 0;; esac; };';
  const result = spawnSync('bash', ['-c', `${prefix}\n${local}`], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, `${failure} was hidden by a subsequent successful command`);
}));

test('S B4: actual token setup mints atomically and preserves a healthy token', t => withFixture(t, async f => {
  const { readFileSync, statSync, existsSync, chmodSync } = await import('node:fs');
  const ops = installedServer(f);
  await ensureServerReady(context(f), { remote: `token-success-${++id}`, instance: 'same' });
  const script = ops.map(a => a.at(-1)!).find(s => s.includes('fresh token minted'))!.replaceAll('/home/alice', `${f.directory}/home`);
  const token = `${f.directory}/home/.vscode-server/data/Machine/.incus-conn-token`;
  assert.equal(spawnSync('bash', ['-c', script]).status, 0);
  const original = readFileSync(token, 'utf8');
  assert.ok(/^[A-Za-z0-9]{43}$/.test(original), 'token must contain 43 alphanumeric characters');
  assert.equal(statSync(token).uid, process.getuid!()); assert.equal(statSync(token).mode & 0o777, 0o600);
  assert.equal(existsSync(`${token}.tmp`), false);
  chmodSync(token, 0o644);
  assert.equal(spawnSync('bash', ['-c', script]).status, 0);
  assert.ok(readFileSync(token, 'utf8') === original, 'sticky token must be unchanged'); assert.equal(statSync(token).mode & 0o777, 0o600);
}));
