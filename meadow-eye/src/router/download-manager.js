// Resumable downloads: HTTP Range requests in 8 MiB chunks, each chunk stored
// in IndexedDB (meadow_assets) as it lands, so a dropped connection resumes
// from the last complete chunk. Optionally assembled into one OPFS file.
import { get, put, del, all } from '../pwa/storage.js';
import { hfUrl } from './assets.js';

export const CHUNK = 8 * 1024 * 1024;
const metaKey = (id, file) => `meta:${id}:${file}`;
const chunkKey = (id, file, i) => `chunk:${id}:${file}:${i}`;

async function probeSize(url, fetchImpl) {
  const r = await fetchImpl(url, { headers: { Range: 'bytes=0-0' } });
  if (r.status === 206) {
    const total = Number((r.headers.get('content-range') || '').split('/')[1]);
    await r.body?.cancel?.();
    return { total, ranges: Number.isFinite(total) && total > 0 };
  }
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return { total: Number(r.headers.get('content-length')) || 0, ranges: false, response: r };
}

/**
 * Download (or resume) one file.
 * @param {(p:{loaded:number,total:number})=>void} onProgress
 */
export async function downloadFile(id, { repo, file }, { onProgress = () => {}, signal, fetchImpl = fetch } = {}) {
  const url = hfUrl(repo, file);
  let meta = await get('meadow_assets', metaKey(id, file));
  if (!meta) {
    const p = await probeSize(url, (u, o) => fetchImpl(u, { ...o, signal }));
    if (!p.ranges) {
      // No range support: one streamed pass, stored as a single chunk.
      const res = p.response || (await fetchImpl(url, { signal }));
      const reader = res.body.getReader();
      const parts = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        loaded += value.length;
        onProgress({ loaded, total: p.total || loaded });
      }
      await put('meadow_assets', chunkKey(id, file, 0), new Blob(parts));
      meta = { url, total: loaded, chunks: 1, done: [0], complete: true };
      await put('meadow_assets', metaKey(id, file), meta);
      return meta;
    }
    meta = { url, total: p.total, chunks: Math.ceil(p.total / CHUNK), done: [], complete: false };
    await put('meadow_assets', metaKey(id, file), meta);
  }
  const doneSet = new Set(meta.done);
  const loadedOf = () => Math.min(meta.total, doneSet.size * CHUNK);
  onProgress({ loaded: loadedOf(), total: meta.total });
  for (let i = 0; i < meta.chunks; i++) {
    if (doneSet.has(i)) continue;
    const start = i * CHUNK;
    const end = Math.min(meta.total, start + CHUNK) - 1;
    const res = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
    if (res.status !== 206) throw new Error(`range request refused (${res.status})`);
    const blob = await res.blob();
    if (blob.size !== end - start + 1) throw new Error(`short chunk ${i}`);
    await put('meadow_assets', chunkKey(id, file, i), blob);
    doneSet.add(i);
    meta.done = [...doneSet];
    await put('meadow_assets', metaKey(id, file), meta);
    onProgress({ loaded: loadedOf(), total: meta.total });
  }
  meta.complete = true;
  await put('meadow_assets', metaKey(id, file), meta);
  return meta;
}

export async function assetStatus(asset) {
  if (!asset.files) return { complete: asset.status === 'included', loaded: 0, total: 0 };
  let loaded = 0;
  let total = 0;
  let complete = true;
  for (const f of asset.files) {
    const m = await get('meadow_assets', metaKey(asset.id, f.file));
    total += m?.total || f.mb * 1e6;
    loaded += m ? Math.min(m.total, m.done.length * CHUNK) : 0;
    if (!m?.complete) complete = false;
  }
  return { complete, loaded, total };
}

export async function readAsset(id, file) {
  const m = await get('meadow_assets', metaKey(id, file));
  if (!m?.complete) return null;
  const parts = [];
  for (let i = 0; i < m.chunks; i++) parts.push(await get('meadow_assets', chunkKey(id, file, i)));
  return new Blob(parts);
}

/** Copy a finished asset into OPFS as one file (atomic .tmp + rename when supported). */
export async function assembleToOpfs(id, file) {
  const blob = await readAsset(id, file);
  if (!blob || !navigator.storage?.getDirectory) return false;
  const { opfsAtomicWrite } = await import('../pwa/storage.js');
  await opfsAtomicWrite(`${id}-${file.replace(/\//g, '_')}`, blob);
  return true;
}

export async function deleteAsset(asset) {
  for (const [k] of await all('meadow_assets')) if (k.includes(`:${asset.id}:`)) await del('meadow_assets', k);
}
