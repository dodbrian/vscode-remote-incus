/** Manual idle-fixture check: managed curl ignores user curlrc options. */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import * as cp from 'node:child_process';
import { probeFlavor, resolveIdentity } from '../src/bootstrap';
import { downloadInContainer } from '../src/serverDownload';
import { execInInstance, sq } from '../src/incusCli';

const selected = process.env.INCUS_TEST_TARGET;
if (process.env.CI || process.env.INCUS_TEST_ALLOW_DESTRUCTIVE !== 'yes' || !selected || !/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(selected)) {
  throw new Error('Explicit idle test target and destructive opt-in required; CI refused');
}
const [remote, instance] = selected.split(':'); const ref = { remote, instance };
const print = console.log.bind(console); console.log = () => {};
const native = createRequire(process.cwd() + '/package.json')('node:child_process') as typeof cp;
const originalExec = native.execFile;
async function main() {
  const commit = cp.execFileSync('code', ['--version'], { encoding: 'utf8' }).trim().split('\n')[1];
  assert.match(commit, /^[a-f0-9]{40}$/);
  const identity = await resolveIdentity(ref); const flavor = await probeFlavor(ref, identity);
  const opts = { uid: identity.uid, home: identity.home };
  const archive = `/tmp/vscode-server-${flavor}-${commit}.tar.gz`;
  await execInInstance(ref, `set -e\ntest ! -e ${sq(identity.home + '/.vscode-server')}\ntest ! -e ${sq(archive)}\ntest ! -L ${sq(archive)}\ntest -z "$(pgrep -f 'out/serv[e]r-main\\.js|\\.vscode-serve[r]/relay\\.js' || true)"`);
  const folder = (await execInInstance(ref, 'mktemp -d /tmp/incus-curl-config-XXXXXX', opts)).trim();
  assert.match(folder, /^\/tmp\/incus-curl-config-[A-Za-z0-9]+$/);
  try {
    await execInInstance(ref, `umask 077; printf '%s\n' 'not-a-real-curl-option = true' > ${sq(folder + '/.curlrc')}`, opts);
    const control = await execInInstance(ref, "curl --silent --show-error --proto '=file' file:///dev/null 2>&1 || true", { ...opts, env: { CURL_HOME: folder } });
    assert.match(control, /not-a-real-curl-option/);
    print('PASS control: ordinary curl reads the injected invalid curlrc');
    let injections = 0;
    native.execFile = ((command: string, args: string[], ...rest: any[]) => {
      if (command === 'incus' && args.at(-1)?.includes('curl --disable --fail')) {
        injections++; args = [...args]; args.splice(args.indexOf('--'), 0, '--env', `CURL_HOME=${folder}`);
      }
      return (originalExec as any)(command, args, ...rest);
    }) as typeof native.execFile;
    await downloadInContainer(ref, identity, commit, flavor);
    native.execFile = originalExec;
    assert.equal(injections, 1);
    const response = await fetch(`https://update.code.visualstudio.com/api/versions/commit:${commit}/server-${flavor}/stable`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    assert.ok(response.ok); const metadata = await response.json() as { version: string; sha256hash: string };
    assert.equal(metadata.version, commit); assert.match(metadata.sha256hash, /^[a-f0-9]{64}$/i);
    const digest = await execInInstance(ref, `sha256sum ${sq(archive)}`, opts);
    assert.equal(digest.split(' ')[0], metadata.sha256hash.toLowerCase());
    await execInInstance(ref, `test "$(stat -c '%u:%g:%a' ${sq(archive)})" = ${sq(`${identity.uid}:${identity.gid}:600`)}`, opts);
    print('PASS managed curl ignores curlrc and publishes the correct owned archive');
  } finally {
    native.execFile = originalExec;
    await execInInstance(ref, `rm -f -- ${sq(archive)}; rm -rf -- ${sq(folder)}`, opts);
    await execInInstance(ref, `test ! -e ${sq(archive)} && test ! -e ${sq(folder)}`, opts);
    print('PASS scoped curl-config fixture cleanup');
  }
}
main().catch(error => { print(`FAIL curl-config check: ${error instanceof Error ? error.name : 'unknown error'}`); process.exitCode = 1; });
