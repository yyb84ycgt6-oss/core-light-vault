// Off-main-thread Y-Axis Collapse. Uses the offline hash embedder, or a real
// ONNX sentence-embedding model downloaded by the Asset Store (read from
// OPFS/IndexedDB, which workers can access too).
import { realYAxisCollapse } from '../longString.js';
import { createHashEmbedder, createOnnxEmbedder } from '../lib/embedder.js';
import { readModelFile } from '../lib/downloads.js';

const hash = createHashEmbedder();
const onnxCache = new Map();

async function onnxEmbedder({ repo, file, tokenizer }) {
  const key = `${repo}/${file}`;
  if (!onnxCache.has(key)) {
    onnxCache.set(
      key,
      (async () => {
        const [model, tok] = await Promise.all([readModelFile(repo, file), readModelFile(repo, tokenizer)]);
        if (!model || !tok) throw new Error(`${repo} is not downloaded (needs ${file} and ${tokenizer})`);
        return createOnnxEmbedder({ id: repo, modelBytes: await model.arrayBuffer(), tokenizerJson: JSON.parse(await tok.text()) });
      })().catch((err) => {
        onnxCache.delete(key);
        throw err;
      }),
    );
  }
  return onnxCache.get(key);
}

self.onmessage = async ({ data }) => {
  const { id, text, k = 2, curveTo = 0, embedder = 'hash' } = data;
  try {
    const emb = embedder === 'hash' ? hash : await onnxEmbedder(embedder);
    const t0 = performance.now();
    const r = await realYAxisCollapse(text, { k, curveTo, embedder: emb });
    const coords = Array.from(r.coords.subarray ? r.coords.subarray(0, Math.min(r.coords.length, r.n * r.k)) : r.coords);
    self.postMessage({
      id,
      ok: true,
      result: {
        words: r.words,
        textBytes: r.textBytes,
        n: r.n,
        d: r.d,
        k: r.k,
        fingerprintBytes: r.fingerprintBytes,
        sourceBytes: r.sourceBytes,
        ratio: r.ratio,
        retention: r.retention,
        energy: r.energy,
        curve: r.curve,
        coords,
        qpdb: r.qpdb,
        embedder: r.embedder,
        ms: performance.now() - t0,
      },
    });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
