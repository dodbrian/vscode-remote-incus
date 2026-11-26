'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { verifyRelease } = require('./verify-release.cjs');

const metadataNames = ['package.json', 'package-lock.json', 'CHANGELOG.md'];
const releasePrFields = 'number,url,state,headRefOid,mergeCommit,autoMergeRequest';

function run(command, args, root) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function nextVersion(version, bump) {
  if (!['patch', 'minor', 'major'].includes(bump)) throw new Error('Choose patch, minor or major.');
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isSafeInteger(part) || part < 0))
    throw new Error('Expected a numeric release version.');
  const index = { major: 0, minor: 1, patch: 2 }[bump];
  parts[index]++;
  parts.fill(0, index + 1);
  return parts.join('.');
}

function inferBump(version, commits) {
  if (/^[a-z]+(?:\([^\n)]+\))?!:|^BREAKING[ -]CHANGE:/m.test(commits))
    return version.startsWith('0.') ? 'minor' : 'major';
  return /^feat(?:\([^\n)]+\))?:/m.test(commits) ? 'minor' : 'patch';
}

function chooseVersion(current, bump, override, commits) {
  const version =
    override || nextVersion(current, bump === 'auto' || !bump ? inferBump(current, commits) : bump);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error('Version override must be MAJOR.MINOR.PATCH.');
  const parts = version.split('.').map(BigInt);
  const old = current.split('.').map(BigInt);
  const first = parts.findIndex((part, index) => part !== old[index]);
  if (first < 0 || parts[first] < old[first]) throw new Error('Release version must increase.');
  return version;
}

