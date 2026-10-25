/**
 * Offline smoke for the pure logic + read-only incus wrappers (no vscode).
 * Run: node esbuild.js is NOT involved — bundled ad hoc:
 *   npx esbuild scripts/smoke.ts --bundle --platform=node --alias:vscode=./scripts/vscode-stub.js --outfile=/tmp/remote-incus-dev/smoke.js && node /tmp/remote-incus-dev/smoke.js
 */
import { parseAuthority, formatAuthority } from '../src/authority';
import { listRemotes, listInstances, execInInstance, target } from '../src/incusCli';
import { resolveIdentity, probeFlavor, resolveClientCommit } from '../src/bootstrap';
import { FolderHistory } from '../src/history';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

async function main(): Promise<void> {
  // authority round-trips
  assert(
    JSON.stringify(parseAuthority('incus+fixture-remote:fixture-container')) ===
      '{"remote":"fixture-remote","instance":"fixture-container"}',
    'parse explicit remote authority',
  );
  assert(
    JSON.stringify(parseAuthority('incus+fixture-container')) ===
      '{"instance":"fixture-container"}',
    'parse default-remote authority',
  );
  assert(
    formatAuthority({ remote: 'fixture-remote', instance: 'fixture-container' }) ===
      'incus+fixture-remote:fixture-container',
    'format explicit',
  );
  assert(formatAuthority({ instance: 'c1' }) === 'incus+c1', 'format default');
  try {
    parseAuthority('incus/fixture-remote:fixture-container');
    assert(false, 'reject malformed authority');
  } catch {
    assert(true, 'reject malformed authority');
  }

  // folder history (pure memento logic)
  const store: Record<string, unknown> = {};
  const fakeContext = {
    globalState: {
      get: (_k: string) => store.v,
      update: (_k: string, v: unknown) => {
        store.v = v;
        return Promise.resolve();
      },
    },
  } as never;
  const history = new FolderHistory(fakeContext);
  history.record('incus+fixture-remote:fixture-container', '/home/ubuntu/proj-a');
  history.record('incus+fixture-remote:fixture-container', '/home/ubuntu/proj-b');
  history.record('incus+fixture-remote:fixture-container', '/home/ubuntu/proj-a'); // dedup → moves to front
  assert(
    JSON.stringify(history.folders('incus+fixture-remote:fixture-container')) ===
      '["/home/ubuntu/proj-a","/home/ubuntu/proj-b"]',
    'history most-recent-first + dedup',
  );
  history.remove('incus+fixture-remote:fixture-container', '/home/ubuntu/proj-a');
  assert(
    JSON.stringify(history.folders('incus+fixture-remote:fixture-container')) ===
      '["/home/ubuntu/proj-b"]',
    'history remove',
  );
  history.remove('incus+fixture-remote:fixture-container', '/home/ubuntu/proj-b');
  assert(
    history.folders('incus+fixture-remote:fixture-container').length === 0,
    'history empty after last removal',
  );
  assert(history.folders('incus+other:x').length === 0, 'history isolated per authority');

  // Live checks require an explicit fixture; pure checks above use synthetic names.
  const selected = process.argv[2];
  if (!selected) {
    console.log('Pure smoke checks passed; no live fixture selected.');
    return;
  }
  if (process.env.CI || !/^[^:\s-][^:\s]*:[^:\s-][^:\s]*$/.test(selected)) {
    throw new Error('Live smoke requires explicit remote:instance outside CI');
  }
  const [remote, instance] = selected.split(':');
  if (!remote || !instance) throw new Error('Expected remote:instance');
  const ref = { remote, instance };
  const remotes = await listRemotes();
  assert(
    remotes.some((r) => r.name === remote),
    'selected remote is an Incus remote',
  );
  const instances = await listInstances(remote);
  const fixture = instances.find((i) => i.name === instance);
  assert(fixture?.status === 'Running', 'selected fixture is running');
  const identity = await resolveIdentity(ref);
  await probeFlavor(ref, identity);
  const out = await execInInstance(ref, 'echo "$HOME"', { uid: identity.uid, home: identity.home });
  assert(out.trim() === identity.home, `exec as user honors HOME (${target(ref)})`);

  const commit = await resolveClientCommit();
  console.log('client commit:', commit);
  assert(/^[0-9a-f]{40}$/.test(commit), 'client commit resolved');
  console.log('ALL SMOKE OK');
}

main().catch((e: unknown) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
