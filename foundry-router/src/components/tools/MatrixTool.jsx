import { useMemo, useState } from 'react';
import { useApp } from '../../AppContext.js';
import { scoreDomains, crossLinks, domainById, TECH_DOMAINS, ESOTERIC_DOMAINS } from '../../toolbox/knowledgeMatrix.js';

function Cell({ d, s, onPick, selected }) {
  const a = s?.score || 0;
  return (
    <button
      className="cell"
      onClick={() => onPick(d.id)}
      style={{
        background: `rgba(${d.ring === 'tech' ? '92,200,255' : '155,140,255'},${(0.06 + a * 0.5).toFixed(2)})`,
        borderColor: selected ? 'var(--accent)' : undefined,
        textAlign: 'left',
      }}
    >
      <div style={{ fontSize: 16 }}>{d.glyph}</div>
      <div>{d.name}</div>
      <div className="faint">{a ? a.toFixed(2) : '·'}</div>
    </button>
  );
}

export default function MatrixTool() {
  const { live, setLive } = useApp();
  const [text, setText] = useState(() => live.chat.map((m) => m.content).join('\n'));
  const scores = useMemo(() => scoreDomains(text), [text]);
  const by = new Map(scores.map((s) => [s.id, s]));
  const links = crossLinks(scores);
  const sel = domainById(live.jacky.selectedDomain);
  const pick = (id) => setLive((s) => ({ ...s, jacky: { ...s.jacky, selectedDomain: id } }));
  return (
    <div>
      <textarea className="field" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to map (defaults to this conversation)" aria-label="Text to map" />
      <h2>12 technical</h2>
      <div className="heat">
        {TECH_DOMAINS.map((d) => (
          <Cell key={d.id} d={{ ...d, ring: 'tech' }} s={by.get(d.id)} onPick={pick} selected={sel?.id === d.id} />
        ))}
      </div>
      <h2>12 esoteric</h2>
      <div className="heat">
        {ESOTERIC_DOMAINS.map((d) => (
          <Cell key={d.id} d={{ ...d, ring: 'esoteric' }} s={by.get(d.id)} onPick={pick} selected={sel?.id === d.id} />
        ))}
      </div>
      <h2>Cross-links</h2>
      <div className="card">
        {links.length ? (
          links.map((l) => (
            <div key={l.tech}>
              {domainById(l.tech).name} ⟷ {domainById(l.esoteric).name} <span className="faint">({l.strength.toFixed(2)})</span>
            </div>
          ))
        ) : (
          <div className="faint">No mirror pair is active in this text yet.</div>
        )}
      </div>
      {sel && (
        <div className="card">
          <b>
            {sel.glyph} {sel.name}
          </b>{' '}
          <span className="faint">· mirror: {domainById(sel.mirror)?.name}</span>
          <div className="faint">Lexicon: {sel.kw.join(', ')}</div>
          <div className="faint">Jacky now answers through this lens (Router tab).</div>
        </div>
      )}
    </div>
  );
}
