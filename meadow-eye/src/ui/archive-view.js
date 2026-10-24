// ARCHIVE: the Living Archive. Opacity = decay. Tap to query/visit (+0.07).
// Below 0.3 an entry composts; "→ Infinity" dissolves it back, keeping only
// its essence. Nothing deletes. It composts.
import { h, sheet, haptic } from './dom.js';
import { seedArchive, listArchive, access, decayDay, returnToInfinity, query, state, COMPOST_AT } from '../archive/living-archive.js';

export function renderArchive(root) {
  const list = h('div.archive');
  const q = h('input.field', { type: 'search', placeholder: 'Query the meadow by meaning…', 'aria-label': 'Query archive' });
  const hits = h('div.dim.mono.small');

  const vecBars = (vec) =>
    h('div.vecbars', {}, vec.map((v) => h('i', { style: { height: `${Math.abs(v) / 2.6 + 2}px`, background: v >= 0 ? '#00ff88' : '#8b5cf6' } })));

  const open = async (e) => {
    const fresh = await access(e.id);
    haptic(8);
    sheet(fresh.name,
      h('div.mono.big', {}, fresh.name),
      h('p', {}, fresh.text || ''),
      h('div.dim', {}, `decay ${fresh.decay.toFixed(3)} · visits ${fresh.accessCount} · versions ${fresh.versions.length} · ${state(fresh)}`),
      h('div.dim.small', {}, '32-d Int8 semantic vector'),
      vecBars(fresh.vec),
    );
    refresh();
  };

  const card = (e) => {
    const el = h('button.leaf.rough', {
      style: { opacity: e.infinity ? 0.12 : Math.max(0.15, e.decay) },
      onclick: () => !e.infinity && open(e),
      'aria-label': `${e.name}, decay ${e.decay.toFixed(2)}`,
    },
      h('span.mono.glyph', {}, e.name),
      h('span.small.dim', {}, e.infinity ? '∞ returned' : `${e.decay.toFixed(2)} · ${state(e)}`),
    );
    if (!e.infinity && e.decay < COMPOST_AT) {
      el.append(
        h('span.inf', {
          role: 'button',
          onclick: async (ev) => {
            ev.stopPropagation();
            el.classList.add('dissolve');
            haptic(20);
            setTimeout(async () => {
              await returnToInfinity(e.id);
              refresh();
            }, 900);
          },
        }, '→ Infinity'),
      );
    }
    return el;
  };

  const refresh = async () => list.replaceChildren(...(await listArchive()).map(card));

  q.addEventListener('input', async () => {
    if (!q.value.trim()) return (hits.textContent = '');
    const r = await query(q.value, 5);
    hits.textContent = r.map((x) => `${x.e.name} ${x.score.toFixed(2)}`).join('   ');
  });

  root.append(
    h('section.page', {},
      h('h2', {}, 'Living Archive'),
      h('p.quote', {}, 'Nothing deletes. It composts.'),
      q,
      hits,
      h('div.row', {},
        h('button.btn.sm', { onclick: async () => { await decayDay(1); refresh(); } }, 'A day passes (×0.99)'),
        h('button.btn.sm', { onclick: async () => { await decayDay(30); refresh(); } }, 'A month passes'),
      ),
      list,
      h('p.dim.small', {}, 'Brute-force cosine over Int8 vectors (no vector DB). Visiting adds +0.07. Below 0.3 a pod composts; returning it to infinity keeps only its essence: name and meaning vector.'),
    ),
  );
  seedArchive().then(refresh);
}
