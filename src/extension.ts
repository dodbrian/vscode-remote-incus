/**
 * "Remote - Incus" — attach to Incus containers as a first-class remote
 * connection type (docs/DESIGN.md). Activates via `onResolveRemoteAuthority:incus`
 * and `onView:remote-incus.instances`.
 */
import * as vscode from 'vscode';
import { AUTHORITY_PREFIX } from './authority';
import { FolderHistory } from './history';
import { IncusAuthorityResolver } from './resolver';
import { InstancesTree } from './tree';
import { registerCommands } from './commands';
import { initLogging, log } from './logging';

export function activate(context: vscode.ExtensionContext): void {
  initLogging(context);
  log(
    `activate: VS Code ${vscode.version}, extension ${context.extension.id} ${(context.extension.packageJSON as { version?: string } | undefined)?.version ?? 'unknown'}`,
  );

  const history = new FolderHistory(context);
  // Record the current window's folder on every ext-host start of a window
  // already sitting on an incus authority — covers reloads, ext-host
  // restarts and opens that bypass our commands. At a FIRST connect the
  // workspace is still empty here; the open commands record at open time
  // (see src/history.ts).
  if (vscode.env.remoteAuthority?.startsWith(`${AUTHORITY_PREFIX}+`)) {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme === 'vscode-remote') {
        history.record(vscode.env.remoteAuthority, folder.uri.path);
      }
    }
  }

  const tree = new InstancesTree(history, context.asAbsolutePath('assets'));
  context.subscriptions.push(
    vscode.workspace.registerRemoteAuthorityResolver(
      AUTHORITY_PREFIX,
      new IncusAuthorityResolver(context, () => {
        tree.refresh();
      }),
    ),
    vscode.window.registerTreeDataProvider('remote-incus.instances', tree),
  );
  registerCommands(context, tree, history);
  log(`registered: resolver prefix "${AUTHORITY_PREFIX}", Remote Explorer tree, commands`);
}

export function deactivate(): void {
  // Nothing to tear down: bridges are core-owned (makeConnection dials), and
  // their incus exec children die via stdin EOF → relay self-exit (DESIGN §6).
}
