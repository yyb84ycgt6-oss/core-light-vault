import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppContext } from './AppContext.js';
import Header from './components/Header.jsx';
import RouterTab from './components/RouterTab.jsx';
import ToolboxTab from './components/ToolboxTab.jsx';
import Handshake from './components/Handshake.jsx';
import { defaultLiveState, sealPodProduction } from './longString.js';
import { startSystemMonitor } from './lib/system.js';
import { loadMicroOrchestrator, eyeDescriptor, evaluateGates, KeywordSpotter } from './eYe.js';
import { effectiveSystem } from './toolbox/batteryLab.js';
import { readAutosave, writeAutosave } from './lib/autosave.js';
import { appendLog } from './toolbox/transparencyLog.js';
import { haptic } from './lib/haptics.js';
import { CHIPS, DEFAULT_CHAIN } from './router.js';

const AssetStoreTab = lazy(() => import('./components/AssetStoreTab.jsx'));
const LongStringSheet = lazy(() => import('./components/LongStringSheet.jsx'));

const TABS = [
  { id: 'router', label: 'Router', ico: '⟁' },
  { id: 'toolbox', label: 'Toolbox', ico: '▦' },
  { id: 'assets', label: 'Asset Store', ico: '⬢' },
];

const readLS = (k, d) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const writeLS = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

