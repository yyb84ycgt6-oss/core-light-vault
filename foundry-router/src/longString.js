// Meta Foundry Router - the atomic long string.
//
//   _{Data}-{AI}-(eYe)-{qpdb}~{Encrypted_compressed}-{bdpq}-(eYe)-{AI}-{Data}_
//
// Production notes (what changed from the draft):
// * Keys are real WebCrypto AES-GCM-256 keys created with extractable=false.
//   Device keys live in IndexedDB as CryptoKey objects; the raw bytes never
//   leave the browser's key store. Passphrase ("twin") keys are derived with
//   PBKDF2-SHA256, 2^20 iterations, over W || C || B.
// * The payload is gzip-compressed (CompressionStream) and encrypted in 16 KiB
//   records (a STREAM construction: per-record nonce = random 12-byte IV XOR
//   counter, final-record flag and the header digest bound in the AAD). Restore
//   decrypts one record at a time, so the working set is O(16 KiB) instead of
//   O(|D|), and truncation or reordering fails authentication.
// * {Data} first is the *public projection* of LIVE_STATE (system, canvas,
//   counts...). Chat text and file contents only exist inside the ciphertext;
//   putting them in clear next to their own ciphertext would defeat the seal.
// * Restore is all-or-nothing: every check runs and every record authenticates
//   before a new state object is returned. Nothing is mutated on failure.

import { idbGet, idbPut, idbKeys, idbDelete, STORES } from './storage/idb.js';
import { opfsSupported, opfsWrite, opfsRead, opfsList, opfsDelete } from './storage/opfs.js';
import { tokenizeWords, collapseEmbeddings, decodeFingerprint } from './lib/collapse.js';
import { createHashEmbedder } from './lib/embedder.js';

export const LS_VERSION = 1;
export const CHUNK_SIZE = 16 * 1024;
export const TAG_BYTES = 16;
export const IV_BYTES = 12;
export const PBKDF2_ITERATIONS = 2 ** 20;
export const POD_LIMIT_BYTES = 50 * 1024 * 1024;
export const ALG = 'AES-GCM-256/STREAM-16K/gzip';

export const ERR = Object.freeze({
  BOUND_VIOLATION: 'BOUND_VIOLATION',
  SEGMENT_MALFORMED: 'SEGMENT_MALFORMED',
  MIRROR_MISMATCH: 'MIRROR_MISMATCH',
  TWIN_MISMATCH: 'TWIN_MISMATCH',
  DIGEST_MISMATCH: 'DIGEST_MISMATCH',
  FUTURE_LOCKED: 'FUTURE_LOCKED',
  KEY_UNAVAILABLE: 'KEY_UNAVAILABLE',
  PASSPHRASE_REQUIRED: 'PASSPHRASE_REQUIRED',
  BIOMETRIC_DENIED: 'BIOMETRIC_DENIED',
  AUTH_FAILED: 'AUTH_FAILED',
  TRUNCATED: 'TRUNCATED',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  POD_TOO_LARGE: 'POD_TOO_LARGE',
});

export class LongStringError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'LongStringError';
    this.code = code;
  }
}
const fail = (code, msg) => {
  throw new LongStringError(code, msg);
};

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto unavailable (needs a secure context: https:// or localhost)');
  return s;
};
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64ToBytes(b64) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) throw new Error('bad base64');
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const jsonToB64 = (obj) => bytesToB64(enc.encode(JSON.stringify(obj)));
const b64ToJson = (b64) => JSON.parse(dec.decode(b64ToBytes(b64)));

export async function sha256(data) {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return new Uint8Array(await subtle().digest('SHA-256', bytes));
}
export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (hex) => Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));
export const sha256Hex = async (data) => toHex(await sha256(data));

const QPDB = ['q', 'p', 'd', 'b'];
const QPDB_INDEX = { q: 0, p: 1, d: 2, b: 3 };

/** Base-4 glyph encoding of fingerprint bytes: every byte -> 4 of {q,p,d,b}. */
export function bytesToQpdb(bytes) {
  let s = '';
  for (const byte of bytes) s += QPDB[byte >> 6] + QPDB[(byte >> 4) & 3] + QPDB[(byte >> 2) & 3] + QPDB[byte & 3];
  return s;
}
export function qpdbToBytes(str) {
  if (str.length % 4 !== 0 || /[^qpdb]/.test(str)) throw new Error('bad qpdb');
  const out = new Uint8Array(str.length / 4);
  for (let i = 0; i < out.length; i++) {
    const j = i * 4;
    out[i] = (QPDB_INDEX[str[j]] << 6) | (QPDB_INDEX[str[j + 1]] << 4) | (QPDB_INDEX[str[j + 2]] << 2) | QPDB_INDEX[str[j + 3]];
  }
  return out;
}
/** bdpq = the mirror of qpdb: the same glyph stream read backwards. */
export const reverseCollapseSignature = (qpdb) => Array.from(qpdb).reverse().join('');

// ---------------------------------------------------------------------------
// LIVE_STATE
// ---------------------------------------------------------------------------

