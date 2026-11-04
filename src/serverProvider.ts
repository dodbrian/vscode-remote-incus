/** Select the server distribution belonging to the running editor. */
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ServerFlavor } from './bootstrap';

export function isVSCodium(): boolean {
  return /^VSCodium(?: - Insiders)?$/i.test(vscode.env.appName);
}

export async function vscodiumArchiveUrl(flavor: ServerFlavor): Promise<string> {
  let version: unknown;
  try {
    const metadata = JSON.parse(
      await readFile(path.join(vscode.env.appRoot, 'package.json'), 'utf8'),
    ) as { version?: unknown };
    version = metadata.version;
  } catch (cause) {
    throw new Error(
      'Could not read the installed VSCodium release version; configure remote-incus.downloadUrlTemplate for this build',
      { cause },
    );
  }
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) {
    throw new Error(
      'Unsupported VSCodium release version; configure remote-incus.downloadUrlTemplate for this build',
    );
  }
  const insiders = /Insiders/i.test(vscode.env.appName);
  const release = `${version}${insiders ? '-insider' : ''}`;
  const repository = insiders ? 'vscodium-insiders' : 'vscodium';
  const platform = flavor === 'linux-alpine' ? 'alpine-x64' : flavor;
  return `https://github.com/VSCodium/${repository}/releases/download/${release}/vscodium-reh-${platform}-${release}.tar.gz`;
}
