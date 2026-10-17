import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLongStringProduction,
  restoreProduction,
  inspectLongString,
  parseLongString,
  bytesToQpdb,
  qpdbToBytes,
  reverseCollapseSignature,
  validateLiveState,
  defaultLiveState,
  createSovereignKey,
  sealPodProduction,
  mountPod,
  releasePod,
  listPods,
  deletePod,
  ERR,
  CHUNK_SIZE,
} from '../src/longString.js';

const eye = { name: 'eYe', weightsDigest: 'ab'.repeat(32), sizeKB: 17 };

function sampleState(extraText = '') {
  const s = defaultLiveState();
  s.chat = [
    { role: 'user', content: 'Hey Jackie, compress the session into a pod.' + extraText, providerBadge: '' },
    { role: 'assistant', content: 'Sealed. Nothing will be lost.', providerBadge: 'Groq · llama-3.3-70b-versatile' },
  ];
  s.files = [{ name: 'notes.md', folder: 'docs', content: '# Foundry\nConversation is the save.', dotSaved: true }];
  s.system = { battery: 14, ram: 4, thermal: 68 };
  return s;
}

// Deterministic, poorly-compressible text so we get many 16 KiB records.
function noisyText(bytes) {
  let x = 123456789;
  let out = '';
  while (out.length < bytes) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out += (x >>> 0).toString(36) + ' ';
  }
  return out;
}

const expectCode = async (promise, code) => {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    return true;
  });
};

test('qpdb glyph codec round-trips and bdpq is its mirror', () => {
  const bytes = Uint8Array.from([0, 1, 2, 3, 127, 128, 254, 255]);
  const q = bytesToQpdb(bytes);
  assert.match(q, /^[qpdb]+$/);
  assert.equal(q.length, 32);
  assert.deepEqual(qpdbToBytes(q), bytes);
  assert.equal(reverseCollapseSignature('qpdb'), 'bdpq');
});

test('device-key long string restores the exact state', async () => {
  const state = sampleState();
  const { longString, report } = await createLongStringProduction(state, { eye, router: { chain: ['groq'] } });
  assert.ok(longString.startsWith('_{') && longString.endsWith('}_'));
  assert.ok(longString.includes('~{'));
  assert.equal(report.keyMode, 'device');
  // Plaintext chat must not leak into the string.
  assert.ok(!longString.includes(Buffer.from('compress the session').toString('base64').slice(0, 12)));
  const info = inspectLongString(longString);
  assert.equal(info.key.mode, 'device');
  assert.equal(info.public.counts.chat, 2);
  const { state: restored, report: r } = await restoreProduction(longString);
  assert.deepEqual(restored, validateLiveState(state));
  assert.equal(r.chunks, 1);
});

test('device key is non-extractable and persisted', async () => {
  const a = await createSovereignKey();
  const b = await createSovereignKey();
  assert.equal(a.keyId, b.keyId);
  assert.equal(a.key.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('raw', a.key));
});

test('passphrase twin key: right passphrase restores, wrong one fails auth', async () => {
  const state = sampleState();
  const { longString } = await createLongStringProduction(state, { eye, keyMode: 'passphrase', passphrase: 'correct horse battery staple', iterations: 2000 });
  const info = inspectLongString(longString);
  assert.equal(info.key.kdf.iterations, 2000);
  const ok = await restoreProduction(longString, { getPassphrase: async () => 'correct horse battery staple' });
  assert.deepEqual(ok.state, validateLiveState(state));
  await expectCode(restoreProduction(longString, { getPassphrase: async () => 'wrong' }), ERR.AUTH_FAILED);
  await expectCode(restoreProduction(longString), ERR.PASSPHRASE_REQUIRED);
});

test('atomic bounds check', async () => {
  const { longString } = await createLongStringProduction(sampleState(), { eye });
  await expectCode(restoreProduction(longString.slice(0, -1)), ERR.BOUND_VIOLATION);
  await expectCode(restoreProduction(longString.slice(1)), ERR.BOUND_VIOLATION);
  await expectCode(restoreProduction('hello'), ERR.BOUND_VIOLATION);
});

test('line-wrapped strings (pasted from a messenger) still restore', async () => {
  const state = sampleState();
  const { longString } = await createLongStringProduction(state, { eye });
  const wrapped = longString.match(/.{1,76}/g).join('\n');
  const { state: restored } = await restoreProduction(`  ${wrapped}\n`);
  assert.deepEqual(restored, validateLiveState(state));
});

test('tamper detection: header, mirror, ciphertext', async () => {
  const { longString } = await createLongStringProduction(sampleState(), { eye });
  const { seg } = parseLongString(longString);

  // Edit the public {Data} projection -> header digest no longer matches.
  const d1 = JSON.parse(Buffer.from(seg.D1, 'base64').toString());
  d1.counts.chat = 99;
  const forgedD1 = Buffer.from(JSON.stringify(d1)).toString('base64');
  await expectCode(restoreProduction(longString.replace(seg.D1, forgedD1)), ERR.DIGEST_MISMATCH);

  // Break the bdpq mirror.
  const badB = seg.B.slice(0, -1) + (seg.B.at(-1) === 'q' ? 'p' : 'q');
  await expectCode(restoreProduction(longString.replace(`-{${seg.B}}-`, `-{${badB}}-`)), ERR.MIRROR_MISMATCH);

  // Flip one ciphertext character.
  const i = Math.floor(seg.ENC.length / 2);
  const flipped = seg.ENC.slice(0, i) + (seg.ENC[i] === 'A' ? 'B' : 'A') + seg.ENC.slice(i + 1);
  await expectCode(restoreProduction(longString.replace(seg.ENC, flipped)), ERR.AUTH_FAILED);
});

