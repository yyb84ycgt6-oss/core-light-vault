// Y-Axis Collapse: Y_k = PCA(cosSim(E(w_i), E(w_j))).
//
// Given n word embeddings E (n x d, rows L2-normalised) the cosine-similarity
// matrix is the Gram matrix S = E E^T. Its top-k eigenvectors give the best
// rank-k approximation of S (Eckart-Young). We compute them through the d x d
// covariance C = E^T E with seeded subspace iteration, project Y = E V (n x k),
// then scalar-quantise each axis to 8 bits. The fingerprint keeps word
// coordinates only: syntax and token identity are gone, similarity geometry is
// (partly) kept. `retention` is measured, never assumed.

export const FP_MAGIC = 0x59; // 'Y'
export const FP_VERSION = 1;
export const MAX_WORDS = 1000;
export const MAX_K = 32;

export function tokenizeWords(text, maxWords = MAX_WORDS) {
  const words = String(text || '')
    .toLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return (words || []).slice(0, maxWords);
}

// Deterministic PRNG (mulberry32) so the same text always collapses identically.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function covariance(E, n, d) {
  const C = new Float64Array(d * d);
  for (let r = 0; r < n; r++) {
    const off = r * d;
    for (let i = 0; i < d; i++) {
      const ei = E[off + i];
      if (ei === 0) continue;
      const row = i * d;
      for (let j = i; j < d; j++) C[row + j] += ei * E[off + j];
    }
  }
  for (let i = 0; i < d; i++) for (let j = i + 1; j < d; j++) C[j * d + i] = C[i * d + j];
  return C;
}

// Modified Gram-Schmidt on the K columns of V (d x K, column-major).
function orthonormalise(V, d, K) {
  for (let c = 0; c < K; c++) {
    const col = c * d;
    for (let p = 0; p < c; p++) {
      const pc = p * d;
      let dot = 0;
      for (let i = 0; i < d; i++) dot += V[col + i] * V[pc + i];
      for (let i = 0; i < d; i++) V[col + i] -= dot * V[pc + i];
    }
    let norm = 0;
    for (let i = 0; i < d; i++) norm += V[col + i] * V[col + i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < d; i++) V[col + i] /= norm;
  }
}

// Cyclic Jacobi eigen-decomposition for a small symmetric K x K matrix.
function jacobiEigen(A, K) {
  const a = Float64Array.from(A);
  const v = new Float64Array(K * K);
  for (let i = 0; i < K; i++) v[i * K + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < K; p++) for (let q = p + 1; q < K; q++) off += a[p * K + q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < K; p++) {
      for (let q = p + 1; q < K; q++) {
        const apq = a[p * K + q];
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q * K + q] - a[p * K + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < K; k++) {
          const akp = a[k * K + p];
          const akq = a[k * K + q];
          a[k * K + p] = c * akp - s * akq;
          a[k * K + q] = s * akp + c * akq;
        }
        for (let k = 0; k < K; k++) {
          const apk = a[p * K + k];
          const aqk = a[q * K + k];
          a[p * K + k] = c * apk - s * aqk;
          a[q * K + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < K; k++) {
          const vkp = v[k * K + p];
          const vkq = v[k * K + q];
          v[k * K + p] = c * vkp - s * vkq;
          v[k * K + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = Array.from({ length: K }, (_, i) => a[i * K + i]);
  return { values, vectors: v };
}

/**
 * Top-K eigenpairs of C = E^T E via subspace iteration + Rayleigh-Ritz.
 * Returns eigenvalues (desc) and V (d x K column-major).
 */
export function topEigen(E, n, d, K, { iterations = 40, seed = 0x9e3779b9 } = {}) {
  K = Math.max(0, Math.min(K, d, n));
  const C = covariance(E, n, d);
  let frob2 = 0;
  for (let i = 0; i < C.length; i++) frob2 += C[i] * C[i];
  if (K === 0) return { values: [], V: new Float64Array(0), frob2, K };

  const rand = mulberry32(seed);
  let V = new Float64Array(d * K);
  for (let i = 0; i < V.length; i++) V[i] = rand() - 0.5;
  orthonormalise(V, d, K);
  const W = new Float64Array(d * K);
  for (let it = 0; it < iterations; it++) {
    W.fill(0);
    for (let c = 0; c < K; c++) {
      const col = c * d;
      for (let i = 0; i < d; i++) {
        const row = i * d;
        let s = 0;
        for (let j = 0; j < d; j++) s += C[row + j] * V[col + j];
        W[col + i] = s;
      }
    }
    orthonormalise(W, d, K);
    V.set(W);
  }
  // Rayleigh-Ritz: T = V^T C V, rotate V into T's eigenbasis.
  const CV = new Float64Array(d * K);
  for (let c = 0; c < K; c++) {
    for (let i = 0; i < d; i++) {
      let s = 0;
      for (let j = 0; j < d; j++) s += C[i * d + j] * V[c * d + j];
      CV[c * d + i] = s;
    }
  }
  const T = new Float64Array(K * K);
  for (let a = 0; a < K; a++) {
    for (let b = 0; b < K; b++) {
      let s = 0;
      for (let i = 0; i < d; i++) s += V[a * d + i] * CV[b * d + i];
      T[a * K + b] = s;
    }
  }
  const { values, vectors } = jacobiEigen(T, K);
  const order = values.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]);
  const Vr = new Float64Array(d * K);
  order.forEach(([, src], dst) => {
    for (let i = 0; i < d; i++) {
      let s = 0;
      for (let m = 0; m < K; m++) s += V[m * d + i] * vectors[m * K + src];
      Vr[dst * d + i] = s;
    }
  });
  return { values: order.map(([v]) => Math.max(0, v)), V: Vr, frob2, K };
}

function project(E, n, d, V, k) {
  const Y = new Float64Array(n * k);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < k; c++) {
      let s = 0;
      for (let i = 0; i < d; i++) s += E[r * d + i] * V[c * d + i];
      Y[r * k + c] = s;
    }
  }
  return Y;
}

