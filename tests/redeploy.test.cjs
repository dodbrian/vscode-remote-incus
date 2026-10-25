'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'incus redeploy test '));
  try {
    const root = path.join(directory, 'checkout with spaces');
    const scripts = path.join(root, 'scripts');
    const binaries = path.join(directory, 'mocks');
    const elsewhere = path.join(directory, 'external cwd');
    for (const folder of [scripts, binaries, elsewhere]) fs.mkdirSync(folder, { recursive: true });
    const helper = path.join(scripts, 'redeploy.sh');
    fs.copyFileSync(path.resolve('scripts/redeploy.sh'), helper);
    const trace = path.join(directory, 'calls.jsonl');
    for (const command of ['npm', 'node', 'code', 'pkill', 'setsid', 'sleep']) {
      fs.writeFileSync(
        path.join(binaries, command),
        `#!${process.execPath}\n'use strict';\nconst fs = require('node:fs');\nfs.appendFileSync(process.env.REDEPLOY_TEST_TRACE, JSON.stringify({command:${JSON.stringify(command)},args:process.argv.slice(2),cwd:process.cwd()})+'\\n');\nprocess.exit(${command === 'npm' ? 'Number(process.env.REDEPLOY_TEST_FAILURE)' : '91'});\n`,
        { mode: 0o755 },
      );
    }
    fs.writeFileSync(path.join(root, 'remote-incus.vsix'), 'last reviewed artifact');
    run({
      root,
      helper,
      trace,
      invoke: (args, failure = 23) =>
        spawnSync('/bin/sh', [helper, ...args], {
          cwd: elsewhere,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${binaries}:/usr/bin:/bin`,
            CDPATH: elsewhere,
            REDEPLOY_TEST_TRACE: trace,
            REDEPLOY_TEST_FAILURE: String(failure),
          },
          timeout: 5000,
        }),
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

for (const [stage, failure] of [
  ['build', 23],
  ['archive validation', 24],
]) {
  test(`redeploy stops before installation or restart when ${stage} fails`, () =>
    fixture(({ root, trace, invoke }) => {
      const result = invoke(['fixture:idle-container', '/remote/folder with spaces'], failure);
      assert.equal(result.error, undefined);
      assert.equal(result.status, failure, result.stderr);
      const calls = fs
        .readFileSync(trace, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.deepEqual(calls, [{ command: 'npm', args: ['run', 'package'], cwd: root }]);
      assert.equal(
        fs.readFileSync(path.join(root, 'remote-incus.vsix'), 'utf8'),
        'last reviewed artifact',
      );
    }));
}

test('redeploy rejects missing or malformed fixture arguments before any commands', () =>
  fixture(({ trace, invoke }) => {
    for (const args of [
      [],
      ['fixture:idle-container'],
      ['bare-instance', '/folder'],
      ['fixture:', '/folder'],
      ['fixture:idle-container', 'relative/folder'],
    ]) {
      const result = invoke(args);
      assert.equal(result.status, 2);
      assert.equal(fs.existsSync(trace), false);
    }
  }));
