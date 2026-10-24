// ZK Tank (SBX1). Container layout:
//   preamble (80 B) = header 16 B ("SBX1" magic 0x53425831, version, flags, zeros)
//                   + nonce 24 B (XChaCha20) + padding 40 B (random)
//   body            = XChaCha20-Poly1305(framed plaintext), AD = preamble
// Framed plaintext = u32 length || data || random padding up to a power-of-two
// bucket (min 4 KiB), so neither the true size nor any timestamp leaks.
// (The brief's field sizes 16 + 24 + 40 add to 80 bytes, not 64; the listed
// field sizes are kept.)
import { xchacha20poly1305Seal, xchacha20poly1305Open } from './chacha.js';

export const MAGIC = 0x53425831; // "SBX1"
export const PREAMBLE = 80;
const MIN_BUCKET = 4096;

const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function bucketSize(n) {
  let b = MIN_BUCKET;
  while (b < n + 4) b *= 2;
  return b;
}

export function sbx1Seal(key, data, { nonce = rand(24) } = {}) {
  const pre = new Uint8Array(PREAMBLE);
  const dv = new DataView(pre.buffer);
  dv.setUint32(0, MAGIC);
  pre[4] = 1; // version
  pre.set(nonce, 16);
  pre.set(rand(40), 40);
  const framed = rand(bucketSize(data.length));
  new DataView(framed.buffer).setUint32(0, data.length);
  framed.set(data, 4);
  const body = xchacha20poly1305Seal(key, nonce, framed, pre);
  const out = new Uint8Array(PREAMBLE + body.length);
  out.set(pre);
  out.set(body, PREAMBLE);
  return out;
}

export const sbx1Nonce = (blob) => blob.subarray(16, 40);

export function isSbx1(blob) {
  return blob?.length >= PREAMBLE + 16 && new DataView(blob.buffer, blob.byteOffset).getUint32(0) === MAGIC;
}

/** Returns data or null (wrong key, wrong context, or tampered). */
export function sbx1Open(key, blob) {
  if (!isSbx1(blob)) return null;
  const pre = blob.subarray(0, PREAMBLE);
  const framed = xchacha20poly1305Open(key, sbx1Nonce(blob), blob.subarray(PREAMBLE), pre);
  if (!framed) return null;
  const len = new DataView(framed.buffer, framed.byteOffset).getUint32(0);
  if (len > framed.length - 4) return null;
  return framed.slice(4, 4 + len);
}
