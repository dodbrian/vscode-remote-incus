import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { ensureServerReady, probeFlavor } from '../src/bootstrap';
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

const setupTools = [
  'tar',
  'gzip',
  'mkdir',
  'rm',
  'touch',
  'sha256sum',
  'cut',
  'stat',
  'chmod',
  'tr',
  'head',
  'wc',
  'mv',
];

function setupPath(directory: string, missing: string): void {
  mkdirSync(directory, { recursive: true });
  for (const tool of [...setupTools, 'uname', 'ldd']) {
    if (tool !== missing) symlinkSync(`/usr/bin/${tool}`, `${directory}/${tool}`);
  }
}

for (const strategy of ['client', 'container', 'auto'])
  for (const user of ['default', 'root'])
    test(`missing tar blocks ${strategy} setup for ${user} before downloads or mutation`, (t) =>
      withFixture(t, async (f) => {
        const home = `${f.directory}/selected home`;
        const utilities = `${f.directory}/utilities`;
        setupPath(utilities, 'tar');
        f.configuration.set('remote-incus.downloadStrategy', strategy);
        f.configuration.set('remote-incus.user', user);
        let checks = 0;
        const operations = installedServer(f, {
          installed: false,
          running: 'c'.repeat(40),
          hook: (args, script) => {
            if (!script.startsWith('kill -0')) return undefined;
            checks++;
            const selectedHome = user === 'root' ? '/root' : '/home/alice';
            assert.ok(args.includes(user === 'root' ? '0' : '1001'));
            assert.ok(args.includes(`HOME=${selectedHome}`));
            const result = spawnSync('/bin/sh', ['-c', script.replaceAll(selectedHome, home)], {
              env: { PATH: utilities },
              encoding: 'utf8',
            });
            assert.equal(result.status, 127);
            throw new Error(result.stderr);
          },
        });
        await assert.rejects(
          ensureServerReady(context(f), {
            remote: `missing-tar-${strategy}-${user}`,
            instance: 'owned',
          }),
          /setup requires 'tar'.*selected user's PATH.*inside the instance/,
        );
        assert.equal(checks, 1);
        assert.ok(
          !operations.some(
            (args) =>
              args[0] === 'file' || /pkill|tar -xzf|fresh token minted/.test(defined(args.at(-1))),
          ),
        );
        assert.ok(!f.calls.some((call) => call.name === 'fetch'));
        assert.equal(existsSync(home), false);
      }));

for (const missing of setupTools.filter((tool) => tool !== 'tar'))
  test(`missing setup utility ${missing} reports the selected-user prerequisite`, (t) =>
    withFixture(t, async (f) => {
      const utilities = `${f.directory}/utilities`;
      setupPath(utilities, missing);
      installedServer(f, {
        installed: false,
        hook: (_args, script) => {
          if (!script.startsWith('kill -0')) return undefined;
          const result = spawnSync(
            '/bin/sh',
            ['-c', script.replaceAll('/home/alice', `${f.directory}/home`)],
            {
              env: { PATH: utilities },
              encoding: 'utf8',
            },
          );
          assert.equal(result.status, 127);
          assert.match(
            result.stderr.split('\n')[0] ?? '',
            new RegExp(`setup requires '${missing}'`),
          );
          throw new Error(result.stderr);
        },
      });
      await assert.rejects(
        ensureServerReady(context(f), { remote: `missing-${missing}`, instance: 'owned' }),
        new RegExp(`setup requires '${missing}'`),
      );
    }));

test('extraction rechecks prerequisites before deleting an interrupted install', (t) =>
  withFixture(t, async (f) => {
    const { createHash } = await import('node:crypto');
    const sha = createHash('sha256').update('archive').digest('hex');
    const home = `${f.directory}/selected home`;
    const bin = `${home}/.vscode-server/bin/${COMMIT}`;
    mkdirSync(bin, { recursive: true });
    writeFileSync(`${bin}/retained`, 'interrupted install evidence');
    const utilities = `${f.directory}/utilities`;
    setupPath(utilities, 'tar');
    f.expect('fetch', () => new Response('archive'));
    let extractions = 0;
    const operations = installedServer(f, {
      installed: false,
      running: '',
      remoteSha: sha,
      hook: (_args, script) => {
        if (!script.includes('tar -xzf')) return undefined;
        extractions++;
        const result = spawnSync('/bin/sh', ['-c', script.replaceAll('/home/alice', home)], {
          env: { PATH: utilities },
          encoding: 'utf8',
        });
        assert.equal(result.status, 127);
        throw new Error(result.stderr);
      },
    });
    await assert.rejects(
      ensureServerReady(context(f), { remote: 'extraction-prerequisite-race', instance: 'owned' }),
      /setup requires 'tar'/,
    );
    assert.equal(extractions, 1);
    assert.equal(readFileSync(`${bin}/retained`, 'utf8'), 'interrupted install evidence');
    assert.equal(existsSync(`${bin}/.incus-installing`), false);
    assert.ok(!operations.some((args) => /nohup|fresh token minted/.test(defined(args.at(-1)))));
  }));

test('complete healthy install reuses without archive utilities in PATH', (t) =>
  withFixture(t, async (f) => {
    const home = `${f.directory}/selected home`;
    const bin = `${home}/.vscode-server/bin/${COMMIT}`;
    mkdirSync(`${bin}/bin`, { recursive: true });
    mkdirSync(`${bin}/out`, { recursive: true });
    writeFileSync(`${bin}/bin/code-server`, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    writeFileSync(`${bin}/node`, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    writeFileSync(`${bin}/out/server-main.js`, '');
    const utilities = `${f.directory}/utilities`;
    mkdirSync(utilities);
    for (const tool of ['uname', 'ldd', 'head'])
      symlinkSync(`/usr/bin/${tool}`, `${utilities}/${tool}`);
    const operations = installedServer(f, {
      hook: (_args, script) => {
        if (!script.startsWith('kill -0')) return undefined;
        const result = spawnSync('/bin/sh', ['-c', script.replaceAll('/home/alice', home)], {
          env: { PATH: utilities },
          encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /INCUS_INSTALL\nyes/);
        return result.stdout;
      },
    });
    const session = await ensureServerReady(context(f), {
      remote: 'reuse-without-archive-utilities',
      instance: 'owned',
    });
    assert.equal(session.port, 4567);
    assert.ok(
      !operations.some((args) => args[0] === 'file' || /tar -xzf|pkill/.test(defined(args.at(-1)))),
    );
    assert.ok(!f.calls.some((call) => call.name === 'fetch'));
  }));

test('flavor probe accepts musl version output with a nonzero ldd status without head', (t) =>
  withFixture(t, async (f) => {
    writeFileSync(`${f.directory}/uname`, '#!/bin/sh\nprintf "x86_64\\n"\n', { mode: 0o700 });
    writeFileSync(`${f.directory}/ldd`, '#!/bin/sh\nprintf "musl libc (x86_64)\\n" >&2\nexit 1\n', {
      mode: 0o700,
    });
    f.expect('child_process.execFile', (_command, args, _options, callback) => {
      const result = spawnSync('/bin/sh', ['-c', defined(args.at(-1))], {
        env: { PATH: f.directory },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0);
      callback(null, result.stdout, result.stderr);
    });
    assert.equal(
      await probeFlavor(
        { remote: 'musl-version-status', instance: 'owned' },
        {
          uid: 1001,
          gid: 1002,
          username: 'alice',
          home: '/home/alice',
        },
      ),
      'linux-alpine',
    );
  }));
