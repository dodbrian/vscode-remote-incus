/**
 * Offline smoke for the pure logic + read-only incus wrappers (no vscode).
 * Run: node esbuild.js is NOT involved — bundled ad hoc:
 *   npx esbuild scripts/smoke.ts --bundle --platform=node --alias:vscode=./scripts/vscode-stub.js --outfile=/tmp/remote-incus-dev/smoke.js && node /tmp/remote-incus-dev/smoke.js
 */
import { parseAuthority, formatAuthority } from '../src/authority';
import { listRemotes, getDefaultRemote, listInstances, execInInstance, target } from '../src/incusCli';
import { resolveIdentity, probeFlavor, resolveClientCommit } from '../src/bootstrap';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

async function main(): Promise<void> {
  // authority round-trips
  assert(JSON.stringify(parseAuthority('incus+fixture-remote:fixture-container')) === '{"remote":"fixture-remote","instance":"fixture-container"}', 'parse explicit remote authority');
  assert(JSON.stringify(parseAuthority('incus+fixture-container')) === '{"instance":"fixture-container"}', 'parse default-remote authority');
  assert(formatAuthority({ remote: 'fixture-remote', instance: 'fixture-container' }) === 'incus+fixture-remote:fixture-container', 'format explicit');
  assert(formatAuthority({ instance: 'c1' }) === 'incus+c1', 'format default');
  try {
    parseAuthority('incus/fixture-remote:fixture-container');
    assert(false, 'reject malformed authority');
  } catch { assert(true, 'reject malformed authority'); }

  // live daemon (read-only)
  const def = await getDefaultRemote();
  console.log('default remote:', def);
  const remotes = await listRemotes();
  console.log('remotes (protocol incus):', remotes.map((r) => r.name).join(', '));
  assert(remotes.some((r) => r.name === def), 'default remote present in filtered list');
  assert(!remotes.some((r) => r.name === 'images'), 'simplestreams remote dropped');

  const instances = await listInstances(def);
  console.log(`instances on ${def}:`, instances.map((i) => `${i.name}=${i.status}`).join(', '));
  const spike = instances.find((i) => i.name === 'fixture-container');
  assert(!!spike, 'fixture-container visible on the default remote');

  if (spike && spike.status === 'Running') {
    const ref = { remote: def, instance: 'fixture-container' };
    const identity = await resolveIdentity(ref);
    console.log('identity:', identity);
    assert(identity.uid === 1000 && identity.username === 'ubuntu' && identity.home === '/home/ubuntu', 'primary user resolved');
    const flavor = await probeFlavor(ref, identity);
    console.log('flavor:', flavor);
    assert(flavor === 'linux-x64', 'flavor probed');
    const out = await execInInstance(ref, 'echo $HOME', { uid: identity.uid, home: identity.home });
    assert(out.trim() === '/home/ubuntu', `exec as user honors HOME (${target(ref)})`);
  }

  const commit = await resolveClientCommit();
  console.log('client commit:', commit);
  assert(/^[0-9a-f]{40}$/.test(commit), 'client commit resolved');
  console.log('ALL SMOKE OK');
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
