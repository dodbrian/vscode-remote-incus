/**
 * The exec-stdio bridge: one `incus exec` per logical channel, child stdio
 * wrapped as `vscode.ManagedMessagePassing` (DESIGN §2). Core dials
 * `makeConnection()` once per channel (management + ext host, plus one per
 * forwarded port) and holds each connection open.
 */
import * as vscode from 'vscode';
import { incusSpawn, target } from './incusCli';
import { log } from './logging';
import { ServerSession } from './bootstrap';

export function openBridge(session: ServerSession): Promise<vscode.ManagedMessagePassing> {
  return new Promise((resolve, reject) => {
    const { ref, identity, commit, port } = session;
    const nodeBin = `${identity.home}/.vscode-server/bin/${commit}/node`;
    const remoteRelay = `${identity.home}/.vscode-server/relay.js`;
    log(
      `bridge: spawning exec transport for ${target(ref)} → 127.0.0.1:${port} (as ${identity.username})`,
    );

    const child = incusSpawn([
      'exec',
      target(ref),
      '--mode',
      'non-interactive',
      '--user',
      String(identity.uid),
      '--env',
      `HOME=${identity.home}`,
      '--env',
      'RELAY_HOST=127.0.0.1',
      '--env',
      `RELAY_PORT=${String(port)}`,
      '--',
      nodeBin,
      remoteRelay,
    ]);

    const receive = new vscode.EventEmitter<Uint8Array>();
    const closed = new vscode.EventEmitter<Error | undefined>();
    const ended = new vscode.EventEmitter<void>();

    child.stdout?.on('data', (d: Buffer) => {
      if (!terminal) {
        receive.fire(new Uint8Array(d));
      }
    });
    child.stderr?.on('data', (d: Buffer) => {
      const line = d.toString().trim();
      if (line) {
        log(`[bridge ${target(ref)} stderr] ${line}`);
      }
    });
    let terminal = false;
    let published = false;
    const finish = (error?: Error): void => {
      if (terminal) {
        return;
      }
      terminal = true;
      if (!published) {
        reject(error ?? new Error('exec bridge closed before spawn'));
      }
      if (error) {
        closed.fire(error);
      } else {
        ended.fire();
      }
      receive.dispose();
      closed.dispose();
      ended.dispose();
    };
    // Reject failed spawns before publication; established channels report closure.
    child.on('error', (error: Error) => {
      finish(error);
    });
    // exit may precede the final stdout bytes. close waits for stdio drainage.
    child.on('close', (code, signal) => {
      log(`bridge to ${target(ref)} closed: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      finish(
        code === 0
          ? undefined
          : new Error(`exec bridge died: code=${code ?? 'null'} signal=${signal ?? 'null'}`),
      );
    });

    child.once('spawn', () => {
      if (terminal) {
        return;
      }
      published = true;
      resolve({
        onDidReceiveMessage: receive.event,
        onDidClose: closed.event,
        onDidEnd: ended.event,
        send: (data: Uint8Array) => {
          if (child.stdin && !child.stdin.destroyed) {
            child.stdin.write(Buffer.from(data));
          }
        },
        end: () => {
          if (child.stdin && !child.stdin.destroyed) {
            child.stdin.end();
          }
        },
      });
    });
  });
}
