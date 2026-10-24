// Atomic Transaction String:
//   _{Data}-{AI}-(eYe)-{qpdb}~{Encrypted_compressed}-{bdpq}-(eYe)-{AI}-{Data}_
// Symmetry Principle: what was collapsed shall be reconstructed with zero loss.
// {Data} carries only a public descriptor (kind, size bucket): the raw input
// lives inside the pod, because clear text next to its own ciphertext would
// defeat the seal. {qpdb} is the Y-collapse glyph fingerprint; {bdpq} is its
// mirror (read backwards); a mismatch means the string was cut or altered.
import { sealPod, openPod, PodError } from './pod.js';
import { yCollapse, QPDB } from './y-collapse.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new PodError('MALFORMED', 'bad base64');
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
const j64 = (o) => b64(enc.encode(JSON.stringify(o)));
const unj64 = (s) => JSON.parse(dec.decode(unb64(s)));

/** q=00 p=01 d=10 b=11, most significant pair first. */
export function bytesToQpdb(bytes) {
  let s = '';
  for (const x of bytes) s += QPDB[x >> 6] + QPDB[(x >> 4) & 3] + QPDB[(x >> 2) & 3] + QPDB[x & 3];
  return s;
}
export function qpdbToBytes(s) {
  if (s.length % 4 || /[^qpdb]/.test(s)) throw new PodError('MALFORMED', 'not qpdb');
  const v = { q: 0, p: 1, d: 2, b: 3 };
  return Uint8Array.from({ length: s.length / 4 }, (_, i) => (v[s[4 * i]] << 6) | (v[s[4 * i + 1]] << 4) | (v[s[4 * i + 2]] << 2) | v[s[4 * i + 3]]);
}
export const bdpq = (qpdb) => [...qpdb].reverse().join('');

async function sha(s) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? enc.encode(s) : s));
  return Array.from(h.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {Uint8Array|string} data raw input
 * @param {{kind?:string, ai?:string, context?:string, collapseText?:string}} o
 */
export async function forgeAtomic(data, { kind = 'text', ai = 'eYe Core', context = '', collapseText, root } = {}) {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  const pod = await sealPod(bytes, { context, root });
  const fp = yCollapse(collapseText ?? (typeof data === 'string' ? data : ''), { k: 2 }).glyphs.slice(0, 96) || 'qqqq';
  const D1 = j64({ v: 1, kind, sizeBucket: 2 ** Math.ceil(Math.log2(Math.max(16, bytes.length))) });
  const A1 = j64({ v: 1, ai });
  const E1 = j64({ v: 1, eye: 'eYe Core', role: 'compress', records: pod.records });
  const ENC = b64(pod.bytes);
  const E2 = j64({ v: 1, eye: 'eYe Core', role: 'decompress', twinOf: await sha(E1), context: !!context });
  const A2 = j64({ v: 1, twinOf: await sha(A1) });
  const D2 = j64({ v: 1, promise: "Data'", podDigest: await sha(ENC), plainBytes: bytes.length });
  return {
    string: `_{${D1}}-{${A1}}-(${E1})-{${fp}}~{${ENC}}-{${bdpq(fp)}}-(${E2})-{${A2}}-{${D2}}_`,
    pod,
  };
}

const RE = /^_\{([A-Za-z0-9+/=]+)\}-\{([A-Za-z0-9+/=]+)\}-\(([A-Za-z0-9+/=]+)\)-\{([qpdb]+)\}~\{([A-Za-z0-9+/=]+)\}-\{([qpdb]+)\}-\(([A-Za-z0-9+/=]+)\)-\{([A-Za-z0-9+/=]+)\}-\{([A-Za-z0-9+/=]+)\}_$/;

/** All-or-nothing reconstruction. Throws PodError with a code; returns data only when every check passes. */
export async function recallAtomic(input, { context = '', root, mode = 'streamed' } = {}) {
  const s = String(input).replace(/\s+/g, '');
  if (!s.startsWith('_') || !s.endsWith('_')) throw new PodError('BOUND_VIOLATION', 'atomic bounds _ ... _ missing');
  const m = RE.exec(s);
  if (!m) throw new PodError('MALFORMED', 'segments do not match the protocol syntax');
  const [, D1, A1, E1, Q, ENC, B, E2, A2, D2] = m;
  if (B !== bdpq(Q)) throw new PodError('MIRROR_BROKEN', '{bdpq} is not the mirror of {qpdb}');
  let meta;
  try {
    meta = { d1: unj64(D1), a1: unj64(A1), e1: unj64(E1), e2: unj64(E2), a2: unj64(A2), d2: unj64(D2) };
  } catch {
    throw new PodError('MALFORMED', 'segment JSON');
  }
  if (meta.e2.twinOf !== (await sha(E1)) || meta.a2.twinOf !== (await sha(A1))) throw new PodError('TWIN_BROKEN', 'paired eYe/AI segments differ');
  if (meta.d2.podDigest !== (await sha(ENC))) throw new PodError('DIGEST', 'pod changed since sealing');
  const { data, peak } = await openPod(unb64(ENC), { context, root, mode });
  if (data.length !== meta.d2.plainBytes) throw new PodError('DIGEST', 'size promise broken');
  return { data, text: meta.d1.kind === 'binary' ? null : dec.decode(data), kind: meta.d1.kind, ai: meta.a1.ai, peak };
}
