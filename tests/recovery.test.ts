import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { withFixture } from './support/fixture';
import { COMMIT, context, installedServer } from './support/scenario';
import { ensureServerReady } from '../src/bootstrap';

// Deliberate S-layer boundary: only captured install scripts run in local bash.
// Rewrite the fixed archive path and selected home into the fixture directory.
const { spawnSync } = createRequire(process.cwd() + '/package.json')('node:child_process') as typeof import('node:child_process');
let id = 0;
for (const mode of ['corrupt', 'interrupted', 'stale-marker'] as const) test(`B3 actual shell: ${mode} install remains recoverable`, t => withFixture(t, async f => {
  const home = `${f.directory}/home`;
  const dir = `${home}/.vscode-server/bin/${COMMIT}`;
  const archive = `${f.directory}/archive.tar.gz`;
  mkdirSync(`${dir}/bin`, { recursive: true }); mkdirSync(`${dir}/out`);
  if (mode === 'interrupted') {
    for (const name of ['node', 'bin/code-server', 'out/server-main.js']) { writeFileSync(`${dir}/${name}`, 'partial'); chmodSync(`${dir}/${name}`, 0o700); }
    writeFileSync(`${dir}/.incus-installing`, '');
  }
  if (mode === 'stale-marker') writeFileSync(`${dir}/.incus-install-ok`, '');
  writeFileSync(archive, 'corrupt archive');
  let extraction = ''; let probe = '';
  installedServer(f, { running: '', hook: (_args, script) => {
    if (script.startsWith('if [ -f') || script.includes('tar -xzf')) {
      const local = script.replaceAll('/home/alice', home).replaceAll(`/tmp/vscode-server-linux-x64-${COMMIT}.tar.gz`, archive);
      if (script.startsWith('if [ -f')) probe = local;
      const result = spawnSync('bash', ['-c', local], { encoding: 'utf8' });
      if (script.includes('tar -xzf')) { extraction = local; if (result.status !== 0) throw new Error('actual extraction failed'); }
      return result.stdout;
    }
    return undefined;
  } });
  f.expect('fetch', async () => new Response('archive'));
  // Remote hash shortcut avoids transfer; extraction still uses the corrupt local archive.
  const { createHash } = await import('node:crypto');
  const dispatch = f.routes.get('child_process.execFile')!;
  f.routes.set('child_process.execFile', (cmd, args, opts, cb) => args.at(-1).startsWith('sha256sum') ? cb(null, createHash('sha256').update('archive').digest('hex'), '') : dispatch(cmd, args, opts, cb));
  await assert.rejects(ensureServerReady(context(f), { remote: `script-${++id}`, instance: 'same' }), /actual extraction failed/);
  assert.equal(existsSync(`${dir}/.incus-install-ok`), false);
  assert.ok(extraction);
  assert.equal(spawnSync('bash', ['-c', probe], { encoding: 'utf8' }).stdout.trim(), 'no');
  // Retry the identical generated script with a valid tiny archive.
  const payload = `${f.directory}/payload`; mkdirSync(`${payload}/bin`, { recursive: true }); mkdirSync(`${payload}/out`);
  for (const name of ['node', 'bin/code-server', 'out/server-main.js']) { writeFileSync(`${payload}/${name}`, 'complete'); chmodSync(`${payload}/${name}`, 0o700); }
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', f.directory, 'payload']).status, 0);
  if (mode === 'interrupted') {
    const interrupted = spawnSync('bash', ['-c', `tar() { command tar "$@"; kill -TERM "$$"; };\n${extraction}`]);
    assert.equal(interrupted.signal, 'SIGTERM');
    assert.equal(existsSync(`${dir}/.incus-install-ok`), false);
    assert.equal(spawnSync('bash', ['-c', probe], { encoding: 'utf8' }).stdout.trim(), 'no');
  }
  assert.equal(spawnSync('bash', ['-c', extraction]).status, 0);
  assert.equal(existsSync(`${dir}/.incus-install-ok`), true);
  assert.equal(existsSync(`${dir}/.incus-installing`), false);
  assert.equal(spawnSync('bash', ['-c', probe], { encoding: 'utf8' }).stdout.trim(), 'yes');
  (await import('node:fs')).unlinkSync(`${dir}/.incus-install-ok`);
  assert.equal(spawnSync('bash', ['-c', probe], { encoding: 'utf8' }).stdout.trim(), 'yes', 'complete legacy install needs no marker');
}));

for (const lost of ['token', 'install'] as const) test(`C10: repaired ${lost} cannot validate existing process`, t => withFixture(t, async f => {
  let repaired = false;
  const ops = installedServer(f, { hook: (_args, script) => {
    if (script.startsWith('if [ -f')) return lost === 'install' && !repaired ? 'no' : 'yes';
    if (script.includes('tar -xzf') || script.includes('fresh token minted')) { repaired = true; return ''; }
    if (script.startsWith('test -x')) return repaired ? 'yes' : 'no';
    return undefined;
  } });
  if (lost === 'install') {
    f.expect('fetch', async () => new Response('archive'));
    const { createHash } = await import('node:crypto');
    const dispatch = f.routes.get('child_process.execFile')!;
    f.routes.set('child_process.execFile', (cmd, args, opts, cb) => args.at(-1).startsWith('sha256sum') ? cb(null, createHash('sha256').update('archive').digest('hex'), '') : dispatch(cmd, args, opts, cb));
  }
  await ensureServerReady(context(f), { remote: `recovery-${++id}`, instance: 'same' });
  assert.equal(ops.filter(a => a.at(-1)!.includes('nohup')).length, 1);
  assert.ok(ops.some(a => a.at(-1)!.startsWith('pkill') && a.at(-1)!.includes('main')));
}));

test('C10: incomplete install cannot be reused even with surviving launcher, log and token', t => withFixture(t, async f => {
  f.expect('fetch', async () => new Response('archive'));
  const { createHash } = await import('node:crypto');
  const ops = installedServer(f, { installed: false, healthy: true, remoteSha: createHash('sha256').update('archive').digest('hex') });
  await ensureServerReady(context(f), { remote: `incomplete-${++id}`, instance: 'same' });
  assert.equal(ops.filter(a => a.at(-1)!.includes('nohup')).length, 1);
}));
