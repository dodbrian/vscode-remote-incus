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
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolve(
    authority: string,
    _context: vscode.RemoteAuthorityResolverContext,
  ): Promise<vscode.ResolverResult> {
    // Runtime guard: the proposed API may be absent in older clients even
    // though the vendored typings declare it.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!vscode.ManagedResolvedAuthority) {
      throw new Error(
        'vscode.ManagedResolvedAuthority is undefined — the "resolvers" proposed API was stripped. ' +
          'Enable it once via ~/.vscode/argv.json: "enable-proposed-api": ["local-dev.remote-incus"]',
      );
    }
    const parsed = parseAuthority(authority);
    // Progress toast with a clickable "(show log)" link — the Dev Containers /
    // Remote-SSH parity UX (DESIGN §7); the slow first bootstrap (download,
    // push, extract) must never be a silent spinner.
    return await withProgressReport(`Connecting to ${parsed.instance}`, async (report) => {
      const remote = parsed.remote ?? (await getDefaultRemote());
      const ref: InstanceRef = { remote, instance: parsed.instance };
      log(`resolve(${authority}) → instance ${remote}:${parsed.instance}`);

      report('checking instance state…');
      const status = await getInstanceStatus(ref);
      if (status === undefined) {
        throw new Error(
          `instance "${remote}:${parsed.instance}" not found (deleted or renamed) — refresh the Remote Explorer`,
        );
      }
      if (status !== 'Running') {
        report(`starting instance…`);
        log(`instance is ${status} — starting …`);
        await startInstance(ref);
        if ((await getInstanceStatus(ref)) !== 'Running') {
          // Controllable wait → core re-resolves (DESIGN §6).
          throw vscode.RemoteAuthorityResolverError.TemporarilyNotAvailable(
            `instance ${remote}:${parsed.instance} is still starting — retrying`,
          );
        }
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
  if (/not found|No such/i.test(msg)) {
    // Deleted/renamed instance: unresolvable, never auto-recreated.
    return vscode.RemoteAuthorityResolverError.NotAvailable(
      `Instance for authority "${authority}" not found`,
      true,
    );
  }
  return new Error(`Failed to resolve "${authority}": ${msg}`);
}
