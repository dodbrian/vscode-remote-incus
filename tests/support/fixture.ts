import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';

type Handler = (...args: any[]) => any;
const current = new AsyncLocalStorage<Fixture>();

export function fixture(): Fixture {
  const value = current.getStore();
  if (!value) throw new Error('Offline boundary called outside a fixture');
  return value;
}

export class Fixture {
  readonly directory = mkdtempSync(join(tmpdir(), 'remote-incus-test-'));
  readonly configuration = new Map<string, unknown>();
  readonly subscriptions: { dispose(): void }[] = [];
  readonly calls: { name: string; args: any[] }[] = [];
  readonly unexpected: string[] = [];
  private readonly handlers = new Map<string, Handler[]>();
  private readonly cleanup: (() => void)[] = [];

  expect(name: string, handler: Handler): void {
    const queue = this.handlers.get(name) ?? [];
    queue.push(handler);
    this.handlers.set(name, queue);
  }

  call(name: string, args: any[]): any {
    this.calls.push({ name, args });
    const handler = this.handlers.get(name)?.shift();
    if (!handler) {
      const message = `Unexpected offline call: ${name}`;
      this.unexpected.push(message);
      throw new Error(message);
    }
    return handler(...args);
  }

  defer(cleanup: () => void): void { this.cleanup.push(cleanup); }

  // Use these helpers for fixture-owned wall timers; Node mock timers are also
  // available through the test context and are automatically reset by Node.
  timeout(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(callback, ms);
    this.defer(() => clearTimeout(timer));
    return timer;
  }

  dispose(): void {
    const failures: unknown[] = [];
    const actions = [
      ...this.subscriptions.splice(0).reverse().map(item => () => item.dispose()),
      ...this.cleanup.splice(0).reverse(),
      () => rmSync(this.directory, { recursive: true, force: true }),
    ];
    for (const action of actions) {
      try { action(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Fixture cleanup failed');
  }

  verify(): void {
    assert.deepEqual(this.unexpected, [], 'Unexpected external calls (even if caught by source)');
    for (const [name, queue] of this.handlers) assert.equal(queue.length, 0, `Unused expectation: ${name}`);
  }
}

export async function withFixture(t: TestContext, body: (f: Fixture) => unknown): Promise<void> {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'setImmediate', 'Date'] });
  const f = new Fixture();
  try {
    await current.run(f, () => body(f));
    f.verify();
  } finally {
    try { f.dispose(); } finally { t.mock.timers.reset(); }
  }
}

// All intercepted modules fail closed, including methods not yet modeled.
export function boundaryModule(name: string, keys: string[]): object {
  return new Proxy({}, {
    ownKeys: () => keys,
    getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }),
    get(_target, key) {
      if (key === '__esModule') return true;
      return (...args: any[]) => fixture().call(`${name}.${String(key)}`, args);
    },
  });
}

// Installed before the test body imports source. Never delegate to host fetch.
globalThis.fetch = ((...args: Parameters<typeof fetch>) => fixture().call('fetch', args)) as typeof fetch;

export function childProcess(): EventEmitter & {
  stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => boolean;
} {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: () => true,
  });
  fixture().defer(() => {
    child.removeAllListeners();
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.destroy();
      stream.removeAllListeners();
    }
  });
  return child;
}
