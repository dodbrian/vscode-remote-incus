/**
 * Remote Explorer tree (`contribViewsRemote`): remotes → instances → folders.
 *
 * Contract notes (spike-verified, DESIGN §8):
 *  - the view joins the Remote Explorer switcher via `remoteName` ("incus" =
 *    our authority prefix) and `group: "targets@1"` — the selected view takes
 *    over the whole viewlet and auto-selects in windows connected to an
 *    `incus+…` authority;
 *  - per-remote listing errors degrade to a leaf node (the daemon is the
 *    source of truth; e.g. an inaccessible `local:` socket on the dev host);
 *  - the tree renders ALWAYS EXPANDED (remotes, and instances that hold
 *    ever-opened folders), mirroring the Dev Containers explorer;
 *  - the CURRENT session (this window's `incus+…` authority + workspace
 *    folder) is marked with a green check-dot on the instance icon and the
 *    connected folder row — also mirrored from Dev Containers, which bakes
 *    the badge into its SVG icons (ThemeIcons cannot carry overlays);
 *  - state icons: running (connectable) / stopped (startable, dim).
 */
import * as vscode from 'vscode';
import { AUTHORITY_PREFIX, formatAuthority } from './authority';
import { getDefaultRemote, InstanceRef, listInstances, listRemotes, RemoteInfo } from './incusCli';
import { FolderHistory } from './history';
import { firstLine, log } from './logging';

/** This window's remote session, if it sits on one of our authorities. */
interface Session {
  authority: string;
  folder?: string;
}

function getSession(): Session | undefined {
  const authority = vscode.env.remoteAuthority;
  if (!authority?.startsWith(`${AUTHORITY_PREFIX}+`)) { return undefined; }
  const folder = (vscode.workspace.workspaceFolders ?? [])
    .find((f) => f.uri.scheme === 'vscode-remote' && f.uri.authority === authority)?.uri.path;
  return { authority, folder };
}

export class RemoteNode extends vscode.TreeItem {
  constructor(readonly info: RemoteInfo, readonly isDefault: boolean) {
    super(info.name, vscode.TreeItemCollapsibleState.Expanded);
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

  constructor(remote: string, inst: { name: string; status: string; os?: string; release?: string },
    opts: { online: boolean; hasFolders: boolean; icon: vscode.IconPath }) {
    super(inst.name, opts.hasFolders ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    this.ref = { remote, instance: inst.name };
    this.authority = formatAuthority(this.ref);
    this.contextValue = inst.status === 'Running' ? 'instance-running' : 'instance-stopped';
    this.iconPath = opts.icon;
    // Plain state description, no click affordance: row click does NOT connect
    // (Dev Containers UX, user decision 2026-10-22, superseding the earlier
    // Remote-SSH parity wiring) — connecting lives only on the two hover icons
    // at the right edge ($(arrow-right) current window, $(empty-window) new
    // window) and the context menu. A stopped instance is still started by the
    // connect flow itself (Start & Connect, DESIGN §7).
    this.description = inst.status === 'Running' || inst.status === 'Stopped' ? undefined : inst.status;
    this.tooltip = new vscode.MarkdownString(
      `**${inst.name}** (${remote})\n\n- state: \`${inst.status}\``
      + (inst.os ? `\n- image OS: ${inst.os}${inst.release ? ` ${inst.release}` : ''}` : ''));
  }
}

export class FolderNode extends vscode.TreeItem {
  constructor(readonly node: InstanceNode, readonly folderPath: string, icon: vscode.IconPath) {
    // Full path as the label, like the official remote views' `${path}`
    // resource label formatter (Dev Containers UX, 2026-10-22).
    super(folderPath, vscode.TreeItemCollapsibleState.None);
    this.iconPath = icon;
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
  constructor(private readonly history: FolderHistory, private readonly assetsRoot: string) {
  }

  private readonly onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChange.event;

  refresh(): void {
    this.onDidChange.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  private icon(name: string): vscode.IconPath {
    // Public microsoft/vscode-icons assets, unchanged under CC BY 4.0.
    // Source revision and attribution: ThirdPartyNotices.md.
    return {
      light: vscode.Uri.file(`${this.assetsRoot}/light/${name}.svg`),
      dark: vscode.Uri.file(`${this.assetsRoot}/dark/${name}.svg`),
    };
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    try {
      const session = getSession();
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
          return instances.map((i) => {
            const authority = formatAuthority({ remote: element.info.name, instance: i.name });
            const hasFolders = this.history.folders(authority).length > 0;
            const online = session?.authority === authority;
            return new InstanceNode(element.info.name, i, {
              online,
              hasFolders,
              // Dev Containers uses theme icons for disconnected containers;
              // only the connected container uses the check-dot SVG.
              icon: online ? this.icon('vm-active')
                : new vscode.ThemeIcon(i.status === 'Running' ? 'vm-running' : 'vm'),
            });
          });
        } catch (err) {
          return [new MessageNode(`unavailable: ${firstLine(err)}`, 'warning')];
        }
      }
      if (element instanceof InstanceNode) {
        // The ever-opened folders on this instance (Dev Containers UX):
        // each opens that folder in one go; no history → the node stays a leaf.
        // The ACTIVE row is marked only when BOTH the authority and the folder
        // path match the current window — the same path on a different
        // instance is NOT active (bug fixed 2026-10-23).
        return this.history.folders(element.authority).map((f) =>
          new FolderNode(element, f,
            this.icon(session?.authority === element.authority && session.folder === f ? 'folder-active' : 'folder')));
      }
      return [];
    } catch (err) {
      log(`tree: ${firstLine(err)}`);
      return [new MessageNode(`error: ${firstLine(err)}`, 'error')];
    }
  }
}
