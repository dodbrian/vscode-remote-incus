import * as path from 'node:path';
import * as vscode from 'vscode';
import { enableProposedApi } from './runtimeArguments';

export function registerOnboarding(context: vscode.ExtensionContext, ready: boolean): void {
  void vscode.commands.executeCommand('setContext', 'remote-incus.setupRequired', !ready);
  void vscode.commands.executeCommand('setContext', 'remote-incus.supportReady', ready);
  const openSetup = (): Thenable<unknown> =>
    vscode.commands.executeCommand(
      'workbench.action.openWalkthrough',
      `${context.extension.id}#setup`,
      false,
    );
  let editing = false;
  context.subscriptions.push(
    vscode.commands.registerCommand('remote-incus.openSetup', openSetup),
    vscode.commands.registerCommand('remote-incus.enableSupport', async () => {
      if (editing) return;
      editing = true;
      try {
        if (ready) {
          await vscode.window.showInformationMessage(
            'Remote-Incus editor support is already enabled.',
          );
          return;
        }
        // Let the running product locate argv.json: VS Code, VSCodium, Insiders,
        // portable mode and custom runtime locations must not share guessed paths.
        await vscode.commands.executeCommand('workbench.action.configureRuntimeArguments');
        const document = vscode.window.activeTextEditor?.document;
        if (document?.uri.scheme !== 'file' || path.basename(document.uri.fsPath) !== 'argv.json') {
          throw new Error(
            'The editor did not open argv.json. Use Preferences: Configure Runtime Arguments to configure it manually.',
          );
        }
        if (document.isDirty)
          throw new Error('Save or discard your existing argv.json edits, then try again.');
        const original = document.getText();
        const updated = enableProposedApi(original, context.extension.id);
        if (updated !== original) {
          const answer = await vscode.window.showWarningMessage(
            `Enable proposed APIs for ${context.extension.id} in ${vscode.env.appName}?`,
            {
              modal: true,
              detail:
                'This adds the extension ID to enable-proposed-api in the open argv.json and saves the file. Other settings and extension IDs are preserved. An existing empty array, which grants access to all extensions, becomes a list containing this extension. A full editor restart is required.',
            },
            'Enable Support',
          );
          if (answer !== 'Enable Support') return;
          // Document state can change while the modal confirmation is open.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (document.isClosed || document.isDirty || document.getText() !== original) {
            throw new Error(
              'argv.json changed during confirmation. Try again with the latest saved file.',
            );
          }
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            document.uri,
            new vscode.Range(document.positionAt(0), document.positionAt(original.length)),
            updated,
          );
          if (!(await vscode.workspace.applyEdit(edit)) || !(await document.save())) {
            throw new Error('Could not save argv.json. Review the open file before trying again.');
          }
        }
        await vscode.commands.executeCommand('setContext', 'remote-incus.supportConfigured', true);
        await vscode.window.showInformationMessage(
          `Support is configured. Quit all ${vscode.env.appName} windows and start the editor again to enable Remote-Incus.`,
        );
      } catch (error) {
        await vscode.window.showErrorMessage(
          `Remote-Incus setup: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        editing = false;
      }
    }),
  );
  if (!ready) {
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider('remote-incus.setup', {
        getTreeItem: (item: vscode.TreeItem) => item,
        getChildren: () => [],
      }),
    );
    // Existing installs can also need setup. Respect the editor's walkthrough
    // preference and show automatically at most once; the setup view persists.
    if (!context.globalState.get<boolean>('setup.offered')) {
      void context.globalState.update('setup.offered', true);
      if (
        vscode.workspace
          .getConfiguration('workbench.welcomePage.walkthroughs')
          .get<boolean>('openOnInstall', true)
      ) {
        void openSetup();
      }
    }
    context.subscriptions.push(
      vscode.commands.registerCommand('remote-incus.showInstances', openSetup),
    );
  }
}
