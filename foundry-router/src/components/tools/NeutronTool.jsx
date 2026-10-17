import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../AppContext.js';
import { createNeutronStar, DPR_CAP } from '../../toolbox/neutronStar.js';

export default function NeutronTool() {
  const { live, setLive } = useApp();
  const ns = live.canvas.neutronStar;
  const canvasRef = useRef(null);
  const viz = useRef(null);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    viz.current = createNeutronStar(canvasRef.current, ns);
    const t = setInterval(() => setFps(viz.current?.fps || 0), 1000);
    return () => {
      clearInterval(t);
      viz.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viz.current?.update(ns);
  }, [ns]);

  const set = (patch) => setLive((s) => ({ ...s, canvas: { ...s.canvas, neutronStar: { ...s.canvas.neutronStar, ...patch } } }));

  return (
    <div>
      <canvas ref={canvasRef} className="star" aria-label="Neutron star visualisation" />
      <div className="faint" style={{ marginTop: 6 }}>
        {fps} fps · DPR capped at {DPR_CAP} · pauses off-screen · saved in LIVE_STATE.canvas
      </div>
      <label className="lbl" htmlFor="ns-pulse">Core pulse {ns.corePulse.toFixed(2)}</label>
      <input id="ns-pulse" type="range" min="0" max="1" step="0.01" value={ns.corePulse} onChange={(e) => set({ corePulse: +e.target.value })} />
      <label className="lbl" htmlFor="ns-disk">Disk layers {ns.diskLayers}</label>
      <input id="ns-disk" type="range" min="1" max="8" step="1" value={ns.diskLayers} onChange={(e) => set({ diskLayers: +e.target.value })} />
      <label className="lbl" htmlFor="ns-stars">Stars {ns.stars}</label>
      <input id="ns-stars" type="range" min="0" max="600" step="10" value={ns.stars} onChange={(e) => set({ stars: +e.target.value })} />
    </div>
  );
}
