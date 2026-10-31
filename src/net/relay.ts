// The relay: the small key-value API the room protocol needs. Firebase's realtime
// database implements it in production (net/firebase.ts); MemoryRelay implements it
// in memory so two simulated players can be tested without a network.

/** Placeholder for "the server's current time" in a written value. */
export const SERVER_TIME = { '.sv': 'timestamp' } as const;

export interface Relay {
  /** This device's anonymous user id. */
  readonly uid: string;
  get<T = unknown>(path: string): Promise<T | null>;
  set(path: string, value: unknown): Promise<void>;
  /** Write only if nothing is at `path` yet; resolves false if something already is. */
  create(path: string, value: unknown): Promise<boolean>;
  update(path: string, patch: Record<string, unknown>): Promise<void>;
  remove(path: string): Promise<void>;
  /** Called with the full value at `path` now and after every change (null when gone). */
  listen(path: string, cb: (value: any) => void): () => void;
}

/** Shared in-memory store for MemoryRelay clients. */
export class MemoryHub {
  data: Record<string, unknown> = {};
  /** Clock used for SERVER_TIME (tests can move it). */
  now: () => number = () => Date.now();
  private listeners = new Set<{ path: string; cb: (v: unknown) => void }>();
  /** Clients that are offline get no deliveries and their writes fail. */
  offline = new Set<string>();

  read(path: string): unknown {
    let node: unknown = this.data;
    for (const k of parts(path)) {
      if (node === null || typeof node !== 'object') return null;
      node = (node as Record<string, unknown>)[k];
    }
    return node === undefined ? null : clone(node);
  }

  write(path: string, value: unknown): void {
    const ks = parts(path);
    let node = this.data as Record<string, unknown>;
    for (const k of ks.slice(0, -1)) {
      if (!node[k] || typeof node[k] !== 'object') node[k] = {};
      node = node[k] as Record<string, unknown>;
    }
    const last = ks[ks.length - 1];
    const v = this.resolve(value);
    if (v === null || v === undefined) delete node[last];
    else node[last] = v;
    this.notify();
  }

  private resolve(v: unknown): unknown {
    if (v && typeof v === 'object' && (v as Record<string, unknown>)['.sv'] === 'timestamp') return this.now();
    if (Array.isArray(v)) return v.map((x) => this.resolve(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.resolve(x)]));
    return v;
  }

  subscribe(path: string, cb: (v: unknown) => void): () => void {
    const l = { path, cb };
    this.listeners.add(l);
    queueMicrotask(() => this.listeners.has(l) && cb(this.read(path)));
    return () => this.listeners.delete(l);
  }

  private pending = false;
  private notify(): void {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      for (const l of [...this.listeners]) l.cb(this.read(l.path));
    });
  }
}

export class MemoryRelay implements Relay {
  readonly uid: string;
  private readonly hub: MemoryHub;
  constructor(hub: MemoryHub, uid: string) {
    this.hub = hub;
    this.uid = uid;
  }
  private check(): void {
    if (this.hub.offline.has(this.uid)) throw new Error('offline');
  }
  async get<T>(path: string): Promise<T | null> {
    this.check();
    return this.hub.read(path) as T | null;
  }
  async set(path: string, value: unknown): Promise<void> {
    this.check();
    this.hub.write(path, value);
  }
  async create(path: string, value: unknown): Promise<boolean> {
    this.check();
    if (this.hub.read(path) !== null) return false;
    this.hub.write(path, value);
    return true;
  }
  async update(path: string, patch: Record<string, unknown>): Promise<void> {
    this.check();
    for (const [k, v] of Object.entries(patch)) this.hub.write(`${path}/${k}`, v);
  }
  async remove(path: string): Promise<void> {
    this.check();
    this.hub.write(path, null);
  }
  listen(path: string, cb: (value: any) => void): () => void {
    return this.hub.subscribe(path, (v) => {
      if (!this.hub.offline.has(this.uid)) cb(v);
    });
  }
}

const parts = (p: string) => p.split('/').filter(Boolean);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
