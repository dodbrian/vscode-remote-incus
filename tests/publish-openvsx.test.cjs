'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { ZipFile } = require('yazl');
const { fixture } = require('./support/package-fixture.cjs');
const {
  verifyCandidate,
  publishReleased,
  registryMatches,
} = require('../scripts/publish-openvsx.cjs');

// In-process automation tests must not append fixture messages to the CI job.
const inheritedSummary = process.env.GITHUB_STEP_SUMMARY;
let summaryDirectory;
before(() => {
  summaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'incus-test-summary-'));
  process.env.GITHUB_STEP_SUMMARY = path.join(summaryDirectory, 'summary.md');
});
after(() => {
  if (inheritedSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
  else process.env.GITHUB_STEP_SUMMARY = inheritedSummary;
  fs.rmSync(summaryDirectory, { recursive: true, force: true });
});

test('automation tests leave the inherited Actions summary untouched', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'incus-parent-summary-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const summary = path.join(directory, 'summary.md');
  const original = '## Real release summary\n';
  fs.writeFileSync(summary, original);
  const env = { ...process.env, GITHUB_STEP_SUMMARY: summary };
  delete env.NODE_TEST_CONTEXT;
  const output = execFileSync(
    process.execPath,
    ['--test', '--test-name-pattern=^accepted upload dispatches', __filename],
    { encoding: 'utf8', env },
  );
  assert.match(output, /v0\.1\.0: Upload accepted/);
  assert.equal(fs.readFileSync(summary, 'utf8'), original);
});

async function archive(t, publisher = 'dodbrian') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'incus-publish-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'remote-incus-0.1.0.vsix');
  const zip = new ZipFile();
  const done = pipeline(zip.outputStream, fs.createWriteStream(filename));
  for (const [name, bytes] of fixture({ publisher })) zip.addBuffer(bytes, name);
  zip.end();
  await done;
  const digest = createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  fs.writeFileSync(path.join(directory, 'SHA256SUMS'), `${digest}  remote-incus-0.1.0.vsix\n`);
  return directory;
}

test('release download must have matching checksum, identity, version and archive policy', async (t) => {
  const directory = await archive(t);
  assert.equal((await verifyCandidate(directory, 'v0.1.0')).version, '0.1.0');
  await assert.rejects(verifyCandidate(directory, 'v0.2.0'));
  fs.appendFileSync(path.join(directory, 'remote-incus-0.1.0.vsix'), 'corruption');
  await assert.rejects(verifyCandidate(directory, 'v0.1.0'), /checksum/);
  const wrong = await archive(t, 'wrong-publisher');
  await assert.rejects(verifyCandidate(wrong, 'v0.1.0'), /identity/);
});

function registry({ visible = false, mismatched = false, delayed = 0 } = {}) {
  const bytes = Buffer.from('released archive');
  let uploads = 0;
  let requests = 0;
  return {
    candidate: { filename: '/fixture/released.vsix', bytes, version: '0.1.0' },
    uploads: () => uploads,
    options: {
      request: async (url) => {
        if (url.endsWith('/archive.vsix'))
          return {
            ok: true,
            arrayBuffer: async () => (mismatched ? Buffer.from('different archive') : bytes),
          };
        requests++;
        if (!visible || requests <= delayed) return { status: 404 };
        return {
          status: 200,
          ok: true,
          json: async () => ({ files: { download: 'https://open-vsx.org/archive.vsix' } }),
        };
      },
      upload: () => {
        uploads++;
        visible = true;
      },
    },
  };
}

test('a published matching version succeeds without another upload', async () => {
  const f = registry({ visible: true });
  assert.match((await publishReleased(f.candidate, f.options)).message, /Already published/);
  assert.equal(f.uploads(), 0);
});

test('different bytes at the same registry version stop publication', async () => {
  const f = registry({ visible: true, mismatched: true });
  await assert.rejects(publishReleased(f.candidate, f.options), /different bytes/);
  assert.equal(f.uploads(), 0);
});

test('publish returns on acceptance without waiting for registry processing', async () => {
  const f = registry({ delayed: 3 });
  assert.match((await publishReleased(f.candidate, f.options)).message, /Upload accepted/);
  assert.equal(f.uploads(), 1);
});

test('a lost upload response is reconciled before another upload', async () => {
  const f = registry();
  const upload = f.options.upload;
  f.options.upload = () => {
    upload();
    throw new Error('connection lost');
  };
  assert.match(
    (await publishReleased(f.candidate, f.options)).message,
    /matches the GitHub release/,
  );
  assert.equal(f.uploads(), 1);
});

test('registry failures stop before upload', async () => {
  const f = registry();
  f.options.request = async () => ({ status: 503, ok: false });
  await assert.rejects(publishReleased(f.candidate, f.options), /503/);
  assert.equal(f.uploads(), 0);
});

