import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapseEmbeddings, decodeFingerprint, tokenizeWords, topEigen } from '../src/lib/collapse.js';
import { createHashEmbedder, hashEmbed, createWordPieceTokenizer } from '../src/lib/embedder.js';
import { realYAxisCollapse } from '../src/longString.js';

test('tokenizer keeps unicode words (Cyrillic phonk lyrics included)', () => {
  assert.deepEqual(tokenizeWords('Имп3рия rises; Hey Jackie!'), ['имп3рия', 'rises', 'hey', 'jackie']);
});

test('hash embeddings are unit length and spelling-aware', () => {
  const a = hashEmbed('running');
  const b = hashEmbed('runner');
  const c = hashEmbed('quantum');
  const dot = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
  assert.ok(Math.abs(dot(a, a) - 1) < 1e-5);
  assert.ok(dot(a, b) > dot(a, c));
});

test('eigen solver recovers a planted rank-2 structure exactly', () => {
  // Rows drawn from a 2-D subspace of R^8: rank-2 collapse must retain ~all geometry.
  const n = 60;
  const d = 8;
  const E = new Float32Array(n * d);
  for (let r = 0; r < n; r++) {
    const a = Math.cos(r);
    const b = Math.sin(r * 1.7);
    const row = [a, b, a, -b, 0.5 * a, 0, b, 0];
    const norm = Math.hypot(...row) || 1;
    row.forEach((v, i) => (E[r * d + i] = v / norm));
  }
  const eig = topEigen(E, n, d, 3);
  assert.ok(eig.values[2] < 1e-6 * eig.values[0]);
  const res = collapseEmbeddings(E, n, d, { k: 2 });
  assert.ok(res.retention > 0.99, `retention ${res.retention}`);
  assert.ok(res.energy > 0.999);
});

test('fingerprint format: 6 + 8k + n*k bytes, round-trips', async () => {
  const words = 'the router collapses words into coordinates for the eye'.split(' ');
  const emb = createHashEmbedder();
  const E = await emb.embedWords(words);
  const res = collapseEmbeddings(E, words.length, emb.dim, { k: 2 });
  assert.equal(res.fingerprintBytes, 6 + 16 + words.length * 2);
  const fp = decodeFingerprint(res.fingerprint);
  assert.equal(fp.n, words.length);
  assert.equal(fp.k, 2);
});

test('1000 words collapse to ~2 KB and report measured retention', async () => {
  const text = Array.from({ length: 1000 }, (_, i) => ['neutron', 'star', 'pod', 'router', 'eye', 'jackie', 'stream', 'chunk'][i % 8] + (i % 13)).join(' ');
  const r = await realYAxisCollapse(text, { k: 2, curveTo: 8 });
  assert.equal(r.words, 1000);
  assert.equal(r.fingerprintBytes, 2022);
  assert.ok(r.ratio > 700);
  assert.ok(r.retention > -1 && r.retention <= 1);
  assert.equal(r.curve.length, 8);
  assert.ok(r.curve[7].retention >= r.curve[0].retention);
  assert.match(r.qpdb, /^[qpdb]+$/);
});

test('collapse is deterministic', async () => {
  const a = await realYAxisCollapse('sovereign keys never leave the device');
  const b = await realYAxisCollapse('sovereign keys never leave the device');
  assert.equal(a.qpdb, b.qpdb);
});

test('WordPiece tokenizer splits into vocab pieces', () => {
  const vocab = { '[PAD]': 0, '[UNK]': 1, '[CLS]': 2, '[SEP]': 3, hey: 4, jack: 5, '##ie': 6, '!': 7 };
  const tok = createWordPieceTokenizer({ model: { type: 'WordPiece', vocab, unk_token: '[UNK]' }, normalizer: { lowercase: true } });
  assert.deepEqual(tok.encode('Hey JACKIE!'), [2, 4, 5, 6, 7, 3]);
  assert.deepEqual(tok.encode('zzz'), [2, 1, 3]);
});
