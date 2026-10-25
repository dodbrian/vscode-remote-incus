/**
 * The remote authority resolver. Registered for prefix `incus` (DESIGN §1).
 *
 * Pre-flight per DESIGN §7: the Incus daemon is the source of truth. A stopped
 * instance is started inline (the "Start & connect" pre-flight); a deleted
 * instance surfaces a distinct error and never auto-recreates.
 */
import * as vscode from 'vscode';
import { parseAuthority } from './authority';
import { ensureServerReady } from './bootstrap';
import { openBridge } from './bridge';
import { getDefaultRemote, getInstanceStatus, InstanceRef, startInstance } from './incusCli';
import { firstLine, log } from './logging';
import { withProgressReport } from './progress';

export class IncusAuthorityResolver implements vscode.RemoteAuthorityResolver {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly refreshInstances?: () => void,
  ) {}

  async resolve(
    authority: string,
    context: vscode.RemoteAuthorityResolverContext,
  ): Promise<vscode.ResolverResult> {
    try {
      return await this.resolveAuthority(authority, context);
    } catch (err) {
      log(
        `resolve(${authority}) failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      throw toResolverError(err, authority);
    }
  }

  private unavailable(ref: InstanceRef): never {
    this.refreshInstances?.();
    throw vscode.RemoteAuthorityResolverError.NotAvailable(
      `instance "${ref.remote}:${ref.instance}" not found (deleted or renamed) — refresh the Remote Explorer`,
    );
  }

  private async resolveAuthority(
    authority: string,
    _context: vscode.RemoteAuthorityResolverContext,
  ): Promise<vscode.ResolverResult> {
    // Runtime guard: the proposed API may be absent in older clients even
    // though the vendored typings declare it.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!vscode.ManagedResolvedAuthority) {
      throw new Error(
        'vscode.ManagedResolvedAuthority is undefined — the "resolvers" proposed API was stripped. ' +
          `Enable it once via ~/.vscode/argv.json: "enable-proposed-api": [${JSON.stringify(this.context.extension.id)}]`,
      );
    }
    const parsed = parseAuthority(authority);
    // Core gates the Ports view on this context, including for managed
    // connections. Forwarding itself uses core's default remote-agent path.
    await vscode.commands.executeCommand('setContext', 'forwardedPortsViewEnabled', true);
    // Progress toast with a clickable "(show log)" link — the Dev Containers /
    // Remote-SSH parity UX (DESIGN §7); the slow first bootstrap (download,
    // push, extract) must never be a silent spinner.
    return await withProgressReport(`Connecting to ${parsed.instance}`, async (report) => {
      const remote = parsed.remote ?? (await getDefaultRemote());
      const ref: InstanceRef = { remote, instance: parsed.instance };
      log(`resolve(${authority}) → instance ${remote}:${parsed.instance}`);

      report('checking instance state…');
      const status = await getInstanceStatus(ref);
      if (status === undefined) this.unavailable(ref);
      if (status === 'Starting') {
        throw vscode.RemoteAuthorityResolverError.TemporarilyNotAvailable(
          `instance ${remote}:${parsed.instance} is still starting — retrying`,
        );
      }
      if (status === 'Stopped') {
        report('starting instance…');
        log(`instance is ${status} — starting …`);
        await startInstance(ref);
        const afterStart = await getInstanceStatus(ref);
        if (afterStart === undefined) this.unavailable(ref);
        if (afterStart === 'Stopped' || afterStart === 'Starting') {
          throw vscode.RemoteAuthorityResolverError.TemporarilyNotAvailable(
            `instance ${remote}:${parsed.instance} is still starting (state: ${afterStart}) — retrying`,
          );
        }
        if (afterStart !== 'Running') {
          throw new Error(
            `instance ${remote}:${parsed.instance} entered ${afterStart} while starting`,
          );
        }
      } else if (status !== 'Running') {
        throw new Error(
          `instance ${remote}:${parsed.instance} is ${status} — make it Running or Stopped before connecting`,
        );
      }

      const session = await ensureServerReady(this.context, ref, report);
      log(
        `resolved ${authority}: commit ${session.commit.slice(0, 10)}…, port ${session.port}, ` +
          `user ${session.identity.username} (uid ${session.identity.uid})`,
      );
      return new vscode.ManagedResolvedAuthority(() => openBridge(session), session.token);
    });
  }
}

/** Map unexpected failures into the resolver error taxonomy (DESIGN §7). */
export function toResolverError(err: unknown, authority: string): Error {
  if (err instanceof vscode.RemoteAuthorityResolverError) {
    return err;
  }
  const msg = firstLine(err);
  return new Error(`Failed to resolve "${authority}": ${msg}`, { cause: err });
}
