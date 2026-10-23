/**
 * VS Code server bootstrap inside an Incus instance.
 *
 * Phase-1 port of the spike-verified flow (spike/02-install-server.sh +
 * spike/03-start-server.sh), inlined per DESIGN.md §12 — no script shell-outs.
 * Every step is idempotent and interruption-safe; a re-run after any
 * interruption re-enters at the cheapest missing step:
 *
 *   1. identity  — primary unprivileged user (getent inside the instance);
 *                  root attach is opt-in via `remote-incus.user` (DESIGN §5)
 *   1b. signals  — kill(2) must work inside; the server's children run a
 *                  kill(parentPid, 0) liveness check and self-terminate
 *                  otherwise (Ubuntu 25.04+ AppArmor hardening trap)
 *   2. flavor    — in-instance arch/libc probe → server build
 *   3. commit    — client commit (vscode.env.appCommit, CLI fallback);
 *                  server and client must match by commit
 *   4. install?  — core files must be complete with no in-progress marker;
 *                  assess process health before any repair, then skip tarball
 *                  steps entirely for a complete installation
 *   5. download  — client-side, cached under globalStorage, sha256 recorded
 *   6. push      — `incus file push` PATH mode; skipped when the remote copy
 *                  already matches (sha256 compared before every push)
 *   7. extract   — as the target user into ~/.vscode-server/bin/<commit>
 *   8. relay     — bundled asset staged to ~/.vscode-server/relay.js
 *   9. token     — 0600 token file, mint-if-missing, charset [0-9a-zA-Z0-9]
 *                  (the server silently rejects other characters — DESIGN §4)
 *  10. start     — detached (nohup, survives the exec session); a server
 *                  running under a stale commit — or a ZOMBIE whose install
 *                  files were wiped — is killed and started fresh
 *  11. port      — parsed from server.log ("Extension host agent listening
 *                  on <port>"); relays are orphan-swept after fresh starts
 *                  (DESIGN §6) — never on reuse paths (live bridges belong
 *                  to running sessions, and relays self-exit on EOF)
 */
import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as vscode from 'vscode';
import { execInInstance, InstanceRef, pushFile, sq, target } from './incusCli';
import { firstLine, log } from './logging';
import { Report } from './progress';

export const VS_SERVER_DIR = '.vscode-server';

const tokenPath = (home: string): string => `${home}/${VS_SERVER_DIR}/data/Machine/.incus-conn-token`;
const logPath = (home: string): string => `${home}/${VS_SERVER_DIR}/data/Machine/server.log`;
const relayPath = (home: string): string => `${home}/${VS_SERVER_DIR}/relay.js`;

const DEFAULT_URL_TEMPLATE = 'https://update.code.visualstudio.com/commit:{commit}/server-{flavor}/stable';
const PORT_POLL_INTERVAL_MS = 500;
const PORT_POLL_TRIES = 120; // 60 s

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// identity (DESIGN §5)
// ---------------------------------------------------------------------------

export interface Identity {
  uid: number;
  gid: number;
  username: string;
  home: string;
}

const identityCache = new Map<string, Promise<Identity>>();

export function resolveIdentity(ref: InstanceRef): Promise<Identity> {
  const override = vscode.workspace.getConfiguration('remote-incus').get<string>('user', 'default');
  const key = `${target(ref)}|${override}`;
  let pending = identityCache.get(key);
  if (!pending) {
    pending = doResolveIdentity(ref, override).catch((err) => {
      identityCache.delete(key);
      throw err;
    });
    identityCache.set(key, pending);
  }
  return pending;
}