export function defaultLiveState() {
  return {
    v: LS_VERSION,
    chat: [],
    files: [],
    canvas: { neutronStar: { corePulse: 0.87, diskLayers: 6, stars: 200 } },
    pods: [],
    models: [],
    jacky: { selectedDomain: null, ringMode: 'tech' },
    system: { battery: null, ram: null, thermal: null },
  };
}

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Validate + normalise a LIVE_STATE object. Throws SCHEMA_INVALID. */
export function validateLiveState(s) {
  if (!isObj(s)) fail(ERR.SCHEMA_INVALID, 'state must be an object');
  const base = defaultLiveState();
  if (s.chat !== undefined && !Array.isArray(s.chat)) fail(ERR.SCHEMA_INVALID, 'chat must be an array');
  if (s.files !== undefined && !Array.isArray(s.files)) fail(ERR.SCHEMA_INVALID, 'files must be an array');
  const chat = (s.chat || []).map((m, i) => {
    if (!isObj(m) || !['user', 'assistant', 'system'].includes(m.role) || typeof m.content !== 'string')
      fail(ERR.SCHEMA_INVALID, `chat[${i}] needs role user|assistant|system and string content`);
    return { role: m.role, content: m.content, providerBadge: typeof m.providerBadge === 'string' ? m.providerBadge : '', ts: num(m.ts, 0) };
  });
  const files = (s.files || []).map((f, i) => {
    if (!isObj(f) || typeof f.name !== 'string' || !f.name || typeof f.content !== 'string')
      fail(ERR.SCHEMA_INVALID, `files[${i}] needs name and string content`);
    if (/[\\/]|^\.\.?$/.test(f.name)) fail(ERR.SCHEMA_INVALID, `files[${i}] has an illegal name`);
    const folder = typeof f.folder === 'string' ? f.folder.replace(/^\/+|\/+$/g, '') : '';
    if (folder.split('/').some((p) => p === '..' || p === '.')) fail(ERR.SCHEMA_INVALID, `files[${i}] has an illegal folder`);
    return { name: f.name, folder, content: f.content, dotSaved: f.dotSaved === true };
  });
  const ns = isObj(s.canvas?.neutronStar) ? s.canvas.neutronStar : {};
  const pods = Array.isArray(s.pods)
    ? s.pods.filter(isObj).map((p) => ({ id: String(p.id || ''), sealed: p.sealed !== false, ratio: num(p.ratio, 0), createdAt: num(p.createdAt, 0), futureLock: p.futureLock ?? null }))
    : [];
  return {
    v: LS_VERSION,
    chat,
    files,
    canvas: {
      neutronStar: {
        corePulse: Math.min(1, Math.max(0, num(ns.corePulse, base.canvas.neutronStar.corePulse))),
        diskLayers: Math.round(Math.min(8, Math.max(1, num(ns.diskLayers, base.canvas.neutronStar.diskLayers)))),
        stars: Math.round(Math.min(2000, Math.max(0, num(ns.stars, base.canvas.neutronStar.stars)))),
      },
    },
    pods,
    models: Array.isArray(s.models) ? s.models.filter((m) => typeof m === 'string') : [],
    jacky: {
      selectedDomain: typeof s.jacky?.selectedDomain === 'string' ? s.jacky.selectedDomain : null,
      ringMode: ['tech', 'esoteric', 'all'].includes(s.jacky?.ringMode) ? s.jacky.ringMode : 'tech',
    },
    system: {
      battery: s.system?.battery ?? null,
      ram: s.system?.ram ?? null,
      thermal: s.system?.thermal ?? null,
    },
  };
}

/** Public, non-sensitive projection of LIVE_STATE for the {Data} first segment. */
export function publicProjection(state) {
  return {
    kind: 'LIVE_STATE/public',
    system: state.system,
    canvas: state.canvas,
    jacky: state.jacky,
    models: state.models,
    pods: state.pods.map(({ id, sealed, ratio }) => ({ id, sealed, ratio })),
    counts: { chat: state.chat.length, files: state.files.length },
  };
}

