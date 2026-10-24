// OPFS write fallback for engines without createWritable() (older iOS Safari).
// createSyncAccessHandle() is only available inside dedicated workers.

self.onmessage = async ({ data }) => {
  const { id, path, bytes } = data;
  let access;
  try {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    let dir = await navigator.storage.getDirectory();
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
    const handle = await dir.getFileHandle(name, { create: true });
    access = await handle.createSyncAccessHandle();
    access.truncate(0);
    let offset = 0;
    while (offset < bytes.byteLength) offset += access.write(bytes.subarray(offset), { at: offset });
    access.flush();
    self.postMessage({ id, ok: true, size: offset });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  } finally {
    access?.close();
  }
};
