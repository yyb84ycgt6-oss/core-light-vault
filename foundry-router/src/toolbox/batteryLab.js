// Battery Lab: drive the eYe gates with real telemetry or simulated values
// (iOS Safari exposes no battery/thermal API, so simulation is how you test the
// Conscious Handshake on an iPhone). Simulated values are always labelled.
import { evaluateGates, EYE } from '../eYe.js';

export const PRESETS = [
  { id: 'live', label: 'Live sensors', system: null },
  { id: 'healthy', label: 'Healthy 80% · 42°C', system: { battery: 80, thermal: 42, charging: false } },
  { id: 'low', label: 'Low 14% · 55°C', system: { battery: 14, thermal: 55, charging: false } },
  { id: 'hot', label: 'Hot 62% · 74°C', system: { battery: 62, thermal: 74, charging: false } },
  { id: 'spec', label: 'Spec 14% · 68°C · 4 GB', system: { battery: 14, thermal: 68, ram: 4, charging: false } },
];

/** Merge live telemetry with an optional simulation overlay. */
export function effectiveSystem(live, sim) {
  if (!sim) return { ...live, simulated: false, simulatedFields: [] };
  return { ...live, ...sim, simulated: true, simulatedFields: Object.keys(sim) };
}

/** Human summary of what the eYe will do right now. */
export function describeGates(system, ctx) {
  const g = evaluateGates(system, ctx);
  if (g.handshake) return { ...g, summary: 'Conscious Handshake: asking to pod the session.' };
  if (g.waitingForStillness) return { ...g, summary: `Low battery: waiting for ${EYE.stillnessMs / 1000}s of stillness before asking.` };
  if (g.forceOffline) return { ...g, summary: `Sovereign mode: ${g.reasons.join(', ')} → WebLLM offline only.` };
  return { ...g, summary: 'All clear: cloud chain active.' };
}
