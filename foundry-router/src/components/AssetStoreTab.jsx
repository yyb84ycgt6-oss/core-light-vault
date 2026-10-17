import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../AppContext.js';
import { createDownloadQueue, isDownloaded, deleteModel, CONCURRENCY } from '../lib/downloads.js';
import { storageEstimate, requestPersistence } from '../lib/system.js';
import { prepareModel, webgpuInfo } from '../lib/webllm.js';
import { fmtBytes } from '../toolbox/yAxisLab.js';

const TIER_LABEL = { green: '✓ iPhone 12', yellow: '◐ CoreML-class', orange: '▲ macro', red: '■ workstation' };

// Module scope: downloads keep running (and keep their progress) while you
// switch tabs; the component subscribes when mounted.
const statusCache = {};
const listeners = new Set();
function setStat(id, patch) {
  statusCache[id] = { ...statusCache[id], ...patch };
  listeners.forEach((fn) => fn(id, statusCache[id]));
}
const queue = createDownloadQueue({ onUpdate: ({ id, ...patch }) => setStat(id, patch) });

export default function AssetStoreTab() {
  const { notify, setLive, eye } = useApp();
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [maxMB, setMaxMB] = useState(100);
  const [tiers, setTiers] = useState({ green: true, yellow: true, orange: true, red: true });
  const [status, setStatus] = useState(() => ({ ...statusCache }));
  const [storage, setStorage] = useState(null);
  const [gpu, setGpu] = useState(null);

  useEffect(() => {
    const onStat = (id, st) => {
      setStatus((s) => ({ ...s, [id]: st }));
      if (st.state === 'done') {
        storageEstimate().then(setStorage);
        setLive((live) => (live.models.includes(id) ? live : { ...live, models: [...live.models, id] }));
      }
    };
    listeners.add(onStat);
    // Anything that finished while this tab was closed.
    const finished = Object.keys(statusCache).filter((id) => statusCache[id].state === 'done');
    if (finished.length) setLive((live) => ({ ...live, models: [...new Set([...live.models, ...finished])] }));
    return () => listeners.delete(onStat);
  }, [setLive]);

  useEffect(() => {
    fetch('/models/manifest.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`manifest ${r.status}`))))
      .then(setManifest)
      .catch((e) => setError(e.message));
    storageEstimate().then(setStorage);
    webgpuInfo().then(setGpu);
  }, []);

  useEffect(() => {
    if (!manifest) return;
    // Mark what is already on this device.
    Promise.all(manifest.models.filter((m) => m.runtime !== 'webllm' && !m.local).map(async (m) => [m.id, await isDownloaded(m)])).then((pairs) => {
      for (const [id, have] of pairs) if (have && !statusCache[id]?.state) setStat(id, { state: 'done' });
    });
  }, [manifest]);

  useEffect(() => {
    if (eye?.weightsSource === 'onnx') setStat('bc-resnet-kws', { state: 'done' });
  }, [eye]);

  const models = useMemo(() => {
    if (!manifest) return [];
    const needle = q.trim().toLowerCase();
    return manifest.models.filter(
      (m) =>
        tiers[m.tier] &&
        m.sizeMB <= (maxMB >= 6000 ? Infinity : maxMB) &&
        (!needle || `${m.name} ${m.repo} ${m.category} ${m.use} ${m.id}`.toLowerCase().includes(needle)),
    );
  }, [manifest, q, maxMB, tiers]);

  async function prepareWebLLM(m) {
    const info = gpu || (await webgpuInfo());
    if (!info.supported) {
      setStat(m.id, { state: 'error', error: info.reason || 'WebGPU unavailable' });
      return;
    }
    setStat(m.id, { state: 'downloading', loaded: 0, total: 1, error: null });
    try {
      const id = await prepareModel(m.webllm, (r) => setStat(m.id, { state: 'downloading', loaded: r.progress || 0, total: 1, note: r.text }));
      setStat(m.id, { state: 'done', note: `${id} is the offline brain` });
    } catch (err) {
      setStat(m.id, { state: 'error', error: String(err.message || err) });
    }
  }

  function download(m) {
    if (m.local) return;
    if (m.runtime === 'webllm') return prepareWebLLM(m);
    queue.enqueue([m]);
  }

  function initializeCore() {
    const core = manifest.core.map((id) => manifest.models.find((m) => m.id === id));
    requestPersistence();
    for (const m of core) if (status[m.id]?.state !== 'done') download(m);
    notify(`Queued the core ${core.length} (~${manifest.coreTotalMB} MB) · ${CONCURRENCY} at a time.`);
  }

  if (error) return <div className="page err">Could not load the model manifest: {error}</div>;
  if (!manifest) return <div className="page empty">Loading manifest…</div>;

  const used = storage?.usage || 0;
  const quota = storage?.quota || 0;
  return (
    <div className="page">
      <h2>Asset Store · iPhone 12 capable</h2>
      <div className="card">
        <div className="row">
          <div className="grow">
            <b>Storage</b> <span className="faint">{storage?.persisted ? '· persistent' : '· best-effort (may be evicted)'}</span>
            <div className="faint">
              {fmtBytes(used)} used of {quota ? fmtBytes(quota) : 'unknown'}
            </div>
          </div>
          {!storage?.persisted && (
            <button className="btn sm" onClick={async () => notify((await requestPersistence()) ? 'Storage marked persistent.' : 'Browser declined persistence.')}>
              Persist
            </button>
          )}
        </div>
        <div className="meter" style={{ marginTop: 8 }}>
          <i style={{ width: `${quota ? Math.min(100, (used / quota) * 100) : 0}%` }} />
        </div>
        <button className="btn primary block" style={{ marginTop: 10 }} onClick={initializeCore}>
          Initialize Downloads · core 8 (~{manifest.coreTotalMB} MB)
        </button>
        <div className="faint" style={{ marginTop: 6 }}>
          bge-micro · TinyStories-1M · SmolLM2-135M (WebLLM) · whisper-tiny · BC-ResNet · MobileNetV2 · YOLOv8n · MiniLM-L6. SmolLM2 is ~270 MB of that; WebGPU {gpu?.supported ? `✓${gpu.f16 ? ' (f16)' : ' (f32)'}` : `✗ ${gpu?.reason || ''}`}.
        </div>
      </div>

      <div className="filters">
        <input className="field" type="search" placeholder={`Search ${manifest.models.length} models…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search models" />
        <label className="lbl" htmlFor="max-mb">
          Max size: {maxMB >= 6000 ? 'any' : `${maxMB} MB`} · {models.length} shown
        </label>
        <input id="max-mb" type="range" min="5" max="6000" step="5" value={maxMB} onChange={(e) => setMaxMB(+e.target.value)} />
        <div className="row">
          {Object.keys(TIER_LABEL).map((t) => (
            <button key={t} className={`badge ${t}`} style={{ minHeight: 32, opacity: tiers[t] ? 1 : 0.35, background: 'none' }} aria-pressed={tiers[t]} onClick={() => setTiers((s) => ({ ...s, [t]: !s[t] }))}>
              {TIER_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="list">
        {models.map((m) => {
          const st = status[m.id] || {};
          const pct = st.total ? Math.min(100, (st.loaded / st.total) * 100) : 0;
          return (
            <div key={m.id} className="card asset">
              <div>
                <div className="name">{m.name}</div>
                <div className="sub">
                  {m.sizeMB < 1 ? `${Math.round(m.sizeMB * 1024)} KB` : `${m.sizeMB} MB`} · {m.quant} · {m.category}
                </div>
                <div className="sub">Use for: {m.use}</div>
                <div className="faint mono">{m.local ? 'public/models/eye/' + m.file : m.repo}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className={`badge ${m.tier}`}>{TIER_LABEL[m.tier]}</span>
                {m.meta && (
                  <div>
                    <span className="badge" style={{ marginTop: 4 }}>
                      Meta
                    </span>
                  </div>
                )}
              </div>
              <div className="actions">
                {m.local ? (
                  <span className="faint">{st.state === 'done' ? '✓ trained model present' : 'No public weights: train and drop the .onnx here'}</span>
                ) : st.state === 'downloading' || st.state === 'queued' ? (
                  <>
                    <div className="meter grow">
                      <i style={{ width: `${pct}%` }} />
                    </div>
                    <span className="faint">{st.state === 'queued' ? 'queued' : m.runtime === 'webllm' ? `${Math.round(pct)}%` : `${fmtBytes(st.loaded || 0)}`}</span>
                    {m.runtime !== 'webllm' && (
                      <button className="btn sm" onClick={() => queue.cancel(m.id)}>
                        Cancel
                      </button>
                    )}
                  </>
                ) : st.state === 'done' ? (
                  <>
                    <span className="okc small grow">✓ on device{st.note ? ` · ${st.note}` : ''}</span>
                    {m.runtime !== 'webllm' && (
                      <button
                        className="btn sm danger"
                        onClick={async () => {
                          await deleteModel(m);
                          setStat(m.id, { state: null, loaded: 0, note: null });
                          setLive((st2) => ({ ...st2, models: st2.models.filter((x) => x !== m.id) }));
                          storageEstimate().then(setStorage);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </>
                ) : (
                  <button className="btn sm primary" onClick={() => download(m)}>
                    {m.runtime === 'webllm' ? 'Load in WebLLM' : 'Download'}
                  </button>
                )}
                <button
                  className="btn sm ghost"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(m.local ? m.file : m.repo);
                      notify(`Copied ${m.local ? m.file : m.repo}`);
                    } catch {
                      notify('Clipboard blocked.');
                    }
                  }}
                >
                  Copy ID
                </button>
                {st.state === 'error' && <div className="err" style={{ width: '100%' }}>{st.error}</div>}
                {st.state === 'downloading' && st.note && <div className="faint" style={{ width: '100%' }}>{st.note}</div>}
              </div>
            </div>
          );
        })}
        {models.length === 0 && <div className="empty">No models match. Raise the size slider or clear the search.</div>}
      </div>

      <h2>Meta assets</h2>
      <div className="card small">
        {manifest.metaAssets.cloud.map((c) => (
          <div key={c.name}>
            ☁ <b>{c.name}</b> <span className="faint">via {c.via}</span>
          </div>
        ))}
        <div style={{ marginTop: 6 }}>
          📱 On-device: {manifest.metaAssets.onDevice.map((id) => manifest.models.find((m) => m.id === id)?.name).join(' · ')}
        </div>
        <div className="faint" style={{ marginTop: 6 }}>
          {manifest.metaAssets.runtime.name}: {manifest.metaAssets.runtime.note}
        </div>
      </div>
      <div className="faint" style={{ marginTop: 8 }}>{manifest.note}</div>
    </div>
  );
}
