// FORGE: "You never save a file again. You recall the conversation that birthed it."
// Say what you need; the eYe routes it and spawns an ephemeral app for this
// moment. Pod the moment (the intent that birthed the app) into an atomic
// string; recall the string later and the same app is re-forged.
import { h, toast, haptic, copy } from './dom.js';
import { route, trace, COUNSELORS } from '../core/eye.js';
import { forgeAtomic, recallAtomic } from '../core/protocol.js';
import { toolBody, storePod } from './toolbox-view.js';
import { TOOLS } from '../router/toolbox.js';
import { streamCounselor } from '../router/chat.js';
import { all } from '../pwa/storage.js';
import { app } from './app.js';

function strip(intent) {
  return intent.replace(/^\s*(please\s+)?(make|forge|build|give me|i need)?\s*(an?\s+)?(app\s+(to|that)\s+)?/i, '').trim();
}

async function counselApp(r, intent) {
  const o = h('div.out', {}, h('span.dots', {}, h('i'), h('i'), h('i')));
  (async () => {
    let text = '';
    try {
      for await (const t of streamCounselor(r.counselor, [{ role: 'user', content: intent }])) {
        text += t;
        o.textContent = text;
      }
    } catch (e) {
      o.textContent =
        e.code === 'NOT_ATTACHED'
          ? `${COUNSELORS[r.counselor].name} isn't attached, so this macro intent has no voice yet. The moment is still yours to pod; attach a counselor in ROUTER.`
          : e.message;
    }
  })();
  return [h('div.dim.small', {}, `${COUNSELORS[r.counselor].glyph} ${COUNSELORS[r.counselor].name}`), o];
}

export function renderForge(root) {
  const intent = h('textarea.field.sensitive', { rows: 3, placeholder: 'Tell the eYe what you need right now… e.g. "make a qr for my meadow", "compress this note", "hash this", "why does stillness matter?"', 'aria-label': 'Intent' });
  const stage = h('div.stage');
  const recallIn = h('textarea.field.sensitive', { rows: 2, placeholder: 'Paste an atomic string _{…}_ to recall the moment that birthed an app', 'aria-label': 'Recall' });
  const podsBox = h('div.list');

  async function spawn(text, { recalled = false } = {}) {
    const r = route(text);
    const tool = r.scale === 'micro' ? TOOLS.find((t) => t.id === r.tool) : null;
    const seed = strip(text).replace(/^(compress|hash|morse|qr|collapse|encrypt|seal)\b[:\s]*(this|it)?\s*/i, '');
    let body;
    if (r.tool === 'workbench' || r.tool === 'symbol') {
      app.setTab('symbol');
      return;
    }
    if (r.tool === 'lattice') {
      app.setTab('lattice');
      return;
    }
    if (tool) body = (await toolBody(tool.id === 'decompress' ? 'decompress' : tool.id, seed)) || [h('div', {}, `Tool ${tool.name}`)];
    else if (r.tool === 'archive') {
      app.setTab('archive');
      return;
    } else body = await counselApp(r, text);
    const card = h('article.app.rough.spawn', {},
      h('div.trace', {}, `${recalled ? 'recalled · ' : ''}${trace(r)}`),
      h('div.app-head', {}, h('b', {}, tool ? `${tool.glyph}  ${tool.name}` : 'Counsel'), h('span.dim.small', {}, ` · ephemeral · born ${new Date().toLocaleTimeString()}`)),
      ...body,
      h('div.row', {},
        h('button.btn.primary', {
          onclick: async () => {
            const { string, pod } = await forgeAtomic(JSON.stringify({ intent: text, at: Date.now() }), { kind: 'forge', ai: tool ? 'eYe Core' : COUNSELORS[r.counselor].name, collapseText: text });
            await storePod(string, { kind: 'forge', intent: text.slice(0, 80), records: pod.records });
            haptic(20);
            copy(string, 'Moment podded ~ string copied');
            refreshPods();
          },
        }, 'Pod this moment ~'),
        h('button.btn', {
          onclick: () => {
            card.classList.add('dissolve');
            haptic(12);
            setTimeout(() => card.remove(), 900);
          },
        }, '→ Infinity'),
      ),
    );
    stage.prepend(card);
    haptic(10);
  }

  async function recall(string) {
    try {
      const r = await recallAtomic(string);
      if (r.kind !== 'forge') return toast(`That pod holds ${r.kind}; open it in TOOLBOX → Decompress.`);
      const { intent: txt } = JSON.parse(r.text);
      intent.value = txt;
      await spawn(txt, { recalled: true });
      toast('Reconstructed with zero loss. The app is re-forged.');
    } catch (e) {
      toast(e.message);
    }
  }

  async function refreshPods() {
    const pods = (await all('meadow_pods')).filter(([, p]) => p.kind === 'forge').slice(-6).reverse();
    podsBox.replaceChildren(
      ...pods.map(([id, p]) =>
        h('div.item.rough.row', {}, h('span.grow.small', {}, p.intent || id), h('button.btn.sm', { onclick: () => recall(p.string) }, 'Recall')),
      ),
    );
  }

  root.append(
    h('section.page', {},
      h('p.quote', {}, 'You never save a file again. You recall the conversation that birthed it.'),
      intent,
      h('div.row', {}, h('button.btn.primary.grow', { onclick: () => intent.value.trim() && spawn(intent.value.trim()) }, 'Forge ⟁'), h('button.btn', { onclick: () => app.podSession() }, 'Pod session')),
      stage,
      h('h2', {}, 'Recall'),
      recallIn,
      h('button.btn', { onclick: () => recallIn.value.trim() && recall(recallIn.value.trim()) }, 'Reverse handshake · bdpq'),
      h('h2', {}, 'Moments you podded'),
      podsBox,
      h('p.dim.small', {}, 'Capability as instinct, not software as product: apps exist for one person at one moment, then return to infinity.'),
    ),
  );
  refreshPods();
}