/** AST-style outline of the state ({AI} second): structure only, no content. */
export function reconstructionMap(value, path = '$', depth = 0) {
  if (Array.isArray(value)) {
    const node = { path, type: 'array', len: value.length };
    if (depth < 2 && value.length) node.item = reconstructionMap(value[0], `${path}[]`, depth + 1);
    return node;
  }
  if (isObj(value)) {
    const node = { path, type: 'object', keys: Object.keys(value).length };
    if (depth < 2) node.children = Object.keys(value).map((k) => reconstructionMap(value[k], `${path}.${k}`, depth + 1));
    return node;
  }
  return { path, type: value === null ? 'null' : typeof value };
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const DEVICE_KEY_CURRENT = 'device:current';

/**
 * Create (or load) the device-bound sovereign key. extractable=false: the raw
 * key can never be exported, only used, and it is persisted in IndexedDB as a
 * structured-cloned CryptoKey.
 */
export async function createSovereignKey({ rotate = false } = {}) {
  if (!rotate) {
    const current = await idbGet(STORES.keys, DEVICE_KEY_CURRENT).catch(() => null);
    if (current?.keyId) {
      const rec = await idbGet(STORES.keys, `device:${current.keyId}`);
      if (rec?.key) return { key: rec.key, keyId: rec.keyId, mode: 'device', createdAt: rec.createdAt };
    }
  }
  const key = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const keyId = toHex(globalThis.crypto.getRandomValues(new Uint8Array(8)));
  const createdAt = Date.now();
  await idbPut(STORES.keys, { id: `device:${keyId}`, key, keyId, createdAt, alg: 'AES-GCM-256' });
  await idbPut(STORES.keys, { id: DEVICE_KEY_CURRENT, keyId });
  return { key, keyId, mode: 'device', createdAt };
}

export async function getDeviceKey(keyId) {
  const rec = await idbGet(STORES.keys, `device:${keyId}`).catch(() => null);
  return rec?.key || null;
}

/** K = PBKDF2(W || C || B, salt, 2^20). Non-extractable AES-GCM-256 result. */
export async function deriveTwinKey({ passphrase, salt, weightsDigest, biometricSecret = null, iterations = PBKDF2_ITERATIONS }) {
  if (!passphrase) fail(ERR.PASSPHRASE_REQUIRED, 'passphrase (C) required for the twin key');
  const W = fromHex(weightsDigest || '');
  const C = enc.encode(String(passphrase).normalize('NFKC'));
  const B = biometricSecret ? new Uint8Array(biometricSecret) : new Uint8Array(0);
  // Length-prefix each part so (C, B) boundaries are unambiguous.
  const material = new Uint8Array(12 + W.length + C.length + B.length);
  const dv = new DataView(material.buffer);
  let o = 0;
  for (const part of [W, C, B]) {
    dv.setUint32(o, part.length);
    material.set(part, o + 4);
    o += 4 + part.length;
  }
  const base = await subtle().importKey('raw', material, 'PBKDF2', false, ['deriveKey']);
  material.fill(0);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Rough entropy estimate for a passphrase, in bits (character-class model). */
export function passphraseBits(p) {
  if (!p) return 0;
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/[0-9]/.test(p)) pool += 10;
  if (/[^A-Za-z0-9]/.test(p)) pool += 33;
  return Math.round(Array.from(p).length * Math.log2(Math.max(pool, 2)));
}

// ---------------------------------------------------------------------------
// STREAM codec: gzip -> 16 KiB records -> AES-GCM per record
// ---------------------------------------------------------------------------

async function pump(stream) {
  const reader = stream.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const gzip = (bytes) => pump(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')));
export const gunzip = (bytes) => pump(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));

function recordNonce(base, index) {
  const n = base.slice();
  const dv = new DataView(n.buffer);
  dv.setUint32(8, dv.getUint32(8) ^ index);
  return n;
}

function recordAad(aadBase, index, final) {
  const a = new Uint8Array(aadBase.length + 5);
  a.set(aadBase);
  new DataView(a.buffer).setUint32(aadBase.length, index);
  a[aadBase.length + 4] = final ? 1 : 0;
  return a;
}

/** Encrypt compressed bytes into authenticated 16 KiB records. */
export async function encryptRecords(key, baseNonce, aadBase, compressed, chunkSize = CHUNK_SIZE) {
  const count = Math.max(1, Math.ceil(compressed.length / chunkSize));
  const records = [];
  for (let i = 0; i < count; i++) {
    const chunk = compressed.subarray(i * chunkSize, Math.min(compressed.length, (i + 1) * chunkSize));
    const ct = await subtle().encrypt(
      { name: 'AES-GCM', iv: recordNonce(baseNonce, i), additionalData: recordAad(aadBase, i, i === count - 1) },
      key,
      chunk,
    );
    records.push(new Uint8Array(ct));
  }
  return records;
}

async function decryptRecord(key, baseNonce, aadBase, index, final, record) {
  try {
    return new Uint8Array(
      await subtle().decrypt({ name: 'AES-GCM', iv: recordNonce(baseNonce, index), additionalData: recordAad(aadBase, index, final) }, key, record),
    );
  } catch {
    if (final) {
      // A record that authenticates as non-final means the tail was cut off.
      const ok = await subtle()
        .decrypt({ name: 'AES-GCM', iv: recordNonce(baseNonce, index), additionalData: recordAad(aadBase, index, false) }, key, record)
        .then(() => true, () => false);
      if (ok) fail(ERR.TRUNCATED, `stream ends at record ${index} without the final record`);
    }
    fail(ERR.AUTH_FAILED, `record ${index} failed authentication (wrong key or tampered data)`);
  }
}

/** Lazily split the '.'-joined base64 records of the encrypted segment. */
export function* iterateRecordStrings(encSegment) {
  let start = 0;
  for (;;) {
    const dot = encSegment.indexOf('.', start);
    const last = dot === -1;
    yield { b64: encSegment.slice(start, last ? undefined : dot), last };
    if (last) return;
    start = dot + 1;
  }
}

/**
 * bdpq streamed restore: decrypt record by record and yield decompressed
 * plaintext. The working set stays at one record (~16 KiB) plus the inflater
 * window: M(t) = const, not M(t) = |D|.
 * @param {Iterable<{bytes?:Uint8Array,b64?:string,last:boolean}>} records
 */
export async function* bdpqStreamed(key, baseNonce, aadBase, records, meter = { peak: 0, chunks: 0, tags: [] }) {
  const inflater = new DecompressionStream('gzip');
  const writer = inflater.writable.getWriter();
  const reader = inflater.readable.getReader();
  let index = 0;
  let sawFinal = false;
  let writeError = null;
  let finished = false;
  const feed = (async () => {
    try {
      for await (const rec of records) {
        if (sawFinal) fail(ERR.AUTH_FAILED, 'data after the final record');
        const bytes = rec.bytes || (() => {
          try {
            return b64ToBytes(rec.b64);
          } catch {
            return fail(ERR.SEGMENT_MALFORMED, `record ${index} is not base64`);
          }
        })();
        if (bytes.length < TAG_BYTES) fail(ERR.TRUNCATED, `record ${index} is shorter than a GCM tag`);
        const plain = await decryptRecord(key, baseNonce, aadBase, index, rec.last, bytes);
        meter.tags.push(bytes.subarray(bytes.length - TAG_BYTES).slice());
        meter.peak = Math.max(meter.peak, (rec.b64?.length || 0) + bytes.length + plain.length);
        meter.chunks++;
        index++;
        if (rec.last) sawFinal = true;
        await writer.write(plain);
      }
      if (!sawFinal) fail(ERR.TRUNCATED, 'no final record');
      await writer.close();
    } catch (err) {
      writeError = err;
      await writer.abort(err).catch(() => {});
    }
  })();
  try {
    for (;;) {
      let r;
      try {
        r = await reader.read();
      } catch (err) {
        if (writeError) throw writeError;
        throw new LongStringError(ERR.AUTH_FAILED, `inflate failed: ${err.message}`);
      }
      if (r.done) break;
      yield r.value;
    }
    finished = true;
  } finally {
    // Consumer stopped early: cancel so a writer blocked on backpressure unwinds.
    if (!finished) await reader.cancel().catch(() => {});
    await feed;
  }
  if (writeError) throw writeError;
}

/** Burst restore for comparison: everything decoded at once, M(t) = |D|. */
export async function burstRestore(key, baseNonce, aadBase, recordStrings) {
  const all = recordStrings.map((s) => b64ToBytes(s));
  const plains = [];
  for (let i = 0; i < all.length; i++) plains.push(await decryptRecord(key, baseNonce, aadBase, i, i === all.length - 1, all[i]));
  const total = plains.reduce((s, p) => s + p.length, 0);
  const joined = new Uint8Array(total);
  let o = 0;
  for (const p of plains) {
    joined.set(p, o);
    o += p.length;
  }
  const out = await gunzip(joined);
  const cipherBytes = all.reduce((s, b) => s + b.length, 0);
  return { bytes: out, peak: recordStrings.reduce((s, r) => s + r.length, 0) + cipherBytes + total + out.length };
}

async function collect(gen) {
  const parts = [];
  let total = 0;
  for await (const p of gen) {
    parts.push(p);
    total += p.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function tagDigest(tags) {
  const all = new Uint8Array(tags.length * TAG_BYTES);
  tags.forEach((t, i) => all.set(t, i * TAG_BYTES));
  return sha256Hex(all);
}

// ---------------------------------------------------------------------------
// Y-Axis Collapse
// ---------------------------------------------------------------------------

const defaultEmbedder = createHashEmbedder();

/** Real Y-axis collapse of text: embeddings -> PCA(cosSim) top-k -> 8-bit SVQ. */
export async function realYAxisCollapse(text, { k = 2, embedder = defaultEmbedder, curveTo = 0 } = {}) {
  const words = tokenizeWords(text);
  const E = await embedder.embedWords(words);
  const d = words.length ? E.length / words.length : embedder.dim || 0;
  const res = collapseEmbeddings(E, words.length, d || 1, { k, curveTo, embedderCode: embedder.code });
  return { ...res, words: words.length, textBytes: enc.encode(String(text || '')).length, embedder: embedder.id, qpdb: bytesToQpdb(res.fingerprint) };
}

export const chatText = (state) => state.chat.map((m) => m.content).join('\n');

// ---------------------------------------------------------------------------
// Long string
// ---------------------------------------------------------------------------

/** The header every record's AAD is bound to. */
function headerString(seg) {
  return [seg.D1, seg.A1, seg.E1, seg.Q, seg.E2].join('|');
}

/**
 * Assemble the atomic long string from the current state.
 * @param {object} state LIVE_STATE
 * @param {object} opts
 * @param {'device'|'passphrase'} [opts.keyMode]
 * @param {string} [opts.passphrase] C in K = PBKDF2(W||C||B)
 * @param {{secret?:Uint8Array, credentialId?:string}|null} [opts.biometric] WebAuthn PRF output (B)
 * @param {object} opts.eye eYe descriptor ({ weightsDigest, ... }) from eYe.js
 * @param {object} [opts.router] router fabric snapshot (no keys)
 * @param {number|null} [opts.futureLock] epoch ms before which restore is refused
 */
export async function createLongStringProduction(state, opts = {}) {
  const t0 = performance.now();
  const {
    keyMode = 'device',
    passphrase,
    biometric = null,
    eye = { name: 'eYe', weightsDigest: '' },
    router = {},
    futureLock = null,
    k = 2,
    embedder,
    iterations = PBKDF2_ITERATIONS,
  } = opts;
  const live = validateLiveState(state);
  const plain = enc.encode(JSON.stringify(live));
  if (plain.length > POD_LIMIT_BYTES) fail(ERR.POD_TOO_LARGE, `state is ${plain.length} bytes (limit ${POD_LIMIT_BYTES})`);

  const collapse = await realYAxisCollapse(chatText(live), { k, embedder: embedder || defaultEmbedder });
  const compressed = await gzip(plain);
  const baseNonce = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const createdAt = new Date().toISOString();

  let key;
  let keyDesc;
  if (keyMode === 'passphrase') {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    key = await deriveTwinKey({ passphrase, salt, weightsDigest: eye.weightsDigest, biometricSecret: biometric?.secret, iterations });
    keyDesc = { mode: 'passphrase', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToB64(salt), material: 'W||C||B' } };
  } else {
    const dk = await createSovereignKey();
    key = dk.key;
    keyDesc = { mode: 'device', keyId: dk.keyId };
  }

  const seg = {};
  seg.D1 = jsonToB64({ v: LS_VERSION, createdAt, futureLock, plainBytes: plain.length, ...publicProjection(live) });
  seg.A1 = jsonToB64({ v: LS_VERSION, fabric: 'free-ai-router', ...router });
  seg.E1 = jsonToB64({ v: LS_VERSION, ...eye });
  seg.Q = collapse.qpdb;
  seg.E2 = jsonToB64({
    v: LS_VERSION,
    twin: 'sovereign-key',
    twinOf: await sha256Hex(seg.E1),
    alg: ALG,
    chunkSize: CHUNK_SIZE,
    nonce: bytesToB64(baseNonce),
    biometric: biometric ? { required: true, prf: !!biometric.secret, credentialId: biometric.credentialId || null } : null,
    ...keyDesc,
  });
  const header = headerString(seg);
  const aadBase = await sha256(header);
  const records = await encryptRecords(key, baseNonce, aadBase, compressed);
  const encSegment = records.map(bytesToB64).join('.');
  const tags = records.map((r) => r.subarray(r.length - TAG_BYTES));
  seg.A2 = jsonToB64({ v: LS_VERSION, twinOf: await sha256Hex(seg.A1), viz: 'ast-map', map: reconstructionMap(live) });
  seg.D2 = jsonToB64({
    v: LS_VERSION,
    promise: "Data'",
    headerDigest: toHex(aadBase),
    tagDigest: await tagDigest(tags),
    chunks: records.length,
    chunkSize: CHUNK_SIZE,
    plainBytes: plain.length,
    compressedBytes: compressed.length,
    ratio: +(plain.length / Math.max(1, compressed.length)).toFixed(2),
    collapse: { words: collapse.words, k: collapse.k, ratio: +collapse.ratio.toFixed(1), retention: +collapse.retention.toFixed(4) },
  });
  const bdpq = reverseCollapseSignature(seg.Q);
  const longString = `_{${seg.D1}}-{${seg.A1}}-(${seg.E1})-{${seg.Q}}~{${encSegment}}-{${bdpq}}-(${seg.E2})-{${seg.A2}}-{${seg.D2}}_`;

  return {
    longString,
    report: {
      bytes: longString.length,
      chunks: records.length,
      plainBytes: plain.length,
      compressedBytes: compressed.length,
      ratio: plain.length / Math.max(1, compressed.length),
      keyMode: keyDesc.mode,
      collapse: { words: collapse.words, k: collapse.k, fingerprintBytes: collapse.fingerprintBytes, ratio: collapse.ratio, retention: collapse.retention },
      ms: performance.now() - t0,
    },
  };
}

const B64 = '[A-Za-z0-9+/]+={0,2}';
const LEFT_RE = new RegExp(`^\\{(${B64})\\}-\\{(${B64})\\}-\\((${B64})\\)-\\{([qpdb]*)\\}$`);
const RIGHT_RE = new RegExp(`^-\\{([qpdb]*)\\}-\\((${B64})\\)-\\{(${B64})\\}-\\{(${B64})\\}$`);

/** Structural parse with the atomic bounds check. No crypto. */
export function parseLongString(input) {
  if (typeof input !== 'string') fail(ERR.BOUND_VIOLATION, 'long string must be a string');
  // No segment alphabet contains whitespace, so line-wraps added by messengers are safe to drop.
  const s = input.replace(/\s+/g, '');
  if (!(s.startsWith('_') && s.endsWith('_')) || s.length < 3) fail(ERR.BOUND_VIOLATION, "must start and end with '_'");
  const inner = s.slice(1, -1);
  const tilde = inner.indexOf('~');
  if (tilde === -1 || inner.indexOf('~', tilde + 1) !== -1) fail(ERR.SEGMENT_MALFORMED, "exactly one '~' portal expected");
  const left = LEFT_RE.exec(inner.slice(0, tilde));
  if (!left) fail(ERR.SEGMENT_MALFORMED, 'left half {Data}-{AI}-(eYe)-{qpdb} malformed');
  const rest = inner.slice(tilde + 1);
  if (rest[0] !== '{') fail(ERR.SEGMENT_MALFORMED, 'encrypted segment must open with {');
  const close = rest.indexOf('}');
  if (close === -1) fail(ERR.SEGMENT_MALFORMED, 'encrypted segment never closes');
  const encSegment = rest.slice(1, close);
  if (!encSegment || /[^A-Za-z0-9+/=.]/.test(encSegment)) fail(ERR.SEGMENT_MALFORMED, 'encrypted segment has illegal characters');
  const right = RIGHT_RE.exec(rest.slice(close + 1));
  if (!right) fail(ERR.SEGMENT_MALFORMED, 'right half {bdpq}-(eYe)-{AI}-{Data} malformed');
  const seg = { D1: left[1], A1: left[2], E1: left[3], Q: left[4], ENC: encSegment, B: right[1], E2: right[2], A2: right[3], D2: right[4] };
  const meta = {};
  try {
    for (const k of ['D1', 'A1', 'E1', 'E2', 'A2', 'D2']) meta[k] = b64ToJson(seg[k]);
  } catch {
    fail(ERR.SEGMENT_MALFORMED, 'a JSON segment failed to decode');
  }
  checkMeta(meta);
  return { seg, meta };
}

const MAX_KDF_ITERATIONS = 2 ** 24; // refuse hostile strings that would pin the CPU

function checkMeta(meta) {
  const bad = (what) => fail(ERR.SEGMENT_MALFORMED, what);
  for (const k of Object.keys(meta)) if (!isObj(meta[k])) bad(`${k} must be a JSON object`);
  const { D1, E2, A2, D2 } = meta;
  if (D1.futureLock != null && typeof D1.futureLock !== 'number') bad('futureLock must be a number');
  if (typeof E2.twinOf !== 'string' || typeof E2.nonce !== 'string') bad('(eYe) twin descriptor incomplete');
  if (E2.mode === 'device' && typeof E2.keyId !== 'string') bad('device keyId missing');
  if (E2.mode === 'passphrase') {
    const it = E2.kdf?.iterations;
    if (typeof E2.kdf?.salt !== 'string' || !Number.isInteger(it) || it < 1000 || it > MAX_KDF_ITERATIONS) bad('kdf parameters invalid');
  }
  if (E2.biometric != null && !isObj(E2.biometric)) bad('biometric descriptor invalid');
  if (typeof A2.twinOf !== 'string') bad('{AI} twin missing');
  if (typeof D2.headerDigest !== 'string' || typeof D2.tagDigest !== 'string') bad('promise digests missing');
  if (!Number.isInteger(D2.chunks) || D2.chunks < 1 || !Number.isInteger(D2.plainBytes) || D2.plainBytes > POD_LIMIT_BYTES)
    bad('promise sizes invalid');
}

/** Inspect without decrypting (what the restore will need, what it promises). */
export function inspectLongString(input) {
  const { seg, meta } = parseLongString(input);
  let fingerprint = null;
  try {
    fingerprint = decodeFingerprint(qpdbToBytes(seg.Q));
  } catch {
    /* empty fingerprint */
  }
  return {
    createdAt: meta.D1.createdAt,
    futureLock: meta.D1.futureLock,
    public: meta.D1,
    router: meta.A1,
    eye: meta.E1,
    key: { mode: meta.E2.mode, keyId: meta.E2.keyId, kdf: meta.E2.kdf, biometric: meta.E2.biometric },
    map: meta.A2.map,
    promise: meta.D2,
    fingerprint: fingerprint && { n: fingerprint.n, k: fingerprint.k, bytes: seg.Q.length / 4 },
    records: seg.ENC.split('.').length,
  };
}

/**
 * Atomic restore. Returns { state, report } only if every check passes.
 * @param {string} input long string
 * @param {object} opts
 * @param {(desc)=>Promise<string>} [opts.getPassphrase] asked only for passphrase-mode strings
 * @param {(desc)=>Promise<{ok:boolean, secret?:Uint8Array}>} [opts.biometricGate] asked when the string requires it
 * @param {number} [opts.now]
 */
export async function restoreProduction(input, opts = {}) {
  const t0 = performance.now();
  const { getPassphrase, biometricGate, now = Date.now() } = opts;
  const { seg, meta } = parseLongString(input);

  if (seg.B !== reverseCollapseSignature(seg.Q)) fail(ERR.MIRROR_MISMATCH, 'bdpq is not the mirror of qpdb');
  if (meta.E2.twinOf !== (await sha256Hex(seg.E1))) fail(ERR.TWIN_MISMATCH, 'second (eYe) is not the twin of the first');
  if (meta.A2.twinOf !== (await sha256Hex(seg.A1))) fail(ERR.TWIN_MISMATCH, 'second {AI} is not the twin of the first');
  const aadBase = await sha256(headerString(seg));
  if (meta.D2.headerDigest !== toHex(aadBase)) fail(ERR.DIGEST_MISMATCH, 'header digest does not match the promise');
  if (meta.D1.futureLock && now < meta.D1.futureLock)
    fail(ERR.FUTURE_LOCKED, `sealed until ${new Date(meta.D1.futureLock).toISOString()}`);

  let biometricSecret = null;
  if (meta.E2.biometric?.required) {
    if (!biometricGate) fail(ERR.BIOMETRIC_DENIED, 'this string requires the biometric gate');
    const res = await biometricGate(meta.E2.biometric);
    if (!res?.ok) fail(ERR.BIOMETRIC_DENIED, 'biometric gate refused');
    biometricSecret = meta.E2.biometric.prf ? res.secret : null;
    if (meta.E2.biometric.prf && !biometricSecret) fail(ERR.BIOMETRIC_DENIED, 'authenticator did not return the PRF secret');
  }

  let key;
  if (meta.E2.mode === 'passphrase') {
    const passphrase = getPassphrase ? await getPassphrase(meta.E2) : null;
    if (!passphrase) fail(ERR.PASSPHRASE_REQUIRED, 'passphrase required');
    key = await deriveTwinKey({
      passphrase,
      salt: b64ToBytes(meta.E2.kdf.salt),
      weightsDigest: meta.E1.weightsDigest,
      biometricSecret,
      iterations: meta.E2.kdf.iterations,
    });
  } else if (meta.E2.mode === 'device') {
    key = await getDeviceKey(meta.E2.keyId);
    if (!key) fail(ERR.KEY_UNAVAILABLE, `device key ${meta.E2.keyId} is not on this device (keys are non-extractable by design)`);
  } else fail(ERR.SEGMENT_MALFORMED, `unknown key mode ${meta.E2.mode}`);

  const baseNonce = b64ToBytes(meta.E2.nonce);
  if (baseNonce.length !== IV_BYTES) fail(ERR.SEGMENT_MALFORMED, 'nonce must be 12 bytes');
  const meter = { peak: 0, chunks: 0, tags: [] };
  const plain = await collect(bdpqStreamed(key, baseNonce, aadBase, iterateRecordStrings(seg.ENC), meter));
  if (meter.chunks !== meta.D2.chunks) fail(ERR.TRUNCATED, `expected ${meta.D2.chunks} records, got ${meter.chunks}`);
  if ((await tagDigest(meter.tags)) !== meta.D2.tagDigest) fail(ERR.DIGEST_MISMATCH, 'tag chain digest mismatch');
  if (plain.length !== meta.D2.plainBytes) fail(ERR.DIGEST_MISMATCH, 'restored size differs from the promise');

  let parsed;
  try {
    parsed = JSON.parse(dec.decode(plain));
  } catch {
    fail(ERR.SCHEMA_INVALID, 'decrypted payload is not JSON');
  }
  const state = validateLiveState(parsed);
  return {
    state,
    report: {
      chunks: meter.chunks,
      peakWorkingBytes: meter.peak,
      plainBytes: plain.length,
      keyMode: meta.E2.mode,
      createdAt: meta.D1.createdAt,
      ms: performance.now() - t0,
    },
  };
}

// ---------------------------------------------------------------------------
// Volatile Pods (OPFS /pods/vol-*.pod, IndexedDB fallback)
// ---------------------------------------------------------------------------

const POD_MAGIC = enc.encode('FRPOD1');
const POD_DIR = 'pods';

function concatBytes(parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const u32 = (n) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
};

/**
 * Seal LIVE_STATE into a Volatile Pod: [magic][hdrLen][hdr][idxLen][enc index][records...].
 * The small encrypted index lets /pods/ be mounted (file list, sizes, lock date)
 * without decompressing the payload. Header bytes are bound into every AAD.
 */
export async function sealPodProduction(state, { futureLock = null, title = '', key: givenKey } = {}) {
  const live = validateLiveState(state);
  const plain = enc.encode(JSON.stringify(live));
  if (plain.length > POD_LIMIT_BYTES) fail(ERR.POD_TOO_LARGE, `pod payload ${plain.length} bytes exceeds 50 MB`);
  const dk = givenKey ? { key: givenKey, keyId: 'given' } : await createSovereignKey();
  const compressed = await gzip(plain);
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const indexNonce = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const id = `vol-${Date.now().toString(36)}-${toHex(globalThis.crypto.getRandomValues(new Uint8Array(3)))}`;
  const header = enc.encode(
    JSON.stringify({ v: 1, alg: ALG, keyId: dk.keyId, nonce: bytesToB64(nonce), indexNonce: bytesToB64(indexNonce), chunkSize: CHUNK_SIZE }),
  );
  const aadBase = await sha256(header);
  const index = {
    id,
    title,
    createdAt: Date.now(),
    futureLock,
    plainBytes: plain.length,
    compressedBytes: compressed.length,
    chat: live.chat.length,
    files: live.files.map((f) => ({ name: f.name, folder: f.folder, size: enc.encode(f.content).length, dotSaved: f.dotSaved })),
  };
  const encIndex = new Uint8Array(
    await subtle().encrypt({ name: 'AES-GCM', iv: indexNonce, additionalData: aadBase }, dk.key, enc.encode(JSON.stringify(index))),
  );
  const records = await encryptRecords(dk.key, nonce, aadBase, compressed);
  const bytes = concatBytes([POD_MAGIC, u32(header.length), header, u32(encIndex.length), encIndex, ...records.flatMap((r) => [u32(r.length), r])]);
  const name = `${id}.pod`;
  const backend = await writePodBytes(name, bytes);
  return { id, name, path: `/pods/${name}`, bytes: bytes.length, ratio: plain.length / compressed.length, backend, index };
}

async function writePodBytes(name, bytes) {
  if (opfsSupported()) {
    try {
      await opfsWrite(`${POD_DIR}/${name}`, bytes);
      return 'opfs';
    } catch {
      /* fall through to IndexedDB */
    }
  }
  await idbPut(STORES.pods, { name, bytes: new Blob([bytes]), savedAt: Date.now() });
  return 'idb';
}

async function readPodBlob(name) {
  if (opfsSupported()) {
    try {
      return await opfsRead(`${POD_DIR}/${name}`);
    } catch {
      /* try IndexedDB */
    }
  }
  const rec = await idbGet(STORES.pods, name);
  if (!rec) throw new Error(`pod ${name} not found`);
  return rec.bytes;
}

const readSlice = async (blob, start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer());

/** Read only the pod preamble (header + encrypted index); the payload stays on disk. */
async function parsePodLayout(blob) {
  const need = (o, n) => {
    if (o + n > blob.size) fail(ERR.TRUNCATED, 'pod file is truncated');
  };
  need(0, POD_MAGIC.length + 4);
  const pre = await readSlice(blob, 0, POD_MAGIC.length + 4);
  for (let i = 0; i < POD_MAGIC.length; i++) if (pre[i] !== POD_MAGIC[i]) fail(ERR.SEGMENT_MALFORMED, 'not a Foundry pod');
  let o = POD_MAGIC.length;
  const hLen = new DataView(pre.buffer).getUint32(o);
  o += 4;
  need(o, hLen + 4);
  const headerAndLen = await readSlice(blob, o, o + hLen + 4);
  const headerBytes = headerAndLen.subarray(0, hLen);
  const iLen = new DataView(headerAndLen.buffer).getUint32(hLen);
  o += hLen + 4;
  need(o, iLen);
  const encIndex = await readSlice(blob, o, o + iLen);
  o += iLen;
  let header;
  try {
    header = JSON.parse(dec.decode(headerBytes));
  } catch {
    fail(ERR.SEGMENT_MALFORMED, 'pod header is not JSON');
  }
  return { header, headerBytes, encIndex, recordsStart: o };
}

/** Async record source that reads one length-prefixed record at a time from disk. */
async function* podRecords(blob, recordsStart) {
  let o = recordsStart;
  while (o < blob.size) {
    if (o + 4 > blob.size) fail(ERR.TRUNCATED, 'record length cut');
    const len = new DataView((await readSlice(blob, o, o + 4)).buffer).getUint32(0);
    o += 4;
    if (len > CHUNK_SIZE + TAG_BYTES || o + len > blob.size) fail(ERR.TRUNCATED, 'record cut or oversized');
    const bytes = await readSlice(blob, o, o + len);
    o += len;
    yield { bytes, last: o >= blob.size };
  }
}

async function podKey(header) {
  const key = await getDeviceKey(header.keyId);
  if (!key) fail(ERR.KEY_UNAVAILABLE, `pod key ${header.keyId} is not on this device`);
  return key;
}

async function decryptPodIndex(layout, key) {
  const aadBase = await sha256(layout.headerBytes);
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(layout.header.indexNonce), additionalData: aadBase },
      key,
      layout.encIndex,
    );
    return { index: JSON.parse(dec.decode(plain)), aadBase };
  } catch {
    return fail(ERR.AUTH_FAILED, 'pod index failed authentication');
  }
}

