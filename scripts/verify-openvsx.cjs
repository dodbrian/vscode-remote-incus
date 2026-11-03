'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { verifyCandidate, publishReleased, registryMatches } = require('./publish-openvsx.cjs');

const delayEnvironment = 'open-vsx-verification-delay';
const maxAttempts = 48;
const context = (tag) => `Open VSX availability (${tag})`;
function api(endpoint, body) {
  const response = execFileSync('gh', ['api', endpoint, ...(body ? ['--input', '-'] : [])], {
    encoding: 'utf8',
    ...(body ? { input: JSON.stringify(body) } : {}),
  });
  return response.trim() ? JSON.parse(response) : null;
}
function pages(endpoint) {
  return JSON.parse(
    execFileSync('gh', ['api', '--paginate', '--slurp', endpoint], {
      encoding: 'utf8',
    }),
  ).flat();
}
function summary(message) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n\n`);
}
function digest(candidate) {
  return createHash('sha256').update(candidate.bytes).digest('hex');
}
function readReceipt(status) {
  const match = /^Pending #([1-9]\d*); accepted=(\d{13}); sha256=([a-f0-9]{64})$/.exec(
    status.description || '',
  );
  if (!match || Number(match[1]) > maxAttempts)
    throw new Error('Invalid accepted-upload receipt; refusing to resume verification.');
  return { nextAttempt: Number(match[1]), acceptedAt: Number(match[2]), digest: match[3] };
}
function pendingResult(receipt) {
  return {
    state: 'pending',
    description: `Pending #${receipt.nextAttempt}; accepted=${receipt.acceptedAt}; sha256=${receipt.digest}`,
  };
}
function assertCandidate(candidate, receipt) {
  if (digest(candidate) !== receipt.digest) {
    const error = new Error('Released package no longer matches the accepted upload.');
    error.code = 'OPENVSX_INTEGRITY';
    throw error;
  }
}
function expired(status, now) {
  const accepted = status.description?.startsWith('Pending #')
    ? readReceipt(status).acceptedAt
    : Date.parse(status.created_at);
  if (!Number.isFinite(accepted)) throw new Error('Invalid upload acceptance timestamp.');
  return now - accepted >= 24 * 60 * 60 * 1000;
}
function timeoutResult() {
  return {
    state: 'failure',
    description: 'Verification deadline reached; investigate Open VSX checks.',
  };
}
async function verifyPending(candidate, status, now = Date.now(), request = fetch) {
  if (expired(status, now)) return timeoutResult();
  if (await registryMatches(candidate, request))
    return { state: 'success', description: 'Published package matches the GitHub release.' };
  return null;
}
function assertDelay(environment) {
  const rules = environment.protection_rules || [];
  if (
    environment.can_admins_bypass !== false ||
    !rules.some((rule) => rule.type === 'wait_timer' && rule.wait_timer === 30) ||
    rules.some((rule) => !['wait_timer', 'branch_policy'].includes(rule.type))
  )
    throw new Error(
      `${delayEnvironment} must have a 30-minute wait timer, admin bypass disabled and no other protection gates.`,
    );
}

