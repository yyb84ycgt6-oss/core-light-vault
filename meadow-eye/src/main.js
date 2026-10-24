// MEADOW EYE OS v0.1.0 Alpha shell.
import { h, $, toast, haptic, copy } from './ui/dom.js';
import { app } from './ui/app.js';
import { renderForge } from './ui/forge-view.js';
import { renderLattice } from './ui/lattice-view.js';
import { renderSymbol } from './ui/symbol-view.js';
import { renderRouter } from './ui/router-view.js';
import { renderArchive } from './ui/archive-view.js';
import { renderToolbox, storePod } from './ui/toolbox-view.js';
import { renderEthics } from './ui/ethics-view.js';
import { manifestDataUri, iconDataUri } from './pwa/manifest.js';
import { registerServiceWorker } from './pwa/sw.js';
import { HANDSHAKE_TEXT, LEARNED_TEXT, evaluate, decline, acceptLearned, loadConsent, saveConsent, watchBattery } from './pwa/battery.js';
import { forgeAtomic } from './core/protocol.js';
import { all } from './pwa/storage.js';

const TABS = [
  ['forge', 'FORGE', '⟁', renderForge],
  ['lattice', 'LATTICE', '•8•', renderLattice],
  ['symbol', 'SYMBOL', 'Z3', renderSymbol],
  ['router', 'ROUTER', '}0{', renderRouter],
  ['archive', 'ARCHIVE', '∞', renderArchive],
  ['toolbox', 'TOOLBOX', '▦', renderToolbox],
  ['ethics', 'ETHICS', '◌', renderEthics],
];

let current = null;
let cleanup = null;
const main = h('main.view', { id: 'view' });

