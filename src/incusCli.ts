/**
 * Thin typed wrapper around the `incus` CLI.
 *
 * Ground rules (docs/DESIGN.md §2/§7/§8, spike-verified):
 *  - instances are ALWAYS addressed as `<remote>:<instance>` — never assume
 *    `local:` (on the dev host the default remote is a TLS daemon and the unix
 *    socket is not group-accessible);
 *  - `--user` takes numeric uids only (incus 6.0.5);
 *  - non-interactive exec = raw binary pipes (no PTY mangling);
 *  - `incus file push` must run in PATH mode (stdin mode is broken on 6.0.5).
 */
import * as cp from 'child_process';
import * as fs from 'fs';
export class IncusError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly stderr?: string,
  ) {
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
    cp.execFile(
      'incus',
      args,
      { timeout: opts.timeoutMs ?? 30_000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // Line 1 must lead with the WHY (stderr / exit status), never the full
          // command: error toasts and firstLine() truncation cut line 2+, and a
          // multi-line script joined into the command text would swallow them.
          const why = err.killed
            ? 'timed out'
            : `exit ${err.code ?? '?'}: ${(stderr || err.message).trim()}`;
          reject(new IncusError(`incus ${describe(args)} failed (${why})`, args, stderr));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

/** Shell-quote a value interpolated into an in-instance script. */
export function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Compact command preview for messages — full args stay on the error object. */
function describe(args: string[]): string {
  const c = args.indexOf('-c');
  return args[0] === 'exec' && c > 0
    ? `${args.slice(0, c).join(' ')} --<inline script>`
    : args.join(' ');
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
  /** explicit group for file creation; ordinary bootstrap exec keeps its existing default */
  group?: number;
  /** set the HOME env inside the instance (required for user sessions) */
  home?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

/** Run a shell snippet inside an instance (bash assumed; glibc MVP images). */
export async function execInInstance(
  ref: InstanceRef,
  script: string,
  opts: ExecOptions = {},
): Promise<string> {
  const args = ['exec', target(ref), '--mode', 'non-interactive'];
  if (opts.uid !== undefined) {
    args.push('--user', String(opts.uid));
  }
  if (opts.group !== undefined) {
    args.push('--group', String(opts.group));
  }
  if (opts.home) {
    args.push('--env', `HOME=${opts.home}`);
  }
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    args.push('--env', `${k}=${v}`);
  }
  args.push('--', 'bash', '-c', script);
  return incus(args, { timeoutMs: opts.timeoutMs });
}

export interface PushOptions {
  uid?: number;
  gid?: number;
  mode?: string;
  /** reports 0–100 — see the progress-source note below */
  onProgress?: (percent: number) => void;
}

/**
 * Path-mode file push (stdin mode is broken on incus 6.0.5 — never use it).
 *
 * Progress sources, in order of trust (both feed a monotonic max):
 *  - CLI 6.x: prints a "<n>% (<speed>)" meter even when piped — parsed here.
 *  - CLI 7.x: push is SFTP-based (cmd/incus/file.go → sftpCreateFile) and the
 *    meter renderer is TTY-gated (shared/cmd/progress.go: Update() returns
 *    unless stdout is a terminal) — verified 2026-10-22 on 7.5.1: piped AND
 *    pty pushes print NOTHING, and no operation event carries progress
 *    (a file push creates no operation). Fallback: poll the growing target
 *    file's size in the instance (`stat -c %s`) — the SFTP writer extends
 *    the file in place, so the byte count is the real transfer progress.
 */
export function pushFile(
  ref: InstanceRef,
  localPath: string,
  remotePath: string,
  opts: PushOptions = {},
): Promise<void> {
  const args = ['file', 'push', localPath, `${target(ref)}${remotePath}`];
  if (opts.uid !== undefined) {
    args.push('--uid', String(opts.uid));
  }
  if (opts.gid !== undefined) {
    args.push('--gid', String(opts.gid));
  }
  if (opts.mode) {
    args.push('--mode', opts.mode);
  }
  // 222 MB took ~110 s on the measured CLI path; this is not a protocol ceiling.
  return new Promise((resolve, reject) => {
    const child = cp.spawn('incus', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let last = 0;
    let polling = true;
    const isPolling = (): boolean => polling;
    const report = (percent: number): void => {
      if (isPolling() && percent > last) {
        last = percent;
        opts.onProgress?.(last);
      }
    };
    const onData = (d: Buffer): void => {
      output += d.toString();
      if (output.length > 128 * 1024) {
        output = output.slice(-64 * 1024);
      } // the meter rewrites one line
      for (const m of d.toString().matchAll(/(\d+)%/g)) {
        report(Number(m[1]));
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    // 7.x fallback: size-poll the target file (1 Hz; stat hiccups never fail
    // the push). The poller stops with the push; one in-flight stat may
    // outlive it briefly and is ignored.
    let totalBytes = 0;
    try {
      totalBytes = fs.statSync(localPath).size;
    } catch {
      /* size unknown → no % from polls */
    }
    if (totalBytes > 0) {
      void (async () => {
        const probe = [
          'exec',
          target(ref),
          '--',
          'bash',
          '-c',
          `stat -c %s ${sq(remotePath)} 2>/dev/null || echo 0`,
        ];
        while (isPolling()) {
          try {
            const size = Number((await incus(probe, { timeoutMs: 15_000 })).trim());
            if (!isPolling()) {
              break;
            }
            if (Number.isFinite(size) && size > 0) {
              report(Math.min(100, Math.floor((size / totalBytes) * 100)));
            }
          } catch {
            /* transient exec hiccup — the push itself decides success */
          }
          if (!isPolling()) {
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      })();
    }

    const stop = (): void => {
      polling = false;
    };
    const timer = setTimeout(() => {
      stop();
      child.kill();
      reject(new IncusError('incus file push timed out after 15 min', args));
    }, 15 * 60_000);
    child.on('error', (err) => {
      stop();
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      stop();
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new IncusError(
            `incus file push failed (exit ${code ?? 'null'}): ${output.split('\n').pop()?.trim() ?? ''}`,
            args,
            output,
          ),
        );
      }
    });
  });
}

// ---------------------------------------------------------------------------
// daemon state (the source of truth — docs/DESIGN.md §7)
// ---------------------------------------------------------------------------

export interface RemoteInfo {
  name: string;
  address: string;
  protocol: string;
  authType: string;
}

/** Instance daemons only (`Protocol === 'incus'`) — drops simplestreams remotes. */
export async function listRemotes(): Promise<RemoteInfo[]> {
  const raw = JSON.parse(await incus(['remote', 'list', '--format', 'json'])) as Record<
    string,
    { Addr?: string; Protocol?: string; AuthType?: string } & Record<string, unknown>
  >;
  return Object.entries(raw)
    .filter(([, r]) => r.Protocol === 'incus')
    .map(([name, r]) => ({
      name,
      address: r.Addr ?? '',
      protocol: r.Protocol ?? '',
      authType: r.AuthType ?? '',
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
  const raw = JSON.parse(await incus(['list', `${remote}:`, '--format', 'json'])) as Record<
    string,
    unknown
  >[];
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
  // Remote and instance filter must be SEPARATE arguments: CLI 7.x returns no
  // matches for the glued `<remote>:<name>` filter (warning: "did you forget
  // a space"; regressed the resolver pre-flight on 2026-10-20 after the
  // zabbly CLI update), while CLI 6.x and 7.x both accept the space form.
  // Exact-name match afterwards: the positional filter is fuzzy, and another
  // instance must never be mistaken for this one (isolation rule).
  const raw = JSON.parse(
    await incus(['list', `${ref.remote}:`, ref.instance, '--format', 'json']),
  ) as Record<string, unknown>[];
  const hit = raw.find((i) => String(i.name) === ref.instance);
  return hit ? String(hit.status) : undefined;
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
