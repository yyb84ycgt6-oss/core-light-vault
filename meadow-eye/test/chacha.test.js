import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { chachaBlock, hchacha20, poly1305, chacha20poly1305Seal, chacha20poly1305Open, xchacha20poly1305Seal, xchacha20poly1305Open } from '../src/core/chacha.js';

const hex = (s) => Uint8Array.from(Buffer.from(s.replace(/[\s:]/g, ''), 'hex'));
const toHex = (b) => Buffer.from(b).toString('hex');
const seq = (n, start = 0) => Uint8Array.from({ length: n }, (_, i) => (start + i) & 0xff);

test('RFC 8439 2.3.2 ChaCha20 block', () => {
  const out = chachaBlock(seq(32), 1, hex('000000090000004a00000000'));
  assert.equal(toHex(out).slice(0, 32), '10f1e7e4d13b5915500fdd1fa32071c4');
});

test('RFC 8439 2.5.2 Poly1305', () => {
  const tag = poly1305(hex('85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b'), new TextEncoder().encode('Cryptographic Forum Research Group'));
  assert.equal(toHex(tag), 'a8061dc1305136c6c22b8baf0c0127a9');
});

test('XChaCha draft 2.2.1 HChaCha20', () => {
  const sub = hchacha20(seq(32), hex('000000090000004a0000000031415927'));
  assert.equal(toHex(sub), '82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc');
});

test('AEAD matches Node native chacha20-poly1305 on random inputs, and rejects tampering', () => {
  for (const len of [0, 1, 63, 64, 65, 1000, 4096]) {
    const key = randomBytes(32);
    const nonce = randomBytes(12);
    const ad = randomBytes(len % 37);
    const pt = randomBytes(len);
    const c = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
    c.setAAD(ad, { plaintextLength: pt.length });
    const expected = Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
    const mine = chacha20poly1305Seal(key, nonce, pt, ad);
    assert.equal(toHex(mine), expected.toString('hex'), `len ${len}`);
    assert.deepEqual(Buffer.from(chacha20poly1305Open(key, nonce, mine, ad)), pt);
    if (mine.length) {
      mine[0] ^= 1;
      assert.equal(chacha20poly1305Open(key, nonce, mine, ad), null);
    }
  }
});

test('XChaCha20-Poly1305 round-trips and binds AD', () => {
  const key = randomBytes(32);
  const nonce = randomBytes(24);
  const ad = new TextEncoder().encode('SBX1');
  const sealed = xchacha20poly1305Seal(key, nonce, new TextEncoder().encode('meadow'), ad);
  assert.equal(new TextDecoder().decode(xchacha20poly1305Open(key, nonce, sealed, ad)), 'meadow');
  assert.equal(xchacha20poly1305Open(key, nonce, sealed, new TextEncoder().encode('SBX2')), null);
});