function setTab(id) {
  if (current === id) return;
  cleanup?.();
  cleanup = null;
  current = id;
  try {
    localStorage.setItem('meadow:tab', id);
  } catch {
    /* private mode */
  }
  main.replaceChildren();
  main.scrollTop = 0;
  const tab = TABS.find((t) => t[0] === id) || TABS[0];
  cleanup = tab[3](main) || null;
  main.append(footer());
  document.querySelectorAll('nav.tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === id ? 'page' : 'false'));
}

/** Session pod: chats + symbols + archive essence, one atomic string. */
async function podSession() {
  const snapshot = {};
  for (const s of ['meadow_chats', 'meadow_symbols', 'meadow_archive']) snapshot[s] = (await all(s)).map(([k, v]) => [k, v]);
  const text = JSON.stringify(snapshot);
  const { string, pod } = await forgeAtomic(text, { kind: 'session', ai: 'eYe Core', collapseText: snapshot.meadow_chats.map(([, m]) => m.content).join(' ') });
  await storePod(string, { kind: 'session', records: pod.records });
  haptic(20);
  copy(string, `Session podded: ${pod.records} record(s) ~ string copied`);
  return string;
}

// ---- Battery handshake with learned consent ---------------------------------
let consent = null;
async function handshake(level, charging) {
  consent = consent || (await loadConsent());
  const { action, state } = evaluate(level, charging, consent);
  consent = state;
  await saveConsent(consent);
  if (action === 'none') return;
  if (action === 'auto-pod') {
    await podSession();
    return toast('Battery at 5%: auto-podded, as you asked. The key waits with me.');
  }
  const learned = action === 'offer-learned';
  const triage = action === 'triage' || learned;
  const close = () => glow.remove();
  const glow = h('div.handshake', { role: 'alertdialog', 'aria-label': 'Battery handshake' },
    h('p', {}, learned ? LEARNED_TEXT : HANDSHAKE_TEXT),
    h('div.mono.dim.small', {}, `${level}%${triage ? ' · emergency triage' : ''}`),
    learned
      ? h('div.row', {},
          h('button.btn.primary', { onclick: async () => { consent = acceptLearned(consent); await saveConsent(consent); await podSession(); close(); } }, 'Yes, always at 5%'),
          h('button.btn', { onclick: async () => { consent = decline(consent, { triage: true }); await saveConsent(consent); close(); } }, 'No, keep asking'),
        )
      : h('div.row', {},
          h('button.btn.primary', { onclick: async () => { await podSession(); close(); } }, 'Yes, pod it'),
          h('button.btn', { onclick: async () => { consent = decline(consent, { triage }); await saveConsent(consent); close(); toast('Honoured. I will not insist.'); } }, "No, I'll manage"),
        ),
  );
  $('.handshake')?.remove();
  document.body.append(glow);
}

Object.assign(app, { setTab, handshake, podSession });

// ---- Shell ------------------------------------------------------------------
const footer = () =>
  h('footer.foot-inline.page', {},
    h('p.quote', {}, 'When the battery falls, the eYe rests. But the knowledge never sleeps—it waits, compressed, for the moment you return.'),
    h('p.dim.small.mono', {}, 'Jessy Eru Collin + DeepSeek · July 2026 · Protocol v0.1.0 Alpha'),
  );

function badges() {
  const online = h('span.badge', {}, navigator.onLine ? 'ONLINE' : 'OFFLINE');
  const sync = () => {
    online.textContent = navigator.onLine ? 'ONLINE' : 'OFFLINE';
    online.classList.toggle('lit', !navigator.onLine);
  };
  addEventListener('online', sync);
  addEventListener('offline', sync);
  sync();
  return h('div.badges', {}, h('span.badge.lit', {}, 'VOLATILE'), h('span.badge.lit', {}, 'ATOMIC'), h('span.badge.lit', {}, 'SOVEREIGN'), online, h('span.badge', {}, '141'), h('span.badge', {}, '0.15'));
}

function mount() {
  document.head.append(
    h('link', { rel: 'manifest', href: manifestDataUri(location.href.split('#')[0]) }),
    h('link', { rel: 'icon', href: iconDataUri() }),
    h('link', { rel: 'apple-touch-icon', href: iconDataUri() }),
  );
  const nav = h('nav.tabs', { 'aria-label': 'Meadow' },
    TABS.map(([id, label, glyph]) => h('button', { 'data-tab': id, onclick: () => setTab(id) }, h('span.g', {}, glyph), h('span.l', {}, label))),
  );
  nav.querySelectorAll('button').forEach((b, i) => (b.dataset.tab = TABS[i][0]));
  document.body.append(
    h('header.top', {}, h('div.title', {}, h('b', {}, 'MEADOW EYE OS'), h('span.ver', {}, 'v0.1.0 α')), badges()),
    main,
    nav,
    h('div.veil', { 'aria-hidden': 'true' }, h('span', {}, '}0{')),
  );
  let initial = 'forge';
  try {
    initial = localStorage.getItem('meadow:tab') || 'forge';
  } catch {
    /* private mode */
  }
  setTab(initial);
}

// ---- Privacy: veil on hide, no callout / copy / paste on sensitive fields ----
function privacy() {
  const veil = () => document.body.classList.toggle('veiled', document.hidden);
  document.addEventListener('visibilitychange', veil);
  addEventListener('pagehide', () => document.body.classList.add('veiled'));
  addEventListener('pageshow', () => document.body.classList.remove('veiled'));
  addEventListener('blur', () => document.body.classList.add('veiled'));
  addEventListener('focus', () => document.body.classList.remove('veiled'));
  // Displayed secrets can't be selected or copied by gesture; only an explicit Copy button
  // takes them out. Paste stays allowed: Recall needs it.
  for (const ev of ['copy', 'cut']) {
    document.addEventListener(ev, (e) => {
      const node = document.getSelection()?.anchorNode;
      const el = node?.nodeType === 1 ? node : node?.parentElement;
      if (el?.closest?.('.longstring, .out')) e.preventDefault();
    });
  }
  document.addEventListener('touchmove', (e) => {
    if (e.target.closest?.('canvas')) e.preventDefault();
  }, { passive: false });
}

privacy();
mount();
registerServiceWorker();
watchBattery(({ level, charging }) => handshake(level, charging)).catch(() => {});