test('streamed restore keeps a constant working set across many records', async () => {
  const state = sampleState(noisyText(300 * 1024));
  const { longString, report } = await createLongStringProduction(state, { eye });
  assert.ok(report.chunks > 5, `expected many records, got ${report.chunks}`);
  const { state: restored, report: r } = await restoreProduction(longString);
  assert.equal(restored.chat[0].content, state.chat[0].content);
  assert.equal(r.chunks, report.chunks);
  // One base64 record + its bytes + one plaintext chunk: bounded by ~4x16 KiB, not |D|.
  assert.ok(r.peakWorkingBytes < 4 * CHUNK_SIZE + 1024, `peak ${r.peakWorkingBytes}`);
  assert.ok(r.plainBytes > 10 * r.peakWorkingBytes / 4);
});

test('truncation and reordering are detected', async () => {
  const state = sampleState(noisyText(80 * 1024));
  const { longString } = await createLongStringProduction(state, { eye });
  const { seg } = parseLongString(longString);
  const recs = seg.ENC.split('.');
  assert.ok(recs.length >= 3);

  const truncated = longString.replace(seg.ENC, recs.slice(0, -1).join('.'));
  await expectCode(restoreProduction(truncated), ERR.TRUNCATED);

  const swapped = [recs[1], recs[0], ...recs.slice(2)].join('.');
  await expectCode(restoreProduction(longString.replace(seg.ENC, swapped)), ERR.AUTH_FAILED);
});

test('future lock refuses early restore', async () => {
  const lock = Date.now() + 86_400_000;
  const { longString } = await createLongStringProduction(sampleState(), { eye, futureLock: lock });
  await expectCode(restoreProduction(longString), ERR.FUTURE_LOCKED);
  const { state } = await restoreProduction(longString, { now: lock + 1 });
  assert.equal(state.chat.length, 2);
});

test('biometric gate is enforced when required', async () => {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const { longString } = await createLongStringProduction(sampleState(), {
    eye,
    keyMode: 'passphrase',
    passphrase: 'pw-123456',
    iterations: 2000,
    biometric: { secret, credentialId: 'cred' },
  });
  const getPassphrase = async () => 'pw-123456';
  await expectCode(restoreProduction(longString, { getPassphrase }), ERR.BIOMETRIC_DENIED);
  await expectCode(restoreProduction(longString, { getPassphrase, biometricGate: async () => ({ ok: false }) }), ERR.BIOMETRIC_DENIED);
  // Wrong PRF secret -> different key -> authentication fails.
  await expectCode(
    restoreProduction(longString, { getPassphrase, biometricGate: async () => ({ ok: true, secret: new Uint8Array(32) }) }),
    ERR.AUTH_FAILED,
  );
  const ok = await restoreProduction(longString, { getPassphrase, biometricGate: async () => ({ ok: true, secret }) });
  assert.equal(ok.state.files[0].name, 'notes.md');
});

test('hostile KDF parameters are refused before any work', async () => {
  const { longString } = await createLongStringProduction(sampleState(), { eye, keyMode: 'passphrase', passphrase: 'x', iterations: 2000 });
  const { seg } = parseLongString(longString);
  const e2 = JSON.parse(Buffer.from(seg.E2, 'base64').toString());
  e2.kdf.iterations = 2 ** 30;
  const forged = longString.replace(seg.E2, Buffer.from(JSON.stringify(e2)).toString('base64'));
  await expectCode(restoreProduction(forged, { getPassphrase: async () => 'x' }), ERR.SEGMENT_MALFORMED);
});

test('schema validation rejects path traversal and bad roles', () => {
  assert.throws(() => validateLiveState({ chat: [{ role: 'root', content: 'x' }] }), (e) => e.code === ERR.SCHEMA_INVALID);
  assert.throws(() => validateLiveState({ files: [{ name: '../etc', folder: '', content: '' }] }), (e) => e.code === ERR.SCHEMA_INVALID);
  assert.throws(() => validateLiveState({ files: [{ name: 'a', folder: '../x', content: '' }] }), (e) => e.code === ERR.SCHEMA_INVALID);
});

test('volatile pods: seal, mount without decompress, stream vs burst release', async () => {
  const state = sampleState(noisyText(200 * 1024));
  const pod = await sealPodProduction(state, { title: 'test pod' });
  assert.equal(pod.backend, 'idb'); // no OPFS under node
  assert.ok((await listPods()).includes(pod.name));

  const mounted = await mountPod(pod.name);
  assert.equal(mounted.files[0].name, 'notes.md');
  assert.equal(mounted.sealed, true);

  const s = await releasePod(pod.name, { mode: 'stream' });
  const b = await releasePod(pod.name, { mode: 'burst' });
  assert.deepEqual(s.state, b.state);
  assert.equal(s.state.chat[0].content, state.chat[0].content);
  assert.ok(s.report.peakWorkingBytes < 4 * CHUNK_SIZE, `stream peak ${s.report.peakWorkingBytes}`);
  assert.ok(b.report.peakWorkingBytes > s.state.chat[0].content.length, `burst peak ${b.report.peakWorkingBytes}`);

  await deletePod(pod.name);
  assert.ok(!(await listPods()).includes(pod.name));
});

test('pod future lock is enforced and bound to the seal', async () => {
  const pod = await sealPodProduction(sampleState(), { futureLock: Date.now() + 60_000 });
  const m = await mountPod(pod.name);
  assert.equal(m.locked, true);
  await expectCode(releasePod(pod.name), ERR.FUTURE_LOCKED);
  await deletePod(pod.name);
});