const { verifyPending, main, assertDelay, readReceipt } = require('../scripts/verify-openvsx.cjs');

test('delayed verification leaves processing pending, then verifies matching bytes', async () => {
  const f = registry();
  const now = Date.now();
  const status = { created_at: new Date(now - 3600000).toISOString() };
  assert.equal(await verifyPending(f.candidate, status, now, f.options.request), null);
  f.options.upload();
  assert.equal((await verifyPending(f.candidate, status, now, f.options.request)).state, 'success');
});

test('unavailable accepted upload fails verification after 24 hours', async () => {
  const f = registry();
  const now = Date.now();
  const status = { created_at: new Date(now - 86400000).toISOString() };
  assert.equal((await verifyPending(f.candidate, status, now, f.options.request)).state, 'failure');
});

test('delayed verification rejects different bytes and registry errors', async () => {
  const f = registry({ visible: true, mismatched: true });
  await assert.rejects(registryMatches(f.candidate, f.options.request), /different bytes/);
  await assert.rejects(
    registryMatches(f.candidate, async () => ({ status: 503 })),
    /503/,
  );
});

test('an unsuccessful upload is not reported as accepted while still invisible', async () => {
  const f = registry();
  f.options.upload = () => {
    throw new Error('upload rejected');
  };
  await assert.rejects(publishReleased(f.candidate, f.options), /upload rejected/);
});

function automation() {
  const statuses = [];
  const dispatches = [];
  let uploads = 0;
  let downloads = 0;
  let clock = Date.now();
  const options = {
    repo: 'fixture/project',
    github: (endpoint, body) => {
      if (endpoint.endsWith('/dispatches')) {
        dispatches.push(body);
        return null;
      }
      if (endpoint.includes('/environments/'))
        return {
          can_admins_bypass: false,
          protection_rules: [{ type: 'wait_timer', wait_timer: 30 }],
        };
      if (!body) return { sha: 'fixture-sha' };
      statuses.unshift({ ...body, created_at: new Date(clock).toISOString() });
    },
    list: () => statuses,
    candidateFor: async () => ({ version: '0.1.0', bytes: Buffer.from('accepted archive') }),
    submit: async () => {
      uploads++;
      return { state: 'accepted', message: 'Upload accepted; awaiting Open VSX checks.' };
    },
    download: async () => {
      downloads++;
    },
    check: async () => null,
    now: () => clock,
  };
  return {
    options,
    statuses,
    dispatches,
    uploads: () => uploads,
    downloads: () => downloads,
    advance: (ms) => {
      clock += ms;
    },
  };
}
const submitArgs = ['submit', '/fixture', 'v0.1.0'];
const verifyArgs = ['verify', 'v0.1.0', '1'];

test('accepted upload dispatches a release-specific check; retry does not upload again', async () => {
  const f = automation();
  const options = { ...f.options, args: submitArgs };
  await main(options);
  await main(options);
  assert.equal(f.uploads(), 1);
  assert.equal(f.statuses.length, 1);
  assert.equal(f.statuses[0].state, 'pending');
  assert.deepEqual(f.dispatches[0], { ref: 'main', inputs: { tag: 'v0.1.0', attempt: '1' } });
});

test('a pending check queues exactly one successor without refreshing the deadline', async () => {
  const f = automation();
  await main({ ...f.options, args: submitArgs });
  const accepted = readReceipt(f.statuses[0]).acceptedAt;
  f.advance(1800000);
  await main({ ...f.options, args: verifyArgs });
  assert.equal(f.statuses.length, 2);
  assert.equal(readReceipt(f.statuses[0]).acceptedAt, accepted);
  assert.deepEqual(f.dispatches[1].inputs, { tag: 'v0.1.0', attempt: '2' });
  assert.equal(f.downloads(), 1);
});

test('success stops the chain and completed releases are never checked or uploaded again', async () => {
  const f = automation();
  await main({ ...f.options, args: submitArgs });
  await main({
    ...f.options,
    args: verifyArgs,
    check: async () => ({ state: 'success', description: 'Verified.' }),
  });
  await main({ ...f.options, args: verifyArgs });
  await main({ ...f.options, args: submitArgs });
  assert.equal(f.dispatches.length, 1);
  assert.equal(f.downloads(), 1);
  assert.equal(f.uploads(), 1);
  assert.equal(f.statuses[0].state, 'success');
});

