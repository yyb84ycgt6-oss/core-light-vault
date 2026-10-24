// File System tool: folders + files persisted in OPFS under /files, with an
// IndexedDB fallback (Safari private mode, older engines). LIVE_STATE.files is
// the open working set; `dotSaved` is true when the open copy matches disk.
import { opfsSupported, opfsDir, opfsWrite, opfsRead, opfsList, opfsDelete, opfsMove, opfsMkdir } from '../storage/opfs.js';
import { idbGet, idbPut, idbDelete, idbGetAll, STORES } from '../storage/idb.js';

const ROOT = 'files';
let backendPromise = null;

export function fsBackend() {
  if (!backendPromise) {
    backendPromise = (async () => {
      if (!opfsSupported()) return 'idb';
      try {
        await opfsDir(ROOT, { create: true });
        return 'opfs';
      } catch {
        return 'idb';
      }
    })();
  }
  return backendPromise;
}

export function cleanFolder(folder) {
  const parts = String(folder || '').split('/').filter(Boolean);
  if (parts.some((p) => p === '.' || p === '..')) throw new Error('Illegal folder');
  return parts.join('/');
}

export function cleanName(name) {
  const n = String(name || '').trim();
  if (!n || n === '.' || n === '..' || /[\\/]/.test(n)) throw new Error('Illegal file name');
  return n;
}

const join = (...p) => p.filter(Boolean).join('/');

export async function fsList(folder = '') {
  const f = cleanFolder(folder);
  if ((await fsBackend()) === 'opfs') {
    return (await opfsList(join(ROOT, f))).map((e) => ({ ...e, folder: f, path: join(f, e.name) }));
  }
  const all = await idbGetAll(STORES.files);
  const entries = new Map();
  for (const r of all) {
    if (r.kind === 'file' && r.folder === f) entries.set(r.name, { name: r.name, kind: 'file', size: r.size, lastModified: r.lastModified, folder: f, path: r.path });
    const rest = r.folder === f ? null : f ? (r.folder.startsWith(`${f}/`) ? r.folder.slice(f.length + 1) : null) : r.folder;
    if (rest) {
      const sub = rest.split('/')[0];
      if (sub) entries.set(`${sub}/`, { name: sub, kind: 'directory', size: 0, lastModified: 0, folder: f, path: join(f, sub) });
    }
    if (r.kind === 'directory' && r.folder === f) entries.set(`${r.name}/`, { name: r.name, kind: 'directory', size: 0, lastModified: 0, folder: f, path: r.path });
  }
  return [...entries.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));
}

export async function fsWrite(folder, name, content) {
  const f = cleanFolder(folder);
  const n = cleanName(name);
  if ((await fsBackend()) === 'opfs') return opfsWrite(join(ROOT, f, n), content);
  const size = new TextEncoder().encode(content).length;
  return idbPut(STORES.files, { path: join(f, n), folder: f, name: n, kind: 'file', content, size, lastModified: Date.now() });
}

export async function fsRead(folder, name) {
  const f = cleanFolder(folder);
  const n = cleanName(name);
  if ((await fsBackend()) === 'opfs') return (await opfsRead(join(ROOT, f, n))).text();
  const r = await idbGet(STORES.files, join(f, n));
  if (!r) throw new Error(`${join(f, n)} not found`);
  return r.content;
}

export async function fsMkdir(folder) {
  const f = cleanFolder(folder);
  if (!f) return;
  if ((await fsBackend()) === 'opfs') return opfsMkdir(join(ROOT, f));
  const parts = f.split('/');
  const name = parts.pop();
  return idbPut(STORES.files, { path: `${f}/`, folder: parts.join('/'), name, kind: 'directory', lastModified: Date.now() });
}

export async function fsDelete(folder, name, { directory = false } = {}) {
  const f = cleanFolder(folder);
  const n = cleanName(name);
  if ((await fsBackend()) === 'opfs') return opfsDelete(join(ROOT, f, n), { recursive: directory });
  if (!directory) return idbDelete(STORES.files, join(f, n));
  const prefix = join(f, n);
  for (const r of await idbGetAll(STORES.files)) {
    if (r.path === `${prefix}/` || r.folder === prefix || r.folder.startsWith(`${prefix}/`)) await idbDelete(STORES.files, r.path);
  }
}

export async function fsRename(folder, from, to) {
  const f = cleanFolder(folder);
  const a = cleanName(from);
  const b = cleanName(to);
  if ((await fsBackend()) === 'opfs') return opfsMove(join(ROOT, f, a), join(ROOT, f, b));
  const r = await idbGet(STORES.files, join(f, a));
  if (!r) throw new Error('not found');
  await idbPut(STORES.files, { ...r, path: join(f, b), name: b, lastModified: Date.now() });
  await idbDelete(STORES.files, join(f, a));
}

/** Persist every unsaved file in the working set; returns the updated list. */
export async function saveWorkingSet(files) {
  const out = [];
  for (const file of files) {
    if (!file.dotSaved) {
      if (file.folder) await fsMkdir(file.folder);
      await fsWrite(file.folder, file.name, file.content);
    }
    out.push({ ...file, dotSaved: true });
  }
  return out;
}

/** dotSaved detection: compare the open copy with what is on disk. */
export async function detectDotSaved(file) {
  try {
    return (await fsRead(file.folder, file.name)) === file.content;
  } catch {
    return false;
  }
}
