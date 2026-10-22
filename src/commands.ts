/**
 * Commands behind the Remote Explorer tree. Every instance command resolves
 * its target from the node the user clicked — instances are never addressed
 * positionally (isolation rule: production instances share the daemon).
 */
import * as vscode from 'vscode';
import { formatAuthority } from './authority';
import { Identity, killServer, resetToken, resolveIdentity, uninstallServer } from './bootstrap';
import { FolderHistory } from './history';
import { InstanceRef, restartInstance, startInstance, stopInstance, target } from './incusCli';
import { firstLine, log, showLog } from './logging';
import { openExecTerminal } from './terminal';
import { FolderNode, InstanceNode, InstancesTree } from './tree';

/** Error toast with the same "show log" affordance the progress toast carries. */
function showErrorWithLog(err: unknown): void {
  void vscode.window.showErrorMessage(`Remote - Incus: ${firstLine(err)} ([show log](command:remote-incus.showLog))`);
}

/** Full multi-line error text for the log; toasts take firstLine() instead. */
function fullMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerCommands(context: vscode.ExtensionContext, tree: InstancesTree, history: FolderHistory): void {
  const reg = (id: string, fn: (node?: InstanceNode | FolderNode) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  };

  reg('remote-incus.refresh', () => tree.refresh());
  reg('remote-incus.showLog', () => showLog(false));
  reg('remote-incus.connectToInstance', (node) => node instanceof InstanceNode && connectToInstance(node, tree, history, false));
  reg('remote-incus.connectToInstanceInNewWindow', (node) => node instanceof InstanceNode && connectToInstance(node, tree, history, true));
  reg('remote-incus.connectToFolder', (node) => node instanceof FolderNode && openFolder(node.node.authority, node.folderPath, history, tree, false));
  reg('remote-incus.connectToFolderInNewWindow', (node) => node instanceof FolderNode && openFolder(node.node.authority, node.folderPath, history, tree, true));
  reg('remote-incus.removeFolderFromHistory', (node) => node instanceof FolderNode && removeFolderFromHistory(node, history, tree));
  reg('remote-incus.startInstance', (node) => node instanceof InstanceNode && withRef(node, tree, (ref) => withProgress(`Starting ${ref.instance} …`, () => startInstance(ref))));
  reg('remote-incus.stopInstance', (node) => node instanceof InstanceNode && withRef(node, tree, (ref) => withProgress(`Stopping ${ref.instance} …`, () => stopInstance(ref))));
  reg('remote-incus.restartInstance', (node) => node instanceof InstanceNode && withRef(node, tree, (ref) => withProgress(`Restarting ${ref.instance} …`, () => restartInstance(ref))));
  reg('remote-incus.openTerminal', (node) => node instanceof InstanceNode && withRef(node, tree, async (ref, identity) => openExecTerminal(ref, identity)));
  reg('remote-incus.killServer', (node) => node instanceof InstanceNode && killServerCommand(node, tree));
  reg('remote-incus.uninstallServer', (node) => node instanceof InstanceNode && uninstallServerCommand(node, tree));
  reg('remote-incus.resetToken', (node) => node instanceof InstanceNode && resetTokenCommand(context, node, tree));
  reg('remote-incus.collectDiagnostics', () => collectDiagnostics(context));
}

async function withProgress<T>(title: string, fn: () => Promise<T>): Promise<T> {
  return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, fn);
}

/** Resolve the clicked node into a ref + identity, then run, refresh, surface errors. */
async function withRef(node: InstanceNode, tree: InstancesTree, fn: (ref: InstanceRef, identity: Identity) => Promise<unknown>): Promise<void> {
  try {
    const ref = node.ref;
    const identity = await resolveIdentity(ref);
    await fn(ref, identity);
    tree.refresh();
  } catch (err) {
    log(`command failed: ${fullMessage(err)}`);
    showErrorWithLog(err);
  }
}

/**
 * Single-flow connect: opening the window IS the connection. Core restarts
 * the extension host within ~1 s of vscode.newWindow and runs a fresh
 * resolver.resolve() there (bridges are ext-host-owned and never survive the
 * reload — evidence 2026-10-20), so pre-running ensureServerReady in this
 * command duplicated the entire bootstrap (~18 s ×2, two toasts). The whole
 * flow now runs exactly once, inside the resolve, which carries its own
 * progress toast; a stopped instance is started by the resolve pre-flight
 * (DESIGN §7).
 *
 * One-go reconnect (Dev Containers UX, 2026-10-22): when the instance has an
 * ever-opened folder history, connecting opens the LAST used folder directly
 * (`vscode.openFolder` on a `vscode-remote://` URI — the folder lives in the
 * URI path and is transparent to the resolver); only a never-opened instance
 * falls back to the empty-window host connect.
 */
