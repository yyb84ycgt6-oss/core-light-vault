// Word embedders for the Y-Axis Collapse.
//
// 1. hashEmbedder (default, offline, zero download): signed feature hashing of
//    character 3/4/5-grams plus the whole token. Real and deterministic, but it
//    only captures spelling similarity, not meaning.
// 2. createOnnxEmbedder: a real sentence-embedding model (bge-micro-v2,
//    all-MiniLM-L6-v2, ...) run with onnxruntime-web on blobs downloaded by the
//    Asset Store, tokenised with a built-in BERT WordPiece tokenizer.

export const HASH_DIM = 384;
export const EMBEDDER_CODES = { hash: 0, onnx: 1 };

function fnv1a(str, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function hashEmbed(word, dim = HASH_DIM) {
  const v = new Float32Array(dim);
  const w = `<${word}>`;
  const add = (feat, weight) => {
    const h = fnv1a(feat);
    v[h % dim] += (h & 0x80000000 ? -1 : 1) * weight;
  };
  add(`w:${word}`, 1.5);
  for (let n = 3; n <= 5; n++) {
    for (let i = 0; i + n <= w.length; i++) add(w.slice(i, i + n), 1);
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

export function createHashEmbedder(dim = HASH_DIM) {
  const cache = new Map();
  return {
    id: 'hash-ngram-384',
    label: `Hashed char n-gram (${dim}d, offline)`,
    code: EMBEDDER_CODES.hash,
    dim,
    async embedWords(words) {
      const E = new Float32Array(words.length * dim);
      words.forEach((w, i) => {
        let vec = cache.get(w);
        if (!vec) {
          vec = hashEmbed(w, dim);
          if (cache.size < 50000) cache.set(w, vec);
        }
        E.set(vec, i * dim);
      });
      return E;
    },
  };
}

// ---------------------------------------------------------------------------
// BERT WordPiece tokenizer (HF tokenizer.json, model.type === 'WordPiece')
// ---------------------------------------------------------------------------

const isPunct = (ch) => /[\p{P}\p{S}]/u.test(ch);
const isCJK = (cp) =>
  (cp >= 0x4e00 && cp <= 0x9fff) ||
  (cp >= 0x3400 && cp <= 0x4dbf) ||
  (cp >= 0x20000 && cp <= 0x2a6df) ||
  (cp >= 0xf900 && cp <= 0xfaff);

export function createWordPieceTokenizer(tokenizerJson) {
  const model = tokenizerJson?.model;
  if (!model || model.type !== 'WordPiece' || !model.vocab) throw new Error('tokenizer.json is not a WordPiece model');
  const vocab = new Map(Object.entries(model.vocab));
  const unk = model.unk_token || '[UNK]';
  const prefix = model.continuing_subword_prefix ?? '##';
  const maxChars = model.max_input_chars_per_word || 100;
  const norm = tokenizerJson.normalizer || {};
  const lowercase = norm.lowercase ?? true;
  const stripAccents = norm.strip_accents ?? lowercase;
  const id = (t) => vocab.get(t) ?? vocab.get(unk);
  const cls = id('[CLS]');
  const sep = id('[SEP]');
  const pad = vocab.get('[PAD]') ?? 0;

  function normalise(text) {
    let t = String(text).replace(/[\u0000�\p{Cc}]/gu, (c) => (/\s/.test(c) ? ' ' : ''));
    if (lowercase) t = t.toLowerCase();
    if (stripAccents) t = t.normalize('NFD').replace(/\p{Mn}/gu, '');
    return t;
  }

  function preTokenise(text) {
    const out = [];
    let cur = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (/\s/.test(ch)) {
        if (cur) out.push(cur);
        cur = '';
      } else if (isPunct(ch) || isCJK(cp)) {
        if (cur) out.push(cur);
        out.push(ch);
        cur = '';
      } else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }

  function wordPiece(word) {
    const chars = Array.from(word);
    if (chars.length > maxChars) return [id(unk)];
    const ids = [];
    let start = 0;
    while (start < chars.length) {
      let end = chars.length;
      let found = null;
      while (start < end) {
        const piece = (start > 0 ? prefix : '') + chars.slice(start, end).join('');
        if (vocab.has(piece)) {
          found = vocab.get(piece);
          break;
        }
        end--;
      }
      if (found === null) return [id(unk)];
      ids.push(found);
      start = end;
    }
    return ids;
  }

  return {
    pad,
    encode(text, maxLen = 128) {
      const ids = [cls];
      for (const w of preTokenise(normalise(text))) ids.push(...wordPiece(w));
      if (ids.length > maxLen - 1) ids.length = maxLen - 1;
      ids.push(sep);
      return ids;
    },
  };
}

let ortPromise = null;
async function loadOrt() {
  if (!ortPromise) {
    ortPromise = (async () => {
      const ort = await import('onnxruntime-web/wasm');
      const [{ default: wasm }, { default: mjs }] = await Promise.all([
        import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url'),
        import('onnxruntime-web/ort-wasm-simd-threaded.mjs?url'),
      ]);
      ort.env.wasm.wasmPaths = { wasm, mjs };
      ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
      return ort;
    })();
  }
  return ortPromise;
}
export { loadOrt };

/**
 * Real transformer embedder from downloaded blobs.
 * @param {{modelBytes: ArrayBuffer|Uint8Array, tokenizerJson: object, id: string}} opts
 */
export async function createOnnxEmbedder({ modelBytes, tokenizerJson, id }) {
  const ort = await loadOrt();
  const session = await ort.InferenceSession.create(
    modelBytes instanceof Uint8Array ? modelBytes : new Uint8Array(modelBytes),
    { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
  );
  const tok = createWordPieceTokenizer(tokenizerJson);
  const needsTypes = session.inputNames.includes('token_type_ids');
  let dim = 0;

  async function embedBatch(texts) {
    const enc = texts.map((t) => tok.encode(t, 32));
    const T = Math.max(...enc.map((e) => e.length));
    const B = texts.length;
    const ids = new BigInt64Array(B * T);
    const mask = new BigInt64Array(B * T);
    enc.forEach((e, b) => {
      for (let t = 0; t < T; t++) {
        ids[b * T + t] = BigInt(t < e.length ? e[t] : tok.pad);
        mask[b * T + t] = t < e.length ? 1n : 0n;
      }
    });
    const feeds = {
      input_ids: new ort.Tensor('int64', ids, [B, T]),
      attention_mask: new ort.Tensor('int64', mask, [B, T]),
    };
    if (needsTypes) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(B * T), [B, T]);
    const out = await session.run(feeds);
    const hidden = out.last_hidden_state || out[session.outputNames[0]];
    const [, , H] = hidden.dims;
    dim = H;
    const data = hidden.data;
    const res = new Float32Array(B * H);
    for (let b = 0; b < B; b++) {
      let count = 0;
      for (let t = 0; t < T; t++) {
        if (mask[b * T + t] === 0n) continue;
        count++;
        const off = (b * T + t) * H;
        for (let h = 0; h < H; h++) res[b * H + h] += data[off + h];
      }
      let norm = 0;
      for (let h = 0; h < H; h++) {
        res[b * H + h] /= count || 1;
        norm += res[b * H + h] ** 2;
      }
      norm = Math.sqrt(norm) || 1;
      for (let h = 0; h < H; h++) res[b * H + h] /= norm;
    }
    return { vectors: res, dim: H };
  }

  const cache = new Map();
  return {
    id,
    label: `${id} (ONNX, wasm)`,
    code: EMBEDDER_CODES.onnx,
    get dim() {
      return dim;
    },
    async embedWords(words) {
      const unique = [...new Set(words)].filter((w) => !cache.has(w));
      for (let i = 0; i < unique.length; i += 64) {
        const batch = unique.slice(i, i + 64);
        const { vectors, dim: H } = await embedBatch(batch);
        batch.forEach((w, j) => cache.set(w, vectors.slice(j * H, (j + 1) * H)));
      }
      if (!dim && words.length) dim = cache.get(words[0])?.length || 0;
      const E = new Float32Array(words.length * dim);
      words.forEach((w, i) => E.set(cache.get(w), i * dim));
      return E;
    },
  };
}
