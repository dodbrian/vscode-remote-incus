import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

/** Open the same folder independently, as VS Code's Duplicate As Workspace does. */
export async function openRemoteFolderInNewWindow(
  context: vscode.ExtensionContext,
  folder: vscode.Uri,
): Promise<void> {
  const root = path.join(context.globalStorageUri.fsPath, 'window-workspaces');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(path.join(root, 'window-'));
  try {
    const file = path.join(directory, 'Incus.code-workspace');
    await fs.writeFile(
      file,
      JSON.stringify({ folders: [{ uri: folder.toString() }], remoteAuthority: folder.authority }),
      { flag: 'wx', mode: 0o600 },
    );
    // Keep successful workspace files: VS Code needs them for reload and restore.
    // No files or settings are written into the remote project.
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(file), {
      forceNewWindow: true,
    });
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}
