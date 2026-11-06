import * as path from 'node:path';
import * as vscode from 'vscode';
import { enableProposedApi } from './runtimeArguments';
import { isVSCodium } from './serverProvider';
import { firstLine, log } from './logging';

export async function registerOnboarding(
  context: vscode.ExtensionContext,
  ready: boolean,
): Promise<void> {
  const codium = isVSCodium();
  const walkthrough = `${context.extension.id}#${codium ? 'setup-vscodium' : 'setup'}`;
  const resume = context.globalState.get<boolean>('setup.resumeAfterRestart', false);
  let configured = ready || resume;
  await Promise.all([
    vscode.commands.executeCommand('setContext', 'remote-incus.setupRequired', !ready),
    vscode.commands.executeCommand('setContext', 'remote-incus.supportReady', ready),
    vscode.commands.executeCommand('setContext', 'remote-incus.supportConfigured', configured),
    vscode.commands.executeCommand(
      'setContext',
      'remote-incus.editor',
      codium ? 'vscodium' : 'vscode',
    ),
  ]);
  const openSetup = (): Thenable<unknown> =>
    vscode.commands.executeCommand(
      'workbench.action.openWalkthrough',
      { category: walkthrough, step: ready ? 'connect' : configured ? 'restart' : 'enable' },
      false,
    );
  // Optional Welcome UI must never prevent command or resolver activation.
  // A failed automatic opening is retried on a later startup.
  const tryOpenSetup = async (): Promise<boolean> => {
    try {
      await openSetup();
      return true;
    } catch (error) {
      log(`Could not open setup walkthrough: ${firstLine(error)}`);
      return false;
    }
  };
  const completeSteps = async (...steps: string[]): Promise<void> => {
    for (const step of steps) {
      try {
        // A startup context event can precede the native walkthrough listeners.
        // Persist completion explicitly rather than relying on that event alone.
        await vscode.commands.executeCommand('welcome.markStepComplete', `${walkthrough}#${step}`);
      } catch (error) {
        log(`Could not complete setup step ${step}: ${firstLine(error)}`);
      }
    }
  };
  const autoOpen = vscode.workspace
    .getConfiguration('workbench.welcomePage.walkthroughs')
    .get<boolean>('openOnInstall', true);
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
                'This adds the extension ID to enable-proposed-api in the open argv.json and saves the file. Other settings and extension IDs are preserved. A full editor restart is required.',
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
        configured = true;
        await context.globalState.update('setup.resumeAfterRestart', true);
        await vscode.commands.executeCommand('setContext', 'remote-incus.supportConfigured', true);
        await completeSteps('enable');
        await tryOpenSetup();
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
    context.subscriptions.push(
      vscode.commands.registerCommand('remote-incus.showInstances', openSetup),
    );
    // Existing installs can also need setup. Respect the editor's walkthrough
    // preference and show automatically at most once; the setup view persists.
    if (
      !context.globalState.get<boolean>('setup.offered') &&
      (!autoOpen || (await tryOpenSetup()))
    ) {
      await context.globalState.update('setup.offered', true);
    }
  }

  if (ready) await completeSteps('enable', 'restart');
  if (ready && resume) {
    // A restored Welcome editor retains its previously selected step. Explicitly
    // select Connect once after our saved configuration takes effect.
    const resumed =
      !autoOpen || vscode.env.remoteAuthority?.startsWith('incus+') || (await tryOpenSetup());
    if (resumed) await context.globalState.update('setup.resumeAfterRestart', false);
  }
}
