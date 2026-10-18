/**
 * Remote - Incus (Spike)
 * ----------------------
 * Minimal remote-authority resolver proving the exec-stdio transport in a REAL
 * VS Code window:
 *
 *   authority  `incus-spike+<container>`
 *   transport  `incus exec <c> --mode non-interactive --user <uid> -- node relay.js`
 *              (child stdio wrapped as vscode.ManagedMessagePassing)
 *
 * Server bootstrap reuses the spike scripts (02-install / 03-start) — they are
 * already verified. This file is throwaway spike code, NOT the Phase-1 design.
 */
'use strict';

// Module-load marker: proves the dev extension was loaded at all (fires before
// any activation event). Guarded — must never break the extension host.
try {
  require('fs').mkdirSync('/tmp/remote-incus-dev/fixture-container', { recursive: true });
  require('fs').appendFileSync('/tmp/remote-incus-dev/fixture-container/ext.log',
    `[${new Date().toISOString()}] module loaded\n`);
} catch { /* ignore */ }

const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

// --- spike constants (deliberately hardcoded; Phase 1 generalizes) ----------
const CONTAINER = 'fixture-container';
const DBU_UID = '1000';
const DBU_USER = 'ubuntu';
const DBU_HOME = '/home/ubuntu';
const RELAY_REMOTE = `${DBU_HOME}/.vscode-server/relay.js`;
const SERVER_LOG = `${DBU_HOME}/.vscode-server/data/Machine/server.log`;
const TOKEN_FILE = `${DBU_HOME}/.vscode-server/data/Machine/.incus-conn-token`;
const SPIKE_LOG = '/tmp/remote-incus-dev/fixture-container/ext.log';

// --- logging -----------------------------------------------------------------
let channel;
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try { fs.appendFileSync(SPIKE_LOG, line + '\n'); } catch { /* ignore */ }
  if (channel) channel.appendLine(msg);
  console.log('[remote-incus-spike]', msg);
}

