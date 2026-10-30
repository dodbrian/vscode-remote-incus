'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { verifyRelease } = require('./verify-release.cjs');

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

function releaseNotes(changelog) {
  return changelog.split(/^## /m)[2].split('\n').slice(1).join('\n').trim();
}

function prepare(
  root,
  { bump, directory, runId, source, date = new Date().toISOString().slice(0, 10) },
) {
  if (!/^\d+$/.test(runId) || !/^[a-f0-9]{40}$/.test(source))
    throw new Error('A workflow run ID and source commit are required.');
  const current = verifyRelease(root);
  const version = nextVersion(current, bump);
  const tag = `v${version}`;
  const git = (...args) => run('git', args, root);
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
      git('log', '-1', '--format=%B', tag).split('\n').at(-1) !== `Release-Run: ${runId}` ||
      git('rev-parse', `${tag}^`) !== source
    )
      throw new Error(`Tag ${tag} already exists and belongs to another release.`);
    git('merge-base', '--is-ancestor', `${tag}^{commit}`, 'origin/main');
    git('checkout', '--detach', tag);
  } else {
    const filename = path.join(root, 'CHANGELOG.md');
    const changelog = fs.readFileSync(filename, 'utf8').replaceAll('\r\n', '\n');
    const sections = changelog.split(/^## /m);
    const authored = sections[1].slice('[Unreleased]'.length).trim();
    const previous = git('tag', '--merged', 'HEAD', '--list', `v${current}`);
    const range = previous ? `${previous}..HEAD` : 'HEAD';
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
  fs.writeFileSync(
    path.join(directory, 'release-notes.md'),
    releaseNotes(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')) + '\n',
  );
  const plan = { version, tag, source, runId, resumed };
  fs.writeFileSync(path.join(directory, 'plan.json'), JSON.stringify(plan) + '\n');
  return plan;
}

function collect(root, directory) {
  const { version } = JSON.parse(fs.readFileSync(path.join(directory, 'plan.json'), 'utf8'));
  if (verifyRelease(root, `refs/tags/v${version}`) !== version)
    throw new Error('Release version changed.');
  fs.writeFileSync(
    path.join(directory, 'release-notes.md'),
    releaseNotes(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')) + '\n',
  );
  const name = `remote-incus-${version}.vsix`;
  const bytes = fs.readFileSync(path.join(root, 'remote-incus.vsix'));
  fs.writeFileSync(path.join(directory, name), bytes);
  fs.writeFileSync(
    path.join(directory, 'SHA256SUMS'),
    `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`,
  );
}

function publish(root, directory) {
  const { version, tag, source, runId, resumed } = JSON.parse(
    fs.readFileSync(path.join(directory, 'plan.json'), 'utf8'),
  );
  const git = (...args) => run('git', args, root);
  const gh = (...args) => run('gh', args, root);
  if (process.env.GITHUB_REF !== 'refs/heads/main')
    throw new Error('Real releases must run from main.');
  if (process.env.GITHUB_RUN_ID !== runId || process.env.GITHUB_SHA !== source)
    throw new Error('Release plan does not belong to this workflow run.');
  if (verifyRelease(root, `refs/tags/${tag}`) !== version)
    throw new Error('Release plan version changed.');
  if (!resumed) {
    if (git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0] !== source)
      throw new Error(
        'main changed during verification. Start a new release run from current main.',
      );
    git('config', 'user.name', 'github-actions[bot]');
    git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
    git('add', 'package.json', 'package-lock.json', 'CHANGELOG.md');
    git(
      'commit',
      '-m',
      `chore(release): release ${tag}`,
      '-m',
      `Publish the verified extension and changelog.\n\nRelease-Run: ${runId}`,
    );
    git('tag', '-a', tag, '-m', `Remote - Incus ${version}`);
    git('push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`);
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

if (require.main === module) {
  try {
    const root = path.join(__dirname, '..');
    const [command, directory] = process.argv.slice(2);
    if (!directory)
      throw new Error('Usage: node scripts/release.cjs prepare|collect|publish OUTPUT_DIRECTORY');
    if (command === 'prepare') {
      const plan = prepare(root, {
        directory,
        bump: process.env.RELEASE_BUMP,
        runId: process.env.GITHUB_RUN_ID,
        source: process.env.GITHUB_SHA,
      });
      console.log(`Prepared ${plan.tag}${plan.resumed ? ' (resuming this run)' : ''}`);
      if (process.env.GITHUB_OUTPUT)
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${plan.tag}\n`);
    } else if (command === 'collect') collect(root, directory);
    else if (command === 'publish') publish(root, directory);
    else throw new Error('Unknown release command.');
  } catch (error) {
    // Commands can contain authentication in their environment; report only captured stderr.
    console.error(error.stderr?.toString().trim() || error.message);
    process.exitCode = 1;
  }
}

module.exports = { nextVersion, prepare, collect, publish };
