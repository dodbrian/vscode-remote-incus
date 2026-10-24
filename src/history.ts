/**
 * Per-instance folder history — the "folders ever opened" list under each
 * instance node (Dev Containers / Remote-SSH UX, user request 2026-10-22).
 *
 * Mechanics mirrored from the official extensions (bundles inspected
 * 2026-10-22): each remote extension keeps its OWN history in extension
 * globalState — remote-ssh: `FolderHistoryManager`, key `folder.history.v1`,
 * shape `{ historyData: { <authority>: [folderPath…] } }` — and the Remote
 * Explorer shell fetches it via an internal command
 * (`remote-internal.getSshFoldersHistory`) to render one row per folder.
 * Our view is our own, so both sides are in this module: a globalState map
 * keyed by the FULL authority (`incus+<remote>:<instance>` — exactly what
 * `vscode.env.remoteAuthority` reports in a connected window), values =
 * remote folder paths, most-recent-first, deduped, capped.
 *
 * Recording happens in two idempotent places:
 *  - the open commands (connect / open folder) at open time — covers the
 *    first-ever open, where the loading window has no workspace yet;
 *  - `extension.ts` activation in any window already sitting on an
 *    `incus+…` authority — covers reloads, ext-host restarts and opens
 *    that bypass our commands (recents, CLI). remote-ssh records from its
 *    resolver success path instead; for us that is too early (the loading
 *    window's workspace is empty at resolve time), activation is the
 *    equivalent moment for a window that already has a workspace.
 */
import * as vscode from 'vscode';

const KEY = 'remote-incus.folder.history.v1';
const MAX_PER_INSTANCE = 10;

export class FolderHistory {
  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Most-recent-first, deduped, capped. */
  record(authority: string, folderPath: string): void {
    const data = this.read();
    const next = [folderPath, ...(data[authority] ?? []).filter((f) => f !== folderPath)].slice(
      0,
      MAX_PER_INSTANCE,
    );
    if (JSON.stringify(next) === JSON.stringify(data[authority] ?? [])) {
      return;
    }
    data[authority] = next;
    void this.context.globalState.update(KEY, data);
  }

  folders(authority: string): string[] {
    return this.read()[authority] ?? [];
  }

  remove(authority: string, folderPath: string): void {
    const data = this.read();
    const next = (data[authority] ?? []).filter((f) => f !== folderPath);
    if (next.length === (data[authority] ?? []).length) {
      return;
    }
    if (next.length === 0) {
      // Drop the authority key entirely (no empty arrays in persisted state).
      const { [authority]: _removed, ...rest } = data;
      void this.context.globalState.update(KEY, rest);
      return;
    }
    data[authority] = next;
    void this.context.globalState.update(KEY, data);
  }

  private read(): Record<string, string[]> {
    return this.context.globalState.get<Record<string, string[]>>(KEY) ?? {};
  }
}
