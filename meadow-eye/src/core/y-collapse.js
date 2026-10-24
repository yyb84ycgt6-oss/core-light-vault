// Y-Axis Collapse: destroy the X axis (linear syntax), keep the Y axis
// (semantic relationships). Words -> hashed n-gram embeddings -> PCA of their
// cosine geometry -> each word becomes k quaternary symbols (q=00 p=01 d=10
// b=11), headed by a 64-bit semantic SimHash (random hyperplanes, so nearby
// meanings land on nearby hashes). The output is gibberish with no word order
// and no tokens left; retention of the similarity geometry is measured.

export const DIM = 64;
export const QPDB = ['q', 'p', 'd', 'b'];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export const tokenize = (text, max = 1000) => (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).slice(0, max);

export function embedWord(w) {
  const v = new Float64Array(DIM);
  const s = `<${w}>`;
  const add = (f, wt) => {
    const h = fnv(f);
    v[h % DIM] += h & 0x80000000 ? -wt : wt;
  };
  add(`w:${w}`, 1.5);
  for (let n = 3; n <= 4; n++) for (let i = 0; i + n <= s.length; i++) add(s.slice(i, i + n), 1);
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

/** Top-k principal axes of the word cloud (power iteration with deflation). */
function principalAxes(E, k) {
  const n = E.length;
  const C = Array.from({ length: DIM }, () => new Float64Array(DIM));
  for (const e of E) for (let i = 0; i < DIM; i++) if (e[i]) for (let j = 0; j < DIM; j++) C[i][j] += e[i] * e[j];
  const axes = [];
  const rand = mulberry32(42);
  for (let a = 0; a < Math.min(k, n, DIM); a++) {
    let v = Float64Array.from({ length: DIM }, () => rand() - 0.5);
    for (let it = 0; it < 60; it++) {
      const w = new Float64Array(DIM);
      for (let i = 0; i < DIM; i++) for (let j = 0; j < DIM; j++) w[i] += C[i][j] * v[j];
      for (const u of axes) {
        const d = w.reduce((s, x, i) => s + x * u[i], 0);
        for (let i = 0; i < DIM; i++) w[i] -= d * u[i];
      }
      const norm = Math.hypot(...w) || 1;
      v = w.map((x) => x / norm);
    }
    axes.push(v);
  }
  return axes;
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

function pearson(x, y) {
  const n = x.length;
  if (n < 2) return 1;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** 64-bit semantic SimHash: signs of the mean embedding on 64 seeded hyperplanes. */
export function semanticSimHash(E) {
  const mean = new Float64Array(DIM);
  for (const e of E) for (let i = 0; i < DIM; i++) mean[i] += e[i];
  const rand = mulberry32(0x5eed);
  let bits = '';
  for (let h = 0; h < 64; h++) {
    let s = 0;
    for (let i = 0; i < DIM; i++) s += mean[i] * (rand() - 0.5);
    bits += s >= 0 ? '1' : '0';
  }
  return bits;
}

/** 32-dim Int8 document vector for the Living Archive (seeded random projection). */
export function docVector(text) {
  const E = tokenize(text).map(embedWord);
  const mean = new Float64Array(DIM);
  for (const e of E) for (let i = 0; i < DIM; i++) mean[i] += e[i];
  const rand = mulberry32(0xa7c1);
  const out = new Float64Array(32);
  for (let o = 0; o < 32; o++) for (let i = 0; i < DIM; i++) out[o] += mean[i] * (rand() * 2 - 1);
  const norm = Math.hypot(...out) || 1;
  return Int8Array.from(out, (x) => Math.round((x / norm) * 127));
}

export function cosineInt8(a, b) {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? s / Math.sqrt(na * nb) : 0;
}

export function yCollapse(text, { k = 4 } = {}) {
  const t0 = performance.now();
  const words = tokenize(text);
  const E = words.map(embedWord);
  const axes = principalAxes(E, k);
  const Y = E.map((e) => axes.map((a) => dot(e, a)));
  // Quartile cut per axis -> 2 bits per coordinate.
  const cuts = axes.map((_, j) => {
    const col = Y.map((y) => y[j]).sort((a, b) => a - b);
    return [0.25, 0.5, 0.75].map((q) => col[Math.min(col.length - 1, Math.floor(q * col.length))] ?? 0);
  });
  const centers = cuts.map((c, j) => {
    const col = Y.map((y) => y[j]);
    return [0, 1, 2, 3].map((b) => {
      const inBin = col.filter((v) => (v > (c[b - 1] ?? -Infinity)) && v <= (c[b] ?? Infinity));
      return inBin.length ? inBin.reduce((s, v) => s + v, 0) / inBin.length : 0;
    });
  });
  const bins = Y.map((y) => y.map((v, j) => cuts[j].filter((c) => v > c).length));
  const sim = semanticSimHash(E);
  let glyphs = '';
  for (let i = 0; i < 64; i += 2) glyphs += QPDB[parseInt(sim.slice(i, i + 2), 2)];
  for (const b of bins) for (const x of b) glyphs += QPDB[x];

  // Retention: do reconstructed coordinates keep pairwise cosine order?
  const truth = [];
  const approx = [];
  const rand = mulberry32(7);
  const pairs = Math.min(3000, (words.length * (words.length - 1)) / 2);
  for (let p = 0; p < pairs; p++) {
    const i = Math.floor(rand() * words.length);
    let j = Math.floor(rand() * (words.length - 1));
    if (j >= i) j++;
    truth.push(dot(E[i], E[j]));
    approx.push(bins[i].reduce((s, b, d) => s + centers[d][b] * centers[d][bins[j][d]], 0));
  }
  const inputBytes = new TextEncoder().encode(String(text)).length;
  const fpBytes = Math.ceil((glyphs.length * 2) / 8);
  return {
    words: words.length,
    k: axes.length,
    glyphs,
    simhash: sim,
    inputBytes,
    fingerprintBytes: fpBytes,
    ratio: fpBytes ? inputBytes / fpBytes : 0,
    retention: pairs ? pearson(truth, approx) : 1,
    us: Math.round((performance.now() - t0) * 1000),
  };
}

export const hamming = (a, b) => [...a].reduce((s, c, i) => s + (c !== b[i]), 0);
