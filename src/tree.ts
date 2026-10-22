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
import { formatAuthority } from './authority';
import { getDefaultRemote, InstanceRef, listInstances, listRemotes, RemoteInfo } from './incusCli';
import { FolderHistory } from './history';
import { firstLine, log } from './logging';

export class RemoteNode extends vscode.TreeItem {
  constructor(readonly info: RemoteInfo, readonly isDefault: boolean) {
    super(info.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'remote';
    // No iconPath: remotes render with just the chevron, like folders in the
    // official Remote Explorer (user decision 2026-10-22, Dev Containers UX).
    this.description = `${info.address}${isDefault ? ' (default)' : ''}`;
    this.tooltip = new vscode.MarkdownString(`**${info.name}** — \`${info.address}\` (auth: ${info.authType || 'none'})`);
  }
}

export class InstanceNode extends vscode.TreeItem {
  readonly ref: InstanceRef;
  readonly authority: string;

  constructor(remote: string, inst: { name: string; status: string; os?: string; release?: string }, hasFolders: boolean) {
    super(inst.name, hasFolders ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.ref = { remote, instance: inst.name };
    this.authority = formatAuthority(this.ref);
    const running = inst.status === 'Running';
    this.contextValue = running ? 'instance-running' : 'instance-stopped';
    this.iconPath = new vscode.ThemeIcon(running ? 'vm-running' : 'vm-outline');
    // Plain state description, no click affordance: row click does NOT connect
    // (Dev Containers UX, user decision 2026-10-22, superseding the earlier
    // Remote-SSH parity wiring) — connecting lives only on the two hover icons
    // at the right edge ($(arrow-right) current window, $(empty-window) new
    // window) and the context menu. A stopped instance is still started by the
    // connect flow itself (Start & Connect, DESIGN §7).
    this.description = inst.status;
    this.tooltip = new vscode.MarkdownString(
      `**${inst.name}** (${remote})\n\n- state: \`${inst.status}\``
      + (inst.os ? `\n- image OS: ${inst.os}${inst.release ? ` ${inst.release}` : ''}` : ''));
  }
}

export class FolderNode extends vscode.TreeItem {
  constructor(readonly node: InstanceNode, readonly folderPath: string) {
    // Full path as the label, like the official remote views' `${path}`
    // resource label formatter (Dev Containers UX, 2026-10-22).
    super(folderPath, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'instance-folder';
    this.tooltip = new vscode.MarkdownString(`**${folderPath}** on \`${node.authority}\``);
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
  constructor(private readonly history: FolderHistory) {
  }

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
          return instances.map((i) =>
            new InstanceNode(element.info.name, i, this.history.folders(formatAuthority({ remote: element.info.name, instance: i.name })).length > 0));
        } catch (err) {
          return [new MessageNode(`unavailable: ${firstLine(err)}`, 'warning')];
        }
      }
      if (element instanceof InstanceNode) {
        // The ever-opened folders on this instance (Dev Containers UX):
        // each opens that folder in one go; no history → the node stays a leaf.
        return this.history.folders(element.authority).map((f) => new FolderNode(element, f));
      }
      return [];
    } catch (err) {
      log(`tree: ${firstLine(err)}`);
      return [new MessageNode(`error: ${firstLine(err)}`, 'error')];
    }
  }
}