function quantise(Y, n, k) {
  const mins = new Float32Array(k);
  const maxs = new Float32Array(k);
  const q = new Uint8Array(n * k);
  for (let c = 0; c < k; c++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let r = 0; r < n; r++) {
      const v = Y[r * k + c];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!Number.isFinite(lo)) lo = hi = 0;
    mins[c] = lo;
    maxs[c] = hi;
    const span = hi - lo || 1;
    for (let r = 0; r < n; r++) q[r * k + c] = Math.round(((Y[r * k + c] - lo) / span) * 255);
  }
  return { mins, maxs, q };
}

export function dequantise({ mins, maxs, q }, n, k) {
  const Y = new Float64Array(n * k);
  for (let c = 0; c < k; c++) {
    const span = maxs[c] - mins[c];
    for (let r = 0; r < n; r++) Y[r * k + c] = mins[c] + (q[r * k + c] / 255) * span;
  }
  return Y;
}

function pearson(xs, ys) {
  const m = xs.length;
  if (m < 2) return 1;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < m; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / m;
  const my = sy / m;
  let cxy = 0;
  let cxx = 0;
  let cyy = 0;
  for (let i = 0; i < m; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cxy += dx * dy;
    cxx += dx * dx;
    cyy += dy * dy;
  }
  if (cxx === 0 || cyy === 0) return cxx === cyy ? 1 : 0;
  return cxy / Math.sqrt(cxx * cyy);
}

// Off-diagonal pairs (i<j). Exact for small n, seeded sample otherwise.
function samplePairs(n, maxPairs = 40000, seed = 7) {
  const total = (n * (n - 1)) / 2;
  const pairs = [];
  if (total <= maxPairs) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push(i, j);
    return pairs;
  }
  const rand = mulberry32(seed);
  for (let s = 0; s < maxPairs; s++) {
    const i = Math.floor(rand() * n);
    let j = Math.floor(rand() * (n - 1));
    if (j >= i) j++;
    pairs.push(Math.min(i, j), Math.max(i, j));
  }
  return pairs;
}

function trueSims(E, d, pairs) {
  const m = pairs.length / 2;
  const truth = new Float64Array(m);
  for (let p = 0; p < m; p++) {
    const i = pairs[2 * p] * d;
    const j = pairs[2 * p + 1] * d;
    let s = 0;
    for (let t = 0; t < d; t++) s += E[i + t] * E[j + t];
    truth[p] = s;
  }
  return truth;
}

