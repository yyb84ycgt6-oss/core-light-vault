import { useState } from 'react';
import { analyzeScam, SCAM_SAMPLE } from '../../toolbox/scamDetector.js';

export default function ScamTool() {
  const [text, setText] = useState('');
  const [res, setRes] = useState(null);
  const color = res ? (res.level === 'high' ? 'var(--bad)' : res.level === 'medium' ? 'var(--warn)' : 'var(--ok)') : 'var(--muted)';
  return (
    <div>
      <textarea className="field" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a message, SMS or email…" aria-label="Message to analyze" />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={() => setRes(analyzeScam(text))} disabled={!text.trim()}>
          Analyze
        </button>
        <button
          className="btn"
          onClick={() => {
            setText(SCAM_SAMPLE);
            setRes(analyzeScam(SCAM_SAMPLE));
          }}
        >
          Sample
        </button>
      </div>
      {res && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row">
            <div className="grow">
              <div style={{ fontSize: 28, fontWeight: 800, color }}>{Math.round(res.risk * 100)}%</div>
              <div className="faint">risk · {res.level} · noisy-OR of {res.matches.length} pattern(s)</div>
            </div>
          </div>
          <div className="meter" style={{ marginTop: 8 }}>
            <i style={{ width: `${res.risk * 100}%`, background: color }} />
          </div>
          <div className="list" style={{ marginTop: 10 }}>
            {res.matches.map((m) => (
              <div key={m.id} className="item">
                <div className="row">
                  <b className="grow">{m.label}</b>
                  <span className="badge">w {m.weight.toFixed(2)}</span>
                </div>
                <div className="faint mono">{m.evidence.map((e) => `“${e}”`).join('  ')}</div>
              </div>
            ))}
            {!res.matches.length && <div className="faint">No red flags matched. Stay alert anyway: novel scams won't match fixed patterns.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
