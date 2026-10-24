// Origin Private File System helpers.
// Writes use FileSystemFileHandle.createWritable() where available (Chrome,
// Safari 18.4+). Older iOS Safari only exposes createSyncAccessHandle() inside a
// dedicated worker, so we fall back to src/storage/opfs.worker.js for writes.

export function opfsSupported() {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
}

function splitPath(path) {
  const parts = String(path).split('/').filter(Boolean);
  for (const p of parts) {
    if (p === '.' || p === '..') throw new Error(`Illegal path segment in ${path}`);
  }
  return parts;
}

export async function opfsRoot() {
  if (!opfsSupported()) throw new Error('OPFS unavailable');
  return navigator.storage.getDirectory();
}

export async function opfsDir(path, { create = false } = {}) {
  let dir = await opfsRoot();
  for (const part of splitPath(path)) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}

async function parentAndName(path, create) {
  const parts = splitPath(path);
  const name = parts.pop();
  if (!name) throw new Error(`Bad path ${path}`);
  const dir = await opfsDir(parts.join('/'), { create });
  return { dir, name };
}

let worker = null;
let seq = 0;
const pending = new Map();

function writeViaWorker(path, bytes) {
  if (!worker) {
    worker = new Worker(new URL('./opfs.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      data.ok ? p.resolve(data.size) : p.reject(new Error(data.error));
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, path, bytes }, [bytes.buffer]);
  });
}

async function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  throw new TypeError('Unsupported data type for OPFS write');
}

/** Write a whole file atomically (createWritable commits on close). */
export async function opfsWrite(path, data) {
  const { dir, name } = await parentAndName(path, true);
  const handle = await dir.getFileHandle(name, { create: true });
  if (typeof handle.createWritable === 'function') {
    const w = await handle.createWritable();
    try {
      await w.write(data instanceof Blob ? data : await toBytes(data));
      await w.close();
    } catch (err) {
      await w.abort?.();
      throw err;
    }
    return;
  }
  // Copy so the transfer does not detach the caller's buffer.
  const bytes = (await toBytes(data)).slice();
  await writeViaWorker(splitPath(path).join('/'), bytes);
}

export async function opfsRead(path) {
  const { dir, name } = await parentAndName(path, false);
  const handle = await dir.getFileHandle(name);
  return handle.getFile();
}

export async function opfsExists(path) {
  try {
    await opfsRead(path);
    return true;
  } catch {
    return false;
  }
}

export async function opfsList(path = '') {
  let dir;
  try {
    dir = await opfsDir(path);
  } catch {
    return [];
  }
  const out = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file') {
      const f = await handle.getFile();
      out.push({ name, kind: 'file', size: f.size, lastModified: f.lastModified });
    } else {
      out.push({ name, kind: 'directory', size: 0, lastModified: 0 });
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));
}

export async function opfsMkdir(path) {
  await opfsDir(path, { create: true });
}

export async function opfsDelete(path, { recursive = false } = {}) {
  const { dir, name } = await parentAndName(path, false);
  await dir.removeEntry(name, { recursive });
}

/** Rename/move a file. Uses handle.move() when present, else copy + delete. */
export async function opfsMove(from, to) {
  const src = await parentAndName(from, false);
  const handle = await src.dir.getFileHandle(src.name);
  const dst = await parentAndName(to, true);
  if (typeof handle.move === 'function') {
    try {
      await handle.move(dst.dir, dst.name);
      return;
    } catch {
      // Some engines only support same-directory moves; fall through to copy.
    }
  }
  const file = await handle.getFile();
  await opfsWrite(to, file);
  await src.dir.removeEntry(src.name);
}
