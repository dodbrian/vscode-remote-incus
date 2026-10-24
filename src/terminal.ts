/**
 * Escape-hatch terminal over `incus exec` (DESIGN §7): no sshd means no plain
 * `ssh` fallback, so the extension must provide the rescue path into the
 * instance when the remote connection is broken.
 *
 * Implementation: a Pseudoterminal wired to plain pipes on the host side,
 * with util-linux `script` allocating a real PTY inside the instance (so
 * line-editing, colors and job control work). Resize propagation is not
 * implemented — acceptable for a rescue path; the real terminal during a
 * connection is core-provided over the management channel anyway.
 */
import * as cp from 'child_process';
import * as vscode from 'vscode';
import { Identity } from './bootstrap';
import { incusSpawn, InstanceRef, target } from './incusCli';
import { log } from './logging';

export function openExecTerminal(ref: InstanceRef, identity: Identity): void {
  const terminal = vscode.window.createTerminal({
    name: `${ref.instance} (incus exec)`,
    pty: new ExecPty(ref, identity),
  });
  terminal.show();
}

class ExecPty implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<void>();
  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;

  private child: cp.ChildProcess | undefined;

  constructor(
    private readonly ref: InstanceRef,
    private readonly identity: Identity,
  ) {}

  open(initialDimensions?: vscode.TerminalDimensions): void {
    const cols = initialDimensions?.columns ?? 80;
    const rows = initialDimensions?.rows ?? 24;
    // Run the wrapper through POSIX sh even if the inherited SHELL is missing.
    // Select before exec: a failing interactive shell must not launch a second one.
    const inner = `stty rows ${rows} cols ${cols} 2>/dev/null; if command -v bash >/dev/null 2>&1; then exec bash; else exec /bin/sh; fi`;
    log(`terminal: opening exec shell on ${target(this.ref)} as ${this.identity.username}`);
    this.child = incusSpawn([
      'exec',
      target(this.ref),
      '--user',
      String(this.identity.uid),
      '--env',
      `HOME=${this.identity.home}`,
      '--env',
      'TERM=xterm-256color',
      '--env',
      'SHELL=/bin/sh',
      '--',
      'script',
      '-qec',
      inner,
      '/dev/null',
    ]);
    this.child.stdout?.on('data', (d: Buffer) => {
      this.writeEmitter.fire(d.toString());
    });
    this.child.stderr?.on('data', (d: Buffer) => {
      this.writeEmitter.fire(d.toString());
    });
    this.child.on('error', (err) => {
      log(`terminal exec failed: ${err.message}`);
      this.writeEmitter.fire(`\r\n[remote-incus] exec failed: ${err.message}\r\n`);
      this.closeEmitter.fire();
    });
    this.child.on('exit', (code, signal) => {
      log(`terminal exec exited: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      this.closeEmitter.fire();
    });
  }

  handleInput(data: string): void {
    if (this.child?.stdin && !this.child.stdin.destroyed) {
      this.child.stdin.write(data);
    }
  }

  close(): void {
    this.child?.kill();
    this.closeEmitter.fire();
  }

  dispose(): void {
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }
}
