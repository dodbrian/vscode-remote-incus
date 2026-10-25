/**
 * End-to-end fresh-install harness (no window, no resolver): runs the REAL
 * ensureServerReady against a THROWAWAY local instance. Exercises the full
 * bootstrap (download → push-as-user → extract → relay → token → start →
 * port) incl. the 2026-10-20 sticky-/tmp fix. The SHELL orchestrates the
 * instance lifecycle (launch before, delete after); this script assumes the
 * instance is RUNNING.
 *
 * Usage (from repository root): INCUS_TEST_ALLOW_DESTRUCTIVE=yes node fresh-install-test.js <remote:instance>
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode'; // stubbed at bundle time
import { ensureServerReady } from '../src/bootstrap';
import { execInInstance, InstanceRef, target } from '../src/incusCli';
import { initLogging } from '../src/logging';

const REPO = process.cwd();
const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-incus-fresh-'));

function defined<T>(value: T | undefined | null, message = 'expected a defined value'): T {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

function clientCommit(): string {
  const out = cp.execFileSync('code', ['--version'], { encoding: 'utf8' });
  const commit = out.split('\n')[1]?.trim();
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(
      `could not parse the client commit from code --version: ${JSON.stringify(out.slice(0, 120))}`,
    );
  }
  return commit;
}

function fakeContext(): vscode.ExtensionContext {
  return {
    globalStorageUri: { fsPath: storage },
    asAbsolutePath: (p: string) => `${REPO}/${p}`,
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

async function main(): Promise<void> {
  const targetArg = process.argv[2];
  if (
    process.env.CI ||
    !targetArg ||
    !/^[^:\s-][^:\s]*:[^:\s-][^:\s]*$/.test(targetArg) ||
    process.env.INCUS_TEST_ALLOW_DESTRUCTIVE !== 'yes'
  ) {
    throw new Error(
      'Requires explicit remote:instance and INCUS_TEST_ALLOW_DESTRUCTIVE=yes; fixture must be test-owned and idle. Run from the repository root.',
    );
  }
  const [remote, instance] = targetArg.split(':');
  const ref: InstanceRef = { remote: defined(remote), instance: defined(instance) };
  initLogging(fakeContext());
  (vscode as unknown as { env: { appCommit?: string } }).env.appCommit = clientCommit();
  console.log(
    `probing ${target(ref)} with client commit ${(vscode as unknown as { env: { appCommit: string } }).env.appCommit.slice(0, 10)}…`,
  );

  const session = await ensureServerReady(fakeContext(), ref, (message, percent) => {
    console.log(`  [${percent !== undefined ? `${Math.round(percent)}%` : '…'}] ${message}`);
  });

  console.log(
    `session: commit=${session.commit.slice(0, 10)}… port=${session.port} token=${session.token ? 'present' : 'MISSING'} user=${session.identity.username}`,
  );

  // on-disk verification
  const checks = await execInInstance(
    ref,
    [
      `test -f ${session.identity.home}/.vscode-server/bin/${session.commit}/.incus-install-ok && echo "marker: ok" || echo "marker: MISSING"`,
      `ls /tmp/vscode-server-*.tar.gz 2>/dev/null && echo "tmp-tarball: LEFTOVER" || echo "tmp-tarball: cleaned"`,
      `stat -c "relay: %a %U" ${session.identity.home}/.vscode-server/relay.js`,
      `stat -c "token: %a %U" ${session.identity.home}/.vscode-server/data/Machine/.incus-conn-token`,
    ].join('\n'),
    { uid: session.identity.uid, home: session.identity.home },
  );
  console.log(checks.trim());

  if (
    !session.port ||
    !session.token ||
    checks.includes('MISSING') ||
    checks.includes('LEFTOVER')
  ) {
    throw new Error('fresh-install verification FAILED');
  }
  console.log('ALL FRESH-INSTALL CHECKS OK');
}

main()
  .finally(() => {
    fs.rmSync(storage, { recursive: true, force: true });
  })
  .then(
    () => process.exit(0),
    (err: unknown) => {
      console.error('FAILED:', err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