async function doResolveIdentity(ref: InstanceRef, override: string): Promise<Identity> {
  if (override === 'root') {
    return { uid: 0, gid: 0, username: 'root', home: '/root' };
  }
  const passwd = await execInInstance(ref, 'getent passwd || cat /etc/passwd');
  const users = passwd.split('\n')
    .map((line) => line.split(':'))
    .filter((f) => f.length === 7)
    .map((f) => ({ username: f[0], uid: Number(f[2]), gid: Number(f[3]), home: f[5], shell: f[6] }))
    .filter((u) => Number.isFinite(u.uid));

  if (override !== 'default') {
    const hit = users.find((u) => u.username === override) ?? users.find((u) => String(u.uid) === override);
    if (!hit) {
      throw new Error(`user "${override}" (remote-incus.user) not found in instance ${ref.instance}`);
    }
    return { uid: hit.uid, gid: hit.gid, username: hit.username, home: hit.home };
  }

  // Default: the instance's primary unprivileged user — lowest uid ≥ 1000 with
  // a home under /home and a real login shell. Root is the explicit fallback.
  const primary = users
    .filter((u) => u.uid >= 1000 && u.uid < 65534 && u.home.startsWith('/home')
      && !/\/?(false|nologin)$/.test(u.shell))
    .sort((a, b) => a.uid - b.uid)[0];
  if (primary) {
    return { uid: primary.uid, gid: primary.gid, username: primary.username, home: primary.home };
  }
  log(`no unprivileged user in ${target(ref)} — attaching as root (unexpected for system containers)`);
  return { uid: 0, gid: 0, username: 'root', home: '/root' };
}

// ---------------------------------------------------------------------------
// instance environment probes
// ---------------------------------------------------------------------------

/**
 * The VS Code server's child processes (extension host, pty host, file
 * watcher) poll their parent's liveness with `kill(parentPid, 0)` and treat
 * ANY error as "parent is gone" — no env/flag disables it (upstream source
 * verified 2026-10-20). On Ubuntu 25.04+ hosts with
 * `kernel.apparmor_restrict_unprivileged_unconfined=1` and an Incus daemon
 * lacking the compat sysctl (Ubuntu-archive packages; Zabbly ships it), the
 * kernel denies EVERY in-container signal — EACCES even for root — and every
 * server child self-terminates within seconds (Launchpad #2109394; seen live
 * 2026-10-20: a death loop of ptyHost/exthost restarts masquerading as a
 * terminal bug). Probe before anything else and refuse loudly.
 */
async function probeSignalSupport(ref: InstanceRef, identity: Identity): Promise<void> {
  const out = await execInInstance(ref, 'kill -0 $$ && echo yes || echo no', { uid: identity.uid, home: identity.home });
  if (out.trim() === 'yes') { return; }
  throw new Error([
    `signal syscalls are blocked inside this instance (kill -0 self denied for uid ${identity.uid})`,
    `the VS Code server's child processes (extension host, pty host) cannot survive here`,
    `known cause: Ubuntu 25.04+ AppArmor hardening (kernel.apparmor_restrict_unprivileged_unconfined=1) combined with an Incus daemon missing the compat sysctl — Ubuntu-archive packages lack it`,
    `fix: install Incus from the Zabbly repo (ships /etc/sysctl.d/50-incus.conf), or set that sysctl to 0 on the host and restart the instance (Launchpad #2109394)`,
  ].join('\n'));
}

// ---------------------------------------------------------------------------
// server flavor + client commit
// ---------------------------------------------------------------------------

export type ServerFlavor = 'linux-x64' | 'linux-arm64' | 'linux-alpine';

export async function probeFlavor(ref: InstanceRef, identity: Identity): Promise<ServerFlavor> {
  const out = await execInInstance(ref, 'uname -m; ldd --version 2>&1 | head -1', { uid: identity.uid, home: identity.home });
  const [arch = '', lddLine = ''] = out.split('\n').map((s) => s.trim());
  if (/musl/i.test(lddLine)) {
    if (arch === 'x86_64') { return 'linux-alpine'; }
    throw new Error(`unsupported instance: musl on ${arch} — no upstream VS Code server build exists (arm64 requires glibc)`);
  }
  if (arch === 'x86_64') { return 'linux-x64'; }
  if (arch === 'aarch64') { return 'linux-arm64'; }
  throw new Error(`unsupported instance architecture: ${arch}`);
}

