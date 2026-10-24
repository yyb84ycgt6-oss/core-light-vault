import { useApp } from '../../AppContext.js';
import { ringOrder, sectorPath, labelPoint, visibleInMode } from '../../toolbox/prismRing.js';
import { domainById } from '../../toolbox/knowledgeMatrix.js';
import { haptic } from '../../lib/haptics.js';

const RING = ringOrder();

export default function PrismTool() {
  const { live, setLive } = useApp();
  const { selectedDomain, ringMode } = live.jacky;
  const sel = domainById(selectedDomain);
  const setJacky = (patch) => setLive((s) => ({ ...s, jacky: { ...s.jacky, ...patch } }));

  return (
    <div>
      <div className="seg" role="group" aria-label="Ring mode">
        {['tech', 'esoteric', 'all'].map((m) => (
          <button key={m} aria-pressed={ringMode === m} onClick={() => setJacky({ ringMode: m })}>
            {m}
          </button>
        ))}
      </div>
      <div className="ring" style={{ marginTop: 10 }}>
        <svg viewBox="-160 -160 320 320" role="listbox" aria-label="Prism ring, 24 domains">
          <defs>
            <radialGradient id="prism-core">
              <stop offset="0" stopColor="#e8f6ff" />
              <stop offset="0.5" stopColor="#5cc8ff" stopOpacity="0.5" />
              <stop offset="1" stopColor="#5cc8ff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle r="62" fill="url(#prism-core)" />
          {RING.map((d, i) => {
            const on = visibleInMode(d, ringMode);
            const active = d.id === selectedDomain;
            const mirror = sel && d.id === sel.mirror;
            const hue = d.ring === 'tech' ? 200 + i * 4 : 255 + (i - 12) * 4;
            const lp = labelPoint(i, 129);
            return (
              <g key={d.id} role="option" aria-selected={active} aria-label={d.name}>
                <path
                  d={sectorPath(i, 104, 152)}
                  fill={`hsla(${hue},85%,${active ? 62 : 45}%,${on ? (active ? 0.95 : 0.55) : 0.12})`}
                  stroke={active || mirror ? '#fff' : 'rgba(255,255,255,0.12)'}
                  strokeWidth={active ? 2 : mirror ? 1.2 : 0.6}
                  strokeDasharray={mirror && !active ? '3 3' : undefined}
                  onClick={() => {
                    if (!on) return;
                    haptic(10);
                    setJacky({ selectedDomain: active ? null : d.id });
                  }}
                />
                <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="central" fontSize="14" fill={on ? '#fff' : 'rgba(255,255,255,0.25)'} pointerEvents="none">
                  {d.glyph}
                </text>
              </g>
            );
          })}
          <text y="-6" textAnchor="middle" fontSize="13" fill="#e8ebff" fontWeight="700">
            {sel ? sel.name : 'Jacky'}
          </text>
          <text y="12" textAnchor="middle" fontSize="10" fill="#9aa1c7">
            {sel ? `mirror: ${domainById(sel.mirror)?.name}` : 'tap a segment'}
          </text>
        </svg>
      </div>
      {sel && (
        <div className="card">
          <b>
            {sel.glyph} {sel.name}
          </b>{' '}
          <span className="faint">({sel.ring})</span>
          <div className="faint">Jacky's router persona now uses this lens. The mirror ({domainById(sel.mirror)?.name}) is outlined.</div>
        </div>
      )}
    </div>
  );
}
