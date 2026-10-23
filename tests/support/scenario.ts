import assert from 'node:assert/strict';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { childProcess, Fixture } from './fixture';

export const COMMIT = 'a'.repeat(40);
export const TOKEN = 'B'.repeat(43);
export const identity = { uid: 1001, gid: 1002, username: 'alice', home: '/home/alice' };
export const passwd = 'service:x:999:999::/home/service:/bin/bash\nlate:x:2000:2000::/home/late:/bin/bash\nblocked:x:1000:1000::/home/blocked:/usr/sbin/nologin\nalice:x:1001:1002::/home/alice:/bin/bash';
export function context(f: Fixture): vscode.ExtensionContext {
  const values = new Map<string, unknown>();
  return {
    subscriptions: f.subscriptions,
    globalStorageUri: { fsPath: f.directory },
    globalState: {
      get: (key: string) => structuredClone(values.get(key)),
      update: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); f.state.set('updates', (f.state.get('updates') ?? 0) + 1); },
    },
    asAbsolutePath: (name: string) => path.resolve(name),
    extension: { id: 'offline', packageJSON: { version: 'test' } },
  } as unknown as vscode.ExtensionContext;
}
export function progress(f: Fixture): { message: string; increment?: number }[] {
  const reports: { message: string; increment?: number }[] = [];
  f.routes.set('vscode.withProgress', (options, callback) => {
    f.state.set('progressOptions', options);
    return callback({ report: (value: any) => reports.push(value) });
  });
  return reports;
}

// Dispatch by operation intent, never by its ordinal position. Unknown scripts
// fail loudly. These outputs model remote state; they do not execute shell.
export function installedServer(f: Fixture, options: {
  running?: string; healthy?: boolean; signal?: string; token?: string;
  pruneError?: boolean; port?: string; installed?: boolean; remoteSha?: string; pushedSha?: string; extractionError?: boolean; hook?: (args: string[], script: string) => string | undefined;
} = {}): string[][] {
  f.state.set('commit', COMMIT);
  const operations: string[][] = [];
  f.routes.set('child_process.execFile', (command, args: string[], _opts, callback) => {
    assert.equal(command, 'incus');
    operations.push(args);
    const script = args.at(-1)!;
    try {
      let output = options.hook?.(args, script);
      if (output === undefined) {
        if (script.startsWith('getent passwd')) output = passwd;
        else if (script.startsWith('kill -0')) output = options.signal ?? 'yes';
        else if (script.startsWith('uname -m')) output = 'x86_64\nglibc';
        else if (script.startsWith('if [ -f')) output = options.installed === false ? 'no' : 'yes';
        else if (script.startsWith('sha256sum')) output = script.includes('2>/dev/null') ? options.remoteSha ?? '' : options.pushedSha ?? '';
        else if (script.startsWith('rm -rf') && script.includes('tar -xzf')) { if (options.extractionError) throw new Error('extract failed'); output = ''; }
        else if (script.includes('fresh token minted')) output = '';
        else if (script.startsWith('pgrep')) output = options.running === '' ? '' : `10 /home/alice/.vscode-server/bin/${options.running ?? f.state.get('commit')}/out/server-main.js`;
        else if (script.startsWith('test -x')) output = options.healthy === false ? 'no' : 'yes';
        else if (script.startsWith('pkill')) output = '';
        else if (script.includes('nohup')) output = 'launched pid 42';
        else if (script.startsWith('grep -s')) output = options.port ?? 'Extension host agent listening on 1234\nExtension host agent listening on 4567';
        else if (script.startsWith('cat ') && script.includes('server.log')) output = 'fixture startup diagnostic';
        else if (script.startsWith('cat ')) output = options.token ?? TOKEN;
        else if (script.startsWith('cd ')) { if (options.pruneError) throw new Error('prune unavailable'); output = ''; }
        else { f.unexpected.push(`Unmodeled command: ${args.join(' ')}`); throw new Error('Unmodeled script'); }
      }
      callback(null, output, '');
    } catch (error) { callback(error, '', String(error)); }
  });
  f.routes.set('child_process.spawn', (command, args: string[]) => {
    assert.equal(command, 'incus');
    assert.equal(args[0], 'file'); assert.equal(args[1], 'push');
    const relay = args[2].endsWith('/assets/relay.js');
    assert.ok(relay || args[2].endsWith('.tar.gz'));
    assert.ok(relay ? args[3].endsWith('/.vscode-server/relay.js') : args[3].includes('/tmp/vscode-server-'));
    assert.equal(args[args.indexOf('--uid') + 1], '1001');
    assert.equal(args[args.indexOf('--gid') + 1], '1002');
    if (relay) assert.equal(args[args.indexOf('--mode') + 1], '600');
    operations.push(args);
    const child = childProcess();
    // Avoid the host's relay file size triggering stat polling in this model.
    // The initial poll is explicitly modeled; completion settles before timers.
    f.expect('child_process.execFile', (_command, pollArgs, _opts, cb) => {
      assert.equal(pollArgs[1], args[3].split('/')[0]);
      cb(null, '0', '');
    });
    queueMicrotask(() => child.emit('close', 0));
    return child;
  });
  return operations;
}
