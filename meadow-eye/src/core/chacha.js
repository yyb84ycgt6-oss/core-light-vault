// Pure-JS ChaCha20, HChaCha20, Poly1305 and (X)ChaCha20-Poly1305 AEAD
// (RFC 8439 + draft-irtf-cfrg-xchacha). WebCrypto has no ChaCha, and the
// Meadow rule is "no CDN ever", so it lives here. Verified against RFC vectors
// and Node's native chacha20-poly1305 in test/chacha.test.js.

const rotl = (v, c) => (v << c) | (v >>> (32 - c));

function quarter(s, a, b, c, d) {
  s[a] = (s[a] + s[b]) | 0; s[d] = rotl(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) | 0; s[b] = rotl(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b]) | 0; s[d] = rotl(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) | 0; s[b] = rotl(s[b] ^ s[c], 7);
}

function rounds(s) {
  for (let i = 0; i < 10; i++) {
    quarter(s, 0, 4, 8, 12); quarter(s, 1, 5, 9, 13); quarter(s, 2, 6, 10, 14); quarter(s, 3, 7, 11, 15);
    quarter(s, 0, 5, 10, 15); quarter(s, 1, 6, 11, 12); quarter(s, 2, 7, 8, 13); quarter(s, 3, 4, 9, 14);
  }
}

const words = (bytes) => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.length / 4 }, (_, i) => dv.getUint32(i * 4, true));
};

function initState(key, counter, nonce12) {
  return Uint32Array.from([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574, ...words(key), counter >>> 0, ...words(nonce12)]);
}

export function chachaBlock(key, counter, nonce12) {
  const init = initState(key, counter, nonce12);
  const s = Uint32Array.from(init);
  rounds(s);
  const out = new Uint8Array(64);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) dv.setUint32(i * 4, (s[i] + init[i]) >>> 0, true);
  return out;
}

export function hchacha20(key, nonce16) {
  const s = Uint32Array.from([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574, ...words(key), ...words(nonce16)]);
  rounds(s);
  const out = new Uint8Array(32);
  const dv = new DataView(out.buffer);
  [0, 1, 2, 3, 12, 13, 14, 15].forEach((w, i) => dv.setUint32(i * 4, s[w], true));
  return out;
}

export function chacha20Xor(key, nonce12, counter, data) {
  const out = new Uint8Array(data.length);
  for (let off = 0, c = counter; off < data.length; off += 64, c++) {
    const ks = chachaBlock(key, c, nonce12);
    const n = Math.min(64, data.length - off);
    for (let i = 0; i < n; i++) out[off + i] = data[off + i] ^ ks[i];
  }
  return out;
}

const P = (1n << 130n) - 5n;
const le = (b) => {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]);
  return n;
};

export function poly1305(key, msg) {
  const r = le(key.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn;
  const s = le(key.subarray(16, 32));
  let acc = 0n;
  for (let i = 0; i < msg.length; i += 16) {
    const block = msg.subarray(i, i + 16);
    acc = ((acc + le(block) + (1n << BigInt(8 * block.length))) * r) % P;
  }
  acc = (acc + s) & ((1n << 128n) - 1n);
  const tag = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    tag[i] = Number(acc & 0xffn);
    acc >>= 8n;
  }
  return tag;
}

function macData(ad, ct) {
  const pad = (n) => (16 - (n % 16)) % 16;
  const out = new Uint8Array(ad.length + pad(ad.length) + ct.length + pad(ct.length) + 16);
  out.set(ad, 0);
  out.set(ct, ad.length + pad(ad.length));
  const dv = new DataView(out.buffer);
  dv.setBigUint64(out.length - 16, BigInt(ad.length), true);
  dv.setBigUint64(out.length - 8, BigInt(ct.length), true);
  return out;
}

function ctEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/** RFC 8439 AEAD. Returns ciphertext || 16-byte tag. */
export function chacha20poly1305Seal(key, nonce12, plaintext, ad = new Uint8Array(0)) {
  const otk = chachaBlock(key, 0, nonce12).subarray(0, 32);
  const ct = chacha20Xor(key, nonce12, 1, plaintext);
  const out = new Uint8Array(ct.length + 16);
  out.set(ct);
  out.set(poly1305(otk, macData(ad, ct)), ct.length);
  return out;
}

/** Returns plaintext, or null when authentication fails. */
export function chacha20poly1305Open(key, nonce12, sealed, ad = new Uint8Array(0)) {
  if (sealed.length < 16) return null;
  const ct = sealed.subarray(0, sealed.length - 16);
  const otk = chachaBlock(key, 0, nonce12).subarray(0, 32);
  if (!ctEqual(poly1305(otk, macData(ad, ct)), sealed.subarray(sealed.length - 16))) return null;
  return chacha20Xor(key, nonce12, 1, ct);
}

function xNonce(key, nonce24) {
  const sub = hchacha20(key, nonce24.subarray(0, 16));
  const n12 = new Uint8Array(12);
  n12.set(nonce24.subarray(16, 24), 4);
  return { sub, n12 };
}

export function xchacha20poly1305Seal(key, nonce24, plaintext, ad) {
  const { sub, n12 } = xNonce(key, nonce24);
  return chacha20poly1305Seal(sub, n12, plaintext, ad);
}

export function xchacha20poly1305Open(key, nonce24, sealed, ad) {
  const { sub, n12 } = xNonce(key, nonce24);
  return chacha20poly1305Open(sub, n12, sealed, ad);
}
