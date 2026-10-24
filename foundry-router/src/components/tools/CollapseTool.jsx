import { useEffect, useState } from 'react';
import { useApp } from '../../AppContext.js';
import { runCollapse, LAB_SAMPLE, fmtBytes } from '../../toolbox/yAxisLab.js';
import { storedFiles } from '../../lib/downloads.js';

const TARGET = 0.97;

function Curve({ curve, k }) {
  if (!curve?.length) return null;
  const W = 320;
  const H = 140;
  const P = 24;
  const x = (c) => P + ((c - 1) / Math.max(1, curve.length - 1)) * (W - 2 * P);
  const y = (r) => H - P - Math.max(0, r) * (H - 2 * P);
  const d = curve.map((c, i) => `${i ? 'L' : 'M'}${x(c.k).toFixed(1)},${y(c.retention).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Retention versus axes kept">
      <line x1={P} x2={W - P} y1={y(TARGET)} y2={y(TARGET)} stroke="var(--warn)" strokeDasharray="4 4" />
      <text x={W - P} y={y(TARGET) - 4} textAnchor="end" fontSize="10" fill="var(--warn)">
        0.97 target
      </text>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" />
      {curve.map((c) => (
        <circle key={c.k} cx={x(c.k)} cy={y(c.retention)} r={c.k === k ? 4 : 1.8} fill={c.k === k ? 'var(--accent-2)' : 'var(--accent)'} />
      ))}
      <text x={P} y={H - 6} fontSize="10" fill="var(--faint)">
        k=1
      </text>
      <text x={W - P} y={H - 6} fontSize="10" fill="var(--faint)" textAnchor="end">
        k={curve.length}
      </text>
    </svg>
  );
}

function Scatter({ coords, n, k }) {
  if (!coords?.length || k < 2) return null;
  const pts = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = coords[i * k];
    const py = coords[i * k + 1];
    pts.push([px, py]);
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  const S = 300;
  const sx = (v) => 10 + ((v - minX) / (maxX - minX || 1)) * (S - 20);
  const sy = (v) => S - 10 - ((v - minY) / (maxY - minY || 1)) * (S - 20);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} style={{ width: '100%', maxWidth: 360, height: 'auto', background: '#05060d', borderRadius: 12 }} role="img" aria-label="Word coordinates on Y1, Y2">
      {pts.map(([a, b], i) => (
        <circle key={i} cx={sx(a)} cy={sy(b)} r="1.6" fill="var(--accent)" opacity="0.7" />
      ))}
    </svg>
  );
}

export default function CollapseTool() {
  const { live } = useApp();
  const chatText = live.chat.map((m) => m.content).join('\n');
  const [text, setText] = useState(chatText.split(/\s+/).length > 50 ? chatText : LAB_SAMPLE);
  const [k, setK] = useState(2);
  const [embedders, setEmbedders] = useState([]);
  const [embedder, setEmbedder] = useState('hash');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Real ONNX embedders become available once the Asset Store has them.
    Promise.all([storedFiles(), fetch('/models/manifest.json').then((r) => r.json())])
      .then(([files, manifest]) => {
        const have = new Set(files.map((f) => f.id));
        setEmbedders(manifest.models.filter((m) => m.embedder && have.has(`${m.repo}/${m.file}`) && m.extra.every((x) => have.has(`${m.repo}/${x}`))));
      })
      .catch(() => {});
  }, []);

  async function run() {
    setBusy(true);
    setError('');
    try {
      const m = embedders.find((e) => e.id === embedder);
      setRes(await runCollapse(text, { k, curveTo: 32, embedder: m ? { repo: m.repo, file: m.file, tokenizer: 'tokenizer.json' } : 'hash' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const pass = res && res.retention >= TARGET;
  return (
    <div>
      <div className="faint">
        Y_k = PCA(cosSim(E(w_i), E(w_j))): word embeddings → top-k eigen-axes of the cosine-similarity matrix → 8-bit SVQ per axis. Syntax is destroyed, geometry is kept as far as k allows. Retention is measured, never assumed.
      </div>
      <textarea className="field" rows={5} style={{ marginTop: 8 }} value={text} onChange={(e) => setText(e.target.value)} aria-label="Text to collapse" />
      <label className="lbl" htmlFor="emb">Embedder</label>
      <select id="emb" className="field" value={embedder} onChange={(e) => setEmbedder(e.target.value)}>
        <option value="hash">Hashed char n-grams (384d, offline, spelling-level)</option>
        {embedders.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} (ONNX, downloaded)
          </option>
        ))}
      </select>
      {embedders.length === 0 && <div className="faint">Download bge-micro-v2 or all-MiniLM-L6-v2 in the Asset Store for real semantic embeddings.</div>}
      <label className="lbl" htmlFor="k">Axes kept k = {k} → ~{fmtBytes(6 + 8 * k + Math.min(1000, text.split(/\s+/).filter(Boolean).length) * k)}</label>
      <input id="k" type="range" min="1" max="32" value={k} onChange={(e) => setK(+e.target.value)} />
      <button className="btn primary block" onClick={run} disabled={busy || !text.trim()}>
        {busy ? 'Collapsing in worker…' : 'Collapse'}
      </button>
      {error && <div className="err" style={{ marginTop: 8 }}>{error}</div>}
      {res && (
        <div className="card" style={{ marginTop: 12 }}>
          <dl className="kv">
            <dt>words</dt>
            <dd>{res.words} (max 1000)</dd>
            <dt>source E</dt>
            <dd>
              {fmtBytes(res.sourceBytes)} ({res.n}×{res.d} float32)
            </dd>
            <dt>Y fingerprint</dt>
            <dd>{fmtBytes(res.fingerprintBytes)}</dd>
            <dt>ratio</dt>
            <dd>{res.ratio.toFixed(0)}:1</dd>
            <dt>retention</dt>
            <dd className={pass ? 'okc' : 'warnc'}>
              {res.retention.toFixed(3)} {pass ? '≥ 0.97 ✓' : '< 0.97'}
            </dd>
            <dt>energy</dt>
            <dd>{res.energy.toFixed(3)}</dd>
            <dt>embedder</dt>
            <dd>{res.embedder}</dd>
            <dt>time</dt>
            <dd>{res.ms.toFixed(0)} ms</dd>
          </dl>
          {!pass && res.curve?.length > 0 && (
            <div className="faint" style={{ marginTop: 6 }}>
              {(() => {
                const hit = res.curve.find((c) => c.retention >= TARGET);
                return hit
                  ? `0.97 needs k=${hit.k} → ${fmtBytes(hit.bytes)} (${(res.sourceBytes / hit.bytes).toFixed(0)}:1).`
                  : `0.97 is not reached within 32 axes with this embedder (best ${Math.max(...res.curve.map((c) => c.retention)).toFixed(3)}).`;
              })()}
            </div>
          )}
          <h2>Retention vs axes</h2>
          <Curve curve={res.curve} k={res.k} />
          <h2>Coordinates (Y1, Y2)</h2>
          <Scatter coords={res.coords} n={res.n} k={res.k} />
          <h2>qpdb glyphs</h2>
          <div className="longstring">{res.qpdb.slice(0, 600)}…</div>
        </div>
      )}
    </div>
  );
}
