/**
 * Commands behind the Remote Explorer tree. Every instance command resolves
 * its target from the node the user clicked — instances are never addressed
 * positionally (isolation rule: production instances share the daemon).
 */
import * as vscode from 'vscode';
import { formatAuthority } from './authority';
import { ensureServerReady, Identity, killServer, resetToken, resolveIdentity, uninstallServer } from './bootstrap';
import { InstanceRef, restartInstance, startInstance, stopInstance, target } from './incusCli';
import { firstLine, log, showLog } from './logging';
import { withProgressReport } from './progress';
import { openExecTerminal } from './terminal';
import { InstanceNode, InstancesTree } from './tree';

/** Error toast with the same "show log" affordance the progress toast carries. */
function showErrorWithLog(err: unknown): void {
  void vscode.window.showErrorMessage(`Remote - Incus: ${firstLine(err)} ([show log](command:remote-incus.showLog))`);
}

export function registerCommands(context: vscode.ExtensionContext, tree: InstancesTree): void {
  const reg = (id: string, fn: (node?: InstanceNode) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  };

  reg('remote-incus.refresh', () => tree.refresh());
  reg('remote-incus.showLog', () => showLog(false));
  reg('remote-incus.connectToInstance', (node) => node && connectToInstance(context, node, tree));
  reg('remote-incus.startInstance', (node) => node && withRef(node, tree, (ref) => withProgress(`Starting ${ref.instance} …`, () => startInstance(ref))));
  reg('remote-incus.stopInstance', (node) => node && withRef(node, tree, (ref) => withProgress(`Stopping ${ref.instance} …`, () => stopInstance(ref))));
  reg('remote-incus.restartInstance', (node) => node && withRef(node, tree, (ref) => withProgress(`Restarting ${ref.instance} …`, () => restartInstance(ref))));
  reg('remote-incus.openTerminal', (node) => node && withRef(node, tree, async (ref, identity) => openExecTerminal(ref, identity)));
  reg('remote-incus.killServer', (node) => node && killServerCommand(node, tree));
  reg('remote-incus.uninstallServer', (node) => node && uninstallServerCommand(node, tree));
  reg('remote-incus.resetToken', (node) => node && resetTokenCommand(context, node, tree));
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
    log(`command failed: ${firstLine(err)}`);
    showErrorWithLog(err);
  }
}

async function connectToInstance(context: vscode.ExtensionContext, node: InstanceNode, tree: InstancesTree): Promise<void> {
  try {
    const ref = node.ref;
    const stopped = node.contextValue === 'instance-stopped';
    if (stopped) {
      await withProgress(`Starting ${ref.instance} …`, () => startInstance(ref));
      tree.refresh();
    }
    // Prepare the server HERE with progress UI (DESIGN §7 pre-flight slot), so
    // the window's resolve() itself is fast — the first install (222 MB push)
    // must not race core's resolve handling. Toast title carries the
    // "(show log)" link; per-step percentages stream into the message line.
    await withProgressReport(`Preparing ${ref.instance}`, (report) => ensureServerReady(context, ref, report));
    log(`connect: opening a new window on authority ${formatAuthority(ref)}`);
    await vscode.commands.executeCommand('vscode.newWindow', {
      remoteAuthority: formatAuthority(ref),
      reuseWindow: false,
    });
  } catch (err) {
    log(`connect failed: ${firstLine(err)}`);
    showErrorWithLog(err);
  }
}

async function killServerCommand(node: InstanceNode, tree: InstancesTree): Promise<void> {
  try {
    await withProgress(`Killing the VS Code server on ${node.ref.instance} …`, () => killServer(node.ref));
    tree.refresh();
  } catch (err) {
    log(`kill server failed: ${firstLine(err)}`);
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
    log(`reset token failed: ${firstLine(err)}`);
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