async function connectToInstance(node: InstanceNode, tree: InstancesTree, history: FolderHistory, newWindow: boolean): Promise<void> {
  const [lastFolder] = history.folders(node.authority);
  if (lastFolder) {
    await openFolder(node.authority, lastFolder, history, tree, newWindow);
    return;
  }
  try {
    log(`connect: opening ${newWindow ? 'a new window' : 'the current window'} on authority ${formatAuthority(node.ref)}`);
    await vscode.commands.executeCommand('vscode.newWindow', {
      remoteAuthority: formatAuthority(node.ref),
      reuseWindow: !newWindow,
    });
    // The (other) window's resolve may have started a stopped instance —
    // cheaply repair stale state icons in THIS window's tree.
    tree.refresh();
  } catch (err) {
    log(`connect failed: ${fullMessage(err)}`);
    showErrorWithLog(err);
  }
}

/**
 * Folder-level open in one step — exactly the official shell mechanics
 * (remote-explorer 0.5.0): `vscode.openFolder(<vscode-remote:// authority/path>)`
 * for the current window, with `forceNewWindow: true` for a new one. Core
 * resolves the authority and opens the folder; the resolver never sees the
 * path.
 */
async function openFolder(authority: string, folderPath: string, history: FolderHistory, tree: InstancesTree, newWindow: boolean): Promise<void> {
  try {
    log(`connect: opening folder ${folderPath} on authority ${authority}${newWindow ? ' (new window)' : ''}`);
    history.record(authority, folderPath);
    const uri = vscode.Uri.from({ scheme: 'vscode-remote', authority, path: folderPath });
    await vscode.commands.executeCommand('vscode.openFolder', uri, ...(newWindow ? [true] : []));
    // The (other) window's resolve may have started a stopped instance —
    // cheaply repair stale state icons in THIS window's tree.
    tree.refresh();
  } catch (err) {
    log(`connect failed: ${fullMessage(err)}`);
    showErrorWithLog(err);
  }
}

async function removeFolderFromHistory(node: FolderNode, history: FolderHistory, tree: InstancesTree): Promise<void> {
  history.remove(node.node.authority, node.folderPath);
  tree.refresh();
}

async function killServerCommand(node: InstanceNode, tree: InstancesTree): Promise<void> {
  try {
    await withProgress(`Killing the VS Code server on ${node.ref.instance} …`, () => killServer(node.ref));
    tree.refresh();
  } catch (err) {
    log(`kill server failed: ${fullMessage(err)}`);
    showErrorWithLog(err);
  }
}

async function uninstallServerCommand(node: InstanceNode, tree: InstancesTree): Promise<void> {
  const ref = node.ref;
  const answer = await vscode.window.showWarningMessage(
    `Uninstall the VS Code server from "${ref.instance}"? Server data (per-instance extensions, workspace state) is removed. The container itself is not touched.`,
    { modal: true },
    'Uninstall');
  if (answer !== 'Uninstall') { return; }
  await withRef(node, tree, async (r, identity) => {
    await withProgress(`Uninstalling the VS Code server from ${r.instance} …`, () => uninstallServer(r, identity));
  });
}

async function resetTokenCommand(context: vscode.ExtensionContext, node: InstanceNode, tree: InstancesTree): Promise<void> {
  const ref = node.ref;
  const answer = await vscode.window.showWarningMessage(
    `Reset the server & connection token on "${ref.instance}"? The server restarts and all connected windows detach.`,
    { modal: true },
    'Reset');
  if (answer !== 'Reset') { return; }
  try {
    await withProgress(`Resetting token and restarting the server on ${ref.instance} …`, () => resetToken(context, ref));
    tree.refresh();
  } catch (err) {
    log(`reset token failed: ${fullMessage(err)}`);
    showErrorWithLog(err);
  }
}

async function collectDiagnostics(context: vscode.ExtensionContext): Promise<void> {
  const { incus, getDefaultRemote, listRemotes, listInstances } = await import('./incusCli');
  log('--- diagnostics ---');
  log(`VS Code ${vscode.version}, client commit ${vscode.env.appCommit ?? 'unknown'}`);
  log(`extension ${context.extension.id} ${context.extension.packageJSON?.version}`);
  log(`current window authority: ${vscode.env.remoteAuthority ?? '(local window)'}`);
  log(`incus CLI: ${(await incus(['version']).catch((e: unknown) => `unavailable: ${firstLine(e)}`)).trim()}`);
  log(`default remote: ${await getDefaultRemote().catch((e: unknown) => `unavailable: ${firstLine(e)}`)}`);
  try {
    for (const r of await listRemotes()) {
      log(`remote ${r.name}: ${r.address} (auth ${r.authType || 'none'})`);
      try {
        for (const i of await listInstances(r.name)) {
          log(`  ${target({ remote: i.remote, instance: i.name })}: ${i.status}`);
        }
      } catch (err: unknown) {
        log(`  <listing failed: ${firstLine(err)}>`);
      }
    }
  } catch (err: unknown) {
    log(`remotes unavailable: ${firstLine(err)}`);
  }
  showLog();
}
