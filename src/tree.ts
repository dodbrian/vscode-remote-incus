/**
 * Remote Explorer tree (`contribViewsRemote`): remotes → instances.
 *
 * Contract notes (spike-verified, DESIGN §8):
 *  - the view joins the Remote Explorer switcher via `remoteName` ("incus" =
 *    our authority prefix) and `group: "targets@N"` — the selected view takes
 *    over the whole viewlet and auto-selects in windows connected to an
 *    `incus+…` authority;
 *  - per-remote listing errors degrade to a leaf node (the daemon is the
 *    source of truth; e.g. an inaccessible `local:` socket on the dev host);
 *  - state icons: running (connectable) / stopped (startable).
 */
import * as vscode from 'vscode';
import { getDefaultRemote, InstanceRef, listInstances, listRemotes, RemoteInfo } from './incusCli';
import { firstLine, log } from './logging';

export class RemoteNode extends vscode.TreeItem {
  constructor(readonly info: RemoteInfo, readonly isDefault: boolean) {
    super(info.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'remote';
    this.iconPath = new vscode.ThemeIcon('remote');
    this.description = `${info.address}${isDefault ? ' (default)' : ''}`;
    this.tooltip = new vscode.MarkdownString(`**${info.name}** — \`${info.address}\` (auth: ${info.authType || 'none'})`);
  }
}

export class InstanceNode extends vscode.TreeItem {
  readonly ref: InstanceRef;

  constructor(remote: string, inst: { name: string; status: string; os?: string; release?: string }) {
    super(inst.name, vscode.TreeItemCollapsibleState.None);
    this.ref = { remote, instance: inst.name };
    const running = inst.status === 'Running';
    this.contextValue = running ? 'instance-running' : 'instance-stopped';
    this.iconPath = new vscode.ThemeIcon(running ? 'vm-running' : 'vm-outline');
    if (running) {
      this.description = inst.status;
    } else {
      // Click still connects: the connect command starts a stopped instance
      // first (Start & Connect, DESIGN §7).
      this.description = `${inst.status} — click to start & connect`;
    }
    this.tooltip = new vscode.MarkdownString(
      `**${inst.name}** (${remote})\n\n- state: \`${inst.status}\``
      + (inst.os ? `\n- image OS: ${inst.os}${inst.release ? ` ${inst.release}` : ''}` : ''));
    // Click = connect in the current window, both states (Remote-SSH parity:
    // connect commands also sit in the context menu / hover icons, and
    // "Connect in New Window..." is a separate command).
    this.command = { command: 'remote-incus.connectToInstance', title: 'Connect', arguments: [this] };
  }
}

export class MessageNode extends vscode.TreeItem {
  constructor(label: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = 'message';
  }
}

export class InstancesTree implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChange.event;

  refresh(): void {
    this.onDidChange.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    try {
      if (!element) {
        const [remotes, def] = await Promise.all([
          listRemotes(),
          getDefaultRemote().catch(() => undefined),
        ]);
        return remotes.map((r) => new RemoteNode(r, r.name === def));
      }
      if (element instanceof RemoteNode) {
        try {
          const instances = await listInstances(element.info.name);
          return instances.map((i) => new InstanceNode(element.info.name, i));
        } catch (err) {
          return [new MessageNode(`unavailable: ${firstLine(err)}`, 'warning')];
        }
      }
      return [];
    } catch (err) {
      log(`tree: ${firstLine(err)}`);
      return [new MessageNode(`error: ${firstLine(err)}`, 'error')];
    }
  }
}