test('temporary errors automatically retry, while a mismatch terminates the chain', async () => {
  const f = automation();
  await main({ ...f.options, args: submitArgs });
  await main({
    ...f.options,
    args: verifyArgs,
    check: async () => {
      throw new Error('Registry lookup failed: HTTP 503');
    },
  });
  assert.equal(f.statuses[0].state, 'pending');
  assert.equal(f.dispatches.length, 2);
  await assert.rejects(
    main({
      ...f.options,
      args: ['verify', 'v0.1.0', '2'],
      check: async () => {
        const error = new Error('different bytes');
        error.code = 'OPENVSX_INTEGRITY';
        throw error;
      },
    }),
  );
  assert.equal(f.statuses[0].state, 'failure');
  assert.equal(f.dispatches.length, 2);
  await assert.rejects(main({ ...f.options, args: submitArgs }), /investigate/);
  assert.equal(f.uploads(), 1);
});

test('deadline stops before download; final attempt never dispatches a successor', async () => {
  for (const elapsed of [true, false]) {
    const f = automation();
    await main({ ...f.options, args: submitArgs });
    if (elapsed) f.advance(86400000);
    else {
      f.statuses[0].description = f.statuses[0].description.replace('Pending #1;', 'Pending #48;');
    }
    await assert.rejects(
      main({ ...f.options, args: ['verify', 'v0.1.0', elapsed ? '1' : '48'] }),
      /deadline/,
    );
    assert.equal(f.dispatches.length, 1);
    assert.equal(f.statuses[0].state, 'failure');
    assert.equal(f.downloads(), elapsed ? 0 : 1);
  }
});

test('untracked releases and malformed attempts cannot start a retry chain', async () => {
  const f = automation();
  await main({ ...f.options, args: verifyArgs });
  assert.equal(f.dispatches.length, 0);
  for (const attempt of ['0', '49', 'NaN', '1.5'])
    await assert.rejects(main({ ...f.options, args: ['verify', 'v0.1.0', attempt] }), /attempt/);
});

test('incorrect delay configuration fails before upload or dispatch', async () => {
  for (const environment of [
    {},
    { protection_rules: [{ type: 'wait_timer', wait_timer: 1 }] },
    { protection_rules: [{ type: 'wait_timer', wait_timer: 30 }, { type: 'required_reviewers' }] },
  ])
    assert.throws(() => assertDelay(environment), /30-minute wait timer/);
  const f = automation();
  const github = f.options.github;
  await assert.rejects(
    main({
      ...f.options,
      args: submitArgs,
      github: (endpoint, body) =>
        endpoint.includes('/environments/') ? {} : github(endpoint, body),
    }),
    /30-minute wait timer/,
  );
  assert.equal(f.uploads(), 0);
  assert.equal(f.dispatches.length, 0);
});

test('invalid released package terminates verification without a successor', async () => {
  const f = automation();
  await main({ ...f.options, args: submitArgs });
  await assert.rejects(
    main({
      ...f.options,
      args: verifyArgs,
      candidateFor: async () => {
        throw new Error('Released VSIX checksum does not match.');
      },
    }),
    /checksum/,
  );
  assert.equal(f.statuses[0].state, 'failure');
  assert.equal(f.dispatches.length, 1);
});

test('duplicate and out-of-order checks cannot repeat work or fork the retry chain', async () => {
  const f = automation();
  await main({ ...f.options, args: submitArgs });
  await main({ ...f.options, args: verifyArgs });
  const downloads = f.downloads();
  const dispatches = f.dispatches.length;
  await main({ ...f.options, args: verifyArgs });
  await main({ ...f.options, args: ['verify', 'v0.1.0', '4'] });
  assert.equal(f.downloads(), downloads);
  assert.equal(f.dispatches.length, dispatches);
});

test('changed release assets cannot be verified against the originally accepted upload', async () => {
  const f = automation();
  await main({ ...f.options, args: submitArgs });
  await assert.rejects(
    main({
      ...f.options,
      args: verifyArgs,
      candidateFor: async () => ({ version: '0.1.0', bytes: Buffer.from('replacement') }),
      check: async () => ({ state: 'success', description: 'Verified.' }),
    }),
    /accepted upload/,
  );
  assert.equal(f.statuses[0].state, 'failure');
  assert.equal(f.dispatches.length, 1);
});

test('verification completing after the deadline cannot report success', async () => {
  const f = automation();
  await main({ ...f.options, args: submitArgs });
  await assert.rejects(
    main({
      ...f.options,
      args: verifyArgs,
      check: async () => {
        f.advance(86400000);
        return { state: 'success', description: 'Verified.' };
      },
    }),
    /deadline/,
  );
  assert.equal(f.statuses[0].state, 'failure');
  assert.equal(f.dispatches.length, 1);
});