// --- exec helpers ------------------------------------------------------------
function inc(args, opts = {}) {
  return new Promise((resolve, reject) => {
    cp.execFile('incus', args, { timeout: 30_000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(`incus ${args.join(' ')}\n${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

const execInContainer = (script) =>
  inc(['exec', CONTAINER, '--mode', 'non-interactive', '--user', DBU_UID,
       '--env', `HOME=${DBU_HOME}`, '--', 'bash', '-c', script]);

// --- bootstrap ---------------------------------------------------------------
async function ensureRelayStaged(extensionPath) {
  const script = `test -f ${RELAY_REMOTE} && echo yes || echo no`;
  const present = (await execInContainer(script)).trim() === 'yes';
  if (!present) {
    log('staging relay.js into container …');
    // Spike note: installed-VSIX extensionPath is ~/.vscode/extensions/<id>, so the
    // local relay.js must be referenced absolutely here. Phase 1 ships it as a
    // bundled asset of the extension itself.
    const local = '/path/to/repository/spike/relay.js';
    await inc(['file', 'push', local, `${CONTAINER}${RELAY_REMOTE}`,
               '--uid', DBU_UID, '--gid', DBU_UID, '--mode', '600']);
    log('relay.js staged');
  }
}

async function ensureServerRunning(extensionPath) {
  const running = (await execInContainer(
    'pgrep -f "serv[e]r-main.js" >/dev/null && echo yes || echo no')).trim() === 'yes';
  if (running) { log('server already running — reusing'); return; }

  log('server not running — running spike 03-start-server.sh …');
  // Spike note: for an INSTALLED VSIX, extensionPath points into ~/.vscode/extensions,
  // so relative derivation is wrong. The spike hardcodes the repo location; Phase 1
  // inlines the bootstrap logic instead of shelling out.
  const repoRoot = '/path/to/repository';
  await new Promise((resolve, reject) => {
    cp.execFile('bash', [path.join(repoRoot, 'spike', '03-start-server.sh')],
      { cwd: repoRoot, timeout: 120_000 },
      (err, stdout, stderr) => {
        log(`03 script finished: err=${err ? err.message : 'none'}`);
        if (stdout) log(stdout.trim());
        if (stderr) log(stderr.trim());
        err ? reject(err) : resolve();
      });
  });
}

async function ensureServerReady(extensionPath) {
  await ensureRelayStaged(extensionPath);
  await ensureServerRunning(extensionPath);

  const commit = (await execInContainer('ls ~/.vscode-server/bin | head -1')).trim();
  const port = (await execInContainer(
    `sed -nE "s/.*Extension host agent listening on ([0-9]+).*/\\1/p" ${SERVER_LOG} | tail -1`
  )).trim();
  const token = (await inc(['exec', CONTAINER, '--user', DBU_UID, '--', 'cat', TOKEN_FILE])).trim();

  if (!port) throw new Error('could not discover server port from server.log');
  if (!token) throw new Error('could not read connection token');
  log(`server ready: commit=${commit.slice(0, 10)} port=${port}`);
  return { commit, port, token };
}

// --- managed connection over exec stdio --------------------------------------
function makeManagedConnectionFactory({ commit, port }) {
  return () => new Promise((resolve, reject) => {
    log(`makeConnection() -> spawning exec bridge for port ${port}`);
    const nodeBin = `${DBU_HOME}/.vscode-server/bin/${commit}/node`;
    const child = cp.spawn('incus', [
      'exec', CONTAINER,
      '--mode', 'non-interactive',
      '--user', DBU_UID,
      '--env', `HOME=${DBU_HOME}`,
      '--env', `RELAY_HOST=127.0.0.1`,
      '--env', `RELAY_PORT=${port}`,
      '--', nodeBin, RELAY_REMOTE,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    child.on('error', reject);

    let recv = new vscode.EventEmitter();
    let closed = new vscode.EventEmitter();
    let ended = new vscode.EventEmitter();

    child.stdout.on('data', (d) => recv.fire(new Uint8Array(d)));
    child.stderr.on('data', (d) => log(`[relay stderr] ${d.toString().trim()}`));
    child.on('exit', (code, signal) => {
      log(`exec bridge exited: code=${code} signal=${signal}`);
      if (code === 0) ended.fire();
      else closed.fire(new Error(`exec bridge died: code=${code} signal=${signal}`));
      recv.dispose(); closed.dispose(); ended.dispose();
    });

    resolve({
      onDidReceiveMessage: recv.event,
      onDidClose: closed.event,
      onDidEnd: ended.event,
      send: (data) => {
        if (!child.stdin.destroyed) child.stdin.write(Buffer.from(data));
      },
      end: () => { if (!child.stdin.destroyed) child.stdin.end(); },
    });
  });
}

// --- resolver ------------------------------------------------------------------
class IncusSpikeAuthorityResolver {
  async resolve(authority) {
    log(`resolve(${authority})`);
    if (!vscode.ManagedResolvedAuthority) {
      throw new Error('vscode.ManagedResolvedAuthority is undefined — proposed API "resolvers" was stripped. ' +
        'Run the window in Insiders or with --enable-proposed-api local-spike.remote-incus-spike.');
    }
    const target = authority.split('+')[1];
    if (target && target !== CONTAINER) {
      throw new Error(`spike is hardcoded to container "${CONTAINER}", got "${target}"`);
    }

    const info = await ensureServerReady(this._extensionPath);
    return new vscode.ManagedResolvedAuthority(
      makeManagedConnectionFactory(info),
      info.token,
    );
  }
}

function activate(context) {
  channel = vscode.window.createOutputChannel('Remote - Incus (Spike)');
  context.subscriptions.push(channel);
  log(`activate: vscode ${vscode.version}`);

  const resolver = new IncusSpikeAuthorityResolver();
  resolver._extensionPath = context.extensionPath;

  context.subscriptions.push(
    vscode.workspace.registerRemoteAuthorityResolver('incus-spike', resolver)
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
