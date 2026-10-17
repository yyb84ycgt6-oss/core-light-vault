import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGates, logMelSpectrogram, melFilterbank, residentKB, EYE, HANDSHAKE_TEXT, SAMPLE_RATE } from '../src/eYe.js';

test('gates: battery < 15% or thermal > 70C force offline; handshake waits for stillness', () => {
  const now = 100_000;
  assert.equal(evaluateGates({ battery: 50, thermal: 40 }, { now }).forceOffline, false);
  assert.equal(evaluateGates({ battery: 14 }, { now, lastActivity: now - 1000 }).forceOffline, true);
  assert.equal(evaluateGates({ battery: 14 }, { now, lastActivity: now - 1000 }).handshake, false);
  assert.equal(evaluateGates({ battery: 14 }, { now, lastActivity: now - 1000 }).waitingForStillness, true);
  assert.equal(evaluateGates({ battery: 14 }, { now, lastActivity: now - EYE.stillnessMs }).handshake, true);
  assert.equal(evaluateGates({ battery: 14, charging: true }, { now }).handshake, false);
  assert.equal(evaluateGates({ battery: 14 }, { now, dismissedUntil: now + 1 }).handshake, false);
  assert.equal(evaluateGates({ thermal: 71 }, { now }).forceOffline, true);
  assert.equal(evaluateGates({ thermal: 71 }, { now }).handshake, false);
  assert.match(HANDSHAKE_TEXT, /safe pod/);
});

test('log-mel puts a 1 kHz tone in the right band', () => {
  const tone = Float32Array.from({ length: SAMPLE_RATE }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE));
  const { data, frames, nMels } = logMelSpectrogram(tone);
  assert.equal(frames, 98);
  assert.equal(nMels, 40);
  const mid = 50 * nMels;
  let best = 0;
  for (let m = 1; m < nMels; m++) if (data[mid + m] > data[mid + best]) best = m;
  // Find which filter is centred closest to 1 kHz.
  const fb = melFilterbank();
  const centre = fb.map((w) => w.indexOf(Math.max(...w)) * (SAMPLE_RATE / 512));
  const expected = centre.reduce((bi, c, i) => (Math.abs(c - 1000) < Math.abs(centre[bi] - 1000) ? i : bi), 0);
  assert.ok(Math.abs(best - expected) <= 1, `peak band ${best}, expected ~${expected}`);
});

test('resident budget stays under 100 KB with a 17 KB model', () => {
  const kb = residentKB(17 * 1024);
  assert.ok(kb > 17 && kb < 100, `${kb} KB`);
});
