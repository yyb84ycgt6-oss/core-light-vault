// Device telemetry for the status chips and eYe gates. Every source is
// feature-detected; nothing is invented. iOS Safari exposes none of the battery,
// memory or pressure APIs, so on iPhone the chips stay "—" until you set values
// in the Battery Lab (labelled as simulated).

const PRESSURE_TO_C = { nominal: 45, fair: 60, serious: 72, critical: 85 };

export function staticInfo() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  return {
    ram: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    cores: nav.hardwareConcurrency || null,
    online: nav.onLine !== false,
    dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  };
}

/**
 * Start watching battery, compute pressure and connectivity.
 * @param {(patch: object) => void} onUpdate receives partial telemetry
 * @returns {() => void} stop
 */
export function startSystemMonitor(onUpdate) {
  const stops = [];
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  onUpdate({ ...staticInfo(), sources: { battery: 'none', thermal: 'none', ram: staticInfo().ram ? 'deviceMemory' : 'none' } });

  if (nav?.getBattery) {
    nav.getBattery().then((b) => {
      const push = () => onUpdate({ battery: Math.round(b.level * 100), charging: b.charging, sourceBattery: 'Battery API' });
      push();
      b.addEventListener('levelchange', push);
      b.addEventListener('chargingchange', push);
      stops.push(() => {
        b.removeEventListener('levelchange', push);
        b.removeEventListener('chargingchange', push);
      });
    }).catch(() => {});
  }

  if (typeof globalThis.PressureObserver === 'function') {
    try {
      const obs = new globalThis.PressureObserver((records) => {
        const state = records.at(-1)?.state;
        if (state) onUpdate({ thermal: PRESSURE_TO_C[state] ?? null, pressure: state, sourceThermal: 'Compute Pressure (est.)' });
      });
      obs.observe('cpu', { sampleInterval: 2000 }).catch(() => {});
      stops.push(() => obs.disconnect());
    } catch {
      /* unsupported */
    }
  }

  if (typeof window !== 'undefined') {
    const on = () => onUpdate({ online: true });
    const off = () => onUpdate({ online: false });
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    stops.push(() => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    });
  }
  return () => stops.forEach((s) => s());
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage.estimate();
    return { usage: e.usage || 0, quota: e.quota || 0, persisted: (await navigator.storage.persisted?.()) || false };
  } catch {
    return { usage: 0, quota: 0, persisted: false };
  }
}

export async function requestPersistence() {
  try {
    return (await navigator.storage.persist?.()) || false;
  } catch {
    return false;
  }
}
