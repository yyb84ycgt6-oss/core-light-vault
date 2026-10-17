// ROUTER: Direct Message hub with the eYe Router, counselor attachments,
// reputation-weighted routing table and the Asset Store.
import { h, toast, haptic, fmtBytes } from './dom.js';
import { route, trace, COUNSELORS, ARCHITECTURE, footprintBytes } from '../router/router.js';
import { loadSettings, saveSettings, streamCounselor, saveMessage, loadThread, reputationTable, rateRoute, endpointFor } from '../router/chat.js';
import { ASSETS } from '../router/assets.js';
import { downloadFile, assetStatus, deleteAsset } from '../router/download-manager.js';
import { runMicro } from './toolbox-view.js';

const THREAD = 'main';

export function renderRouter(root) {
  let pinned = 'auto';
  const log = h('div.chatlog', { 'aria-live': 'polite' });
  const input = h('textarea.field', { rows: 1, placeholder: 'Message the eYe…', 'aria-label': 'Message' });
  const pills = h('div.pills');
  const tableBox = h('div.mono.small');

  const bubble = (m) =>
    h(`div.bubble.${m.role}`, {},
      m.trace ? h('div.trace', {}, m.trace) : null,
      h('div.text', {}, m.content),
      m.counselor && m.role === 'assistant'
        ? h('div.row.small', {},
            h('span.dim', {}, COUNSELORS[m.counselor]?.name || m.counselor),
            h('button.btn.xs', { onclick: async () => { renderTable(await rateRoute(m.counselor, true)); toast('+0.07'); } }, '👍'),
            h('button.btn.xs', { onclick: async () => { renderTable(await rateRoute(m.counselor, false)); toast('−0.12'); } }, '👎'),
          )
        : null,
    );

  const renderTable = (t) => {
    tableBox.textContent = Object.entries(t).map(([k, v]) => `${COUNSELORS[k].glyph} ${COUNSELORS[k].name.padEnd(12)} ${v.toFixed(2)} ${endpointFor(k) ? '● attached' : '○ offline'}`).join('\n');
  };

  const renderPills = () =>
    pills.replaceChildren(
      ...['auto', ...Object.keys(COUNSELORS)].map((id) =>
        h('button.pill', { 'aria-pressed': pinned === id, onclick: () => { pinned = id; renderPills(); } }, id === 'auto' ? 'eYe auto' : `${COUNSELORS[id].glyph} ${COUNSELORS[id].name}`),
      ),
    );

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const user = { role: 'user', content: text };
    log.append(bubble(user));
    await saveMessage(THREAD, user);
    const rep = await reputationTable();
    const r = pinned === 'auto' ? route(text, { reputation: rep }) : { scale: 'macro', counselor: pinned, rule: 'pinned', us: 1 };
    const tr = trace(r);
    if (r.scale === 'micro') {
      let out;
      try {
        out = await runMicro(r.tool, text);
      } catch (e) {
        out = `eYe Core: ${e.message}`;
      }
      const m = { role: 'assistant', content: out, trace: tr, counselor: null };
      log.append(bubble(m));
      saveMessage(THREAD, m);
      return;
    }
    const m = { role: 'assistant', content: '', trace: tr, counselor: r.counselor };
    const el = bubble(m);
    const textEl = el.querySelector('.text');
    textEl.append(h('span.dots', {}, h('i'), h('i'), h('i')));
    log.append(el);
    haptic(10);
    try {
      const history = (await loadThread(THREAD)).slice(-12).map(({ role, content }) => ({ role, content }));
      for await (const t of streamCounselor(r.counselor, history)) {
        m.content += t;
        textEl.textContent = m.content;
      }
    } catch (e) {
      m.content =
        e.code === 'NOT_ATTACHED'
          ? `${COUNSELORS[r.counselor].name} is not attached, so nothing answered. Your message is kept in meadow_chats. Attach a runner URL or key below to wake ${COUNSELORS[r.counselor].name}.`
          : `${e.message}. The eYe kept your message; nothing was lost.`;
      textEl.textContent = m.content;
    }
    saveMessage(THREAD, m);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });

  const s = loadSettings();
  const field = (key, label, type = 'text') =>
    h('label.lbl', {}, label, h('input.field.sensitive', { type, value: s[key] || '', autocomplete: 'off', spellcheck: false, oninput: (e) => { s[key] = e.target.value.trim(); saveSettings(s); } }));

  const assetsBox = h('div.list');
  const renderAssets = async () => {
    assetsBox.replaceChildren(
      ...(await Promise.all(
        ASSETS.map(async (a) => {
          const st = await assetStatus(a);
          const bar = h('div.meter', {}, h('i', { style: { width: `${st.total ? Math.min(100, (100 * st.loaded) / st.total) : st.complete ? 100 : 0}%` } }));
          const note = h('div.small.dim', {}, a.runtime || '');
          const actions = h('div.row');
          if (a.status === 'included') actions.append(h('span.ok', {}, '✓ Already included'));
          else if (a.status === 'companion') actions.append(h('span.amber', {}, 'Hosted by the companion runner'));
          else if (st.complete)
            actions.append(
              h('span.ok', {}, '✓ On device'),
              h('button.btn.sm', { onclick: () => toast(a.runtime) }, 'Run'),
              h('button.btn.sm', { onclick: async () => { await deleteAsset(a); renderAssets(); } }, '→ Infinity'),
            );
          else
            actions.append(
              h('button.btn.sm.primary', {
                onclick: async (ev) => {
                  ev.target.disabled = true;
                  ev.target.textContent = st.loaded ? 'Resuming…' : 'Downloading…';
                  try {
                    for (const f of a.files) {
                      await downloadFile(a.id, f, {
                        onProgress: ({ loaded, total }) => {
                          bar.firstChild.style.width = `${total ? (100 * loaded) / total : 0}%`;
                          ev.target.textContent = `${fmtBytes(loaded)} / ${fmtBytes(total)}`;
                        },
                      });
                    }
                    toast(`${a.name} stored offline`);
                  } catch (e) {
                    toast(`Paused: ${e.message}. Tap again to resume.`);
                  }
                  renderAssets();
                },
              }, st.loaded ? `Resume (${fmtBytes(st.loaded)})` : 'Download'),
            );
          return h('div.item.rough', {},
            h('div.row', {}, h('b.grow', {}, a.name), h('span.mono.small', {}, `RAM ${a.ram} · ${a.disk}`)),
            h('div.small', {}, a.use),
            a.files ? bar : null,
            actions,
            note,
          );
        }),
      )),
    );
  };

  root.append(
    h('section.page', {},
      h('h2', {}, 'eYe Router · direct message'),
      h('div.mono.small.dim', {}, ARCHITECTURE.join('  →  '), `  ·  rule table ${footprintBytes()} B`),
      pills,
      log,
      h('div.composer', {}, input, h('button.btn.primary', { onclick: send, 'aria-label': 'Send' }, '↑')),
      h('h2', {}, 'Routing table (reputation)'),
      tableBox,
      h('details.rough', {},
        h('summary', {}, 'Attach counselors'),
        h('p.dim.small', {}, 'Stored only on this device. Jackie and Local Llama use the companion runner (OpenAI-compatible, e.g. llama.cpp on the iPhone); Grok and DeepSeek need your own keys and a network.'),
        field('runnerUrl', 'Runner / Ollama URL for Jackie + Local Llama (e.g. http://localhost:8080/v1)'),
        field('xaiKey', 'xAI key (Grok)', 'password'),
        field('deepseekKey', 'DeepSeek key', 'password'),
        h('button.btn.sm', { onclick: async () => renderTable(await reputationTable()) }, 'Refresh table'),
      ),
      h('h2', {}, 'Asset Store · iPhone 12 (A14, 4 GB)'),
      h('p.dim.small', {}, 'Ranged 8 MiB chunks into IndexedDB: interrupted downloads resume. Safari tabs get about 1.5 GB, so the 3B model lives in the companion runner.'),
      assetsBox,
    ),
  );
  renderPills();
  reputationTable().then(renderTable);
  loadThread(THREAD).then((msgs) => log.replaceChildren(...msgs.map(bubble)));
  renderAssets();
}
