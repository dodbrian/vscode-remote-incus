/** Manual idle-fixture checks. No real archive is accepted, installed or started. */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import * as cp from 'node:child_process';
import { resolveIdentity, probeFlavor } from '../src/bootstrap';
import { downloadInContainer } from '../src/serverDownload';
import { execInInstance, sq } from '../src/incusCli';

const selected = process.env.INCUS_TEST_TARGET;
if (process.env.CI || process.env.INCUS_TEST_ALLOW_DESTRUCTIVE !== 'yes' || !selected || !/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(selected)) {
  throw new Error('Explicit idle test fixture and destructive opt-in required; CI refused');
}
const [remote, instance] = selected.split(':'); const ref = { remote, instance };
const output = console.log.bind(console); console.log = () => {};
const native = createRequire(process.cwd() + '/package.json')('node:child_process') as typeof cp;
let stage = 'preflight';
async function main() {
  const commit = cp.execFileSync('code', ['--version'], { encoding: 'utf8' }).trim().split('\n')[1];
  assert.match(commit, /^[a-f0-9]{40}$/);
  const identity = await resolveIdentity(ref); const flavor = await probeFlavor(ref, identity);
  const options = { uid: identity.uid, home: identity.home };
  const archive = `/tmp/vscode-server-${flavor}-${commit}.tar.gz`;
  await execInInstance(ref, [
    'set -e', `test ! -e ${sq(identity.home + '/.vscode-server')}`,
    `test ! -e ${sq(archive)}`,
    `test -z "$(pgrep -f 'out/serv[e]r-main\\.js|\\.vscode-serve[r]/relay\\.js' || true)"`,
  ].join('\n'));
  const folder = (await execInInstance(ref, 'mktemp -d /tmp/incus-download-failures-XXXXXX', options)).trim();
  assert.match(folder, /^\/tmp\/incus-download-failures-[A-Za-z0-9]+$/);
  const original = native.execFile;
  try {
    for (const mode of ['corrupt', 'failure', 'signal']) {
      stage = mode;
      const action = mode === 'corrupt' ? 'printf corrupt > "$2"' : mode === 'failure' ? 'exit 22' : 'kill -TERM "$PPID"; exit 0';
      await execInInstance(ref, `cat > ${sq(folder + '/curl')} <<'INCUS_FAKE_CURL'\n#!/bin/sh\nwhile [ "$1" != --output ]; do shift; done\n${action}\nINCUS_FAKE_CURL\nchmod 700 ${sq(folder + '/curl')}`, options);
      // Only this download exec receives a temporary PATH. No executable or
      // environment outside the owned directory is changed.
      native.execFile = ((command: string, args: string[], ...rest: any[]) => {
        if (command === 'incus' && args.at(-1)?.includes('curl --disable --fail')) {
          args = [...args]; args.splice(args.indexOf('--'), 0, '--env', `PATH=${folder}:/usr/bin:/bin`);
        }
        return (original as any)(command, args, ...rest);
      }) as typeof native.execFile;
      try {
        await assert.rejects(downloadInContainer(ref, identity, commit, flavor), (error: any) => {
          assert.match(error.message, /container download failed/);
          const status = mode === 'corrupt' ? 1 : mode === 'failure' ? 22 : 143;
          assert.match(error.cause?.message ?? '', new RegExp(`exit ${status}:`));
          return true;
        });
      }
      finally { native.execFile = original; }
      await execInInstance(ref, [
        'set -e', `test ! -e ${sq(archive)}`,
        `test ! -e ${sq(identity.home + '/.vscode-server')}`,
        `test -z "$(find /tmp -maxdepth 1 -name ${sq(`vscode-server-${flavor}-${commit}.tar.gz.partial-*`)} -print)"`,
      ].join('\n'), options);
      output(`PASS ${mode}: no accepted archive, install or partial`);
    }
  } finally {
    native.execFile = original;
    await execInInstance(ref, `rm -rf -- ${sq(folder)}`, options);
    await execInInstance(ref, `test ! -e ${sq(folder)}`, options);
    output('PASS scoped fake-downloader cleanup');
  }
}
main().catch(error => { output(`FAIL ${stage}: ${error instanceof Error ? error.name : 'unknown error'}`); process.exitCode = 1; });