/** Geometry retention: Pearson r between true and reconstructed off-diagonal cosine similarities. */
export function geometryRetention(E, n, d, Yhat, k, pairs = samplePairs(n), truth = trueSims(E, d, pairs)) {
  const m = pairs.length / 2;
  const approx = new Float64Array(m);
  for (let p = 0; p < m; p++) {
    const i = pairs[2 * p] * k;
    const j = pairs[2 * p + 1] * k;
    let a = 0;
    for (let c = 0; c < k; c++) a += Yhat[i + c] * Yhat[j + c];
    approx[p] = a;
  }
  return pearson(truth, approx);
}

export function encodeFingerprint({ n, k, embedderCode, mins, maxs, q }) {
  const out = new Uint8Array(6 + 8 * k + n * k);
  const dv = new DataView(out.buffer);
  out[0] = FP_MAGIC;
  out[1] = FP_VERSION;
  dv.setUint16(2, n, true);
  out[4] = k;
  out[5] = embedderCode;
  for (let c = 0; c < k; c++) {
    dv.setFloat32(6 + 8 * c, mins[c], true);
    dv.setFloat32(10 + 8 * c, maxs[c], true);
  }
  out.set(q, 6 + 8 * k);
  return out;
}

export function decodeFingerprint(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 6 || bytes[0] !== FP_MAGIC) throw new Error('Not a Y fingerprint');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint16(2, true);
  const k = bytes[4];
  const embedderCode = bytes[5];
  if (bytes.length !== 6 + 8 * k + n * k) throw new Error('Fingerprint length mismatch');
  const mins = new Float32Array(k);
  const maxs = new Float32Array(k);
  for (let c = 0; c < k; c++) {
    mins[c] = dv.getFloat32(6 + 8 * c, true);
    maxs[c] = dv.getFloat32(10 + 8 * c, true);
  }
  const q = bytes.slice(6 + 8 * k);
  return { n, k, embedderCode, mins, maxs, q, coords: dequantise({ mins, maxs, q }, n, k) };
}

/**
 * Collapse an embedding matrix to a k-axis fingerprint.
 * @param {Float32Array} E row-major n x d, rows L2-normalised
 */
export function collapseEmbeddings(E, n, d, { k = 2, curveTo = 0, embedderCode = 0 } = {}) {
  k = Math.max(1, Math.min(k, MAX_K));
  const K = Math.min(Math.max(k, curveTo), MAX_K);
  const eig = topEigen(E, n, d, K);
  const kk = Math.min(k, eig.K);
  const Y = project(E, n, d, eig.V, kk);
  const qz = quantise(Y, n, kk);
  const Yhat = dequantise(qz, n, kk);
  const pairs = samplePairs(n);
  const truth = trueSims(E, d, pairs);
  const retention = n < 2 ? 1 : geometryRetention(E, n, d, Yhat, kk, pairs, truth);
  const energy = eig.frob2 > 0 ? eig.values.slice(0, kk).reduce((s, v) => s + v * v, 0) / eig.frob2 : 1;

  // Optional retention curve r(k) for k = 1..curveTo (unquantised, for the lab).
  const curve = [];
  if (curveTo > 0 && n >= 2) {
    // Rank-c reconstruction grows by one outer product per axis: approx += y_c y_c^T.
    const Yall = project(E, n, d, eig.V, eig.K);
    const m = pairs.length / 2;
    const approx = new Float64Array(m);
    for (let c = 0; c < eig.K; c++) {
      for (let p = 0; p < m; p++) approx[p] += Yall[pairs[2 * p] * eig.K + c] * Yall[pairs[2 * p + 1] * eig.K + c];
      curve.push({ k: c + 1, retention: pearson(truth, approx), bytes: 6 + 8 * (c + 1) + n * (c + 1) });
    }
  }

  const fingerprint = encodeFingerprint({ n, k: kk, embedderCode, ...qz });
  const sourceBytes = n * d * 4; // float32 embedding matrix
  return {
    n,
    d,
    k: kk,
    fingerprint,
    fingerprintBytes: fingerprint.length,
    sourceBytes,
    ratio: fingerprint.length ? sourceBytes / fingerprint.length : 0,
    retention,
    energy,
    eigenvalues: eig.values,
    coords: Yhat,
    curve,
  };
}
