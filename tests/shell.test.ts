import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { execInInstance } from '../src/incusCli';
import { openExecTerminal } from '../src/terminal';
import { childProcess, withFixture } from './support/fixture';
import { identity } from './support/scenario';
import { defined } from './support/assert';

const { spawnSync } = createRequire(process.cwd() + '/package.json')(
  'node:child_process',
) as typeof import('node:child_process');
const ref = { remote: 'offline-shell', instance: 'owned' };

for (const failure of [false, true]) {
  test(`shell: bootstrap runs once without bash, failure=${String(failure)}`, (t) =>
    withFixture(t, async (f) => {
      let calls = 0;
      f.routes.set('child_process.execFile', (_cmd, args: string[], _opts, cb) => {
        calls++;
        const command = args.slice(args.indexOf('--') + 1);
        assert.equal(command[0], '/bin/sh');
        const result = spawnSync(defined(command[0]), command.slice(1), {
          env: { PATH: f.directory },
          encoding: 'utf8',
        });
        cb(result.status ? new Error('script failed') : null, result.stdout, result.stderr);
      });
      const pending = execInInstance(
        ref,
        failure ? 'printf failure >&2; exit 73' : 'printf success',
        identity,
      );
      if (failure) await assert.rejects(pending, /failure/);
      else assert.equal(await pending, 'success');
      assert.equal(calls, 1, 'a failed script must not be rerun with another shell');
    }));
}

for (const bash of ['absent', 'present', 'fails'] as const) {
  test(`shell: rescue terminal with bash ${bash}`, (t) =>
    withFixture(t, (f) => {
      writeFileSync(`${f.directory}/script`, '#!/bin/sh\nexec /bin/sh -c "$2"\n', { mode: 0o700 });
      writeFileSync(`${f.directory}/stty`, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
      if (bash !== 'absent') {
        writeFileSync(
          `${f.directory}/bash`,
          `#!/bin/sh\nprintf bash-shell\nexit ${bash === 'fails' ? '7' : '0'}\n`,
          { mode: 0o700 },
        );
      }
      f.expect('vscode.terminal', (options) => ({
        show: () => options.pty.open({ rows: 24, columns: 80 }),
      }));
      f.expect('child_process.spawn', (_cmd, args: string[]) => {
        assert.equal(args[1], 'offline-shell:owned');
        assert.ok(args.includes('HOME=/home/alice'));
        assert.ok(args.includes('SHELL=/bin/sh'));
        const inner = defined(args.at(-1));
        const result = spawnSync('/bin/sh', ['-c', inner], {
          env: { PATH: f.directory },
          input: 'printf sh-shell; exit\n',
          encoding: 'utf8',
        });
        assert.equal(result.stdout, bash === 'absent' ? 'sh-shell' : 'bash-shell');
        assert.equal(result.status, bash === 'fails' ? 7 : 0);
        return childProcess();
      });
      openExecTerminal(ref, identity);
    }));
}

test('shell: missing rescue utility names the prerequisite before shell startup', (t) =>
  withFixture(t, (f) => {
    f.expect('vscode.terminal', (options) => ({ show: () => options.pty.open() }));
    f.expect('child_process.spawn', (_cmd, args: string[]) => {
      const command = args.slice(args.indexOf('--') + 1);
      const result = spawnSync(defined(command[0]), command.slice(1), {
        env: { PATH: f.directory },
        encoding: 'utf8',
      });
      assert.match(result.stderr ?? '', /rescue terminal requires util-linux.*script/i);
      assert.equal(result.status, 127);
      return childProcess();
    });
    openExecTerminal(ref, identity);
  }));
