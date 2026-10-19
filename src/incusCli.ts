/**
 * Thin typed wrapper around the `incus` CLI.
 *
 * Ground rules (DESIGN.md §2/§7/§8, spike-verified):
 *  - instances are ALWAYS addressed as `<remote>:<instance>` — never assume
 *    `local:` (on the dev host the default remote is a TLS daemon and the unix
 *    socket is not group-accessible);
 *  - `--user` takes numeric uids only (incus 6.0.5);
 *  - non-interactive exec = raw binary pipes (no PTY mangling);
 *  - `incus file push` must run in PATH mode (stdin mode is broken on 6.0.5).
 */
import * as cp from 'child_process';
export class IncusError extends Error {
  constructor(message: string, readonly args: string[], readonly stderr?: string) {
    super(message);
    this.name = 'IncusError';
  }
}

export interface IncusRunOptions {
  timeoutMs?: number;
}

/** Run `incus` and capture stdout. Non-zero exit rejects with an IncusError. */
export function incus(args: string[], opts: IncusRunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile('incus', args, { timeout: opts.timeoutMs ?? 30_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new IncusError(`incus ${args.join(' ')} failed: ${(stderr || err.message).trim()}`, args, stderr));
      } else {
        resolve(stdout);
      }
    });
  });
}

/** Spawn `incus` with piped stdio (used for the long-lived exec bridges). */
export function incusSpawn(args: string[]): cp.ChildProcess {
  return cp.spawn('incus', args, { stdio: ['pipe', 'pipe', 'pipe'] });
}

// ---------------------------------------------------------------------------
// instance addressing
// ---------------------------------------------------------------------------

export interface InstanceRef {
  remote: string;
  instance: string;
}

export const target = (ref: InstanceRef): string => `${ref.remote}:${ref.instance}`;

export interface ExecOptions {
  /** numeric uid for `--user` (omit to run as root) */
  uid?: number;
  /** set the HOME env inside the instance (required for user sessions) */
  home?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

/** Run a shell snippet inside an instance (bash assumed; glibc MVP images). */
export async function execInInstance(ref: InstanceRef, script: string, opts: ExecOptions = {}): Promise<string> {
  const args = ['exec', target(ref), '--mode', 'non-interactive'];
  if (opts.uid !== undefined) { args.push('--user', String(opts.uid)); }
  if (opts.home) { args.push('--env', `HOME=${opts.home}`); }
  for (const [k, v] of Object.entries(opts.env ?? {})) { args.push('--env', `${k}=${v}`); }
  args.push('--', 'bash', '-c', script);
  return incus(args, { timeoutMs: opts.timeoutMs });
}

export interface PushOptions {
  uid?: number;
  gid?: number;
  mode?: string;
  /** reports 0–100, parsed from the CLI's own progress meter */
  onProgress?: (percent: number) => void;
}

/**
 * Path-mode file push (stdin mode is broken on incus 6.0.5 — never use it).
 * The CLI prints a "<n>% (<speed>)" meter even when piped; it is streamed and
 * parsed so the UI gets real transfer progress.
 */
export function pushFile(ref: InstanceRef, localPath: string, remotePath: string, opts: PushOptions = {}): Promise<void> {
  const args = ['file', 'push', localPath, `${target(ref)}${remotePath}`];
  if (opts.uid !== undefined) { args.push('--uid', String(opts.uid)); }
  if (opts.gid !== undefined) { args.push('--gid', String(opts.gid)); }
  if (opts.mode) { args.push('--mode', opts.mode); }
  // 222 MB at the ~2.1 MB/s websocket ceiling ≈ 110 s (spike); generous ceiling.
  return new Promise((resolve, reject) => {
    const child = cp.spawn('incus', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let last = 0;
    const onData = (d: Buffer): void => {
      output += d.toString();
      if (output.length > 128 * 1024) { output = output.slice(-64 * 1024); } // the meter rewrites one line
      for (const m of d.toString().matchAll(/(\d+)%/g)) {
        last = Number(m[1]);
      }
      opts.onProgress?.(last);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    const timer = setTimeout(() => {
      child.kill();
      reject(new IncusError('incus file push timed out after 15 min', args));
    }, 15 * 60_000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new IncusError(`incus file push failed (exit ${code}): ${output.split('\n').pop()?.trim() ?? ''}`, args, output));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// daemon state (the source of truth — DESIGN.md §7)
// ---------------------------------------------------------------------------

export interface RemoteInfo {
  name: string;
  address: string;
  protocol: string;
  authType: string;
}

/** Instance daemons only (`Protocol === 'incus'`) — drops simplestreams remotes. */
export async function listRemotes(): Promise<RemoteInfo[]> {
  const raw = JSON.parse(await incus(['remote', 'list', '--format', 'json'])) as Record<string, Record<string, unknown>>;
  return Object.entries(raw)
    .filter(([, r]) => r.Protocol === 'incus')
    .map(([name, r]) => ({
      name,
      address: String(r.Addr ?? ''),
      protocol: String(r.Protocol ?? ''),
      authType: String(r.AuthType ?? ''),
    }));
}

export async function getDefaultRemote(): Promise<string> {
  return (await incus(['remote', 'get-default'])).trim();
}

export interface InstanceInfo {
  remote: string;
  name: string;
  status: string;
  os?: string;
  release?: string;
}

export async function listInstances(remote: string): Promise<InstanceInfo[]> {
  const raw = JSON.parse(await incus(['list', `${remote}:`, '--format', 'json'])) as Record<string, unknown>[];
  return raw.map((i) => {
    const cfg = (i.config ?? {}) as Record<string, string>;
    return {
      remote,
      name: String(i.name),
      status: String(i.status),
      os: cfg['image.os'],
      release: cfg['image.release'],
    };
  });
}

/** Undefined ⇒ the instance does not exist (deleted/renamed). */
export async function getInstanceStatus(ref: InstanceRef): Promise<string | undefined> {
  const raw = JSON.parse(await incus(['list', target(ref), '--format', 'json'])) as Record<string, unknown>[];
  return raw[0] ? String(raw[0].status) : undefined;
}

export async function startInstance(ref: InstanceRef): Promise<void> {
  await incus(['start', target(ref)], { timeoutMs: 120_000 });
}

export async function stopInstance(ref: InstanceRef): Promise<void> {
  await incus(['stop', target(ref)], { timeoutMs: 120_000 });
}

export async function restartInstance(ref: InstanceRef): Promise<void> {
  await incus(['restart', target(ref)], { timeoutMs: 180_000 });
}
