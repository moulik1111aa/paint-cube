// Firebase as the relay, over its plain REST and streaming endpoints (no SDK, since the
// bundler takes no npm runtime libraries): anonymous sign-in through Identity Toolkit,
// reads and writes with fetch, live updates with EventSource. The anonymous identity is
// kept on the device, so a guest who drops and comes back is still the same player.

import type { Relay } from './relay.ts';

export interface FirebaseConfig {
  apiKey: string;
  databaseURL: string;
  projectId: string;
}

interface Session {
  uid: string;
  idToken: string;
  refreshToken: string;
  /** Local time the id token expires. */
  expires: number;
}

const STORE = 'paintcube.auth';

function loadSession(): Pick<Session, 'uid' | 'refreshToken'> | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    return s && typeof s.uid === 'string' && typeof s.refreshToken === 'string' ? s : null;
  } catch {
    return null;
  }
}

function saveSession(s: Session): void {
  try {
    localStorage.setItem(STORE, JSON.stringify({ uid: s.uid, refreshToken: s.refreshToken }));
  } catch {
    /* no storage: a new identity each launch */
  }
}

async function signUp(cfg: FirebaseConfig): Promise<Session> {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(cfg.apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!r.ok) throw new Error(`sign-in failed (${r.status})`);
  const j = await r.json();
  return { uid: j.localId, idToken: j.idToken, refreshToken: j.refreshToken, expires: Date.now() + Number(j.expiresIn) * 1000 };
}

async function refresh(cfg: FirebaseConfig, refreshToken: string): Promise<Session> {
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(cfg.apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  });
  if (!r.ok) throw new Error(`token refresh failed (${r.status})`);
  const j = await r.json();
  return { uid: j.user_id, idToken: j.id_token, refreshToken: j.refresh_token, expires: Date.now() + Number(j.expires_in) * 1000 };
}

/** Sign in (reusing this device's identity) and return a Relay on the database. */
export async function connectFirebase(cfg: FirebaseConfig): Promise<Relay> {
  const base = cfg.databaseURL.replace(/\/+$/, '');
  let session: Session;
  const saved = loadSession();
  try {
    session = saved ? await refresh(cfg, saved.refreshToken) : await signUp(cfg);
  } catch {
    session = await signUp(cfg);
  }
  saveSession(session);

  async function token(): Promise<string> {
    if (Date.now() > session.expires - 5 * 60 * 1000) {
      session = await refresh(cfg, session.refreshToken);
      saveSession(session);
    }
    return session.idToken;
  }
  const url = async (path: string) => `${base}/${path}.json?auth=${encodeURIComponent(await token())}`;
  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const r = await fetch(await url(path), { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok && r.status !== 412) throw new Error(`${method} ${path}: ${r.status}`);
    return r;
  }

  return {
    get uid() {
      return session.uid;
    },
    async get(path) {
      return (await (await call('GET', path)).json()) ?? null;
    },
    async set(path, value) {
      await call('PUT', path, value);
    },
    async create(path, value) {
      // "null_etag" means: only if nothing is there yet.
      const r = await call('PUT', path, value, { 'if-match': 'null_etag' });
      return r.status !== 412;
    },
    async update(path, patch) {
      await call('PATCH', path, patch);
    },
    async remove(path) {
      await call('DELETE', path);
    },
    listen(path, cb) {
      let tree: unknown = null;
      let es: EventSource | null = null;
      let closed = false;
      let retry = 1000;
      const apply = (at: string, data: unknown, merge: boolean) => {
        const keys = at.split('/').filter(Boolean);
        if (!keys.length) {
          tree = merge && tree && typeof tree === 'object' ? { ...(tree as object), ...(data as object) } : data;
          return;
        }
        if (!tree || typeof tree !== 'object') tree = {};
        let node = tree as Record<string, unknown>;
        for (const k of keys.slice(0, -1)) {
          if (!node[k] || typeof node[k] !== 'object') node[k] = {};
          node = node[k] as Record<string, unknown>;
        }
        const last = keys[keys.length - 1];
        if (merge && data && typeof data === 'object') node[last] = { ...((node[last] as object) ?? {}), ...(data as object) };
        else if (data === null) delete node[last];
        else node[last] = data;
      };
      const strip = (v: unknown): unknown => {
        // A patch can leave null children behind; drop them.
        if (!v || typeof v !== 'object') return v;
        return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, strip(x)]));
      };
      const open = async () => {
        if (closed) return;
        try {
          es = new EventSource(await url(path));
        } catch {
          setTimeout(open, (retry = Math.min(15000, retry * 2)));
          return;
        }
        const onData = (merge: boolean) => (e: MessageEvent) => {
          retry = 1000;
          const { path: at, data } = JSON.parse(e.data);
          apply(at, data, merge);
          cb(strip(tree) ?? null);
        };
        es.addEventListener('put', onData(false));
        es.addEventListener('patch', onData(true));
        const reopen = () => {
          es?.close();
          es = null;
          if (!closed) setTimeout(open, retry);
        };
        // The token expired or permissions changed: get a fresh token and reconnect.
        es.addEventListener('auth_revoked', reopen);
        es.addEventListener('cancel', reopen);
        es.onerror = () => {
          if (es?.readyState === EventSource.CLOSED) reopen();
        };
      };
      void open();
      return () => {
        closed = true;
        es?.close();
      };
    },
  };
}