/**
 * The server commit must equal the local client commit. `vscode.env.appCommit`
 * (resolvers proposal) is the authoritative source; parsing the electron
 * binary's `--version` output (version/commit/arch, like the spike's
 * `code --version | sed -n '2p'`) is the fallback.
 */
export async function resolveClientCommit(): Promise<string> {
  const fromApi = vscode.env.appCommit;
  if (fromApi && /^[0-9a-f]{40}$/i.test(fromApi)) { return fromApi.toLowerCase(); }
  for (const exe of [process.execPath, 'code']) {
    try {
      const out = await new Promise<string>((resolve, reject) => {
        cp.execFile(exe, ['--version'], { timeout: 15_000 }, (err, stdout, stderr) =>
          err ? reject(new Error(stderr || err.message)) : resolve(stdout));
      });
      const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
      const commit = lines[1];
      if (commit && /^[0-9a-f]{40}$/i.test(commit)) { return commit.toLowerCase(); }
    } catch { /* try the next candidate */ }
  }
  throw new Error('could not determine the local VS Code commit — server and client must match by commit');
}

/** Delete client-side cache entries for other commits (regenerable). */
async function pruneServerCache(cacheDir: string, keepCommit: string): Promise<void> {
  try {
    for (const name of await fs.promises.readdir(cacheDir)) {
      if (name.startsWith('vscode-server-') && !name.includes(keepCommit)) {
        await fs.promises.rm(path.join(cacheDir, name), { force: true });
      }
    }
  } catch (err) {
    log(`cache prune skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// tarball download (client-side, cached — DESIGN §3 step 2)
// ---------------------------------------------------------------------------

export async function downloadTarball(context: vscode.ExtensionContext, commit: string, flavor: ServerFlavor, report?: Report): Promise<{ file: string; sha256: string }> {
  const template = vscode.workspace.getConfiguration('remote-incus').get<string>('downloadUrlTemplate') || DEFAULT_URL_TEMPLATE;
  const url = template.replace('{commit}', commit).replace('{flavor}', flavor);
  const cacheDir = path.join(context.globalStorageUri.fsPath, 'server-cache');
  await fs.promises.mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `vscode-server-${flavor}-${commit}.tar.gz`);
  const shaFile = `${file}.sha256`;

  if (fs.existsSync(file) && fs.existsSync(shaFile)) {
    const expected = (await fs.promises.readFile(shaFile, 'utf8')).trim();
    log(`tarball cache hit (${path.basename(file)}) — verifying sha256 …`);
    report?.('verifying cached tarball…');
    const actual = await sha256File(file);
    if (actual === expected) {
      return { file, sha256: actual };
    }
    log('cache entry corrupted (sha256 mismatch) — re-downloading');
  }

  log(`downloading server tarball: ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`server tarball download failed: HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const total = Number(res.headers.get('content-length') ?? 0);
  const partial = `${file}.partial`;
  try {
    let received = 0;
    let nextMark = 64 << 20;
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      async function* (source) {
        for await (const chunk of source) {
          received += chunk.length;
          if (received >= nextMark) {
            nextMark += 64 << 20;
            log(`  … ${(received / 1e6).toFixed(0)} MB`);
          }
          if (total) {
            const pct = (received / total) * 100;
            // Percent FIRST — collapsed toasts append the message to the title
            // and truncate from the right; the number must survive that cut.
            report?.(`${pct.toFixed(0)}% — downloading server`, pct * 0.3); // download phase = 0–30 %
          }
          yield chunk;
        }
      },
      fs.createWriteStream(partial, { mode: 0o644 }),
    );
    const sha256 = await sha256File(partial);
    await fs.promises.writeFile(shaFile, `${sha256}\n`);
    await fs.promises.rename(partial, file); // atomic: cache only ever sees complete files
    log(`download complete: ${(received / 1e6).toFixed(0)} MB, sha256 ${sha256.slice(0, 12)}…`);
    return { file, sha256 };
  } catch (err) {
    await fs.promises.rm(partial, { force: true });
    throw err;
  }
}

async function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// in-instance install steps
// ---------------------------------------------------------------------------

async function ensureTarballInInstance(ref: InstanceRef, identity: Identity, tar: { file: string; sha256: string }, commit: string, flavor: ServerFlavor, report?: Report): Promise<void> {
  const tmp = `/tmp/vscode-server-${flavor}-${commit}.tar.gz`;
  const probe = await execInInstance(ref, `sha256sum ${sq(tmp)} 2>/dev/null | cut -d' ' -f1 || true`, { uid: identity.uid, home: identity.home });
  if (probe.trim() === tar.sha256) {
    log(`tarball already in ${target(ref)} (sha256 match) — skipping push`);
    report?.('server tarball already on instance', 30);
    return;
  }
  log(`pushing server tarball to ${target(ref)}${tmp} (path mode, ${(fs.statSync(tar.file).size / 1e6).toFixed(0)} MB) …`);
  report?.('pushing to instance…', 30);
  // Push AS THE TARGET USER: the extract step runs as the target user and
  // must be able to remove the tarball afterwards — a root-owned file in
  // sticky /tmp (1777) is undeletable for any other uid ("Operation not
  // permitted"; hit live 2026-10-20 on the first fully fresh install —
  // fixture-remote never exercised the extract path, its install was spike-era).
  await pushFile(ref, tar.file, tmp, {
    uid: identity.uid, gid: identity.gid,
    onProgress: (p) => report?.(`${p}% — pushing to instance`, 30 + p * 0.6), // push phase = 30–90 %
  });
  const pushed = await execInInstance(ref, `sha256sum ${sq(tmp)} | cut -d' ' -f1`);
  if (pushed.trim() !== tar.sha256) {
    throw new Error(`tarball corrupted in transit: sha256 ${pushed.trim() || '<none>'} ≠ ${tar.sha256}`);
  }
}

async function isServerInstalled(ref: InstanceRef, identity: Identity, commit: string): Promise<boolean> {
  const dir = `${identity.home}/${VS_SERVER_DIR}/bin/${commit}`;
  const out = await execInInstance(ref, [
    `if [ -f ${sq(`${dir}/.incus-installing`)} ]; then`,
    `  echo no`,
    `elif [ -x ${sq(`${dir}/bin/code-server`)} ] && [ -f ${sq(`${dir}/out/server-main.js`)} ] && [ -x ${sq(`${dir}/node`)} ]; then`,
    `  echo yes`,
    `else`,
    `  echo no`,
    `fi`,
  ].join('\n'), { uid: identity.uid, home: identity.home });
  return out.trim() === 'yes';
}

async function ensureExtracted(ref: InstanceRef, identity: Identity, commit: string, flavor: ServerFlavor, report?: Report): Promise<void> {
  const dir = `${identity.home}/${VS_SERVER_DIR}/bin/${commit}`;
  const marker = `${dir}/.incus-install-ok`;
  report?.('extracting server…', 91);
  if (await isServerInstalled(ref, identity, commit)) {
    log(`server install for ${commit.slice(0, 10)}… already present — skipping extract`);
    // Record success for complete legacy installs too. A marker alone is not proof.
    await execInInstance(ref, `touch ${sq(marker)}`, { uid: identity.uid, home: identity.home });
    return;
  }
  const tmp = `/tmp/vscode-server-${flavor}-${commit}.tar.gz`;
  // rm first: a previously interrupted extract must not leave debris behind.
  await execInInstance(ref, [
    `set -e`,
    `rm -rf ${sq(dir)}`,
    `mkdir -p ${sq(dir)}`,
    `touch ${sq(`${dir}/.incus-installing`)}`,
    `tar -xzf ${sq(tmp)} -C ${sq(dir)} --strip-components=1`,
    `touch ${sq(marker)}`,
    `rm -f ${sq(`${dir}/.incus-installing`)}`,
    `rm -f ${sq(tmp)}`,
  ].join('\n'), { uid: identity.uid, home: identity.home, timeoutMs: 300_000 });
}

/** Relay is tiny — re-stage on every install so asset updates always land. */
async function stageRelay(context: vscode.ExtensionContext, ref: InstanceRef, identity: Identity, report?: Report): Promise<void> {
  report?.('staging relay…', 93);
  const localRelay = path.join(context.asAbsolutePath('.'), 'assets', 'relay.js');
  await pushFile(ref, localRelay, relayPath(identity.home), {
    uid: identity.uid, gid: identity.gid, mode: '600',
  });
}

/**
 * Token lifecycle (DESIGN §4): file delivery only (never argv/env), 0600,
 * owner = target user, fresh-mint when missing, sticky across server restarts.
 * The URL-safe charset guard is mandatory — the server silently rejects
 * tokens containing anything outside [0-9a-zA-Z_-] (spike finding: it fails
 * only after the health check reports OK, which is brutally confusing).
 */
async function ensureToken(ref: InstanceRef, identity: Identity, report?: Report): Promise<void> {
  report?.('preparing token…', 95);
  const dir = `${identity.home}/${VS_SERVER_DIR}/data/Machine`;
  await execInInstance(ref, [
    `set -e`,
    `mkdir -p ${sq(dir)}`,
    `if [ ! -s ${sq(tokenPath(identity.home))} ]; then`,
    `  ( umask 077`,
    `    tr -dc A-Za-z0-9 < /dev/urandom | head -c 43 > ${sq(tokenPath(identity.home))}.tmp`,
    `    test "$(wc -c < ${sq(tokenPath(identity.home))}.tmp)" -eq 43`,
    `    mv ${sq(tokenPath(identity.home))}.tmp ${sq(tokenPath(identity.home))} )`,
    `  echo 'fresh token minted'`,
    `else`,
    `  echo 'token already exists (sticky reuse)'`,
    `fi`,
    `chmod 600 ${sq(tokenPath(identity.home))}`,
  ].join('\n'), { uid: identity.uid, home: identity.home });
}

// ---------------------------------------------------------------------------
// server lifecycle
// ---------------------------------------------------------------------------

/** Commit of a currently running server, if any (root view of /proc). */
async function findRunningServerCommit(ref: InstanceRef): Promise<string | undefined> {
  // Bracketed pattern: `pkill`/`pgrep -f` match their own invoking cmdline —
  // the bash -c payload must never contain the plain name (spike finding).
  // The regex demands EXACTLY 40 hex chars in a bin/<…>/ path — malformed
  // commit dirs can never be mistaken for a server version (verified).
  const out = await execInInstance(ref, `pgrep -af 'serv[e]r-main\\.js' || true`);
  const commits = [...out.matchAll(/bin\/([0-9a-f]{40})\//g)].map((m) => m[1].toLowerCase());
  const unique = [...new Set(commits)];
  log(`running server check: ${unique.length === 0 ? 'none' : `commit ${unique.join(', ')}${commits.length > 1 ? ` (${commits.length} processes)` : ''}`}`);
  return unique[0];
}

export async function killServer(ref: InstanceRef): Promise<void> {
  await execInInstance(ref, `pkill -f 'serv[e]r-main\\.js' 2>/dev/null || true; sleep 0.5`);
}

async function startServer(ref: InstanceRef, identity: Identity, commit: string): Promise<void> {
  const bin = `${identity.home}/${VS_SERVER_DIR}/bin/${commit}/bin/code-server`;
  const logFile = logPath(identity.home);
  await execInInstance(ref, [
    `set -e`,
    `rm -f ${sq(logFile)}`,
    `nohup ${sq(bin)} \\`,
    `  --host 127.0.0.1 --port 0 \\`,
    `  --connection-token-file ${sq(tokenPath(identity.home))} \\`,
    `  --accept-server-license-terms \\`,
    `  > ${sq(logFile)} 2>&1 < /dev/null &`,
    `echo "launched pid $!"`,
  ].join('\n'), { uid: identity.uid, home: identity.home });
}

async function discoverPort(ref: InstanceRef, identity: Identity, report?: Report): Promise<number> {
  const file = logPath(identity.home);
  report?.('waiting for port…', 97);
  for (let i = 0; i < PORT_POLL_TRIES; i++) {
    const out = await execInInstance(ref, `grep -s "Extension host agent listening on" ${sq(file)} || true`, { uid: identity.uid, home: identity.home });
    const hits = [...out.matchAll(/Extension host agent listening on (\d+)/g)];
    if (hits.length > 0) {
      return Number(hits[hits.length - 1][1]);
    }
    await sleep(PORT_POLL_INTERVAL_MS);
  }
  const dump = await execInInstance(ref, `cat ${sq(file)} 2>/dev/null || true`, { uid: identity.uid, home: identity.home });
  throw new Error(`server did not announce a port in time; server.log:\n${dump}`);
}

/** DESIGN §6: after a fresh server start every existing relay is garbage. */
async function sweepOrphanRelays(ref: InstanceRef): Promise<void> {
  await execInInstance(ref, `pkill -f '\\.vscode-serve[r]/relay\\.js' 2>/dev/null || true`);
}

/**
 * Keep only the running commit's install dir. Old-commit dirs are regenerable
 * (the tarball cache rebuilds them) and ~600 MB each — without this, every
 * client auto-update would accumulate one. Safe by this point: killServer has
 * already taken down any other commit's server (a window connected to it
 * reconnects through core's re-resolve into the new server).
 */
async function pruneOldInstalls(ref: InstanceRef, identity: Identity, commit: string): Promise<void> {
  const binRoot = `${identity.home}/${VS_SERVER_DIR}/bin`;
  await execInInstance(ref, [
    `set -e`,
    `cd ${sq(binRoot)}`,
    'for d in */; do',
    '  d=${d%/}',
    `  [ "$d" = ${sq(commit)} ] && continue`,
    '  rm -rf "$d"',
    'done',
  ].join('\n'), { uid: identity.uid, home: identity.home });
}

// ---------------------------------------------------------------------------
// orchestration (concurrency-safe per instance)
// ---------------------------------------------------------------------------

export interface ServerSession {
  ref: InstanceRef;
  identity: Identity;
  commit: string;
  flavor: ServerFlavor;
  port: number;
  token: string;
}

const inflight = new Map<string, Promise<ServerSession>>();

export async function ensureServerReady(context: vscode.ExtensionContext, ref: InstanceRef, report?: Report): Promise<ServerSession> {
  const key = target(ref);
  const pending = inflight.get(key);
  if (pending) { return pending; }
  const p = doEnsureServerReady(context, ref, report).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function doEnsureServerReady(context: vscode.ExtensionContext, ref: InstanceRef, report?: Report): Promise<ServerSession> {
  report?.('connecting to instance…');
  const identity = await resolveIdentity(ref);
  // Fail fast on instances where signals are blocked — BEFORE any transfer
  // work and on every path (a death-looping server still "runs", so the
  // reuse path must be covered too).
  await probeSignalSupport(ref, identity);
  const commit = await resolveClientCommit();
  await pruneServerCache(path.join(context.globalStorageUri.fsPath, 'server-cache'), commit);
  const flavor = await probeFlavor(ref, identity);
  report?.('checking for an existing server…');
  // Snapshot installation validity before any repair, including partial installs.
  const installed = await isServerInstalled(ref, identity, commit);
  // Assess the existing process before bootstrap can recreate its state.
  const running = await findRunningServerCommit(ref);
  let reuse = false;
  if (running) {
    if (running !== commit) {
      log(`server on ${target(ref)} runs stale commit ${running.slice(0, 10)}… — restarting under ${commit.slice(0, 10)}…`);
      await killServer(ref);
    } else {
      // A live process alone is not a healthy server: a wiped ~/.vscode-server
      // (recreated instance, manual cleanup) leaves the process running from
      // memory with its install dir, token file and log GONE — reusing it
      // means polling a nonexistent log forever (seen live 2026-10-19).
      // Verify the on-disk state before trusting the reuse.
      const healthy = (await execInInstance(ref, [
        `test -x ${sq(`${identity.home}/${VS_SERVER_DIR}/bin/${running}/bin/code-server`)} &&`,
        `test -f ${sq(logPath(identity.home))} &&`,
        `test -s ${sq(tokenPath(identity.home))} && echo yes || echo no`,
      ].join(' '))).trim() === 'yes';
      if (healthy && installed) {
        reuse = true;
      } else {
        log(`running server on ${target(ref)} lost its install (zombie) — killing and starting fresh`);
        await killServer(ref);
      }
    }
  }
  if (installed) {
    // The most common case: nothing to transfer at all — not even the local
    // tarball as a sha reference.
    log(`server install for ${commit.slice(0, 10)}… already present — skipping download/push/extract`);
    report?.('server already installed', 90);
  } else {
    const tar = await downloadTarball(context, commit, flavor, report);
    await ensureTarballInInstance(ref, identity, tar, commit, flavor, report);
    await ensureExtracted(ref, identity, commit, flavor, report);
  }
  await stageRelay(context, ref, identity, report);
  await ensureToken(ref, identity, report);

  if (reuse) {
    log(`server already running under ${commit.slice(0, 10)}… — reusing`);
  } else {
    report?.('starting server…', 96);
    await startServer(ref, identity, commit);
  }

  const port = await discoverPort(ref, identity, report);
  if (!reuse) {
    await sweepOrphanRelays(ref);
  }
  report?.('reading token…', 99);
  const token = (await execInInstance(ref, `cat ${sq(tokenPath(identity.home))}`, { uid: identity.uid, home: identity.home })).trim();
  if (!token) {
    throw new Error('could not read the connection token from the instance');
  }
  // Prune is pure hygiene (superseded ~600 MB install dirs); the connection's
  // correctness does not depend on it, so a transient exec hiccup (seen live
  // 2026-10-20: prune exec failed once while the connection itself was ready)
  // is logged and ignored instead of failing a fully-ready connect.
  try {
    await pruneOldInstalls(ref, identity, commit);
  } catch (err: unknown) {
    log(`install prune skipped: ${firstLine(err)}`);
  }
  report?.('ready', 100);
  log(`server ready on ${target(ref)}: commit ${commit.slice(0, 10)}…, 127.0.0.1:${port}, user ${identity.username} (uid ${identity.uid})`);
  return { ref, identity, commit, flavor, port, token };
}

// ---------------------------------------------------------------------------
// parity / hygiene commands (DESIGN §7)
// ---------------------------------------------------------------------------

/** Root rm: must also catch /tmp leftovers pushed by root (mode 644 root:root). */
export async function uninstallServer(ref: InstanceRef, identity: Identity): Promise<void> {
  await execInInstance(ref, [
    `set -e`,
    `rm -rf ${sq(`${identity.home}/${VS_SERVER_DIR}`)}`,
    `rm -f /tmp/vscode-server-*.tar.gz`,
  ].join('\n'));
  identityCache.delete(`${target(ref)}|${vscode.workspace.getConfiguration('remote-incus').get<string>('user', 'default')}`);
}

/** Kill server, drop the token, bring everything back with a fresh one. */
export async function resetToken(context: vscode.ExtensionContext, ref: InstanceRef): Promise<ServerSession> {
  await killServer(ref);
  const identity = await resolveIdentity(ref);
  await execInInstance(ref, `rm -f ${sq(tokenPath(identity.home))}`);
  return ensureServerReady(context, ref);
}
