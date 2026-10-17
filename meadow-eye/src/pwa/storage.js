// Storage: IndexedDB primary (meadow_pods, meadow_core, meadow_archive,
// meadow_chats, meadow_symbols), localStorage fallback, in-memory cache for
// speed only. Every write is one IndexedDB transaction: all-or-nothing.

export const STORES = ['meadow_pods', 'meadow_core', 'meadow_archive', 'meadow_chats', 'meadow_symbols', 'meadow_assets'];
const DB_NAME = 'meadow-eye';
const cache = new Map();
let dbp = null;

function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => STORES.forEach((s) => req.result.objectStoreNames.contains(s) || req.result.createObjectStore(s));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => {
    dbp = null;
    throw e;
  });
  return dbp;
}

const lsKey = (store, key) => `meadow:${store}:${key}`;

function tx(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req?.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('aborted'));
      }),
  );
}

export async function put(store, key, value) {
  cache.set(`${store}/${key}`, value);
  try {
    await tx(store, 'readwrite', (s) => s.put(value, key));
    return 'idb';
  } catch {
    try {
      localStorage.setItem(lsKey(store, key), JSON.stringify(value, (k, v) => (v instanceof Uint8Array ? { __u8: Array.from(v) } : v)));
      return 'localStorage';
    } catch {
      return 'memory';
    }
  }
}

const revive = (k, v) => (v && v.__u8 ? Uint8Array.from(v.__u8) : v);

export async function get(store, key) {
  const ck = `${store}/${key}`;
  if (cache.has(ck)) return cache.get(ck);
  let v;
  try {
    v = await tx(store, 'readonly', (s) => s.get(key));
  } catch {
    try {
      const raw = localStorage.getItem(lsKey(store, key));
      v = raw ? JSON.parse(raw, revive) : undefined;
    } catch {
      v = undefined;
    }
  }
  if (v !== undefined) cache.set(ck, v);
  return v;
}

export async function del(store, key) {
  cache.delete(`${store}/${key}`);
  try {
    await tx(store, 'readwrite', (s) => s.delete(key));
  } catch {
    try {
      localStorage.removeItem(lsKey(store, key));
    } catch {
      /* memory only */
    }
  }
}

export async function all(store) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const out = [];
      const req = db.transaction(store).objectStore(store).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(out);
        out.push([c.key, c.value]);
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(`meadow:${store}:`)) out.push([k.slice(`meadow:${store}:`.length), JSON.parse(localStorage.getItem(k), revive)]);
      }
    } catch {
      /* none */
    }
    return out;
  }
}

/** Atomic file write in OPFS: write name.tmp, then rename over name. */
export async function opfsAtomicWrite(name, bytes) {
  const root = await navigator.storage.getDirectory();
  const tmp = await root.getFileHandle(`${name}.tmp`, { create: true });
  const w = await tmp.createWritable();
  await w.write(bytes);
  await w.close();
  if (typeof tmp.move !== 'function') throw new Error('rename unsupported');
  await root.removeEntry(name).catch(() => {});
  await tmp.move(name);
}

export const _resetForTests = () => {
  cache.clear();
  dbp = null;
};
