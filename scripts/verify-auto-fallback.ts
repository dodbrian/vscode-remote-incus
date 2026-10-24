/** Manual auto-fallback verification. Owned idle Linux x64 fixture only. */
import { measureStartup } from './startup-metrics';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { downloadTarball, ensureServerReady, killServer, resolveIdentity, probeFlavor, ServerSession } from '../src/bootstrap';
import { execInInstance, sq } from '../src/incusCli';

const selected = process.env.INCUS_TEST_TARGET;
if (process.env.CI || !selected || !/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(selected) || process.env.INCUS_TEST_ALLOW_DESTRUCTIVE !== 'yes') {
  throw new Error('Requires explicit remote:instance in INCUS_TEST_TARGET and INCUS_TEST_ALLOW_DESTRUCTIVE=yes; fixture must be test-owned and idle.');
}
if (process.env.INCUS_TEST_DOWNLOAD_STRATEGY && !['auto', 'client', 'container'].includes(process.env.INCUS_TEST_DOWNLOAD_STRATEGY)) {
  throw new Error('INCUS_TEST_DOWNLOAD_STRATEGY must be auto, client or container');
}
if (process.env.INCUS_TEST_DOWNLOAD_STRATEGY && process.env.INCUS_TEST_DOWNLOAD_STRATEGY !== 'auto') throw new Error('Fallback check requires auto strategy');
const signingPath = process.env.INCUS_TEST_VSDA_PATH;
if (!signingPath) throw new Error('Requires the installed stable client signing module path in INCUS_TEST_VSDA_PATH');
type Signing = {
  validator: new () => { createNewMessage(input: string): string; validate(input: string): string; dispose?: () => void };
  signer: new () => { sign(input: string): string };
};
let signing: Signing;
try { signing = createRequire(path.join(process.cwd(), 'package.json'))(signingPath) as Signing; }
catch { throw new Error('Unable to load the installed stable client signing module'); }
const [remote, instance] = selected.split(':');
const ref = { remote, instance };
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'incus-live-verification-'));
const context = { globalStorageUri: { fsPath: directory }, asAbsolutePath: (p: string) => path.resolve(p), subscriptions: [] } as unknown as vscode.ExtensionContext;
const output = console.log.bind(console);
// Production diagnostic strings include target identifiers. Keep this run private
// and emit only fixed scenario labels; never serialize sessions or caught errors.
console.log = () => {};
const children = new Set<cp.ChildProcess>();
const closed = new Map<cp.ChildProcess, Promise<void>>();
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('bounded wait expired')), 15000); })]); }
  finally { clearTimeout(timer); }
}
function dial(session: ServerSession) {
  const child = cp.spawn('incus', ['exec', `${ref.remote}:${ref.instance}`, '--mode', 'non-interactive', '--user', String(session.identity.uid), '--env', `HOME=${session.identity.home}`, '--env', 'RELAY_HOST=127.0.0.1', '--env', `RELAY_PORT=${session.port}`, '--', `${session.identity.home}/.vscode-server/bin/${session.commit}/node`, `${session.identity.home}/.vscode-server/relay.js`], { stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  const done = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('close', () => { children.delete(child); resolve(); }); });
  closed.set(child, done);
  child.stdin!.on('error', () => {}); child.stderr!.resume();
  return child;
}
async function end(child: cp.ChildProcess) { child.stdin!.end(); await bounded(closed.get(child)!); }
function reader(child: cp.ChildProcess) {
  let buffer = Buffer.alloc(0);
  let wake: (() => void) | undefined;
  let terminal = false;
  child.once('close', () => { terminal = true; wake?.(); });
  child.stdout!.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); wake?.(); });
  return async (complete: (b: Buffer) => number): Promise<Buffer> => bounded((async () => {
    while (true) {
      const count = complete(buffer);
      if (count) { const result = buffer.subarray(0, count); buffer = buffer.subarray(count); return result; }
      if (terminal) throw new Error('channel closed while waiting for data');
      await new Promise<void>(r => { wake = r; });
      wake = undefined;
    }
  })());
}
async function authenticated(session: ServerSession, valid = true, keepOpen = false) {
  checkpoint = valid ? 'valid-token upgrade' : 'invalid-token upgrade';
  const child = dial(session), read = reader(child);
  const validator = new signing.validator();
  try {
    child.stdin!.write('GET /?reconnectionToken=' + randomUUID() + '&skipWebSocketFrames=true HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
    const header = await read(b => { const i = b.indexOf('\r\n\r\n'); return i < 0 ? 0 : i + 4; });
    assert.ok(header.toString().startsWith('HTTP/1.1 101'), 'websocket upgrade');
    function control(value: unknown) {
      const payload = Buffer.from(JSON.stringify(value)), frame = Buffer.alloc(13);
      frame[0] = 2; frame.writeUInt32BE(payload.length, 9);
      child.stdin!.write(Buffer.concat([frame, payload]));
    }
    async function response() {
      const frame = await read(b => b.length >= 13 && b.length >= 13 + b.readUInt32BE(9) ? 13 + b.readUInt32BE(9) : 0);
      assert.equal(frame[0], 2, 'expected control response');
      return JSON.parse(frame.subarray(13).toString());
    }
    checkpoint = valid ? 'valid-token response' : 'invalid-token rejection';
    control({ type: 'auth', auth: valid ? session.token : 'invalid-task4-token', data: validator.createNewMessage(randomUUID()) });
    const result = await response();
    assert.equal(result.type, valid ? 'sign' : 'error');
    if (valid) {
      checkpoint = 'signed management handshake';
      assert.equal(validator.validate(result.signedData), 'ok');
      control({ type: 'connectionType', commit: session.commit, signedData: new signing.signer().sign(result.data), desiredConnectionType: 1 });
      assert.equal((await response()).type, 'ok');
      if (keepOpen) {
        let monitoring = true;
        let keepAlives = 0;
        let failed = false;
        let acknowledged = 0;
        const packet = () => read(b => b.length >= 13 && b.length >= 13 + b.readUInt32BE(9) ? 13 + b.readUInt32BE(9) : 0);
        const timer = setInterval(() => {
          const frame = Buffer.alloc(13); frame[0] = 9; frame.writeUInt32BE(acknowledged, 5);
          if (!child.stdin!.destroyed) child.stdin!.write(frame);
        }, 5000);
        child.once('close', () => { monitoring = false; clearInterval(timer); });
        const monitor = (async () => {
          while (monitoring) {
            const frame = await packet();
            if (frame[0] === 1) {
              acknowledged = frame.readUInt32BE(1);
              const ack = Buffer.alloc(13); ack[0] = 3; ack.writeUInt32BE(acknowledged, 5);
              child.stdin!.write(ack);
            }
            if (frame[0] === 9) keepAlives++;
            if (frame[0] === 5 && monitoring) throw new Error('unexpected management disconnect');
          }
        })().catch(() => { if (monitoring) failed = true; });
        return {
          child,
          get keepAlives() { return keepAlives; },
          get failed() { return failed; },
          async close() {
            monitoring = false; clearInterval(timer);
            const disconnect = Buffer.alloc(13); disconnect[0] = 5;
            child.stdin!.write(disconnect);
            await end(child); await monitor;
          },
        };
      }
      // Explicit protocol disconnect prevents leaving an upstream reconnect lease.
      const disconnect = Buffer.alloc(13); disconnect[0] = 5;
      child.stdin!.write(disconnect);
    }
    checkpoint = 'protocol disconnect and relay close';
    await end(child);
  } finally { validator.dispose?.(); }
}

async function checks(session: ServerSession) {
  checkpoint = 'filesystem assertions';
  const root = `${session.identity.home}/.vscode-server`;
  assert.ok(/^[A-Za-z0-9]{43}$/.test(session.token), 'generated token shape');
  await execInInstance(ref, [
    'set -e',
    `test "$(stat -c %u ${sq(root + '/bin/' + session.commit + '/node')})" = ${session.identity.uid}`,
    `test "$(stat -c %u ${sq(root + '/bin/' + session.commit + '/bin/code-server')})" = ${session.identity.uid}`,
    `test "$(stat -c %u ${sq(root + '/relay.js')})" = ${session.identity.uid}`,
    `test "$(stat -c %g ${sq(root + '/relay.js')})" = ${session.identity.gid}`,
    `test ! -L ${sq(root + '/relay.js')}`,
    `test "$(stat -c %a ${sq(root + '/relay.js')})" = 600`,
    `test "$(stat -c %u ${sq(root + '/data/Machine/.incus-conn-token')})" = ${session.identity.uid}`,
    `test "$(stat -c %a ${sq(root + '/data/Machine/.incus-conn-token')})" = 600`,
    `test -f ${sq(root + '/bin/' + session.commit + '/.incus-install-ok')}`,
    `test ! -e ${sq(root + '/data/Machine/.incus-conn-token.tmp')}`,
    `test ! -e ${sq(root + '/bin/' + session.commit + '/.incus-installing')}`,
    `test ! -e /tmp/vscode-server-${session.flavor}-${session.commit}.tar.gz`,
  ].join('\n'));
  checkpoint = 'relay content assertion';
  const relay = await execInInstance(ref, `sha256sum ${sq(root + '/relay.js')}`);
  const { createHash } = await import('node:crypto');
  assert.equal(relay.split(' ')[0], createHash('sha256').update(fs.readFileSync('assets/relay.js')).digest('hex'));
  await authenticated(session);
  await authenticated(session, false);
}
let stage = 'preflight';
let checkpoint = 'bootstrap';
let mutated = false;
let testedCommit = '';
let testedFlavor = '';
const native = createRequire(path.join(process.cwd(), 'package.json'))('node:child_process') as typeof cp;
const originalExec = native.execFile;
let fakeFolder = '';
async function main() {
  try {
    const version = cp.execFileSync('code', ['--version'], { encoding: 'utf8' }).trim().split('\n');
    testedCommit = version[1]; assert.match(testedCommit, /^[a-f0-9]{40}$/);
    (vscode.env as unknown as { appCommit: string }).appCommit = testedCommit;
    const id = await resolveIdentity(ref); assert.ok(id.uid !== 0);
    assert.equal(await probeFlavor(ref, id), 'linux-x64', 'this fixture verifier requires Linux x64');
    assert.equal((await execInInstance(ref, "pgrep -f '\\.vscode-serve[r]/relay\\.js|out/serv[e]r-main\\.js' || true")).trim(), '');
    await execInInstance(ref, `test ! -e ${sq(id.home + '/.vscode-server')}`);
    stage = 'prepare verified client cache';
    await downloadTarball(context, testedCommit, 'linux-x64'); testedFlavor = 'linux-x64';
    fakeFolder = (await execInInstance(ref, 'mktemp -d /tmp/incus-auto-fallback-XXXXXX', { uid: id.uid, home: id.home })).trim();
    assert.match(fakeFolder, /^\/tmp\/incus-auto-fallback-[A-Za-z0-9]+$/);
    await execInInstance(ref, `printf '#!/bin/sh\\nexit 22\\n' > ${sq(fakeFolder + '/curl')}; chmod 700 ${sq(fakeFolder + '/curl')}`, { uid: id.uid, home: id.home });
    let attempts = 0;
    native.execFile = ((command: string, args: string[], ...rest: any[]) => {
      if (command === 'incus' && args.at(-1)?.includes('curl --disable --fail')) {
        attempts++; args = [...args]; args.splice(args.indexOf('--'), 0, '--env', `PATH=${fakeFolder}:/usr/bin:/bin`);
      }
      return (originalExec as any)(command, args, ...rest);
    }) as typeof native.execFile;
    stage = 'auto fallback'; mutated = true;
    const messages: string[] = [];
    const session = await measureStartup(stage, () => ensureServerReady(context, ref, message => { messages.push(message); measureStartup.phase(message); }), output);
    native.execFile = originalExec;
    assert.equal(attempts, 1); assert.equal(messages.filter(m => m.includes('switching to client')).length, 1);
    await checks(session);
    output('PASS one failed container attempt, one visible client fallback, verified archive and signed authentication');
    const a = (await authenticated(session, true, true))!; const b = (await authenticated(session, true, true))!;
    stage = 'auto healthy reuse after fallback';
    const reused = await measureStartup(stage, () => ensureServerReady(context, ref), output);
    assert.equal(reused.port, session.port); assert.ok(reused.token === session.token);
    const initial = a.keepAlives;
    await bounded((async () => { while (a.keepAlives <= initial) { assert.ok(!a.failed && !b.failed); await new Promise(r => setTimeout(r, 100)); } })());
    await Promise.all([a.close(), b.close()]);
    output('PASS auto healthy reuse keeps token, port and both signed channels');
  } finally {
    native.execFile = originalExec;
    const cleanupErrors: unknown[] = [];
    for (const c of children) c.kill('SIGKILL');
    try { await bounded(Promise.all([...closed.values()])); } catch (e) { cleanupErrors.push(e); }
    if (mutated) {
      try {
        await killServer(ref);
        await execInInstance(ref, "pkill -f '\\.vscode-serve[r]/relay\\.js' 2>/dev/null || true");
        const identity = await resolveIdentity(ref);
        await execInInstance(ref, `rm -rf ${sq(identity.home + '/.vscode-server')}`);
        // Only archives belonging to this tested commit are owned by this run.
        if (testedCommit) {
          for (const flavor of testedFlavor ? [testedFlavor] : ['linux-x64', 'linux-arm64', 'linux-alpine']) {
            await execInInstance(ref, `rm -f ${sq('/tmp/vscode-server-' + flavor + '-' + testedCommit + '.tar.gz')}`);
          }
        }
        const partials = await execInInstance(ref, `find /tmp -maxdepth 1 -name ${sq(`vscode-server-*-` + testedCommit + `.tar.gz.partial-*`)} -print`);
        assert.equal(partials.trim(), '', 'container download partials must be absent');
        for (let n = 0; ; n++) {
          const remaining = (await execInInstance(ref, "pgrep -f 'out/serv[e]r-main\\.js|\\.vscode-serve[r]/relay\\.js' || true")).trim();
          if (!remaining) break;
          if (n >= 10) throw new Error('remote processes remain');
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (e) { cleanupErrors.push(e); }
    }
    if (fakeFolder) {
      try { const id = await resolveIdentity(ref); await execInInstance(ref, `rm -rf -- ${sq(fakeFolder)}`, { uid: id.uid, home: id.home }); await execInInstance(ref, `test ! -e ${sq(fakeFolder)}`); }
      catch (e) { cleanupErrors.push(e); }
    }
    fs.rmSync(directory, { recursive: true, force: true });
    assert.equal(children.size, 0);
    assert.equal(cleanupErrors.length, 0, 'cleanup must succeed');
    output('PASS bounded cleanup of owned processes, installation and temporary storage');
  }
}
main().catch(error => {
  output(`FAIL ${stage} / ${checkpoint}; ${error instanceof Error ? error.name : 'unknown error'}`);
  if (error instanceof Error) {
    for (const line of (error.stack ?? '').split('\n').filter(line => /^\s+at /.test(line) && line.includes('incus-verify-live.cjs'))) output(line);
  }
  process.exitCode = 1;
});
