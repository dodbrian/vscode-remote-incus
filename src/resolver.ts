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

export class IncusAuthorityResolver implements vscode.RemoteAuthorityResolver {
  constructor(private readonly context: vscode.ExtensionContext) {
  }

  async resolve(authority: string, _context: vscode.RemoteAuthorityResolverContext): Promise<vscode.ResolverResult> {
    if (!vscode.ManagedResolvedAuthority) {
      throw new Error('vscode.ManagedResolvedAuthority is undefined — the "resolvers" proposed API was stripped. '
        + 'Enable it once via ~/.vscode/argv.json: "enable-proposed-api": ["local-dev.remote-incus"]');
    }
    const parsed = parseAuthority(authority);
    const remote = parsed.remote ?? (await getDefaultRemote());
    const ref: InstanceRef = { remote, instance: parsed.instance };
    log(`resolve(${authority}) → instance ${remote}:${parsed.instance}`);

    const status = await getInstanceStatus(ref);
    if (status === undefined) {
      throw new Error(`instance "${remote}:${parsed.instance}" not found (deleted or renamed) — refresh the Remote Explorer`);
    }
    if (status !== 'Running') {
      log(`instance is ${status} — starting …`);
      await startInstance(ref);
      if ((await getInstanceStatus(ref)) !== 'Running') {
        // Controllable wait → core re-resolves (DESIGN §6).
        throw vscode.RemoteAuthorityResolverError.TemporarilyNotAvailable(`instance ${remote}:${parsed.instance} is still starting — retrying`);
      }
    }

    const session = await ensureServerReady(this.context, ref);
    log(`resolved ${authority}: commit ${session.commit.slice(0, 10)}…, port ${session.port}, `
      + `user ${session.identity.username} (uid ${session.identity.uid})`);
    return new vscode.ManagedResolvedAuthority(() => openBridge(session), session.token);
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
    return vscode.RemoteAuthorityResolverError.NotAvailable(`Instance for authority "${authority}" not found`, true);
  }
  return new Error(`Failed to resolve "${authority}": ${msg}`);
}
