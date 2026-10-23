import { fixture } from './fixture';

export class Disposable {
  private disposed = false;
  constructor(private readonly cleanup: () => void) {}
  dispose(): void {
    if (!this.disposed) { this.disposed = true; this.cleanup(); }
  }
  static from(...items: { dispose(): void }[]): Disposable {
    return new Disposable(() => items.forEach(item => item.dispose()));
  }
}

export class EventEmitter<T> {
  private readonly listeners = new Set<{ callback: (value: T) => unknown; thisArg: unknown }>();
  private disposed = false;
  constructor() { fixture().subscriptions.push(this); }
  readonly event = (callback: (value: T) => unknown, thisArg?: unknown, disposables?: { dispose(): void }[]): Disposable => {
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
  dispose(): void { this.disposed = true; this.listeners.clear(); }
}

export const workspace = {
  getConfiguration(section?: string) {
    return {
      get<T>(key: string, fallback?: T): T | undefined {
        return (fixture().configuration.get(section ? `${section}.${key}` : key) as T | undefined) ?? fallback;
      },
    };
  },
};
