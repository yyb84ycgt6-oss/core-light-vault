// Minimal promise wrapper over IndexedDB. Uses globalThis.indexedDB so the same
// code runs in browsers and under `fake-indexeddb` in node tests.

export const DB_NAME = 'foundry-router';
export const DB_VERSION = 1;

export const STORES = {
  keys: 'keys', // CryptoKey records (non-extractable, structured-cloned)
  blobs: 'blobs', // downloaded model files
  files: 'files', // file-system fallback when OPFS is unavailable
  pods: 'pods', // pod fallback when OPFS is unavailable
  log: 'log', // historical transparency log
  kv: 'kv', // small settings
};

let dbPromise = null;

export function idbAvailable() {
  return typeof globalThis.indexedDB !== 'undefined';
}

export function openDB() {
  if (dbPromise) return dbPromise;
  if (!idbAvailable()) return Promise.reject(new Error('IndexedDB unavailable'));
  dbPromise = new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.keys)) db.createObjectStore(STORES.keys, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.blobs)) db.createObjectStore(STORES.blobs, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.files)) db.createObjectStore(STORES.files, { keyPath: 'path' });
      if (!db.objectStoreNames.contains(STORES.pods)) db.createObjectStore(STORES.pods, { keyPath: 'name' });
      if (!db.objectStoreNames.contains(STORES.log)) db.createObjectStore(STORES.log, { keyPath: 'seq', autoIncrement: true });
      if (!db.objectStoreNames.contains(STORES.kv)) db.createObjectStore(STORES.kv);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgraded the schema: drop our handle so the next call reopens.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(store, mode, fn) {
  const db = await openDB();
  const tx = db.transaction(store, mode);
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
  const result = await fn(tx.objectStore(store));
  await done;
  return result;
}

export const idbGet = (store, key) => withStore(store, 'readonly', (s) => promisify(s.get(key)));
export const idbGetAll = (store) => withStore(store, 'readonly', (s) => promisify(s.getAll()));
export const idbKeys = (store) => withStore(store, 'readonly', (s) => promisify(s.getAllKeys()));
export const idbPut = (store, value, key) =>
  withStore(store, 'readwrite', (s) => promisify(key === undefined ? s.put(value) : s.put(value, key)));
export const idbDelete = (store, key) => withStore(store, 'readwrite', (s) => promisify(s.delete(key)));
export const idbClear = (store) => withStore(store, 'readwrite', (s) => promisify(s.clear()));

/** Atomic multi-put: either every record lands or none do (single transaction). */
export const idbPutMany = (store, values) =>
  withStore(store, 'readwrite', async (s) => {
    for (const v of values) s.put(v);
    return values.length;
  });

/** Test helper: forget the cached connection (used after deleting the database). */
export function _resetIdbForTests() {
  dbPromise = null;
}
