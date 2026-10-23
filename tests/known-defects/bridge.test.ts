// Intended contracts. This opt-in suite must remain RED until separately
// authorized correctness work repairs these defects. No skips or inversions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childProcess, withFixture } from '../support/fixture';
import { COMMIT, TOKEN, identity } from '../support/scenario';
import { openBridge } from '../../src/bridge';
const session = { ref: { remote: 'offline', instance: 'same' }, identity, commit: COMMIT, flavor: 'linux-x64' as const, port: 4567, token: TOKEN };

test('T3 defect: asynchronous spawn error must reach managed closure', t => withFixture(t, async f => {
  let child!: ReturnType<typeof childProcess>;
  f.expect('child_process.spawn', () => child = childProcess());
  const bridge = await openBridge(session); const errors: unknown[] = [];
  bridge.onDidClose(e => errors.push(e));
  child.emit('error', new Error('spawn failed'));
  assert.equal(errors.length, 1, 'spawn failure must be observable after openBridge resolves');
}));

test('T3 defect: final stdout between exit and close must not be dropped', t => withFixture(t, async f => {
  let child!: ReturnType<typeof childProcess>;
  f.expect('child_process.spawn', () => child = childProcess());
  const bridge = await openBridge(session); const received: number[] = [];
  bridge.onDidReceiveMessage(bytes => received.push(...bytes));
  child.stdout.write(Buffer.from([1])); child.emit('exit', 0, null);
  child.stdout.write(Buffer.from([255])); child.emit('close', 0, null);
  assert.deepEqual(received, [1, 255], 'exit can precede stdio close and final byte delivery');
}));
