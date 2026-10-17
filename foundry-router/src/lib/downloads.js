// Asset Store downloader: real fetch() from the Hugging Face CDN with streamed
// progress, two downloads at a time, cancellable. Files stream straight into
// OPFS (/models/...) when the browser supports writable streams; otherwise they
// are assembled into a Blob and stored in IndexedDB.
import { idbGet, idbPut, idbDelete, idbGetAll, STORES } from '../storage/idb.js';
import { opfsSupported, opfsDir, opfsRead, opfsDelete } from '../storage/opfs.js';

export const HF_CDN = 'https://huggingface.co/{id}/resolve/main/{file}';
export const CONCURRENCY = 2;

export const hfUrl = (repo, file) => HF_CDN.replace('{id}', repo).replace('{file}', file.split('/').map(encodeURIComponent).join('/'));
const blobId = (repo, file) => `${repo}/${file}`;
const opfsPath = (repo, file) => `models/${repo}/${file}`;

async function streamToOpfs(path, body, onChunk) {
  const parts = path.split('/');
  const name = parts.pop();
  const dir = await opfsDir(parts.join('/'), { create: true });
  const handle = await dir.getFileHandle(name, { create: true });
  if (typeof handle.createWritable !== 'function') return false;
  const writable = await handle.createWritable();
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      onChunk(value.length);
    }
    await writable.close();
    return true;
  } catch (err) {
    await writable.abort?.().catch(() => {});
    throw err;
  }
}

async function downloadFile(repo, file, { signal, onProgress }) {
  const res = await fetch(hfUrl(repo, file), { signal, mode: 'cors' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText || ''} for ${repo}/${file}`.trim());
  const total = Number(res.headers.get('content-length')) || 0;
  let loaded = 0;
  const tick = (n) => {
    loaded += n;
    onProgress(loaded, total);
  };
  if (opfsSupported()) {
    try {
      if (await streamToOpfs(opfsPath(repo, file), res.body, tick)) {
        await idbPut(STORES.blobs, { id: blobId(repo, file), repo, file, size: loaded, backend: 'opfs', savedAt: Date.now() });
        return loaded;
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      throw new Error(`OPFS write failed: ${err.message}`);
    }
  }
  const reader = res.body.getReader();
  const parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    tick(value.length);
  }
  const blob = new Blob(parts);
  await idbPut(STORES.blobs, { id: blobId(repo, file), repo, file, size: blob.size, backend: 'idb', blob, savedAt: Date.now() });
  return blob.size;
}

export async function readModelFile(repo, file) {
  const rec = await idbGet(STORES.blobs, blobId(repo, file)).catch(() => null);
  if (!rec) return null;
  if (rec.backend === 'opfs') return opfsRead(opfsPath(repo, file)).catch(() => null);
  return rec.blob || null;
}

export async function storedFiles() {
  const all = await idbGetAll(STORES.blobs).catch(() => []);
  return all.map(({ id, repo, file, size, backend, savedAt }) => ({ id, repo, file, size, backend, savedAt }));
}

export async function deleteModel(model) {
  for (const file of [model.file, ...(model.extra || [])]) {
    const rec = await idbGet(STORES.blobs, blobId(model.repo, file)).catch(() => null);
    if (rec?.backend === 'opfs') await opfsDelete(opfsPath(model.repo, file)).catch(() => {});
    await idbDelete(STORES.blobs, blobId(model.repo, file)).catch(() => {});
  }
}

export async function isDownloaded(model) {
  for (const file of [model.file, ...(model.extra || [])]) {
    if (!(await idbGet(STORES.blobs, blobId(model.repo, file)).catch(() => null))) return false;
  }
  return true;
}

/**
 * Queue with fixed concurrency. Listeners get { id, state, loaded, total, error }.
 */
export function createDownloadQueue({ concurrency = CONCURRENCY, onUpdate = () => {} } = {}) {
  const queue = [];
  const active = new Map();
  const emit = (id, patch) => onUpdate({ id, ...patch });

  async function run(model) {
    const ctrl = new AbortController();
    active.set(model.id, ctrl);
    const files = [model.file, ...(model.extra || [])];
    const done = new Map();
    let expected = (model.sizeMB || 0) * 1e6;
    try {
      emit(model.id, { state: 'downloading', loaded: 0, total: expected });
      for (const file of files) {
        await downloadFile(model.repo, file, {
          signal: ctrl.signal,
          onProgress: (loaded, total) => {
            done.set(file, { loaded, total });
            const sum = [...done.values()].reduce((s, f) => s + f.loaded, 0);
            const knownTotal = [...done.values()].reduce((s, f) => s + (f.total || f.loaded), 0);
            expected = Math.max(expected, knownTotal);
            emit(model.id, { state: 'downloading', loaded: sum, total: expected });
          },
        });
      }
      const loaded = [...done.values()].reduce((s, f) => s + f.loaded, 0);
      emit(model.id, { state: 'done', loaded, total: loaded });
    } catch (err) {
      emit(model.id, { state: err?.name === 'AbortError' ? 'cancelled' : 'error', error: String(err?.message || err) });
    } finally {
      active.delete(model.id);
      pump();
    }
  }

  function pump() {
    while (active.size < concurrency && queue.length) run(queue.shift());
  }

  return {
    enqueue(models) {
      for (const m of models) {
        if (active.has(m.id) || queue.some((q) => q.id === m.id)) continue;
        queue.push(m);
        emit(m.id, { state: 'queued' });
      }
      pump();
    },
    cancel(id) {
      const i = queue.findIndex((q) => q.id === id);
      if (i >= 0) {
        queue.splice(i, 1);
        emit(id, { state: 'cancelled' });
      }
      active.get(id)?.abort();
    },
    get activeCount() {
      return active.size;
    },
    get queuedCount() {
      return queue.length;
    },
  };
}
