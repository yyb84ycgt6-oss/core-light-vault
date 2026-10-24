// SYMBOL: the workbench. Inventory chips (with usage), MY CORE (3-4 picks,
// mirror lines drawn automatically), a 280x280 finger canvas, a meaning built
// from core chips, Test on the lattice, Seal Z3 ... EZ into the Tiny Archive.
import { h, toast, haptic, sheet } from './dom.js';
import { INVENTORY, MINIMAL, SKELETONS, loadRegistry, saveRegistry, useGlyph, listSymbols } from '../symbol/registry.js';
import { mirror, isEquilibrium, reduce, mirrorSeq, show } from '../symbol/mirror-law.js';
import { sealSymbol, sampleTargets } from '../symbol/workbench.js';
import { drawLattice, world } from './lattice-view.js';

export function renderSymbol(root) {
  let reg = null;
  let strokes = [];
  let meaning = [];
  const coreBox = h('div.core-drop.rough');
  const invBox = h('div.inv');
  const meaningBox = h('div.seq.mono');
  const mirrorBox = h('div.mono.dim');
  const nameIn = h('input.field', { placeholder: 'Name or type the glyph (e.g. ~0~)', 'aria-label': 'Symbol name' });
  const pad = h('canvas.pad.rough', { width: 280, height: 280, 'aria-label': 'Draw a new glyph' });
  const pctx = pad.getContext('2d');
  const savedBox = h('div.list');

  const paint = () => {
    pctx.fillStyle = '#05070d';
    pctx.fillRect(0, 0, 280, 280);
    pctx.strokeStyle = '#00ff88';
    pctx.lineWidth = 5;
    pctx.lineCap = pctx.lineJoin = 'round';
    pctx.shadowColor = '#00ff88';
    pctx.shadowBlur = 8;
    for (const s of strokes) {
      pctx.beginPath();
      s.forEach(([x, y], i) => (i ? pctx.lineTo(x * 280, y * 280) : pctx.moveTo(x * 280, y * 280)));
      pctx.stroke();
    }
    pctx.shadowBlur = 0;
  };
  const pt = (e) => {
    const r = pad.getBoundingClientRect();
    const t = e.touches?.[0] || e;
    return [Math.max(0, Math.min(1, (t.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (t.clientY - r.top) / r.height))];
  };
  let drawing = false;
  pad.addEventListener('pointerdown', (e) => {
    drawing = true;
    pad.setPointerCapture(e.pointerId);
    strokes.push([pt(e)]);
  });
  pad.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    strokes.at(-1).push(pt(e));
    paint();
  });
  pad.addEventListener('pointerup', () => (drawing = false));
  pad.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  const renderCore = () => {
    coreBox.replaceChildren(
      h('div.dim.small', {}, `MY CORE (${reg.core.length}/4) · tap to add to meaning · long-press to remove`),
      h('div.chips', {}, reg.core.map((g) =>
        h('button.chip.core', {
          onclick: () => {
            meaning.push(g);
            useGlyph(reg, g);
            saveRegistry(reg);
            haptic(8);
            renderMeaning();
          },
          oncontextmenu: (e) => {
            e.preventDefault();
            reg.core = reg.core.filter((x) => x !== g);
            saveRegistry(reg);
            renderCore();
          },
        }, g),
      )),
      h('div.mono.dim.small', {}, reg.core.map((g) => `${g}  ⟷  ${mirror(g)}${isEquilibrium(g) ? '  (equilibrium)' : ''}`).join('\n')),
    );
  };
  const renderInv = () => {
    invBox.replaceChildren(
      ...Object.entries(INVENTORY).map(([group, glyphs]) =>
        h('div', {},
          h('div.dim.small', {}, group),
          h('div.chips', {}, glyphs.map((g) =>
            h('button.chip', {
              'aria-pressed': reg.core.includes(g),
              onclick: () => {
                if (reg.core.includes(g)) reg.core = reg.core.filter((x) => x !== g);
                else if (reg.core.length < 4) reg.core.push(g);
                else return toast('Core holds 3-4 symbols. Remove one first.');
                saveRegistry(reg);
                renderInv();
                renderCore();
              },
            }, g, h('sup', {}, reg.usage[g] || '')),
          )),
        ),
      ),
    );
  };
  const renderMeaning = () => {
    const reduced = reduce(meaning);
    meaningBox.replaceChildren(meaning.length ? meaning.join(' ') : 'tap your core chips to compose a meaning');
    mirrorBox.textContent = meaning.length ? `mirror: ${mirrorSeq(meaning).join(' ')} · reduces to ${show(reduced)}` : '';
  };
  const refreshSaved = async () => {
    const syms = await listSymbols();
    savedBox.replaceChildren(...syms.map((s) => h('div.item.rough', {}, h('b.mono', {}, s.name), ' ', h('span.mono.dim', {}, s.sealed))));
  };

  const testCanvas = h('canvas.lattice.small');
  let testView = null;
  const test = () => {
    const c2 = document.createElement('canvas');
    c2.width = c2.height = 280;
    const x = c2.getContext('2d');
    x.fillStyle = '#fff';
    x.strokeStyle = '#fff';
    x.lineWidth = 10;
    x.lineCap = 'round';
    if (strokes.length) {
      for (const s of strokes) {
        x.beginPath();
        s.forEach(([px, py], i) => (i ? x.lineTo(px * 280, py * 280) : x.moveTo(px * 280, py * 280)));
        x.stroke();
      }
    } else {
      x.font = 'bold 64px ui-monospace, Menlo, monospace';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText((nameIn.value || meaning.join('') || '}0{').slice(0, 7), 140, 140);
    }
    world.formation = sampleTargets(x, 280, 280, 141);
    testView?.destroy();
    testView = drawLattice(testCanvas);
    haptic(12);
    setTimeout(() => (world.formation = null), 6000);
  };

  const seal = async () => {
    try {
      const name = nameIn.value.trim() || (strokes.length ? `glyph-${Date.now().toString(36)}` : '');
      const res = await sealSymbol({ name, strokes, sequence: meaning, meaning: meaning.join(' ') });
      haptic(20);
      sheet('Sealed', h('div.mono', {}, res.sym.sealed), h('div.dim', {}, `Compressed through the {} boundary into a ${res.bytes}-character atomic string. Stored in the Tiny Archive, where it will decay like everything else unless you use it.`), h('div.longstring.sensitive', {}, res.string.slice(0, 400) + '…'));
      strokes = [];
      meaning = [];
      nameIn.value = '';
      paint();
      renderMeaning();
      refreshSaved();
    } catch (e) {
      toast(e.message);
    }
  };

  root.append(
    h('section.page', {},
      h('h2', {}, 'Symbol Workbench · v0.1'),
      h('p.dim', {}, 'Personal, not engineered. Pick 3-4 core symbols from your own inventory. Minimal set that builds everything: ', h('span.mono', {}, MINIMAL.join('  ')), '.'),
      coreBox,
      h('details.rough', {}, h('summary', {}, 'Inventory'), invBox),
      h('h2', {}, 'Draw'),
      h('div.center', {}, pad),
      h('div.row', {}, h('button.btn.sm', { onclick: () => { strokes = []; paint(); } }, 'Clear'), h('button.btn.sm', { onclick: () => { strokes.pop(); paint(); } }, 'Undo')),
      nameIn,
      h('h2', {}, 'Meaning'),
      meaningBox,
      mirrorBox,
      h('div.row', {}, h('button.btn.sm', { onclick: () => { meaning.pop(); renderMeaning(); } }, '⌫'), h('button.btn.sm', { onclick: () => { meaning = [...meaning, ...mirrorSeq(meaning)]; renderMeaning(); } }, 'Append mirror (→ 0)')),
      h('div.row', {}, h('button.btn', { onclick: test }, 'Test on lattice'), h('button.btn.primary', { onclick: seal }, 'Seal Z3 … EZ')),
      testCanvas,
      h('h2', {}, 'Skeletons'),
      h('div.list', {}, SKELETONS.map((s) => h('div.item.rough.mono', {}, `${s.glyph}  ${s.of ? `← ${s.of} · ` : ''}${s.meaning}`))),
      h('h2', {}, 'Your sealed symbols'),
      savedBox,
    ),
  );
  paint();
  loadRegistry().then((r) => {
    reg = r;
    renderCore();
    renderInv();
    renderMeaning();
    refreshSaved();
  });
  return () => testView?.destroy();
}
