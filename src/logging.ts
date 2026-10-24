/**
 * Output-channel logging. All modules funnel through here so the output
 * channel ("Remote - Incus") doubles as the per-bridge diagnostics trail
 * (docs/DESIGN.md §12 item 4).
 *
 * For the dev loop, REMOTE_INCUS_DEBUG_LOG may point at a file the extension
 * mirrors every line into (the redeploy script sets it; the extension host
 * inherits the env from the launching CLI).
 */
import * as fs from 'fs';
import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;
let debugFile: string | undefined;

export function initLogging(context: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel('Remote - Incus');
  context.subscriptions.push(channel);
  debugFile = process.env.REMOTE_INCUS_DEBUG_LOG;
}

export function log(message: string): void {
  channel?.appendLine(message);
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log('[remote-incus]', line);
  if (debugFile) {
    try { fs.appendFileSync(debugFile, line + '\n'); } catch { /* ignore */ }
  }
}

/** First line of an error message (incus/stderr blobs are multi-line). */
export function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split('\n')[0].trim() || 'unknown error';
}

/** Bring the output channel into view (diagnostics command). */
export function showLog(preserveFocus = true): void {
  channel?.show(preserveFocus);
}
