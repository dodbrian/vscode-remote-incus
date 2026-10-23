import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childProcess, withFixture } from './support/fixture';
import { COMMIT, TOKEN, identity } from './support/scenario';
import { openBridge } from '../src/bridge';
const session = { ref: { remote: 'offline', instance: 'same' }, identity, commit: COMMIT, flavor: 'linux-x64' as const, port: 4567, token: TOKEN };

test('T3 defect: asynchronous spawn error must reach managed closure', t => withFixture(t, async f => {
  let child!: ReturnType<typeof childProcess>;
  f.expect('child_process.spawn', () => child = childProcess());
  const bridge = await openBridge(session); const errors: unknown[] = [];
  bridge.onDidClose(e => errors.push(e));
  let ends = 0; bridge.onDidEnd(() => ends++);
  child.emit('error', new Error('spawn failed'));
  child.emit('close', -2, null); child.emit('error', new Error('duplicate'));
  assert.equal(ends, 0);
  assert.equal(errors.length, 1, 'spawn failure must be observable after openBridge resolves');
}));

test('T3 defect: final stdout between exit and close must not be dropped', t => withFixture(t, async f => {
  let child!: ReturnType<typeof childProcess>;
  f.expect('child_process.spawn', () => child = childProcess());
  const bridge = await openBridge(session); const received: number[] = [];
  let ends = 0; let closes = 0;
  bridge.onDidEnd(() => { ends++; assert.deepEqual(received, [1, 255]); });
  bridge.onDidClose(() => closes++);
  bridge.onDidReceiveMessage(bytes => received.push(...bytes));
  child.stdout.write(Buffer.from([1])); child.emit('exit', 0, null);
  child.stdout.write(Buffer.from([255])); child.emit('close', 0, null);
  child.emit('close', 0, null); child.stdout.write(Buffer.from([9]));
  assert.equal(ends, 1); assert.equal(closes, 0);
  assert.deepEqual(received, [1, 255], 'exit can precede stdio close and final byte delivery');
}));

for (const signal of [null, 'SIGTERM']) test(`T3: abnormal close drains final data once (${signal})`, t => withFixture(t, async f => {
  let child!: ReturnType<typeof childProcess>;
  f.expect('child_process.spawn', () => child = childProcess());
  const bridge = await openBridge(session); const events: string[] = [];
  bridge.onDidReceiveMessage(() => events.push('data'));
  bridge.onDidClose(error => { assert.ok(error instanceof Error); events.push('close'); });
  bridge.onDidEnd(() => events.push('end'));
  child.emit('exit', signal ? null : 1, signal);
  child.stdout.write(Buffer.from([255])); child.emit('close', signal ? null : 1, signal);
  child.emit('close', 1, null); child.stdout.write(Buffer.from([1]));
  assert.deepEqual(events, ['data', 'close']);
}));

test('T3: synchronous spawn exception rejects open', t => withFixture(t, async f => {
  f.expect('child_process.spawn', () => { throw new Error('spawn exception'); });
  await assert.rejects(openBridge(session), /spawn exception/);
}));

test('T3: spawn error before the caller receives the channel rejects', t => withFixture(t, async f => {
  f.expect('child_process.spawn', () => {
    const child = childProcess({ spawn: false });
    queueMicrotask(() => child.emit('error', new Error('early spawn failure')));
    return child;
  });
  await assert.rejects(openBridge(session), /early spawn failure/);
}));
