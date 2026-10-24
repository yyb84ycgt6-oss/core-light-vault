import { useState } from 'react';
import { useApp } from '../../AppContext.js';
import { PRESETS, describeGates } from '../../toolbox/batteryLab.js';
import { EYE, HANDSHAKE_TEXT } from '../../eYe.js';

export default function BatteryTool() {
  const { system, telemetry, sim, setSim, gates, eye, kws, startListening, stopListening, triggerHandshake } = useApp();
  const [preset, setPreset] = useState(sim ? 'custom' : 'live');
  const d = describeGates(system, {});
  const setField = (patch) => {
    setPreset('custom');
    setSim((s) => ({ battery: system.battery ?? 80, thermal: system.thermal ?? 45, charging: false, ...s, ...patch }));
  };

  return (
    <div>
      <div className={`banner ${gates.forceOffline ? 'sovereign' : 'info'}`}>
        <b>eYe:</b> {gates.handshake ? 'Conscious Handshake showing.' : d.summary}
      </div>
      <div className="row">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className="btn sm"
            aria-pressed={preset === p.id}
            style={preset === p.id ? { borderColor: 'var(--accent)' } : undefined}
            onClick={() => {
              setPreset(p.id);
              setSim(p.system);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label className="lbl" htmlFor="sim-bat">Battery {system.battery ?? '—'}%{system.simulated ? ' (simulated)' : ''}</label>
      <input id="sim-bat" type="range" min="1" max="100" value={system.battery ?? 80} onChange={(e) => setField({ battery: +e.target.value })} />
      <label className="lbl" htmlFor="sim-th">Thermal {system.thermal ?? '—'}°C{system.simulated ? ' (simulated)' : ''}</label>
      <input id="sim-th" type="range" min="25" max="95" value={system.thermal ?? 45} onChange={(e) => setField({ thermal: +e.target.value })} />
      <div className="row">
        <button className="btn sm" onClick={() => setField({ charging: !system.charging })}>
          {system.charging ? '⚡ charging' : 'on battery'}
        </button>
        <button
          className="btn sm"
          onClick={() => {
            setField({ battery: 14, charging: false });
            triggerHandshake();
          }}
        >
          Trigger handshake (14%, still)
        </button>
      </div>

      <h2>Live sensors</h2>
      <dl className="kv card">
        <dt>battery</dt>
        <dd>{telemetry.battery != null ? `${telemetry.battery}% · ${telemetry.sourceBattery}` : 'no Battery API (iOS Safari, Firefox)'}</dd>
        <dt>thermal</dt>
        <dd>{telemetry.thermal != null ? `${telemetry.pressure} → ~${telemetry.thermal}°C · ${telemetry.sourceThermal}` : 'no Compute Pressure API'}</dd>
        <dt>RAM</dt>
        <dd>{telemetry.ram != null ? `${telemetry.ram} GB (deviceMemory)` : 'not exposed'}</dd>
        <dt>cores</dt>
        <dd>{telemetry.cores ?? '—'}</dd>
        <dt>gates</dt>
        <dd>
          battery &lt; {EYE.gates.batteryPct}% or thermal &gt; {EYE.gates.thermalC}°C → WebLLM only; handshake after {EYE.stillnessMs / 1000}s stillness
        </dd>
      </dl>

      <h2>eYe micro-orchestrator</h2>
      <div className="card">
        {eye ? (
          <dl className="kv">
            <dt>weights W</dt>
            <dd>
              {eye.sizeKB} KB · {eye.weightsSource === 'onnx' ? 'trained BC-ResNet ONNX' : 'seeded placeholder (no trained "Hey Jackie" model shipped)'}
            </dd>
            <dt>resident</dt>
            <dd>{eye.residentKB} KB (weights + 1 s int16 ring + mel tile + FFT)</dd>
            <dt>digest</dt>
            <dd>{eye.weightsDigest.slice(0, 32)}…</dd>
            <dt>power</dt>
            <dd>{EYE.designPower_mW} mW is a hardware design target; a browser cannot measure it</dd>
          </dl>
        ) : (
          <div className="faint">Loading W…</div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          {kws.mode === 'off' ? (
            <button className="btn primary" onClick={startListening}>
              🎙 Listen for "Hey Jackie"
            </button>
          ) : (
            <button className="btn" onClick={stopListening}>
              Stop listening
            </button>
          )}
          <span className="faint">
            {kws.mode}
            {kws.detail ? ` · ${kws.detail}` : ''}
          </span>
        </div>
        {kws.mode !== 'off' && kws.mode !== 'web-speech' && (
          <div className="meter" style={{ marginTop: 8 }} aria-label="mic level">
            <i style={{ width: `${Math.min(100, kws.level * 400)}%` }} />
          </div>
        )}
      </div>
      <h2>Handshake text</h2>
      <div className="card faint">{HANDSHAKE_TEXT}</div>
    </div>
  );
}
