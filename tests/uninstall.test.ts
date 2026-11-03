import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  copyFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { withFixture } from './support/fixture';
import { identity } from './support/scenario';
import { uninstallServer } from '../src/bootstrap';
const cp = createRequire(process.cwd() + '/package.json')(
  'node:child_process',
) as typeof import('node:child_process');

for (const mode of ['normal', 'deleted', 'symlink', 'denied', 'stuck'] as const) {
  const deleted = mode === 'deleted';
  test(`uninstall stops installation executables (mode: ${mode}) and preserves other processes`, (t) =>
    withFixture(t, async (f) => {
      t.mock.timers.reset();
      const home = `${f.directory}/selected home`;
      const root = `${home}/.vscode-server`;
      const other = `${home}/.vscode-server-other`;
      const selectedHome = mode === 'symlink' ? `${f.directory}/alias` : home;
      if (mode === 'symlink') symlinkSync(home, selectedHome);
      mkdirSync(root, { recursive: true });
      mkdirSync(other, { recursive: true });
      const marker = `${root}/installation-marker`;
      writeFileSync(marker, 'preserve installation contents');
      const processes: import('node:child_process').ChildProcess[] = [];
      let childPid: number | undefined;
      t.after(() => {
        for (const p of processes) p.kill('SIGKILL');
        if (childPid) {
          try {
            process.kill(childPid, 'SIGKILL');
          } catch {
            /* Already exited. */
          }
        }
      });
      const launch = async (
        file: string,
        ignoreTerm = false,
        spawnChild = false,
      ): Promise<import('node:child_process').ChildProcess> => {
        copyFileSync(process.execPath, file);
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        const p = cp.spawn(
          file,
          [
            '-e',
            `${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}${spawnChild ? `const child = require('child_process').spawn('/bin/sleep', ['60'], { stdio: 'ignore', detached: true });` : ''}require('fs').writeSync(1, ${spawnChild ? 'String(child.pid)' : "'ready'"}); setInterval(() => {}, 1000);`,
          ],
          { env, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        processes.push(p);
        await new Promise<void>((resolve, reject) => {
          p.stdout.once('data', (data: Buffer) => {
            if (spawnChild) childPid = Number(data.toString());
            resolve();
          });
          p.once('error', reject);
          p.once('exit', (code) => {
            reject(new Error(`fixture exited: ${String(code)}`));
          });
          p.stderr.on('data', (data: Buffer) => {
            process.stderr.write(data);
          });
        });
        return p;
      };
      const server = await launch(`${root}/node`, false, true);
      const copilot = await launch(`${root}/copilot-runtime`, true);
      const unrelated = await launch(`${other}/node`);
      if (deleted) {
        const { unlinkSync } = await import('node:fs');
        unlinkSync(`${root}/node`);
        unlinkSync(`${root}/copilot-runtime`);
      }
      f.expect('child_process.execFile', (_cmd, args, _opts, cb) => {
        // Keep real /proc identities and signals, but scan only fixture-owned
        // processes so retry duration does not depend on the host process count.
        // Visit the child before its parent to require another discovery pass.
        const procEntries = [childPid, ...processes.map((p) => p.pid)].map((pid) => {
          assert.ok(typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0);
          return `/proc/${pid}`;
        });
        const original = String(args.at(-1));
        assert.ok(original.includes('for proc in /proc/[0-9]*; do'));
        const script = original
          .replace('for proc in /proc/[0-9]*; do', `for proc in ${procEntries.join(' ')}; do`)
          .replaceAll('/tmp/vscode-server-', `${f.directory}/archive-`);
        const prefix =
          mode === 'denied'
            ? 'kill() { return 1; };'
            : mode === 'stuck'
              ? 'kill() { return 0; }; sleep() { :; };'
              : '';
        cp.execFile(
          '/bin/sh',
          ['-c', prefix + script],
          { timeout: 10_000 },
          (err, stdout, stderr) => cb(err, stdout, stderr),
        );
      });
      const uninstall = (): Promise<void> =>
        uninstallServer(
          { remote: 'fixture', instance: 'selected' },
          { ...identity, home: selectedHome },
        );
      const running = (pid: number | undefined): boolean => {
        try {
          assert.ok(pid);
          process.kill(pid, 0);
          return !/\) [ZX] /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
        } catch {
          return false;
        }
      };
      if (mode === 'denied' || mode === 'stuck') {
        await assert.rejects(
          uninstall(),
          mode === 'denied'
            ? /Cannot stop server process .*installation preserved/
            : /Server processes did not exit; installation preserved/,
        );
        assert.equal(readFileSync(marker, 'utf8'), 'preserve installation contents');
        assert.equal(running(server.pid), true, 'failed shutdown must preserve server process');
        assert.equal(running(childPid), true, 'failed shutdown must preserve child process');
        assert.equal(running(copilot.pid), true, 'failed shutdown must preserve Copilot process');
        assert.equal(running(unrelated.pid), true, 'other installation must survive failure');
        return;
      }
      await uninstall();
      assert.equal(running(server.pid), false, 'server must exit before uninstall completes');
      assert.equal(running(childPid), false, 'external child executable must exit');
      assert.equal(running(copilot.pid), false, 'TERM-resistant Copilot must exit');
      assert.equal(running(unrelated.pid), true, 'other installation must survive');
      assert.equal(existsSync(root), false);
    }));
}
