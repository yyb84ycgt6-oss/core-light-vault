// Volatile Compression Pod. Lifecycle:
//   active -> handshake (15% battery) -> pod (cold noise) -> reverse handshake -> reconstructed
// Bytes: [24 B pod nonce][u32 record count] then [u32 len][SBX1 record]...
// Each record's sealed plaintext is [u32 index][u8 final][<=16380 B gzip slice],
// so reordering and truncation fail inside the AEAD. The pod key is derived
// from the sovereign root + context; nothing in the pod can open it alone.
import { sbx1Seal, sbx1Open } from './sbx1.js';
import { derivePodKey } from './sovereign-key.js';

export const RECORD = 16380; // framed record fits the 16 KiB SBX1 bucket exactly
export const STATES = ['active', 'handshake', 'pod', 'reverse', 'reconstructed'];

async function pump(stream) {
  const parts = [];
  const r = stream.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    parts.push(value);
  }
  return concat(parts);
}

export function concat(parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const gzip = (b) => pump(new Blob([b]).stream().pipeThrough(new CompressionStream('gzip')));
const u32 = (n) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
};

export class PodError extends Error {
  constructor(code, msg) {
    super(`${code}: ${msg}`);
    this.code = code;
  }
}

export async function sealPod(data, { context = '', root = null } = {}) {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(24));
  const key = await derivePodKey(nonce, context, root);
  const z = await gzip(data);
  const count = Math.max(1, Math.ceil(z.length / RECORD));
  const parts = [nonce, u32(count)];
  for (let i = 0; i < count; i++) {
    const slice = z.subarray(i * RECORD, (i + 1) * RECORD);
    const plain = concat([u32(i), Uint8Array.of(i === count - 1 ? 1 : 0), slice]);
    const rec = sbx1Seal(key, plain);
    parts.push(u32(rec.length), rec);
  }
  key.fill(0);
  return { bytes: concat(parts), records: count, plainBytes: data.length, gzipBytes: z.length };
}

function* records(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(24);
  let o = 28;
  for (let i = 0; i < count; i++) {
    if (o + 4 > bytes.length) throw new PodError('TRUNCATED', 'record header cut');
    const len = dv.getUint32(o);
    if (o + 4 + len > bytes.length) throw new PodError('TRUNCATED', 'record cut');
    yield bytes.subarray(o + 4, o + 4 + len);
    o += 4 + len;
  }
  if (o !== bytes.length) throw new PodError('MALFORMED', 'trailing bytes');
}

/**
 * Reverse handshake. mode 'streamed' decrypts and inflates one record at a time
 * (working set ~ one record); 'burst' opens everything into RAM first.
 */
export async function openPod(bytes, { context = '', root = null, mode = 'streamed' } = {}) {
  if (bytes.length < 28) throw new PodError('MALFORMED', 'not a pod');
  const key = await derivePodKey(bytes.subarray(0, 24), context, root);
  const meter = { peak: 0 };
  const opened = [];
  let expect = 0;
  let sawFinal = false;
  const openOne = (rec) => {
    const plain = sbx1Open(key, rec);
    if (!plain) throw new PodError('SOVEREIGN_DENIED', 'wrong device key or context, or tampered pod');
    const idx = new DataView(plain.buffer, plain.byteOffset).getUint32(0);
    if (idx !== expect++) throw new PodError('REORDERED', `record ${idx} out of place`);
    if (sawFinal) throw new PodError('MALFORMED', 'data after final record');
    sawFinal = plain[4] === 1;
    return plain.subarray(5);
  };
  let out;
  if (mode === 'burst') {
    for (const rec of records(bytes)) opened.push(openOne(rec));
    if (!sawFinal) throw new PodError('TRUNCATED', 'final record missing');
    const z = concat(opened);
    meter.peak = bytes.length + z.length;
    out = await pump(new Blob([z]).stream().pipeThrough(new DecompressionStream('gzip')));
    meter.peak += out.length;
  } else {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    const reading = pump(ds.readable);
    try {
      for (const rec of records(bytes)) {
        const slice = openOne(rec);
        meter.peak = Math.max(meter.peak, rec.length + slice.length);
        await writer.write(slice);
      }
      if (!sawFinal) throw new PodError('TRUNCATED', 'final record missing');
      await writer.close();
    } catch (e) {
      writer.abort(e).catch(() => {});
      reading.catch(() => {});
      throw e;
    }
    out = await reading;
  }
  key.fill(0);
  return { data: out, peak: meter.peak, mode };
}