function releaseNotes(changelog) {
  return changelog.split(/^## /m)[2].split('\n').slice(1).join('\n').trim();
}

function orderChangelogSections(notes) {
  notes = notes.trim();
  // Give the last section the same boundary as the others before moving it.
  const sections = `${notes}\n\n`.split(/(?=^### )/m);
  const added = sections.findIndex((section) => /^### Added\s*\n/.test(section));
  const fixed = sections.findIndex((section) => /^### Fixed\s*\n/.test(section));
  if (fixed !== -1 && added > fixed) sections.splice(fixed, 0, sections.splice(added, 1)[0]);
  return sections.join('').trim();
}

function writeNotes(root, directory, tag) {
  let notes = releaseNotes(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
  if (process.env.GITHUB_REPOSITORY)
    notes += `\n\n## Installation and usage\n\n[README for this release](https://github.com/${process.env.GITHUB_REPOSITORY}/blob/${tag}/README.md)`;
  fs.writeFileSync(path.join(directory, 'release-notes.md'), notes + '\n');
}

function prepare(
  root,
  {
    bump = 'auto',
    versionOverride = '',
    directory,
    runId,
    source,
    date = new Date().toISOString().slice(0, 10),
  },
) {
  if (!/^\d+$/.test(runId) || !/^[a-f0-9]{40}$/.test(source))
    throw new Error('A workflow run ID and source commit are required.');
  const current = verifyRelease(root);
  const git = (...args) => run('git', args, root);
  const previous = git('tag', '--merged', 'HEAD', '--list', `v${current}`);
  const range = previous ? `${previous}..HEAD` : 'HEAD';
  const version = chooseVersion(current, bump, versionOverride, git('log', '--format=%B', range));
  const tag = `v${version}`;
  if (git('rev-parse', 'HEAD') !== source)
    throw new Error('Checkout does not match the requested source commit.');
  if (git('status', '--porcelain'))
    throw new Error('Release preparation requires a clean checkout.');
  const exists = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], {
    cwd: root,
  });
  if (exists.error || ![0, 1].includes(exists.status))
    throw new Error('Unable to check release tag.');
  const resumed = exists.status === 0;
  if (resumed) {
    if (
      git('for-each-ref', '--format=%(contents)', `refs/tags/${tag}`) !==
      tagMessage({ version, source, runId })
    )
      throw new Error(`Tag ${tag} already exists and belongs to another release.`);
    git('merge-base', '--is-ancestor', `${tag}^{commit}`, 'origin/main');
    git('checkout', '--detach', tag);
  } else {
    const filename = path.join(root, 'CHANGELOG.md');
    const changelog = fs.readFileSync(filename, 'utf8').replaceAll('\r\n', '\n');
    const sections = changelog.split(/^## /m);
    const authored = orderChangelogSections(sections[1].slice('[Unreleased]'.length));
    const commits = git('log', '--format=- %s (%h)', range);
    if (!commits) throw new Error('There are no changes since the previous release.');
    const notes = [authored, '### Commits\n\n' + commits].filter(Boolean).join('\n\n');
    fs.writeFileSync(
      filename,
      `${sections[0]}## [Unreleased]\n\n## [${version}] - ${date}\n\n${notes}\n\n## ${sections.slice(2).join('## ')}`,
    );
    for (const name of ['package.json', 'package-lock.json']) {
      const file = path.join(root, name);
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      value.version = version;
      if (name === 'package-lock.json') value.packages[''].version = version;
      fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
    }
  }
  verifyRelease(root, `refs/tags/${tag}`);
  fs.mkdirSync(directory, { recursive: true });
  writeNotes(root, directory, tag);
  const plan = { version, tag, source, runId, resumed };
  fs.writeFileSync(path.join(directory, 'plan.json'), JSON.stringify(plan) + '\n');
  saveMetadata(root, directory);
  return plan;
}

function saveMetadata(root, directory) {
  fs.mkdirSync(path.join(directory, 'metadata'), { recursive: true });
  for (const name of metadataNames)
    fs.copyFileSync(path.join(root, name), path.join(directory, 'metadata', name));
}

function collect(root, directory) {
  const plan = JSON.parse(fs.readFileSync(path.join(directory, 'plan.json'), 'utf8'));
  const { version } = plan;
  if (verifyRelease(root, `refs/tags/v${version}`) !== version)
    throw new Error('Release version changed.');
  plan.tree = candidateTree(root, plan.source);
  fs.writeFileSync(path.join(directory, 'plan.json'), JSON.stringify(plan) + '\n');
  writeNotes(root, directory, `v${version}`);
  const name = `remote-incus-${version}.vsix`;
  const bytes = fs.readFileSync(path.join(root, 'remote-incus.vsix'));
  fs.writeFileSync(path.join(directory, name), bytes);
  fs.writeFileSync(
    path.join(directory, 'SHA256SUMS'),
    `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`,
  );
  saveMetadata(root, directory);
}

function restore(root, directory, expectedTag) {
  const plan = JSON.parse(fs.readFileSync(path.join(directory, 'plan.json'), 'utf8'));
  if (plan.runId !== process.env.GITHUB_RUN_ID || plan.source !== process.env.GITHUB_SHA)
    throw new Error('Artifact does not belong to this workflow run.');
  if (run('git', ['rev-parse', 'HEAD'], root) !== plan.source)
    throw new Error('Checkout does not match the candidate source.');
  if (expectedTag !== undefined && plan.tag !== expectedTag)
    throw new Error('Artifact does not match the approved release tag.');
  const metadata = path.join(directory, 'metadata');
  if (verifyRelease(metadata, `refs/tags/${plan.tag}`) !== plan.version)
    throw new Error('Artifact metadata does not match its release plan.');
  for (const name of metadataNames)
    fs.copyFileSync(path.join(metadata, name), path.join(root, name));
}

function candidateTree(root, source) {
  const git = (...args) => run('git', args, root);
  if (git('rev-parse', 'HEAD') !== source)
    throw new Error('Checkout does not match the candidate source.');
  git('add', '--', ...metadataNames);
  const changed = git('diff', '--cached', '--name-only', source, '--');
  if (
    git('diff', '--name-only') ||
    changed.split('\n').some((name) => !metadataNames.includes(name))
  )
    throw new Error('Release changes must be limited to the version metadata.');
  return git('write-tree');
}

function readCandidate(root, directory) {
  const plan = JSON.parse(fs.readFileSync(path.join(directory, 'plan.json'), 'utf8'));
  if (process.env.GITHUB_REF !== 'refs/heads/main')
    throw new Error('Real releases must run from main.');
  if (process.env.GITHUB_RUN_ID !== plan.runId || process.env.GITHUB_SHA !== plan.source)
    throw new Error('Release plan does not belong to this workflow run.');
  if (verifyRelease(root, `refs/tags/${plan.tag}`) !== plan.version)
    throw new Error('Release plan version changed.');
  if (candidateTree(root, plan.source) !== plan.tree)
    throw new Error('Working tree does not match the verified release tree.');
  return plan;
}

function tagMessage({ version, source, runId }) {
  return `Remote - Incus ${version}\n\nRelease-Run: ${runId}\nRelease-Source: ${source}`;
}

function ensureReleasePullRequest(root, directory) {
  const plan = readCandidate(root, directory);
  const { tag, source, runId, tree } = plan;
  const git = (...args) => run('git', args, root);
  const gh = (...args) => run('gh', args, root);
  const branch = `release/${tag}-${runId}`;
  const branchRef = `refs/heads/${branch}`;
  const ownership = `Release-Run: ${runId}`;
  const matching = JSON.parse(
    gh(
      'pr',
      'list',
      '--base',
      'main',
      '--head',
      branch,
      '--state',
      'all',
      '--json',
      releasePrFields,
    ),
  );
  if (matching.length > 1) throw new Error('Found multiple PRs for this release run.');
  let [pr] = matching;
  if (pr?.state === 'MERGED') return pr;
  if (pr && pr.state !== 'OPEN') throw new Error(`Release PR is closed: ${pr.url}`);
  if (git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0] !== source)
    throw new Error('main changed during verification. Start a new release run from current main.');
  if (git('ls-remote', 'origin', `refs/tags/${tag}`)) throw new Error(`Tag ${tag} already exists.`);
  if (gh('api', 'repos/{owner}/{repo}', '--jq', '.allow_auto_merge') !== 'true')
    throw new Error('Enable Allow auto-merge in repository settings before releasing.');

  let head;
  if (git('ls-remote', 'origin', branchRef)) {
    git('fetch', '--no-tags', 'origin', branchRef);
    head = git('rev-parse', 'FETCH_HEAD');
    if (
      git('rev-parse', `${head}^{tree}`) !== tree ||
      git('rev-list', '--parents', '-n', '1', head) !== `${head} ${source}` ||
      git('log', '-1', '--format=%B', head).split('\n').at(-1) !== ownership
    )
      throw new Error('Existing release branch does not match this verified candidate.');
  } else {
    if (pr) throw new Error('The open release PR branch disappeared.');
    head = git(
      '-c',
      'user.name=github-actions[bot]',
      '-c',
      'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit-tree',
      tree,
      '-p',
      source,
      '-m',
      `chore(release): release ${tag}`,
      '-m',
      `Publish the verified extension and changelog.\n\n${ownership}`,
    );
    git('push', 'origin', `${head}:${branchRef}`);
  }
  if (!pr) {
    const url = gh(
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      branch,
      '--title',
      `Release ${tag}`,
      '--body',
      `Version and changelog from verified Release run ${runId}.`,
    );
    pr = JSON.parse(gh('pr', 'view', url, '--json', releasePrFields));
  }
  if (pr.headRefOid !== head) throw new Error('Release PR head changed.');
  if (!pr.autoMergeRequest)
    gh('pr', 'merge', String(pr.number), '--auto', '--rebase', '--match-head-commit', head);
  return pr;
}

async function awaitReleaseMerge(root, number, interval = 15_000, timeout = 15 * 60_000) {
  const deadline = Date.now() + timeout;
  do {
    const pr = JSON.parse(run('gh', ['pr', 'view', number, '--json', releasePrFields], root));
    if (pr.state === 'MERGED') return pr.mergeCommit?.oid;
    if (pr.state !== 'OPEN') throw new Error(`Release PR closed without merging: ${pr.url}`);
    const remaining = deadline - Date.now();
    if (remaining > 0) await delay(Math.min(interval, remaining));
  } while (Date.now() < deadline);
  throw new Error(
    `Release PR #${number} is still open. Inspect its checks and re-run failed jobs.`,
  );
}

function publish(root, directory, mergedCommit) {
  const plan = readCandidate(root, directory);
  const { version, tag, source, tree } = plan;
  const git = (...args) => run('git', args, root);
  const gh = (...args) => run('gh', args, root);
  if (!/^[a-f0-9]{40}$/.test(mergedCommit))
    throw new Error('A merged release PR commit is required.');
  git('fetch', '--no-tags', 'origin', 'refs/heads/main');
  git('merge-base', '--is-ancestor', mergedCommit, 'FETCH_HEAD');
  git('merge-base', '--is-ancestor', source, mergedCommit);
  if (git('rev-parse', `${mergedCommit}^{tree}`) !== tree)
    throw new Error(
      'Merged release tree differs from the verified candidate. Publication stopped.',
    );

  const tagRef = `refs/tags/${tag}`;
  if (git('ls-remote', 'origin', tagRef)) {
    git('fetch', '--no-tags', 'origin', `${tagRef}:${tagRef}`);
    if (
      git('rev-parse', `${tagRef}^{commit}`) !== mergedCommit ||
      git('for-each-ref', '--format=%(contents)', tagRef) !== tagMessage(plan)
    )
      throw new Error('Existing tag belongs to another release.');
  } else {
    git('config', 'user.name', 'github-actions[bot]');
    git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
    git('tag', '-a', tag, mergedCommit, '-m', tagMessage(plan));
    git('push', 'origin', tagRef);
  }

  const assets = [`remote-incus-${version}.vsix`, 'SHA256SUMS'];
  const files = assets.map((name) => path.join(directory, name));
  const notes = path.join(directory, 'release-notes.md');
  const existing = spawnSync('gh', ['release', 'view', tag, '--json', 'isDraft'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (existing.status === 0) {
    if (JSON.parse(existing.stdout).isDraft) {
      gh('release', 'upload', tag, ...files, '--clobber');
      gh(
        'release',
        'edit',
        tag,
        '--draft=false',
        '--latest',
        '--title',
        `Remote - Incus ${version}`,
        '--notes-file',
        notes,
      );
    }
  } else {
    gh(
      'release',
      'create',
      tag,
      ...files,
      '--verify-tag',
      '--latest',
      '--title',
      `Remote - Incus ${version}`,
      '--notes-file',
      notes,
    );
  }
  const downloaded = fs.mkdtempSync(path.join(os.tmpdir(), 'incus-release-download-'));
  try {
    for (const name of assets) {
      gh('release', 'download', tag, '--pattern', name, '--dir', downloaded);
      if (
        !fs
          .readFileSync(path.join(downloaded, name))
          .equals(fs.readFileSync(path.join(directory, name)))
      )
        throw new Error(`Published asset differs from the verified build: ${name}`);
    }
  } finally {
    fs.rmSync(downloaded, { recursive: true, force: true });
  }
  console.log(gh('release', 'view', tag, '--json', 'url', '--jq', '.url'));
}

async function main() {
  const root = path.join(__dirname, '..');
  const [command, directory, expectedTag] = process.argv.slice(2);
  if (!directory)
    throw new Error(
      'Usage: node scripts/release.cjs prepare|collect|restore|open-pr|publish OUTPUT_DIRECTORY [TAG_OR_PR]',
    );
  if (command === 'prepare') {
    const plan = prepare(root, {
      directory,
      bump: process.env.RELEASE_BUMP,
      versionOverride: process.env.RELEASE_VERSION,
      runId: process.env.GITHUB_RUN_ID,
      source: process.env.GITHUB_SHA,
    });
    console.log(`Prepared ${plan.tag}${plan.resumed ? ' (resuming this run)' : ''}`);
    if (process.env.GITHUB_OUTPUT)
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${plan.tag}\n`);
  } else if (command === 'collect') collect(root, directory);
  else if (command === 'restore') restore(root, directory, expectedTag);
  else if (command === 'open-pr') {
    const pr = ensureReleasePullRequest(root, directory);
    console.log(`Release pull request: ${pr.url}`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `number=${pr.number}\n`);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Release pull request: ${pr.url}\n`);
  } else if (command === 'publish') {
    if (!/^\d+$/.test(expectedTag)) throw new Error('A release PR number is required.');
    const mergedCommit = await awaitReleaseMerge(root, expectedTag);
    publish(root, directory, mergedCommit);
  } else throw new Error('Unknown release command.');
}

if (require.main === module) {
  main().catch((error) => {
    // Commands can contain authentication in their environment; report only captured stderr.
    console.error(error.stderr?.toString().trim() || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  nextVersion,
  inferBump,
  chooseVersion,
  prepare,
  collect,
  restore,
  ensureReleasePullRequest,
  awaitReleaseMerge,
  publish,
};
