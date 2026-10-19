/**
 * Connection-progress UX (parity with Dev Containers / Remote-SSH):
 * a notification toast with a progress bar whose TITLE embeds a clickable
 * "(show log)" link — Dev Containers does exactly this by rendering a
 * markdown `command:` URI in the withProgress title (verified in its bundle:
 * `[Connecting to Dev Container (show log)](command:remote-containers.
 * revealLogTerminal "…")`); Remote-SSH uses the same link form in errors.
 * Live step detail goes into progress.report({ message }) beneath the title.
 */
import * as vscode from 'vscode';

export type Report = (message: string, percent?: number) => void;

export function logLink(title: string): string {
  return `[${title} (show log)](command:remote-incus.showLog "Open the Remote - Incus log")`;
}

export async function withProgressReport<T>(title: string, fn: (report: Report) => Promise<T>): Promise<T> {
  let last = 0;
  return await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: logLink(title), cancellable: false },
    (progress) => fn((message, percent) => {
      if (percent === undefined) {
        progress.report({ message });
        return;
      }
      const increment = Math.max(0, percent - last);
      last = Math.max(last, percent);
      progress.report({ message, increment });
    }),
  );
}
