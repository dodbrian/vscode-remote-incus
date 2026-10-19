/**
 * "Remote - Incus" — attach to Incus containers as a first-class remote
 * connection type (DESIGN.md). Activates via `onResolveRemoteAuthority:incus`
 * and `onView:remote-incus.instances`.
 */
import * as vscode from 'vscode';
import { AUTHORITY_PREFIX } from './authority';
import { IncusAuthorityResolver } from './resolver';
import { InstancesTree } from './tree';
import { registerCommands } from './commands';
import { initLogging, log } from './logging';

export function activate(context: vscode.ExtensionContext): void {
  initLogging(context);
  log(`activate: VS Code ${vscode.version}, extension ${context.extension.id} ${context.extension.packageJSON?.version}`);

  const tree = new InstancesTree();
  context.subscriptions.push(
    vscode.workspace.registerRemoteAuthorityResolver(AUTHORITY_PREFIX, new IncusAuthorityResolver(context)),
    vscode.window.registerTreeDataProvider('remote-incus.instances', tree),
  );
  registerCommands(context, tree);
  log(`registered: resolver prefix "${AUTHORITY_PREFIX}", Remote Explorer tree, commands`);
}

export function deactivate(): void {
  // Nothing to tear down: bridges are core-owned (makeConnection dials), and
  // their incus exec children die via stdin EOF → relay self-exit (DESIGN §6).
}
