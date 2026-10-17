// Local autosave between visits: LIVE_STATE sealed with the device key
// (AES-GCM, fresh 12-byte IV each write) in IndexedDB. The portable save is
// still the long string; this just means a reload doesn't lose the session.
import { idbGet, idbPut, STORES } from '../storage/idb.js';
import { createSovereignKey, getDeviceKey, gzip, gunzip, validateLiveState } from '../longString.js';

const KEY = 'autosave';

export async function writeAutosave(state) {
  const { key, keyId } = await createSovereignKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = await gzip(new TextEncoder().encode(JSON.stringify(state)));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`autosave:${keyId}`) }, key, plain);
  await idbPut(STORES.kv, { keyId, iv, ct: new Uint8Array(ct), savedAt: Date.now() }, KEY);
}

export async function readAutosave() {
  const rec = await idbGet(STORES.kv, KEY).catch(() => null);
  if (!rec) return null;
  const key = await getDeviceKey(rec.keyId);
  if (!key) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv, additionalData: new TextEncoder().encode(`autosave:${rec.keyId}`) }, key, rec.ct);
    return validateLiveState(JSON.parse(new TextDecoder().decode(await gunzip(new Uint8Array(plain)))));
  } catch {
    return null;
  }
}
