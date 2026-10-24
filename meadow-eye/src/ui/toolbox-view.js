// TOOLBOX: 13 micro apps, each a working modal. Also runMicro(), which the
// eYe Router uses to answer micro intents in chat without any model.
import { h, sheet, toast, haptic, copy } from './dom.js';
import { TOOLS, OPS, composeTool, toMorse, fromMorse, isMorse, morsePattern } from '../router/toolbox.js';
import { forgeAtomic, recallAtomic } from '../core/protocol.js';
import { yCollapse, semanticSimHash, tokenize, embedWord } from '../core/y-collapse.js';
import { encodeQR, drawQR } from '../router/qr.js';
import { visualize } from '../router/code-visualizer.js';
import { put, get, all } from '../pwa/storage.js';
import { query } from '../archive/living-archive.js';
import { app } from './app.js';

const enc = new TextEncoder();
const area = (ph, v = '') => h('textarea.field.sensitive', { rows: 4, placeholder: ph, value: v });
const out = () => h('div.out.mono.sensitive');

async function hashes(text) {
  const res = {};
  for (const alg of ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']) res[alg] = Array.from(new Uint8Array(await crypto.subtle.digest(alg, enc.encode(text))), (b) => b.toString(16).padStart(2, '0')).join('');
  res.simhash = BigInt(`0b${semanticSimHash(tokenize(text).map(embedWord)) || '0'}`).toString(16).padStart(16, '0');
  return res;
}

export async function storePod(string, meta) {
  const id = `pod:${Date.now().toString(36)}`;
  await put('meadow_pods', id, { string, ...meta, at: Date.now() });
  return id;
}

/** Micro intent -> answer text (used by chat). Visual tools open their modal. */
export async function runMicro(tool, text) {
  const body = text.replace(/^\s*(please\s+)?(compress|decompress|recall|collapse|encrypt|seal|hash|morse|qr)\b[:\s]*/i, '').trim() || text;
  switch (tool) {
    case 'compress': {
      const { string, pod } = await forgeAtomic(body, { ai: 'eYe Router' });
      await storePod(string, { kind: 'chat', records: pod.records });
      return `Podded into ${pod.records} record(s), ${string.length} chars. Atomic string kept in meadow_pods (FORGE lists it).`;
    }
    case 'decompress': {
      const m = body.match(/_\{[\s\S]*\}_/);
      if (!m) return 'Paste an atomic string _{…}_ after "recall" and I will reconstruct it.';
      return (await recallAtomic(m[0])).text ?? '(binary data)';
    }
    case 'collapse': {
      const r = yCollapse(body);
      return `${r.words} words → ${r.fingerprintBytes} B (${r.ratio.toFixed(1)}:1), retention ${r.retention.toFixed(2)}, ${r.us} µs\n${r.glyphs.slice(0, 160)}…`;
    }
    case 'sbx1':
      return OPS['['].run(body);
    case 'hash': {
      const x = await hashes(body);
      return `SHA-256 ${x['SHA-256']}\nsimhash ${x.simhash}`;
    }
    case 'morse':
      return isMorse(body) ? fromMorse(body) : toMorse(body);
    case 'archive': {
      const r = await query(body, 3);
      return r.length ? r.map((x) => `${x.e.name} (${x.score.toFixed(2)})`).join('\n') : 'The meadow holds nothing near that yet.';
    }
    case 'battery':
      app.setTab('toolbox');
      openTool('battery');
      return 'Opened the Battery Handshake.';
    case 'workbench':
    case 'symbol':
      app.setTab('symbol');
      return 'Opened the Symbol Workbench.';
    case 'lattice':
      app.setTab('lattice');
      return 'Opened the Lattice.';
    default:
      openTool(tool, body);
      return `Opened ${TOOLS.find((t) => t.id === tool)?.name || tool}.`;
  }
}

function ring(canvas, hex) {
  const ctx = canvas.getContext('2d');
  const S = 280;
  canvas.width = canvas.height = S;
  ctx.fillStyle = '#080a12';
  ctx.fillRect(0, 0, S, S);
  const bits = [...hex].flatMap((c) => parseInt(c, 16).toString(2).padStart(4, '0').split('').map(Number));
  bits.forEach((b, i) => {
    const a = (i / bits.length) * Math.PI * 2 - Math.PI / 2;
    const nib = parseInt(hex[i >> 2], 16);
    const r0 = 70 + (i % 4) * 12;
    ctx.strokeStyle = b ? `hsl(${150 + nib * 8},90%,${45 + (i % 4) * 8}%)` : 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(140 + Math.cos(a) * r0, 140 + Math.sin(a) * r0);
    ctx.lineTo(140 + Math.cos(a) * (r0 + 9), 140 + Math.sin(a) * (r0 + 9));
    ctx.stroke();
  });
  ctx.fillStyle = '#a8ff8a';
  ctx.font = '22px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('}0{', 140, 148);
}

const TOOL_UI = {
  compress(seed = '') {
    const t = area('Data to pod (text, code, intent)…', seed);
    const ctx = h('input.field.sensitive', { placeholder: 'Context / sigil (optional, part of the key)' });
    const o = out();
    return [t, ctx, h('button.btn.primary', {
      onclick: async () => {
        const { string, pod } = await forgeAtomic(t.value, { context: ctx.value, ai: 'eYe Core' });
        await storePod(string, { kind: 'text', records: pod.records, context: !!ctx.value });
        haptic(20);
        o.replaceChildren(h('div.dim', {}, `${pod.plainBytes} B → gzip ${pod.gzipBytes} B → ${pod.records} SBX1 record(s) → ${string.length} chars`), h('div.longstring', {}, string), h('button.btn.sm', { onclick: () => copy(string, 'Atomic string copied ~') }, 'Copy'));
      },
    }, 'Collapse → pod ~'), o];
  },
  decompress(seed = '') {
    const t = area('Paste _{…}_ atomic string', seed);
    const ctx = h('input.field.sensitive', { placeholder: 'Context / sigil used when sealing' });
    const mode = h('select.field', {}, h('option', { value: 'streamed' }, 'Streamed (low memory)'), h('option', { value: 'burst' }, 'Burst (full RAM)'));
    const o = out();
    return [t, ctx, mode, h('button.btn.primary', {
      onclick: async () => {
        try {
          const r = await recallAtomic(t.value, { context: ctx.value, mode: mode.value });
          haptic(20);
          o.replaceChildren(h('div.dim', {}, `Reconstructed with zero loss · ${r.kind} · from ${r.ai} · peak ${r.peak} B (${mode.value})`), h('pre', {}, r.text ?? '(binary)'));
        } catch (e) {
          o.replaceChildren(h('div.err', {}, e.message));
        }
      },
    }, 'Reverse handshake · bdpq'), o];
  },
  collapse(seed = '') {
    const t = area('Up to 1000 words…', seed);
    const o = out();
    return [t, h('button.btn.primary', {
      onclick: () => {
        const r = yCollapse(t.value);
        o.replaceChildren(h('div.dim', {}, `${r.words} words · ${r.inputBytes} B → ${r.fingerprintBytes} B (${r.ratio.toFixed(1)}:1) · k=${r.k} · geometry retention ${r.retention.toFixed(3)} · ${r.us} µs`), h('div.longstring', {}, r.glyphs));
      },
    }, 'Collapse the X axis'), o];
  },
  seal(seed = '') {
    const t = area('Anything to seal…', seed);
    const c = h('canvas.qr');
    const o = out();
    return [t, h('button.btn.primary', {
      onclick: async () => {
        const x = await hashes(t.value);
        ring(c, x['SHA-256']);
        o.textContent = x['SHA-256'];
      },
    }, 'Draw sovereign ring'), c, o];
  },
  sbx1(seed = '') {
    const t = area('Plaintext, or a sealed SBX1 base64 blob', seed);
    const o = out();
    const run = (sym) => async () => {
      try {
        o.textContent = await OPS[sym].run(t.value);
      } catch (e) {
        o.textContent = e.message;
      }
    };
    return [t, h('div.row', {}, h('button.btn.primary', { onclick: run('[') }, 'Seal ['), h('button.btn', { onclick: run(']') }, 'Open ]')), h('div.dim.small', {}, 'XChaCha20-Poly1305 · 80-byte preamble as AD · size padded to a power-of-two bucket · key from the sovereign root.'), o];
  },
  qr(seed = '') {
    const t = area('Text or URL (up to ~200 bytes)', seed);
    const c = h('canvas.qr');
    const o = h('div.dim.small');
    let last = null;
    return [t, h('div.row', {},
      h('button.btn.primary', {
        onclick: () => {
          try {
            last = encodeQR(t.value || ' ', { ecl: 'M' });
            drawQR(c, last, 280);
            o.textContent = `QR version ${last.version} · ${last.size}×${last.size} · ECC M · mask ${last.mask}`;
          } catch (e) {
            o.textContent = e.message;
          }
        },
      }, 'Forge'),
      h('button.btn', { onclick: () => last && c.toBlob((b) => { const a = h('a', { href: URL.createObjectURL(b), download: 'meadow-qr.png' }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }) }, 'Download PNG'),
    ), c, o];
  },
  code(seed = '') {
    const t = h('textarea.field.code', { rows: 10, placeholder: 'Paste JavaScript, place the cursor where you are looking, tap Visualize', value: seed, spellcheck: false });
    const o = out();
    return [t, h('button.btn.primary', {
      onclick: () => {
        const v = visualize(t.value, t.selectionStart || 0);
        if (!v.ok) return o.replaceChildren(h('div.err', {}, v.error));
        o.replaceChildren(
          h('div', {}, h('b', {}, `view: ${v.view}`), h('span.dim', {}, ` · ${v.folds} irrelevant region(s) closed`)),
          h('div.dim', {}, v.path.map((p) => `${p.type}${p.name ? `(${p.name})` : ''}@${p.line}`).join(' › ')),
          h('pre', {}, v.folded),
        );
      },
    }, 'Visualize at cursor'), o];
  },
  battery() {
    const lvl = h('input', { type: 'range', min: 1, max: 100, value: 14, 'aria-label': 'Battery level' });
    const lab = h('div.mono', {}, '14%');
    lvl.oninput = () => (lab.textContent = `${lvl.value}%`);
    return [h('p.dim', {}, 'iOS Safari gives web pages no battery level, so test the handshake here. Your answers train the learned-consent memory.'), lab, lvl, h('button.btn.primary', { onclick: () => app.handshake(+lvl.value, false) }, 'Feel this battery level')];
  },
  hash(seed = '') {
    const t = area('Text to hash', seed);
    const o = out();
    return [t, h('button.btn.primary', { onclick: async () => { const x = await hashes(t.value); o.textContent = Object.entries(x).map(([k, v]) => `${k.padEnd(8)} ${v}`).join('\n'); } }, 'Forge hashes'), o];
  },
  morse(seed = '') {
    const t = area('Text or morse (. - / )', seed);
    const o = out();
    const flash = h('div.flash');
    return [t, h('div.row', {},
      h('button.btn.primary', { onclick: () => (o.textContent = isMorse(t.value) ? fromMorse(t.value) : toMorse(t.value)) }, 'Translate ~'),
      h('button.btn', {
        onclick: async () => {
          const m = isMorse(t.value) ? t.value : toMorse(t.value);
          const pat = morsePattern(m);
          try {
            navigator.vibrate?.(pat);
          } catch {
            /* none */
          }
          for (let i = 0; i < pat.length; i += 2) {
            flash.classList.toggle('on', pat[i] > 0);
            await new Promise((r) => setTimeout(r, pat[i]));
            flash.classList.remove('on');
            await new Promise((r) => setTimeout(r, pat[i + 1]));
          }
        },
      }, 'Play (light + vibrate)'),
    ), flash, o];
  },
  async add() {
    const name = h('input.field', { placeholder: 'Tool name' });
    const seqBox = h('div.seq.mono', {}, '');
    const seq = [];
    const o = out();
    const list = h('div.list');
    const renderList = async () => {
      const tools = (await get('meadow_core', 'custom-tools')) || [];
      list.replaceChildren(...tools.map((tl) => h('div.item.rough', {}, h('b', {}, tl.name), ' ', h('span.mono', {}, tl.sequence.join(' ')), h('span.dim.small', {}, `  mirror: ${composeTool(tl.name, tl.sequence).mirror.join(' ')}`))));
    };
    renderList();
    const input = area('Input text for a test run');
    return [
      h('p.dim', {}, 'A new tool is a sequence of symbols. Each symbol is an operation; its mirror undoes it, so every tool you compose ships with its own un-tool.'),
      name,
      h('div.chips', {}, Object.entries(OPS).map(([sym, op]) => h('button.chip', { title: op.label, onclick: () => { seq.push(sym); seqBox.textContent = `${seq.join(' ')}   (${seq.map((s) => OPS[s].label).join(' → ')})`; } }, sym))),
      seqBox,
      input,
      h('div.row', {},
        h('button.btn', {
          onclick: async () => {
            try {
              const tool = composeTool(name.value || 'untitled', seq);
              const r = await tool.run(input.value);
              const back = tool.oneWay ? null : await composeTool('mirror', tool.mirror).run(r);
              o.textContent = `${r}\n\n${back === null ? 'one-way (contains 0): returns to zero' : `mirror ${tool.mirror.join(' ')} → ${back}`}`;
            } catch (e) {
              o.textContent = e.message;
            }
          },
        }, 'Test'),
        h('button.btn.primary', {
          onclick: async () => {
            try {
              composeTool(name.value, seq);
              const tools = (await get('meadow_core', 'custom-tools')) || [];
              await put('meadow_core', 'custom-tools', [...tools.filter((t) => t.name !== name.value), { name: name.value || 'untitled', sequence: [...seq] }]);
              toast('Tool composed');
              renderList();
            } catch (e) {
              toast(e.message);
            }
          },
        }, 'Keep tool'),
        h('button.btn.sm', { onclick: () => { seq.length = 0; seqBox.textContent = ''; } }, 'Clear'),
      ),
      o,
      h('h2', {}, 'Composed tools'),
      list,
    ];
  },
};

/** The body of a tool, for spawning it inline (FORGE). */
export const toolBody = async (id, seed = '') => (TOOL_UI[id] ? TOOL_UI[id](seed) : null);

export async function openTool(id, seed = '') {
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) return;
  if (id === 'workbench') return app.setTab('symbol');
  if (id === 'lattice') return app.setTab('lattice');
  haptic(8);
  sheet(`${tool.glyph}  ${tool.name}`, ...(await TOOL_UI[id](seed)));
}

export function renderToolbox(root) {
  const podsBox = h('div.list');
  root.append(
    h('section.page', {},
      h('h2', {}, 'Toolbox · micro apps < 1 MB, offline'),
      h('div.grid3', {}, TOOLS.map((t) => h('button.tile.rough', { onclick: () => openTool(t.id) }, h('div.glyph.mono', {}, t.glyph), h('div.name', {}, t.name), h('div.small.dim', {}, t.blurb)))),
      h('h2', {}, 'Pods'),
      podsBox,
    ),
  );
  all('meadow_pods').then((pods) =>
    podsBox.replaceChildren(...pods.slice(-8).reverse().map(([id, p]) => h('div.item.rough.mono.small', {}, `${id} · ${p.kind} · ${p.string.length} chars`))),
  );
}