/** Mount: decrypt only the small index. No payload read, no decompression. */
export async function mountPod(name, { key: givenKey } = {}) {
  const blob = await readPodBlob(name);
  const layout = await parsePodLayout(blob);
  const key = givenKey || (await podKey(layout.header));
  const { index } = await decryptPodIndex(layout, key);
  return { name, path: `/pods/${name}`, bytes: blob.size, sealed: true, ...index, locked: !!index.futureLock && Date.now() < index.futureLock };
}

/**
 * Release: decrypt the payload back into LIVE_STATE.
 * mode 'stream' reads + decrypts one 16 KiB record at a time (M(t) constant);
 * mode 'burst' loads every record first (M(t) = |D|) for comparison.
 */
export async function releasePod(name, { key: givenKey, mode = 'stream', now = Date.now() } = {}) {
  const t0 = performance.now();
  const blob = await readPodBlob(name);
  const layout = await parsePodLayout(blob);
  const key = givenKey || (await podKey(layout.header));
  const { index, aadBase } = await decryptPodIndex(layout, key);
  if (index.futureLock && now < index.futureLock) fail(ERR.FUTURE_LOCKED, `pod sealed until ${new Date(index.futureLock).toISOString()}`);
  const nonce = b64ToBytes(layout.header.nonce);

  let plain;
  let peak;
  if (mode === 'burst') {
    const strs = [];
    for await (const r of podRecords(blob, layout.recordsStart)) strs.push(bytesToB64(r.bytes));
    const res = await burstRestore(key, nonce, aadBase, strs);
    plain = res.bytes;
    peak = res.peak;
  } else {
    const meter = { peak: 0, chunks: 0, tags: [] };
    plain = await collect(bdpqStreamed(key, nonce, aadBase, podRecords(blob, layout.recordsStart), meter));
    peak = meter.peak;
  }
  if (plain.length !== index.plainBytes) fail(ERR.DIGEST_MISMATCH, 'released size differs from the sealed index');
  const state = validateLiveState(JSON.parse(dec.decode(plain)));
  const mounted = { name, path: `/pods/${name}`, bytes: blob.size, sealed: false, ...index, locked: false };
  return { state, index: mounted, report: { mode, peakWorkingBytes: peak, plainBytes: plain.length, ms: performance.now() - t0 } };
}

export async function listPods() {
  const names = new Set();
  if (opfsSupported()) for (const e of await opfsList(POD_DIR)) if (e.kind === 'file' && e.name.endsWith('.pod')) names.add(e.name);
  try {
    for (const k of await idbKeys(STORES.pods)) names.add(k);
  } catch {
    /* no IndexedDB */
  }
  return [...names].sort().reverse();
}

export async function deletePod(name) {
  if (opfsSupported()) await opfsDelete(`${POD_DIR}/${name}`).catch(() => {});
  await idbDelete(STORES.pods, name).catch(() => {});
}
