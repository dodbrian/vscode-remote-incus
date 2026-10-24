import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { ensureServerReady } from '../src/bootstrap';
import { sq } from '../src/incusCli';
import { withFixture } from './support/fixture';
import { COMMIT, context, installedServer } from './support/scenario';
import { defined } from './support/assert';

const { spawnSync } = createRequire(process.cwd() + '/package.json')(
  'node:child_process',
) as typeof import('node:child_process');

for (const mode of [
  'libraries',
  'permission',
  'missing-node',
  'missing-launcher',
  'launcher-permission',
  'missing-nohup',
  'ready',
] as const) {
  test(`startup prerequisites: ${mode}`, (t) =>
    withFixture(t, async (f) => {
      const home = `${f.directory}/selected home`;
      const bin = `${home}/.vscode-server/bin/${COMMIT}`;
      const log = `${home}/.vscode-server/data/Machine/server.log`;
      const launched = `${f.directory}/launched`;
      mkdirSync(`${bin}/bin`, { recursive: true });
      mkdirSync(`${home}/.vscode-server/data/Machine`, { recursive: true });
      writeFileSync(log, 'previous startup diagnostic');
      if (mode !== 'missing-node')
        writeFileSync(
          `${bin}/node`,
          mode === 'libraries'
            ? '#!/bin/sh\nprintf "%s\\n" "Error loading shared library libstdc++.so.6" "Error loading shared library libgcc_s.so.1" >&2\nexit 127\n'
            : '#!/bin/sh\n[ "$1" = --version ] || exit 90\nprintf "v24.22.1\\n"\n',
          { mode: mode === 'permission' ? 0o600 : 0o700 },
        );
      if (mode !== 'missing-launcher')
        writeFileSync(`${bin}/bin/code-server`, `#!/bin/sh\nprintf launched > ${sq(launched)}\n`, {
          mode: mode === 'launcher-permission' ? 0o600 : 0o700,
        });
      writeFileSync(`${f.directory}/rm`, '#!/bin/sh\nexec /bin/rm "$@"\n', { mode: 0o700 });
      if (mode !== 'missing-nohup')
        writeFileSync(`${f.directory}/nohup`, '#!/bin/sh\nexec "$@"\n', { mode: 0o700 });
      let launches = 0;
      const operations = installedServer(f, {
        running: '',
        hook: (args, script) => {
          if (!script.includes('nohup')) return undefined;
          launches++;
          assert.ok(args.includes('1001'));
          assert.ok(args.includes('HOME=/home/alice'));
          const local = script.replaceAll('/home/alice', home);
          const result = spawnSync('/bin/sh', ['-c', local + '\nwait'], {
            env: { PATH: f.directory },
            encoding: 'utf8',
          });
          assert.equal(
            result.status,
            mode === 'ready'
              ? 0
              : mode === 'permission'
                ? 126
                : mode === 'missing-launcher' || mode === 'launcher-permission'
                  ? 1
                  : 127,
            'the runtime or prerequisite failure status must propagate',
          );
          if (result.status !== 0) throw new Error(result.stderr);
          return result.stdout;
        },
      });
      const reports: string[] = [];
      const pending = ensureServerReady(
        context(f),
        { remote: `prerequisite-${mode}`, instance: 'owned' },
        (message) => reports.push(message),
      );
      if (mode === 'ready') {
        await pending;
        assert.equal(readFileSync(launched, 'utf8'), 'launched');
      } else {
        await assert.rejects(pending, (error: Error) => {
          assert.match(error.message, /VS Code server .*?(runtime|launcher|requires)/);
          if (mode === 'libraries') {
            assert.match(error.message, /libstdc\+\+\.so\.6/);
            assert.match(error.message, /libgcc_s\.so\.1/);
            assert.match(error.message, /install.*runtime libraries/i);
          }
          if (mode === 'missing-nohup') assert.match(error.message, /nohup/);
          if (mode === 'permission') assert.match(error.message, /[Pp]ermission denied/);
          return true;
        });
        assert.equal(existsSync(launched), false);
        assert.equal(readFileSync(log, 'utf8'), 'previous startup diagnostic');
        assert.ok(!reports.includes('waiting for port…'));
        assert.ok(!operations.some((args) => defined(args.at(-1)).startsWith('grep -s')));
      }
      assert.equal(launches, 1);
    }));
}
