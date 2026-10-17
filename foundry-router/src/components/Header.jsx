import { useApp } from '../AppContext.js';

export default function Header() {
  const { system, eye, kws, gates } = useApp();
  const simulated = (field) => system.simulatedFields?.includes(field);
  const b = system.battery;
  const t = system.thermal;
  return (
    <header className="header">
      <div className="brand">
        <h1>Foundry Router v1</h1>
        <span className="meta">Meta Assets</span>
        {gates.forceOffline && <span className="meta" style={{ color: 'var(--accent-2)' }}>· sovereign</span>}
      </div>
      <div className="chips" role="status" aria-label="Device status">
        <span className={`chip ${b == null ? '' : b < 15 ? 'bad' : b < 30 ? 'warn' : 'ok'} ${simulated('battery') ? 'sim' : ''}`} title={system.sourceBattery || 'no Battery API'}>
          🔋 {b == null ? '—' : `${b}%`}
          {system.charging ? '⚡' : ''}
        </span>
        <span className={`chip ${simulated('ram') ? 'sim' : ''}`} title="navigator.deviceMemory (Chrome only, capped at 8)">
          RAM {system.ram == null ? '—' : `${system.ram}GB`}
        </span>
        <span className={`chip ${t == null ? '' : t > 70 ? 'bad' : t > 60 ? 'warn' : 'ok'} ${simulated('thermal') ? 'sim' : ''}`} title={system.sourceThermal || 'no thermal API on this device'}>
          🌡 {t == null ? '—' : `${t}°C`}
        </span>
        <span className={`chip ${system.online === false ? 'warn' : 'ok'}`}>{system.online === false ? 'offline' : 'online'}</span>
        <span className={`chip ${kws.mode !== 'off' ? 'ok' : ''}`} title="eYe micro-orchestrator (Toolbox → Battery Lab)">
          👁 eYe {eye ? `${eye.residentKB}KB` : '…'} L2{kws.mode !== 'off' ? ' · listening' : ''}
        </span>
      </div>
    </header>
  );
}
