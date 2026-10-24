import { lazy, Suspense, useState } from 'react';
import { TOOLS } from '../toolbox/index.js';

const VIEWS = {
  scam: lazy(() => import('./tools/ScamTool.jsx')),
  code: lazy(() => import('./tools/CodeTool.jsx')),
  matrix: lazy(() => import('./tools/MatrixTool.jsx')),
  pods: lazy(() => import('./tools/PodTool.jsx')),
  files: lazy(() => import('./tools/FilesTool.jsx')),
  neutron: lazy(() => import('./tools/NeutronTool.jsx')),
  prism: lazy(() => import('./tools/PrismTool.jsx')),
  collapse: lazy(() => import('./tools/CollapseTool.jsx')),
  battery: lazy(() => import('./tools/BatteryTool.jsx')),
  log: lazy(() => import('./tools/LogTool.jsx')),
};

export default function ToolboxTab() {
  const [open, setOpen] = useState(null);
  const tool = TOOLS.find((t) => t.id === open);
  if (tool) {
    const View = VIEWS[tool.id];
    return (
      <div className="page">
        <div className="toolhead">
          <button className="btn sm" onClick={() => setOpen(null)} aria-label="Back to toolbox">
            ‹ Tools
          </button>
          <h3>
            {tool.icon} {tool.name}
          </h3>
        </div>
        <Suspense fallback={<div className="empty">Loading…</div>}>
          <View />
        </Suspense>
      </div>
    );
  }
  return (
    <div className="page">
      <h2>Toolbox</h2>
      <div className="grid3">
        {TOOLS.map((t) => (
          <button key={t.id} className="tile" onClick={() => setOpen(t.id)}>
            <div>
              <div className="ico" aria-hidden="true">{t.icon}</div>
              <div className="name">{t.name}</div>
              <div className="blurb">{t.blurb}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