export default function App() {
  const [tab, setTabState] = useState(() => readLS('foundry.tab', 'router'));
  const [live, setLive] = useState(defaultLiveState);
  const [restored, setRestored] = useState(false);
  const [telemetry, setTelemetry] = useState({});
  const [sim, setSim] = useState(null);
  const [eyeWeights, setEyeWeights] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [dismissedUntil, setDismissedUntil] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [routerInfo, setRouterInfo] = useState(() => ({ chipId: readLS('foundry.chip', 'llama-1b-groq'), lastBadge: null }));
  const [kws, setKws] = useState({ mode: 'off', level: 0, detail: '' });
  const lastActivity = useRef(Date.now());
  const spotter = useRef(null);
  const toastTimer = useRef(0);

  const setTab = useCallback((t) => {
    setTabState(t);
    writeLS('foundry.tab', t);
  }, []);

  const notify = useCallback((msg, ms = 3200) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  const logEvent = useCallback((e) => {
    if (e.type === 'progress') return;
    appendLog({ type: e.type, provider: e.provider, model: e.model || e.to || null, detail: e.reason || e.badge || e.detail || (e.delayMs ? `retry in ${e.delayMs} ms (HTTP ${e.status})` : null) });
  }, []);

  // Restore the encrypted local autosave, if any.
  useEffect(() => {
    readAutosave()
      .then((s) => s && setLive(s))
      .finally(() => setRestored(true));
  }, []);

  // Autosave (debounced) once the initial restore finished.
  useEffect(() => {
    if (!restored) return undefined;
    const t = setTimeout(() => writeAutosave(live).catch(() => {}), 800);
    return () => clearTimeout(t);
  }, [live, restored]);

  useEffect(() => startSystemMonitor((patch) => setTelemetry((t) => ({ ...t, ...patch }))), []);
  useEffect(() => {
    loadMicroOrchestrator().then(setEyeWeights).catch(() => {});
  }, []);

  // Stillness tracking for the Conscious Handshake.
  useEffect(() => {
    const mark = () => {
      lastActivity.current = Date.now();
    };
    const opts = { passive: true };
    for (const ev of ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart']) window.addEventListener(ev, mark, opts);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      for (const ev of ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart']) window.removeEventListener(ev, mark, opts);
      clearInterval(t);
    };
  }, []);

  const system = useMemo(() => effectiveSystem(telemetry, sim), [telemetry, sim]);
  const gates = evaluateGates(system, { now, lastActivity: lastActivity.current, dismissedUntil });
  const eye = useMemo(() => (eyeWeights ? eyeDescriptor(eyeWeights) : null), [eyeWeights]);

  /** LIVE_STATE with the current device readings folded in (what gets saved). */
  const snapshot = useCallback(
    () => ({ ...live, system: { battery: system.battery ?? null, ram: system.ram ?? null, thermal: system.thermal ?? null } }),
    [live, system.battery, system.ram, system.thermal],
  );

  const routerSnapshot = useCallback(() => {
    const chip = CHIPS.find((c) => c.id === routerInfo.chipId);
    return { chain: DEFAULT_CHAIN, chip: chip ? { id: chip.id, provider: chip.provider, model: chip.model } : null, lastBadge: routerInfo.lastBadge, backoff: '500ms*2^n' };
  }, [routerInfo]);

  const sealPod = useCallback(
    async (opts = {}) => {
      const pod = await sealPodProduction(snapshot(), opts);
      setLive((s) => ({ ...s, pods: [...s.pods, { id: pod.id, sealed: true, ratio: +pod.ratio.toFixed(2), createdAt: Date.now(), futureLock: opts.futureLock ?? null }] }));
      appendLog({ type: 'seal', detail: `${pod.path} ${pod.bytes} B via ${pod.backend}` });
      return pod;
    },
    [snapshot],
  );

  const acceptHandshake = useCallback(async () => {
    try {
      const pod = await sealPod({ title: 'Conscious Handshake' });
      haptic(20);
      notify(`Sealed ${pod.path}. I'll hold the key until you return.`);
    } catch (err) {
      notify(`Pod failed: ${err.message}`);
    }
    setDismissedUntil(Date.now() + 30 * 60_000);
  }, [sealPod, notify]);

  const startListening = useCallback(async () => {
    if (spotter.current) return;
    const s = new KeywordSpotter({
      onStatus: ({ mode, detail }) => setKws((k) => ({ ...k, mode, detail })),
      onLevel: (level) => setKws((k) => ({ ...k, level })),
      onWake: ({ source }) => {
        haptic(20);
        setTab('router');
        notify('Hey Jackie - listening. Ask away.');
        appendLog({ type: 'wake', detail: source });
        window.dispatchEvent(new CustomEvent('foundry:focus-composer'));
      },
    });
    spotter.current = s;
    try {
      await s.start();
    } catch (err) {
      spotter.current = null;
      setKws({ mode: 'off', level: 0, detail: String(err.message || err) });
      notify(`eYe could not listen: ${err.message}`);
    }
  }, [notify, setTab]);

  const stopListening = useCallback(() => {
    spotter.current?.stop();
    spotter.current = null;
    setKws({ mode: 'off', level: 0, detail: '' });
  }, []);

  useEffect(() => () => spotter.current?.stop(), []);

  const ctx = {
    live,
    setLive,
    system,
    telemetry,
    sim,
    setSim,
    gates,
    eye,
    eyeWeights,
    notify,
    logEvent,
    snapshot,
    routerInfo,
    setRouterInfo: (fn) =>
      setRouterInfo((r) => {
        const next = typeof fn === 'function' ? fn(r) : fn;
        writeLS('foundry.chip', next.chipId);
        return next;
      }),
    routerSnapshot,
    sealPod,
    kws,
    startListening,
    stopListening,
    setTab,
    openSaver: () => setSheetOpen(true),
    triggerHandshake: () => {
      lastActivity.current = 0;
      setDismissedUntil(0);
      setNow(Date.now());
    },
  };

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <Header />
        <main className="main" id="main">
          {tab === 'router' && <RouterTab />}
          {tab === 'toolbox' && <ToolboxTab />}
          {tab === 'assets' && (
            <Suspense fallback={<div className="page empty">Loading Asset Store…</div>}>
              <AssetStoreTab />
            </Suspense>
          )}
        </main>
        <nav className="nav" aria-label="Primary">
          {TABS.slice(0, 2).map((t) => (
            <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              <span className="ico" aria-hidden="true">{t.ico}</span>
              {t.label}
            </button>
          ))}
          <button className="save" aria-label="Save to Long String" onClick={() => setSheetOpen(true)}>
            ∞
          </button>
          <button aria-current={tab === 'assets' ? 'page' : undefined} onClick={() => setTab('assets')}>
            <span className="ico" aria-hidden="true">{TABS[2].ico}</span>
            {TABS[2].label}
          </button>
        </nav>
      </div>
      {gates.handshake && !sheetOpen && <Handshake onYes={acceptHandshake} onLater={() => setDismissedUntil(Date.now() + 10 * 60_000)} />}
      {sheetOpen && (
        <Suspense fallback={null}>
          <LongStringSheet onClose={() => setSheetOpen(false)} />
        </Suspense>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </AppContext.Provider>
  );
}
