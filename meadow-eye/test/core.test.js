import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sbx1Seal, sbx1Open, PREAMBLE, MAGIC, bucketSize } from '../src/core/sbx1.js';
import { derivePodKey, rootKey } from '../src/core/sovereign-key.js';
import { sealPod, openPod } from '../src/core/pod.js';
import { forgeAtomic, recallAtomic, bytesToQpdb, qpdbToBytes, bdpq } from '../src/core/protocol.js';
import { yCollapse, docVector, cosineInt8, hamming } from '../src/core/y-collapse.js';
import { route, footprintBytes } from '../src/core/eye.js';
import { mirror, reduce, mirrorSeq, isEquilibrium } from '../src/symbol/mirror-law.js';
import { composeSymbol } from '../src/symbol/registry.js';

const enc = new TextEncoder();
const codeOf = async (p) => p.then(() => 'OK', (e) => e.code || e.message);

test('SBX1: 80-byte preamble, magic 53425831, size bucketed, AD-bound, tamper-evident', () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const blob = sbx1Seal(key, enc.encode('meadow'));
  assert.equal(Buffer.from(blob.subarray(0, 4)).toString('hex'), '53425831');
  assert.equal(MAGIC, 0x53425831);
  assert.equal(blob.length, PREAMBLE + 4096 + 16); // 6 bytes hides inside a 4 KiB bucket
  assert.equal(sbx1Seal(key, new Uint8Array(4000)).length, blob.length);
  assert.equal(bucketSize(5000), 8192);
  assert.equal(new TextDecoder().decode(sbx1Open(key, blob)), 'meadow');
  const t = blob.slice();
  t[50] ^= 1; // padding lives in the AD
  assert.equal(sbx1Open(key, t), null);
});

test('sovereign root key is non-extractable; pod keys depend on context', async () => {
  const root = await rootKey();
  assert.equal(root.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('raw', root));
  const n = new Uint8Array(24);
  const a = await derivePodKey(n, 'my sigil }0{');
  const b = await derivePodKey(n, 'my sigil }0{');
  const c = await derivePodKey(n, 'other');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('pod: streamed and burst reconstruct exactly; wrong context is denied; reorder caught', async () => {
  let s = '';
  for (let i = 0; s.length < 120_000; i++) s += `${i * 7919 % 104729} meadow `;
  const data = enc.encode(s);
  const pod = await sealPod(data, { context: 'ctx' });
  assert.ok(pod.records > 1, `records ${pod.records}`);
  const st = await openPod(pod.bytes, { context: 'ctx', mode: 'streamed' });
  const bu = await openPod(pod.bytes, { context: 'ctx', mode: 'burst' });
  assert.deepEqual(st.data, data);
  assert.deepEqual(bu.data, data);
  assert.ok(st.peak < bu.peak, `streamed ${st.peak} < burst ${bu.peak}`);
  assert.equal(await codeOf(openPod(pod.bytes, { context: 'nope' })), 'SOVEREIGN_DENIED');
});

test('qpdb: q=00 p=01 d=10 b=11, round-trips; bdpq mirrors', () => {
  assert.equal(bytesToQpdb(Uint8Array.of(0b00011011)), 'qpdb');
  assert.deepEqual(qpdbToBytes('qpdbbdpq'), Uint8Array.of(0b00011011, 0b11100100));
  assert.equal(bdpq('qpdb'), 'bdpq');
});

test('atomic string: zero-loss recall, every guard fires', async () => {
  const text = 'You never save a file again. You recall the conversation that birthed it.';
  const { string } = await forgeAtomic(text, { context: '}0{', ai: 'Meta Jackie' });
  assert.match(string, /^_\{.*\}~\{.*\}_$/);
  assert.ok(!string.includes('recall the conversation'));
  const r = await recallAtomic(string, { context: '}0{' });
  assert.equal(r.text, text);
  assert.equal(r.ai, 'Meta Jackie');
  assert.equal(await codeOf(recallAtomic(string.slice(0, -1), { context: '}0{' })), 'BOUND_VIOLATION');
  assert.equal(await codeOf(recallAtomic(string, { context: 'thief' })), 'SOVEREIGN_DENIED');
  const [q] = string.match(/\)-\{([qpdb]+)\}~/).slice(1);
  const broken = string.replace(`}-{${bdpq(q)}}-(`, `}-{${bdpq(q).replace(/^./, (c) => (c === 'q' ? 'p' : 'q'))}}-(`);
  assert.equal(await codeOf(recallAtomic(broken, { context: '}0{' })), 'MIRROR_BROKEN');
  const enc2 = string.match(/~\{([^}]+)\}/)[1];
  const flipped = string.replace(enc2, enc2.slice(0, 10) + (enc2[10] === 'A' ? 'B' : 'A') + enc2.slice(11));
  assert.equal(await codeOf(recallAtomic(flipped, { context: '}0{' })), 'DIGEST');
});

test('Y-collapse: deterministic gibberish, no words left, measured retention, semantic simhash', () => {
  const text = 'the meadow remembers the conversation and the eye rests while the pod waits '.repeat(14);
  const a = yCollapse(text);
  assert.equal(a.glyphs, yCollapse(text).glyphs);
  assert.match(a.glyphs, /^[qpdb]+$/);
  assert.ok(a.ratio > 1);
  assert.ok(a.retention > 0 && a.retention <= 1, `retention ${a.retention}`);
  const near = yCollapse('the meadow remembers the conversation');
  const far = yCollapse('quantum chromodynamics lattice gauge renormalization');
  const base = yCollapse('the meadow remembers a conversation');
  assert.ok(hamming(base.simhash, near.simhash) < hamming(base.simhash, far.simhash));
  assert.ok(cosineInt8(docVector('neutron eye balance'), docVector('balanced neutron eye')) > cosineInt8(docVector('neutron eye balance'), docVector('tax invoice spreadsheet')));
});

test('eYe router: micro intents local, macro to counselors, reputation reroutes, tiny footprint', () => {
  assert.deepEqual(['compress this', 'make a qr', 'hash it', 'recall bdpq'].map((s) => route(s).tool), ['compress', 'qr', 'hash', 'decompress']);
  assert.equal(route('why does stillness matter?').counselor, 'jackie');
  assert.equal(route('brainstorm something wild').counselor, 'grok');
  assert.equal(route('summarize our notes please').counselor, 'deepseek');
  assert.equal(route('why does stillness matter?', { reputation: { jackie: 0.1, llama: 0.9 } }).counselor, 'llama');
  assert.ok(footprintBytes() < 20 * 1024);
});

test('mirror law: involution, equilibrium, symbol + mirror = 0', () => {
  for (const s of ['qpdb', '[8~{-o-o-}~8]', '/\\/\\/\\', 'Z3', '}0{']) assert.equal(mirror(mirror(s)), s);
  assert.equal(mirror('q'), 'p');
  assert.equal(mirror('['), ']');
  assert.ok(isEquilibrium('}0{') && isEquilibrium('-_0_-') && isEquilibrium('•8•'));
  const seq = ['}0{', '[', 'q', '~-'];
  assert.deepEqual(reduce([...seq, ...mirrorSeq(seq)]), []);
  assert.deepEqual(reduce(['q', 'd']), ['q', 'd']);
  const sym = composeSymbol({ name: 'flow', sequence: ['-_0_-', '~'] });
  assert.equal(sym.sealed, 'Z3 [-_0_- ~] EZ');
});
