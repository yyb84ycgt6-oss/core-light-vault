// Symbol registry (meadow_core / meadow_symbols, versioned). Primitives are
// immutable; every new symbol is a composition of the user's own core picks.
// Symbols ARE pods: sealing wraps Z3 [sequence] EZ and compresses it through
// the {} boundary into the Living Archive.
import { get, put, all } from '../pwa/storage.js';
import { mirror, isEquilibrium } from './mirror-law.js';

export const INVENTORY = {
  letters: ['q', 'p', 'd', 'b', 'qpdb'],
  forms: ['8', '0', '-0-', '-_0_-', '}0{', '•8•', 'o', '-o-'],
  boundaries: ['[]', '{}', '[8~{-o-o-}~8]', '_-[}-_0_-{]-_'],
  fields: ['/\\/\\/\\/\\', '//|\\\\', '/\\/\\/\\/\\//|\\\\/\\/\\/\\/\\'],
  sigils: ['Z3', 'EZ', 'Z3/\\/\\/\\/\\', '\\/\\/\\/\\EZ'],
  threads: ['-', '_', '~', '~-', '-~'],
};
export const PRIMITIVES = Object.values(INVENTORY).flat();
export const MINIMAL = ['0', '[8-0-8]', '-', '[]']; // 0 + loop + thread + boundary builds the rest

export const SKELETONS = [
  { glyph: '[8-0-8]', of: '[8~{-o-o-}~8]', meaning: 'skeleton of the bounded double loop' },
  { glyph: '}0{', meaning: 'neutron eye: balanced, self-mirroring' },
  { glyph: '-_0_-', meaning: 'balanced conduit' },
];

const VERSION = 1;

export async function loadRegistry() {
  const reg = (await get('meadow_core', 'registry')) || { version: VERSION, core: ['}0{', '-_0_-', '[]', '~'], usage: {}, symbols: [] };
  return reg;
}

export async function saveRegistry(reg) {
  reg.version = VERSION;
  reg.updatedAt = Date.now();
  return put('meadow_core', 'registry', reg);
}

export function useGlyph(reg, glyph) {
  reg.usage[glyph] = (reg.usage[glyph] || 0) + 1;
}

/** A composed symbol: name, user-drawn strokes, meaning sequence of core glyphs. */
export function composeSymbol({ name, strokes = [], sequence }) {
  if (!name?.trim()) throw new Error('A symbol needs a name or glyph');
  if (!sequence?.length) throw new Error('Define its meaning as a sequence of your core symbols');
  return {
    name: name.trim(),
    strokes,
    sequence,
    mirrorName: mirror(name.trim()),
    mirrorSequence: sequence.slice().reverse().map(mirror),
    equilibrium: isEquilibrium(name.trim()),
    sealed: `Z3 [${sequence.join(' ')}] EZ`,
  };
}

export async function storeSymbol(sym) {
  await put('meadow_symbols', sym.name, { ...sym, savedAt: Date.now() });
}

export async function listSymbols() {
  return (await all('meadow_symbols')).map(([, v]) => v);
}
