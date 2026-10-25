/** IPv4 loopback workaround using core forwarding and the selected Ports row. */
import * as vscode from 'vscode';
import { AUTHORITY_PREFIX } from './authority';
import { firstLine, log } from './logging';

const MAPPED_LOOPBACK = '::ffff:127.0.0.1';
const IPV4_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0']);
const ROW_TYPES = new Set(['Candidate', 'Detected', 'Forwarded']);

interface PortRow {
  tunnelType: string;
  remoteHost: string;
  remotePort: number;
  localPort?: unknown;
  name?: unknown;
  protocol?: unknown;
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function portRow(value: unknown): PortRow {
  if (!value || typeof value !== 'object') {
    throw new Error('Select an IPv4 loopback port in the Ports view and choose Forward over IPv4.');
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.tunnelType !== 'string' ||
    !ROW_TYPES.has(row.tunnelType) ||
    typeof row.remoteHost !== 'string' ||
    !IPV4_LOOPBACK_HOSTS.has(row.remoteHost) ||
    !isPort(row.remotePort)
  ) {
    throw new Error('Forward over IPv4 requires an IPv4 loopback port selected in the Ports view.');
  }
  return {
    tunnelType: row.tunnelType,
    remoteHost: row.remoteHost,
    remotePort: row.remotePort,
    localPort: row.localPort,
    name: row.name,
    protocol: row.protocol,
  };
}

export function registerIPv4Forwarding(context: vscode.ExtensionContext): void {
  const pending = new Map<string, Promise<void>>();
  context.subscriptions.push(
    vscode.commands.registerCommand('remote-incus.forwardPortIPv4', async (value: unknown) => {
      try {
        const authority = vscode.env.remoteAuthority;
        if (!authority?.startsWith(`${AUTHORITY_PREFIX}+`)) {
          throw new Error('Forward over IPv4 requires an Incus remote window.');
        }
        const row = portRow(value);
        const key = `${authority}:${row.remotePort}`;
        const existing = pending.get(key);
        if (existing) {
          await existing;
          return;
        }
        const operation = (async (): Promise<void> => {
          const tunnels = await vscode.workspace.tunnels;
          if (vscode.env.remoteAuthority !== authority) {
            throw new Error('The Incus remote changed before the port could be forwarded.');
          }
          if (
            tunnels.some(
              (tunnel) =>
                tunnel.remoteAddress.host === MAPPED_LOOPBACK &&
                tunnel.remoteAddress.port === row.remotePort,
            )
          )
            return;
          // Runtime can return undefined when core cannot create a tunnel, even
          // though the vendored proposal declares a non-optional return value.
          const openTunnel: (options: vscode.TunnelOptions) => Thenable<vscode.Tunnel | undefined> =
            vscode.workspace.openTunnel;
          const tunnel = await openTunnel({
            remoteAddress: { host: MAPPED_LOOPBACK, port: row.remotePort },
            ...(isPort(row.localPort) ? { localAddressPort: row.localPort } : {}),
            ...(typeof row.name === 'string' && row.name ? { label: row.name } : {}),
            ...(row.protocol === 'http' || row.protocol === 'https'
              ? { protocol: row.protocol }
              : {}),
            privacy: 'private',
          });
          if (!tunnel)
            throw new Error(
              'VS Code did not create the IPv4 port forward. See the Ports view and log.',
            );
          context.subscriptions.push(tunnel);
          log(`Forwarded IPv4 loopback port ${row.remotePort} through core`);
        })();
        pending.set(key, operation);
        try {
          await operation;
        } finally {
          pending.delete(key);
        }
      } catch (error) {
        log(`IPv4 forwarding failed: ${error instanceof Error ? error.message : String(error)}`);
        await vscode.window.showErrorMessage(
          `Remote - Incus: ${firstLine(error)} ([show log](command:remote-incus.showLog))`,
        );
      }
    }),
  );
}
