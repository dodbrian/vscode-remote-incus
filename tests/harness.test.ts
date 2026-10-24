import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import * as cp from 'node:child_process';
import * as net from 'node:net';
import * as vscode from 'vscode';
import { childProcess, withFixture } from './support/fixture';
import { defined } from './support/assert';
import { incus, incusSpawn } from '../src/incusCli';

test('events deliver with thisArg; subscription and emitter disposal stop delivery', (t) =>
  withFixture(t, (f) => {
    const emitter = new vscode.EventEmitter<number>();
    const receiver = { values: [] as number[] };
    const subscription = emitter.event(
      function (this: typeof receiver, value) {
        this.values.push(value);
      },
      receiver,
      f.subscriptions,
    );
    emitter.fire(1);
    subscription.dispose();
    subscription.dispose();
    emitter.fire(2);
    emitter.event((value) => receiver.values.push(value));
    emitter.fire(3);
    emitter.dispose();
    emitter.fire(4);
    assert.deepEqual(receiver.values, [1, 3]);
  }));

test('fixtures clean listeners, timers and files even when the body fails', async (t) => {
  let directory = '';
  let emitter: vscode.EventEmitter<void> | undefined;
  let delivered = false;
  await assert.rejects(
    withFixture(t, (f) => {
      directory = f.directory;
      writeFileSync(`${directory}/fixture`, 'temporary');
      f.configuration.set('remote-incus.user', 'test-user');
      assert.equal(vscode.workspace.getConfiguration('remote-incus').get('user'), 'test-user');
      emitter = new vscode.EventEmitter<void>();
      emitter.event(() => {
        delivered = true;
      });
      f.timeout(() => assert.fail('leaked timer'), 60_000);
      throw new Error('deliberate fixture failure');
    }),
    /deliberate fixture failure/,
  );
  assert.equal(existsSync(directory), false);
  defined(emitter).fire();
  assert.equal(delivered, false);
  await withFixture(t, (f) => {
    assert.equal(
      vscode.workspace.getConfiguration('remote-incus').get('user', 'default'),
      'default',
    );
    assert.deepEqual(f.calls, []);
    t.mock.timers.tick(60_000);
  });
});

test('real source module uses controlled command callback and child streams', (t) =>
  withFixture(t, async (f) => {
    f.expect('child_process.execFile', (_command, _args, _options, callback) =>
      callback(null, 'fixture stdout', ''),
    );
    assert.equal(await incus(['harness-check']), 'fixture stdout');
    f.expect('child_process.spawn', () => childProcess());
    const child = incusSpawn(['harness-check']);
    const bytes: Buffer[] = [];
    const events: unknown[] = [];
    const childStdout = defined(child.stdout);
    childStdout.on('data', (chunk) => bytes.push(chunk));
    child.on('error', (error) => events.push(error.message));
    child.on('exit', (code) => events.push(['exit', code]));
    child.on('close', (code) => events.push(['close', code]));
    childStdout.emit('data', Buffer.from([0, 255, 42]));
    child.emit('error', new Error('fixture error'));
    child.emit('exit', 1);
    child.emit('close', 1);
    assert.deepEqual(Buffer.concat(bytes), Buffer.from([0, 255, 42]));
    assert.deepEqual(events, ['fixture error', ['exit', 1], ['close', 1]]);
  }));

test('fetch responses are controlled', (t) =>
  withFixture(t, async (f) => {
    f.expect('fetch', () => Promise.resolve(new Response('fixture body', { status: 201 })));
    const response = await fetch('https://offline.invalid/harness');
    assert.equal(response.status, 201);
    assert.equal(await response.text(), 'fixture body');
  }));

test('unexpected process, socket and fetch calls fail closed and poison the fixture', async (t) => {
  for (const [name, invoke] of [
    ['child_process.spawn', () => cp.spawn('must-never-run')],
    ['net.connect', () => net.connect(12345)],
    ['fetch', () => fetch('https://must-never-resolve.invalid')],
  ] as const) {
    await assert.rejects(
      withFixture(t, () => {
        assert.throws(invoke, new RegExp(`Unexpected offline call: ${name}`));
      }),
      /Unexpected external calls/,
    );
  }
});
