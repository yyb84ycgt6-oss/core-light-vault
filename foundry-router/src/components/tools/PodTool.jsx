import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../AppContext.js';
import { mountAll, releasePod, deletePod, compareStreamBurst, lockDateFromDays, POD_LIMIT_BYTES } from '../../toolbox/podManager.js';
import { fmtBytes } from '../../toolbox/yAxisLab.js';
import { appendLog } from '../../toolbox/transparencyLog.js';
import { haptic } from '../../lib/haptics.js';

export default function PodTool() {
  const { sealPod, setLive, notify } = useApp();
  const [pods, setPods] = useState(null);
  const [title, setTitle] = useState('');
  const [days, setDays] = useState(0);
  const [busy, setBusy] = useState('');
  const [cmp, setCmp] = useState({});

  const refresh = useCallback(async () => setPods(await mountAll()), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (label, fn) => {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      notify(`${label} failed: ${err.code || ''} ${err.message}`);
    } finally {
      setBusy('');
    }
  };

  return (
    <div>
      <div className="card">
        <b>Seal current session</b>
        <div className="faint">AES-GCM-256 (non-extractable device key), gzip, 16 KiB records → OPFS /pods/vol-*.pod. Limit {fmtBytes(POD_LIMIT_BYTES)}.</div>
        <label className="lbl" htmlFor="pod-title">Title</label>
        <input id="pod-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="optional" />
        <label className="lbl" htmlFor="pod-lock">Future-lock: {days ? `${days} day(s)` : 'none'}</label>
        <input id="pod-lock" type="range" min="0" max="30" value={days} onChange={(e) => setDays(+e.target.value)} />
        <button
          className="btn primary block"
          disabled={!!busy}
          onClick={() =>
            run('Seal', async () => {
              const pod = await sealPod({ title, futureLock: lockDateFromDays(days) });
              haptic(20);
              notify(`Sealed ${pod.path} · ${fmtBytes(pod.bytes)} · ${pod.ratio.toFixed(1)}:1`);
              setTitle('');
              await refresh();
            })
          }
        >
          {busy === 'Seal' ? 'Sealing…' : 'Create pod'}
        </button>
      </div>

      <h2>/pods/ (mounted, payload untouched)</h2>
      {pods === null && <div className="faint">Mounting…</div>}
      {pods?.length === 0 && <div className="empty">No pods yet.</div>}
      <div className="list">
        {pods?.map((p) => (
          <div key={p.name} className="item">
            <div className="row">
              <b className="grow mono">{p.path}</b>
              <span className={`badge ${p.error ? 'red' : p.locked ? 'yellow' : 'green'}`}>{p.error ? p.error : p.locked ? '🔒 future-locked' : '● sealed'}</span>
            </div>
            {!p.error && (
              <>
                <div className="faint">
                  {p.title || 'untitled'} · {new Date(p.createdAt).toLocaleString()} · {fmtBytes(p.bytes)} on disk · {fmtBytes(p.plainBytes)} plain ·{' '}
                  {(p.plainBytes / Math.max(1, p.compressedBytes)).toFixed(1)}:1 · {p.chat} msgs
                  {p.futureLock ? ` · unlocks ${new Date(p.futureLock).toLocaleDateString()}` : ''}
                </div>
                {p.files.length > 0 && (
                  <div className="mono small" style={{ marginTop: 4 }}>
                    {p.files.map((f) => (
                      <div key={`${f.folder}/${f.name}`}>
                        {f.dotSaved ? '  ' : '● '}/{f.folder ? `${f.folder}/` : ''}
                        {f.name} <span className="faint">{fmtBytes(f.size)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {cmp[p.name] && (
                  <div className="small" style={{ marginTop: 6 }}>
                    Stream M(t) peak <b className="okc">{fmtBytes(cmp[p.name].stream.peakWorkingBytes)}</b> vs burst <b className="warnc">{fmtBytes(cmp[p.name].burst.peakWorkingBytes)}</b> (
                    {cmp[p.name].ratio.toFixed(1)}× less) for {fmtBytes(cmp[p.name].plainBytes)}
                  </div>
                )}
              </>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn sm"
                disabled={!!busy || p.locked || !!p.error}
                onClick={() =>
                  run('Release', async () => {
                    if (!confirm('Release this pod? It replaces the current session (chat, files, canvas).')) return;
                    const { state, report } = await releasePod(p.name);
                    setLive(state);
                    appendLog({ type: 'release', detail: `${p.path} streamed, peak ${report.peakWorkingBytes} B` });
                    notify(`Released ${p.path} in ${report.ms.toFixed(0)} ms.`);
                  })
                }
              >
                Release
              </button>
              <button
                className="btn sm"
                disabled={!!busy || p.locked || !!p.error}
                onClick={() =>
                  run('Compare', async () => {
                    const r = await compareStreamBurst(p.name);
                    setCmp((c) => ({ ...c, [p.name]: r }));
                  })
                }
              >
                Stream vs burst
              </button>
              <button
                className="btn sm danger"
                disabled={!!busy}
                onClick={() =>
                  run('Delete', async () => {
                    if (!confirm(`Delete ${p.path}? This cannot be undone.`)) return;
                    await deletePod(p.name);
                    setLive((s) => ({ ...s, pods: s.pods.filter((x) => `${x.id}.pod` !== p.name) }));
                    await refresh();
                  })
                }
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