async function main({
  repo = process.env.GITHUB_REPOSITORY,
  args = process.argv.slice(2),
  github = api,
  list = pages,
  candidateFor = verifyCandidate,
  submit = publishReleased,
  check = verifyPending,
  now = Date.now,
  download = (releaseTag, temp) =>
    execFileSync('gh', [
      'release',
      'download',
      releaseTag,
      '--repo',
      repo,
      '--pattern',
      '*.vsix',
      '--pattern',
      'SHA256SUMS',
      '--dir',
      temp,
    ]),
} = {}) {
  if (!repo) throw new Error('GITHUB_REPOSITORY is required.');
  const base = `repos/${repo}`;
  const [mode, first, second] = args;
  const directory = mode === 'submit' ? first : undefined;
  const tag = mode === 'submit' ? second : first;
  const attemptText = mode === 'verify' ? second : '1';
  if (
    !['submit', 'verify'].includes(mode) ||
    !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag || '')
  )
    throw new Error('Expected submit <directory> <tag> or verify <tag> <attempt>.');
  const attempt = Number(attemptText);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > maxAttempts)
    throw new Error('Invalid verification attempt.');
  const { sha } = github(`${base}/commits/${tag}`);
  const status = list(`${base}/commits/${sha}/statuses?per_page=100`).find(
    (item) => item.context === context(tag),
  );
  const post = (result) =>
    github(`${base}/statuses/${sha}`, {
      context: context(tag),
      target_url: `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
      ...result,
    });
  const dispatch = (nextAttempt) => {
    assertDelay(github(`${base}/environments/${delayEnvironment}`));
    github(`${base}/actions/workflows/verify-openvsx.yml/dispatches`, {
      ref: 'main',
      inputs: { tag, attempt: String(nextAttempt) },
    });
    summary(
      `${tag}: Automatic verification ${nextAttempt}/${maxAttempts} queued with a 30-minute delay.`,
    );
  };
  if (mode === 'submit') {
    const candidate = await candidateFor(directory, tag);
    if (status) {
      if (status.state === 'success') {
        assertCandidate(candidate, {
          digest: /sha256=([a-f0-9]{64})$/.exec(status.description || '')?.[1],
        });
        summary(`${tag}: Already verified; no upload or further checks needed.`);
        return;
      }
      if (status.state !== 'pending')
        throw new Error('An accepted upload failed verification; investigate before resubmitting.');
      if (expired(status, now())) {
        post(timeoutResult());
        throw new Error('Verification deadline reached.');
      }
      // Resume the persisted attempt rather than resetting the retry budget.
      const receipt = readReceipt(status);
      assertCandidate(candidate, receipt);
      dispatch(receipt.nextAttempt);
      return;
    }
    assertDelay(github(`${base}/environments/${delayEnvironment}`));
    const { state, message } = await submit(candidate);
    if (!['accepted', 'verified'].includes(state)) throw new Error('Invalid upload result.');
    const verified = state === 'verified';
    post(
      verified
        ? { state: 'success', description: `Verified; sha256=${digest(candidate)}` }
        : pendingResult({ nextAttempt: 1, acceptedAt: now(), digest: digest(candidate) }),
    );
    summary(`${tag}: ${message}`);
    if (!verified) dispatch(1);
    return;
  }
  // Each dispatch checks only its release. Completed/untracked releases cannot start a chain.
  if (status?.state !== 'pending') {
    summary(`${tag}: No pending upload; verification stopped.`);
    return;
  }
  const receipt = readReceipt(status);
  if (attempt !== receipt.nextAttempt) {
    summary(
      `${tag}: Stale or out-of-order attempt ${attempt}; expected ${receipt.nextAttempt}. Stopped.`,
    );
    return;
  }
  if (expired(status, now())) {
    post(timeoutResult());
    throw new Error('Verification deadline reached.');
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'incus-registry-'));
  let result;
  try {
    await download(tag, temp);
    let candidate;
    try {
      candidate = await candidateFor(temp, tag);
      assertCandidate(candidate, receipt);
    } catch (error) {
      error.permanentVerificationFailure = true;
      throw error;
    }
    result = await check(candidate, status, now());
  } catch (error) {
    if (error.permanentVerificationFailure || error.code === 'OPENVSX_INTEGRITY') {
      post({ state: 'failure', description: 'Package verification failed; see workflow logs.' });
      throw error;
    }
    summary(`${tag}: Temporary verification error: ${error.message}`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  if (expired(status, now()) || (!result && attempt === maxAttempts)) result = timeoutResult();
  if (result) {
    post(
      result.state === 'success'
        ? { state: 'success', description: `Verified; sha256=${receipt.digest}` }
        : result,
    );
    summary(`${tag}: ${result.description}`);
    if (result.state === 'failure') throw new Error(result.description);
    return;
  }
  summary(`${tag}: Awaiting Open VSX checks.`);
  // Persist the next attempt before dispatch. Replayed runs cannot repeat a check
  // or fork the chain; a failed dispatch can be resumed by the publication job.
  post(pendingResult({ ...receipt, nextAttempt: attempt + 1 }));
  dispatch(attempt + 1);
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { verifyPending, main, assertDelay, readReceipt };
