import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeQR } from '../src/router/qr.js';

// Matrices produced by the Python `qrcode` library (fixtures/qr-reference.json).
const cases = JSON.parse(readFileSync(new URL('./fixtures/qr-reference.json', import.meta.url), 'utf8'));

test(`QR matrices match the Python qrcode reference module-for-module (${cases.length} cases, all 8 masks, L/M/Q/H, v1-v10)`, () => {
  for (const c of cases) {
    const q = encodeQR(Uint8Array.from(c.data), { ecl: c.ecl, mask: c.mask });
    assert.equal(q.version, c.version, `version for ${c.data.length}B ${c.ecl}`);
    const rows = q.modules.map((r) => r.map((b) => (b ? '1' : '0')).join(''));
    assert.deepEqual(rows, c.rows, `matrix ${c.data.length}B ${c.ecl} mask ${c.mask}`);
  }
});

test('automatic mask selection yields a valid symbol; oversize input is refused', () => {
  const q = encodeQR('Z3 [}0{ -_0_-] EZ');
  assert.ok(q.mask >= 0 && q.mask < 8);
  assert.equal(q.size, q.version * 4 + 17);
  assert.throws(() => encodeQR('x'.repeat(400), { ecl: 'H' }), /Too long/);
});
