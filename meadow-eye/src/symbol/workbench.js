// Symbol Workbench logic. It should feel like an extension of how you draw,
// not a finished programming language: pick 3-4 core symbols, draw a glyph,
// give it a meaning as a sequence of your core, test it on the lattice, seal
// it Z3 ... EZ into the Tiny Archive where it decays like everything else.
import { composeSymbol, storeSymbol } from './registry.js';
import { forgeAtomic } from '../core/protocol.js';
import { remember } from '../archive/living-archive.js';
import { put } from '../pwa/storage.js';

/** Ramer-Douglas-Peucker simplification of one stroke. */
export function simplify(points, eps = 0.01) {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  let idx = 0;
  let max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const d = Math.abs((b[1] - a[1]) * p[0] - (b[0] - a[0]) * p[1] + b[0] * a[1] - b[1] * a[0]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [a, b];
  return [...simplify(points.slice(0, idx + 1), eps).slice(0, -1), ...simplify(points.slice(idx), eps)];
}

/** Quantise normalised strokes onto a 64x64 grid: 1 byte per axis per point. */
export const quantize = (strokes) => strokes.map((s) => simplify(s).map(([x, y]) => [Math.round(x * 63), Math.round(y * 63)]));

/** Sample up to n lit pixel positions from a canvas (formation targets for the lattice). */
export function sampleTargets(ctx, w, h, n) {
  const data = ctx.getImageData(0, 0, w, h).data;
  const lit = [];
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (data[(y * w + x) * 4 + 3] > 80) lit.push([x - w / 2, y - h / 2]);
  if (!lit.length) return [];
  const out = [];
  for (let i = 0; i < n; i++) out.push(lit[Math.floor((i * lit.length) / n)]);
  return out;
}

/** Seal Z3 [sequence] EZ: compress through the {} boundary, store in the Tiny Archive. */
export async function sealSymbol({ name, strokes, sequence, meaning = '' }) {
  const sym = composeSymbol({ name, strokes: quantize(strokes), sequence });
  const payload = JSON.stringify({ ...sym, meaning });
  const { string, pod } = await forgeAtomic(payload, { kind: 'symbol', ai: 'Symbol Workbench', collapseText: `${name} ${meaning} ${sequence.join(' ')}` });
  await storeSymbol({ ...sym, meaning, atomic: string });
  await put('meadow_pods', `symbol:${sym.name}`, { string, records: pod.records, kind: 'symbol', name: sym.name });
  const entry = await remember(sym.name, `${sym.sealed} ${meaning}`, { id: `symbol:${sym.name}`, kind: 'symbol', glyph: sym.name });
  return { sym, string, entry, bytes: string.length };
}
