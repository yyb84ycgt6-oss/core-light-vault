// QR Forge encoder: byte mode, ECC L/M/Q/H, versions 1-10 (up to 271 bytes at L),
// Reed-Solomon over GF(256), all 8 masks scored with the standard penalty rules.
// Structure follows Project Nayuki's reference design; verified module-for-module
// against the Python `qrcode` library in test/qr.test.js.

const ECL = { L: { ord: 0, fmt: 1 }, M: { ord: 1, fmt: 0 }, Q: { ord: 2, fmt: 3 }, H: { ord: 3, fmt: 2 } };
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
];
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
];
export const MAX_VERSION = 10;

const bit = (x, i) => ((x >>> i) & 1) !== 0;

function rawModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
const dataCodewords = (ver, e) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[e.ord][ver] * NUM_BLOCKS[e.ord][ver];

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

function rsRemainder(data, div) {
  const r = div.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    div.forEach((c, i) => (r[i] ^= gfMul(c, f)));
  }
  return r;
}

function interleave(data, ver, e) {
  const numBlocks = NUM_BLOCKS[e.ord][ver];
  const eccLen = ECC_PER_BLOCK[e.ord][ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => (i !== shortLen - eccLen || j >= numShort) && out.push(b[i]));
  return out;
}

function alignPositions(ver, size) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = size - 7; r.length < n; pos -= step) r.splice(1, 0, pos);
  return r;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Grid {
  constructor(ver, e) {
    this.ver = ver;
    this.e = e;
    this.size = ver * 4 + 17;
    this.m = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.fn = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
  }
  set(x, y, dark) {
    this.m[y][x] = dark;
    this.fn[y][x] = true;
  }
  functionPatterns() {
    const s = this.size;
    for (let i = 0; i < s; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [[3, 3], [s - 4, 3], [3, s - 4]]) {
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && x < s && y >= 0 && y < s) this.set(x, y, d !== 2 && d !== 4);
        }
    }
    const pos = alignPositions(this.ver, s);
    const n = pos.length;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    this.format(0);
    if (this.ver >= 7) {
      let rem = this.ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (this.ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const a = s - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.set(a, b, bit(bits, i));
        this.set(b, a, bit(bits, i));
      }
    }
  }
  format(mask) {
    const data = (this.e.fmt << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const s = this.size;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(bits, i));
    this.set(8, 7, bit(bits, 6));
    this.set(8, 8, bit(bits, 7));
    this.set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(bits, i));
    this.set(8, s - 8, true);
  }
  codewords(data) {
    const s = this.size;
    let i = 0;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < s; v++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const y = ((right + 1) & 2) === 0 ? s - 1 - v : v;
          if (!this.fn[y][x] && i < data.length * 8) {
            this.m[y][x] = bit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
    }
  }
  mask(k) {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) if (!this.fn[y][x] && MASKS[k](x, y)) this.m[y][x] = !this.m[y][x];
  }
  penalty() {
    const s = this.size;
    const m = this.m;
    let res = 0;
    const addHist = (len, h) => {
      if (h[0] === 0) len += s;
      h.pop();
      h.unshift(len);
    };
    const count = (h) => {
      const n = h[1];
      const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
      return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
    };
    const terminate = (color, len, h) => {
      if (color) {
        addHist(len, h);
        len = 0;
      }
      addHist(len + s, h);
      return count(h);
    };
    for (const get of [(a, b) => m[a][b], (a, b) => m[b][a]]) {
      for (let a = 0; a < s; a++) {
        let color = false;
        let run = 0;
        const h = [0, 0, 0, 0, 0, 0, 0];
        for (let b = 0; b < s; b++) {
          if (get(a, b) === color) {
            run++;
            if (run === 5) res += 3;
            else if (run > 5) res++;
          } else {
            addHist(run, h);
            if (!color) res += count(h) * 40;
            color = get(a, b);
            run = 1;
          }
        }
        res += terminate(color, run, h) * 40;
      }
    }
    for (let y = 0; y < s - 1; y++)
      for (let x = 0; x < s - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) res += 3;
      }
    const dark = m.reduce((t, row) => t + row.filter(Boolean).length, 0);
    const total = s * s;
    res += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return res;
  }
}

/**
 * @param {Uint8Array|string} input
 * @param {{ecl?:'L'|'M'|'Q'|'H', mask?:number}} o mask forces a pattern (tests)
 * @returns {{version:number, size:number, mask:number, modules:boolean[][]}}
 */
export function encodeQR(input, { ecl = 'M', mask = -1 } = {}) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const e = ECL[ecl];
  let ver = 1;
  for (; ; ver++) {
    if (ver > MAX_VERSION) throw new Error(`Too long for QR v${MAX_VERSION}-${ecl} (${data.length} bytes)`);
    const used = 4 + (ver < 10 ? 8 : 16) + data.length * 8;
    if (used <= dataCodewords(ver, e) * 8) break;
  }
  const bits = [];
  const push = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(data.length, ver < 10 ? 8 : 16);
  for (const b of data) push(b, 8);
  const cap = dataCodewords(ver, e) * 8;
  push(0, Math.min(4, cap - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  const g = new Grid(ver, e);
  g.functionPatterns();
  g.codewords(interleave(codewords, ver, e));
  let best = mask;
  if (best < 0) {
    let min = Infinity;
    for (let k = 0; k < 8; k++) {
      g.mask(k);
      g.format(k);
      const p = g.penalty();
      if (p < min) {
        min = p;
        best = k;
      }
      g.mask(k);
    }
  }
  g.mask(best);
  g.format(best);
  return { version: ver, size: g.size, mask: best, modules: g.m };
}

/** Draw onto a canvas with a 4-module quiet zone. */
export function drawQR(canvas, qr, px = 280) {
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.height = px;
  const n = qr.size + 8;
  const cell = px / n;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000';
  for (let y = 0; y < qr.size; y++)
    for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) ctx.fillRect(Math.floor((x + 4) * cell), Math.floor((y + 4) * cell), Math.ceil(cell), Math.ceil(cell));
}