test('failed dispatch resumes the persisted next attempt without resetting acceptance or uploading', async () => {
  const f = automation();
  await main({ ...f.options, args: submitArgs });
  const receipt = readReceipt(f.statuses[0]);
  const github = f.options.github;
  await assert.rejects(
    main({
      ...f.options,
      args: verifyArgs,
      github: (endpoint, body) => {
        if (endpoint.endsWith('/dispatches')) throw new Error('dispatch unavailable');
        return github(endpoint, body);
      },
    }),
    /dispatch unavailable/,
  );
  assert.equal(readReceipt(f.statuses[0]).nextAttempt, 2);
  f.advance(1800000);
  await main({ ...f.options, args: submitArgs });
  assert.equal(f.dispatches.at(-1).inputs.attempt, '2');
  assert.equal(readReceipt(f.statuses[0]).acceptedAt, receipt.acceptedAt);
  assert.equal(f.uploads(), 1);
});

test('delay environment cannot permit admin bypass or additional protection gates', () => {
  assert.throws(
    () =>
      assertDelay({
        can_admins_bypass: true,
        protection_rules: [{ type: 'wait_timer', wait_timer: 30 }],
      }),
    /admin bypass/,
  );
  assert.throws(
    () =>
      assertDelay({
        can_admins_bypass: false,
        protection_rules: [{ type: 'wait_timer', wait_timer: 30 }, { type: 'custom' }],
      }),
    /protection gates/,
  );
});

test('CLI resumes a real verified archive through gh JSON boundaries without any upload or network', async (t) => {
  const directory = await archive(t);
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  const candidate = await verifyCandidate(directory, 'v0.1.0');
  const digest = createHash('sha256').update(candidate.bytes).digest('hex');
  const state = path.join(directory, 'status.json');
  const log = path.join(directory, 'calls.jsonl');
  fs.writeFileSync(
    state,
    JSON.stringify([
      {
        context: 'Open VSX availability (v0.1.0)',
        state: 'pending',
        description: `Pending #2; accepted=${Date.now()}; sha256=${digest}`,
        created_at: new Date().toISOString(),
      },
    ]),
  );
  fs.writeFileSync(
    path.join(directory, 'no-network.cjs'),
    "global.fetch = () => { throw new Error('Unexpected network'); };\n",
  );
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const endpoint = args.find((arg) => arg.startsWith('repos/'));
let body;
if (args.includes('--input')) body = JSON.parse(fs.readFileSync(0, 'utf8'));
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ args, body }) + '\\n');
if (endpoint.endsWith('/dispatches')) process.exit(0);
if (endpoint.includes('/environments/')) console.log(JSON.stringify({ can_admins_bypass: false,
  protection_rules: [{ type: 'wait_timer', wait_timer: 30 }] }));
else if (endpoint.includes('/statuses?')) console.log(JSON.stringify([JSON.parse(fs.readFileSync(process.env.FIXTURE_STATUS))]));
else if (endpoint.includes('/statuses/')) {
  const statuses = JSON.parse(fs.readFileSync(process.env.FIXTURE_STATUS));
  statuses.unshift({ ...body, created_at: new Date().toISOString() });
  fs.writeFileSync(process.env.FIXTURE_STATUS, JSON.stringify(statuses));
  console.log(JSON.stringify(body));
} else if (endpoint.includes('/commits/')) console.log(JSON.stringify({ sha: 'a'.repeat(40) }));
else throw new Error('Unexpected gh call: ' + args.join(' '));
`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    NODE_OPTIONS: `--require=${path.join(directory, 'no-network.cjs')}`,
    GITHUB_REPOSITORY: 'fixture/project',
    GITHUB_RUN_ID: '12345',
    GITHUB_STEP_SUMMARY: path.join(directory, 'summary.md'),
    FIXTURE_LOG: log,
    FIXTURE_STATUS: state,
  };
  const script = path.resolve('scripts/verify-openvsx.cjs');
  execFileSync(process.execPath, [script, 'submit', directory, 'v0.1.0'], { env });
  const calls = fs
    .readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const dispatch = calls.find((call) => call.args.some((arg) => arg.endsWith('/dispatches')));
  assert.deepEqual(dispatch.body, { ref: 'main', inputs: { tag: 'v0.1.0', attempt: '2' } });
  assert.ok(
    calls.some((call) => call.args.includes('--paginate') && call.args.includes('--slurp')),
  );
  assert.equal(JSON.parse(fs.readFileSync(state)).length, 1);
  execFileSync(process.execPath, [script, 'verify', 'v0.1.0', '1'], { env });
  assert.equal(fs.readFileSync(log, 'utf8').split('/dispatches').length - 1, 1);
  const summary = fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8');
  assert.match(summary, /v0\.1\.0: Automatic verification 2\/48 queued/);
  assert.match(summary, /v0\.1\.0: Stale or out-of-order attempt 1; expected 2/);
});
