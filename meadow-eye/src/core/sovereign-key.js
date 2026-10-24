// Sovereign Key: there is no key file. A root HMAC-SHA256 key is generated
// with extractable=false, so the browser's key store can use it but nothing,
// including this code, can read it out. Each pod key is derived on demand:
//
//   podKey = HMAC(root, "MEADOW/SBX1/v1" || nonce || SHA-256(context))
//
// `context` is the behavioural part (a personal sigil, rhythm or phrase): steal
// the pod and the app and you still lack both the root and the context.
// Honest limit: the root lives in this browser profile; it is not literally
// woven into model weights.
import { get, put } from '../pwa/storage.js';

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const LABEL = enc.encode('MEADOW/SBX1/v1');

export async function rootKey() {
  const rec = await get('meadow_core', 'sovereign-root');
  if (rec?.key) return rec.key;
  const key = await subtle().generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  await put('meadow_core', 'sovereign-root', { key, createdAt: Date.now() });
  return key;
}

export async function contextDigest(context = '') {
  return new Uint8Array(await subtle().digest('SHA-256', enc.encode(String(context).normalize('NFKC'))));
}

export async function derivePodKey(nonce, context = '', root = null) {
  const k = root || (await rootKey());
  const ctx = await contextDigest(context);
  const msg = new Uint8Array(LABEL.length + nonce.length + ctx.length);
  msg.set(LABEL);
  msg.set(nonce, LABEL.length);
  msg.set(ctx, LABEL.length + nonce.length);
  return new Uint8Array(await subtle().sign('HMAC', k, msg));
}

export async function isExtractable() {
  return (await rootKey()).extractable;
}
