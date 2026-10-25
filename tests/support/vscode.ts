import { fixture } from './fixture';

export class Disposable {
  private disposed = false;
  constructor(private readonly cleanup: () => void) {}
  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.cleanup();
    }
  }
  static from(...items: { dispose(): void }[]): Disposable {
    return new Disposable(() => {
      items.forEach((item) => {
        item.dispose();
      });
    });
  }
}

export class EventEmitter<T> {
  private readonly listeners = new Set<{ callback: (value: T) => unknown; thisArg: unknown }>();
  private disposed = false;
  constructor() {
    fixture().subscriptions.push(this);
  }
  readonly event = (
    callback: (value: T) => unknown,
    thisArg?: unknown,
    disposables?: { dispose(): void }[],
  ): Disposable => {
    const listener = { callback, thisArg };
    if (!this.disposed) this.listeners.add(listener);
    const subscription = new Disposable(() => this.listeners.delete(listener));
    disposables?.push(subscription);
    return subscription;
  };
  fire(value: T): void {
    for (const listener of [...this.listeners]) {
      if (this.listeners.has(listener)) listener.callback.call(listener.thisArg, value);
    }
  }
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}

export const workspace = {
  get tunnels(): Promise<any[]> {
    return fixture().call('vscode.tunnels', []);
  },
  openTunnel: (...args: any[]) => fixture().call('vscode.openTunnel', args),
  get workspaceFolders(): any {
    return fixture().state.get('folders');
  },
  registerRemoteAuthorityResolver: (...args: any[]) =>
    fixture().call('vscode.registerResolver', args),
  getConfiguration(section?: string) {
    return {
      get<T>(key: string, fallback?: T): T | undefined {
        return (
          (fixture().configuration.get(section ? `${section}.${key}` : key) as T | undefined) ??
          fallback
        );
      },
    };
  },
};

// Test-only model objects. Host actions still require explicit fixture routes.
export class Uri {
  constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
  ) {}
  static from(value: { scheme: string; authority?: string; path?: string }): Uri {
    return new Uri(value.scheme, value.authority ?? '', value.path ?? '');
  }
  static file(path: string): Uri {
    return new Uri('file', '', path);
  }
  get fsPath(): string {
    return this.path;
  }
  toString(): string {
    return `${this.scheme}://${this.authority}${encodeURI(this.path).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
  }
}
export enum TreeItemCollapsibleState {
  None,
  Collapsed,
  Expanded,
}
export class TreeItem {
  contextValue?: string;
  description?: string;
  tooltip?: unknown;
  iconPath?: any;
  command?: unknown;
  constructor(
    readonly label: string,
    readonly collapsibleState = TreeItemCollapsibleState.None,
  ) {}
}
export class ThemeIcon {
  constructor(readonly id: string) {}
}
export class MarkdownString {
  constructor(readonly value: string) {}
}
export const env = {
  get appCommit(): string | undefined {
    return fixture().state.get('commit');
  },
  get remoteAuthority(): string | undefined {
    return fixture().state.get('authority');
  },
};
export const version = 'offline';
export const ProgressLocation = { Notification: 15 };
export const window = {
  withProgress: (...args: any[]) => fixture().call('vscode.withProgress', args),
  showErrorMessage: (...args: any[]) => fixture().call('vscode.error', args),
  showWarningMessage: (...args: any[]) => fixture().call('vscode.warning', args),
  createTerminal: (...args: any[]) => fixture().call('vscode.terminal', args),
  createOutputChannel: (...args: any[]) => fixture().call('vscode.output', args),
  registerTreeDataProvider: (...args: any[]) => fixture().call('vscode.registerTree', args),
};
export const commands = {
  registerCommand(id: string, fn: (...args: any[]) => unknown): Disposable {
    const callbacks = fixture().state.get('commands') ?? new Map();
    fixture().state.set('commands', callbacks);
    if (callbacks.has(id)) throw new Error(`Duplicate command ${id}`);
    callbacks.set(id, fn);
    return new Disposable(() => callbacks.delete(id));
  },
  executeCommand: (...args: any[]) => fixture().call('vscode.execute', args),
};
class ManagedAuthority {
  constructor(
    readonly makeConnection: () => unknown,
    readonly connectionToken: string,
  ) {}
}
export let ManagedResolvedAuthority: typeof ManagedAuthority | undefined = ManagedAuthority;
export function setManagedApiAvailable(available: boolean): void {
  ManagedResolvedAuthority = available ? ManagedAuthority : undefined;
}
export class RemoteAuthorityResolverError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
  static TemporarilyNotAvailable(message: string): Error {
    return new RemoteAuthorityResolverError(message, 'TemporarilyNotAvailable');
  }
  static NotAvailable(message: string): Error {
    return new RemoteAuthorityResolverError(message, 'NotAvailable');
  }
}
