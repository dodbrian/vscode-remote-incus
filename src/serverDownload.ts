/** Verified container download used by auto and explicit container strategies. */
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { execInInstance, InstanceRef, sq } from './incusCli';
import type { Identity, ServerFlavor } from './bootstrap';
import type { Report } from './progress';

export const DEFAULT_URL_TEMPLATE =
  'https://update.code.visualstudio.com/commit:{commit}/server-{flavor}/stable';

/** Expected route failure; preserve any trusted digest for the client fallback. */
export class ContainerDownloadError extends Error {
  constructor(
    message: string,
    options?: ErrorOptions,
    readonly expectedSha256?: string,
  ) {
    super(message, options);
  }
}
/** Unknown partial state must block automatic route switching. */
export class ContainerDownloadCleanupError extends ContainerDownloadError {}

export async function downloadInContainer(
  ref: InstanceRef,
  identity: Identity,
  commit: string,
  flavor: ServerFlavor,
  report?: Report,
): Promise<void> {
  const template =
    vscode.workspace.getConfiguration('remote-incus').get<string>('downloadUrlTemplate') ??
    DEFAULT_URL_TEMPLATE;
  if (template !== DEFAULT_URL_TEMPLATE) {
    throw new ContainerDownloadError(
      'container download does not support custom mirrors: select auto or client download strategy to retain checksum verification',
    );
  }
  report?.('obtaining server checksum metadata…', 5);
  let url: URL;
  let sha256: string | undefined;
  try {
    const response = await fetch(
      `https://update.code.visualstudio.com/api/versions/commit:${commit}/server-${flavor}/stable`,
      {
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      },
    );
    if (!response.ok) throw new Error(`metadata HTTP ${response.status}`);
    const metadata: unknown = await response.json();
    if (!metadata || typeof metadata !== 'object') throw new Error('missing metadata');
    const m = metadata as Record<string, unknown>;
    if (
      m.version !== commit ||
      typeof m.sha256hash !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(m.sha256hash)
    ) {
      throw new Error('metadata commit, SHA-256 or URL is invalid');
    }
    sha256 = m.sha256hash.toLowerCase();
    if (typeof m.url !== 'string') throw new Error('metadata URL is missing');
    url = new URL(m.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !['vscode.download.prss.microsoft.com', 'update.code.visualstudio.com'].includes(url.hostname)
    ) {
      throw new Error('metadata URL is not an allowed Microsoft HTTPS endpoint');
    }
  } catch (cause) {
    throw new ContainerDownloadError(
      'could not obtain verified server metadata; select the client download strategy or retry explicitly',
      { cause },
      sha256,
    );
  }

  if (!sha256) throw new ContainerDownloadError('server metadata has no expected SHA-256');
  const archive = `/tmp/vscode-server-${flavor}-${commit}.tar.gz`;
  const partial = `${archive}.partial-${randomUUID()}`;
  const options = {
    uid: identity.uid,
    group: identity.gid,
    home: identity.home,
    timeoutMs: 210_000,
  };
  report?.('downloading server inside container…', 30);
  try {
    await execInInstance(
      ref,
      [
        'set -e',
        'umask 077',
        `partial=${sq(partial)}`,
        `trap 'rm -f -- "$partial"' EXIT`,
        `trap 'exit 130' INT`,
        `trap 'exit 143' TERM`,
        `test ! -d ${sq(archive)}`,
        `if [ -f ${sq(archive)} ] && [ ! -L ${sq(archive)} ] &&`,
        `   [ "$(stat -c '%u:%g' ${sq(archive)})" = ${sq(`${identity.uid}:${identity.gid}`)} ] &&`,
        `   [ "$(sha256sum ${sq(archive)} | cut -d' ' -f1)" = ${sq(sha256)} ]; then`,
        `  chmod 600 ${sq(archive)}`,
        `  exit 0`,
        'fi',
        `command -v curl >/dev/null || { echo 'curl is required for container download; select client strategy' >&2; exit 1; }`,
        // Exclusive creation and rename prevent following a preexisting symlink.
        '(set -C; : > "$partial")',
        `curl --disable --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 180 --output "$partial" ${sq(url.href)}`,
        `printf '%s  %s\\n' ${sq(sha256)} "$partial" | sha256sum --check --status`,
        `test "$(stat -c '%u:%g:%a' "$partial")" = ${sq(`${identity.uid}:${identity.gid}:600`)}`,
        `mv -fT -- "$partial" ${sq(archive)}`,
      ].join('\n'),
      options,
    );
  } catch (cause) {
    // Also clean a known owned path when a lost exec connection prevents EXIT.
    try {
      await execInInstance(ref, `rm -f -- ${sq(partial)}`, {
        uid: identity.uid,
        home: identity.home,
      });
    } catch (cleanupCause) {
      throw new ContainerDownloadCleanupError(
        'container download failed and partial cleanup could not be confirmed; inspect the fixture before retrying',
        { cause: new AggregateError([cause, cleanupCause]) },
      );
    }
    throw new ContainerDownloadError(
      'container download failed; no archive was accepted. Client strategy supports local download and transfer',
      { cause },
      sha256,
    );
  }
  report?.('container archive checksum verified', 90);
}
