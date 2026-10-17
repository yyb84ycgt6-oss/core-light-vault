// Toolbox: micro apps under 1 MB, pure JS, offline. Every tool is also an
// operation bound to a symbol, so "Add Tool" composes new tools from core
// symbols, and the Mirror Law gives every composed tool its un-tool:
//   {  compress (gzip -> qpdb)      }  decompress
//   [  seal (SBX1, sovereign key)    ]  open
//   q  bytes -> qpdb glyphs          p  qpdb glyphs -> bytes
//   ~  morse <-> text (self-mirror: its own inverse)
//   -_0_-  reverse (self-mirror)
//   0  SHA-256 (one-way: returns the input to zero, no mirror needed)
import { gzip, concat } from '../core/pod.js';
import { bytesToQpdb, qpdbToBytes, b64, unb64 } from '../core/protocol.js';
import { sbx1Seal, sbx1Open, sbx1Nonce } from '../core/sbx1.js';
import { derivePodKey } from '../core/sovereign-key.js';
import { mirrorSeq } from '../symbol/mirror-law.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

export const MORSE = {
  a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--',
  n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
};
const UNMORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
export const isMorse = (s) => /^[.\-\s/]+$/.test(s.trim()) && s.trim().length > 0;
export const toMorse = (s) => s.toLowerCase().split(/\s+/).filter(Boolean).map((w) => [...w].map((c) => MORSE[c]).filter(Boolean).join(' ')).join(' / ');
export const fromMorse = (s) => s.trim().split(/\s*\/\s*/).map((w) => w.split(/\s+/).map((c) => UNMORSE[c] ?? '').join('')).join(' ');
/** Vibration pattern for the Morse Lattice (unit = 120 ms). */
export function morsePattern(morse, unit = 120) {
  const out = [];
  for (const ch of morse) {
    if (ch === '.') out.push(unit, unit);
    else if (ch === '-') out.push(unit * 3, unit);
    else if (ch === ' ') out.push(0, unit * 2);
    else if (ch === '/') out.push(0, unit * 4);
  }
  return out;
}

async function sha256Hex(s) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function gunzipQ(q) {
  const out = await new Response(new Blob([qpdbToBytes(q)]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return dec.decode(out);
}

/** Symbol -> text operation. */
export const OPS = {
  '{': { label: 'compress → qpdb', run: async (t) => bytesToQpdb(await gzip(enc.encode(t))) },
  '}': { label: 'decompress ← bdpq', run: (t) => gunzipQ(t.trim()) },
  '[': {
    label: 'seal SBX1',
    run: async (t) => {
      const nonce = crypto.getRandomValues(new Uint8Array(24));
      const key = await derivePodKey(nonce, 'toolbox');
      return b64(sbx1Seal(key, enc.encode(t), { nonce }));
    },
  },
  ']': {
    label: 'open SBX1',
    run: async (t) => {
      const blob = unb64(t.trim());
      const out = sbx1Open(await derivePodKey(sbx1Nonce(blob), 'toolbox'), blob);
      if (!out) throw new Error('SBX1: sovereign key or context mismatch, or tampered');
      return dec.decode(out);
    },
  },
  q: { label: 'bytes → qpdb', run: (t) => bytesToQpdb(enc.encode(t)) },
  p: { label: 'qpdb → bytes', run: (t) => dec.decode(qpdbToBytes(t.trim())) },
  '~': { label: 'morse ⇄ text', run: (t) => (isMorse(t) ? fromMorse(t) : toMorse(t)) },
  '-_0_-': { label: 'reverse', run: (t) => [...t].reverse().join('') },
  0: { label: 'SHA-256 (one-way)', run: (t) => sha256Hex(t), terminal: true },
};

export const composable = (sym) => sym in OPS;

/** Compose a tool from a symbol sequence. Its mirror tool undoes it (unless it ends in 0). */
export function composeTool(name, sequence) {
  const bad = sequence.filter((s) => !composable(s));
  if (bad.length) throw new Error(`No operation bound to ${bad.join(' ')}`);
  return {
    name,
    sequence,
    oneWay: sequence.includes('0'),
    mirror: mirrorSeq(sequence),
    async run(text) {
      let t = text;
      for (const s of sequence) t = await OPS[s].run(t);
      return t;
    },
  };
}

export const TOOLS = [
  { id: 'compress', name: 'eYe Compress', glyph: 'qpdb', blurb: 'Atomic pod string' },
  { id: 'decompress', name: 'Decompress', glyph: 'bdpq', blurb: 'Recall from string' },
  { id: 'collapse', name: 'Y-Collapse', glyph: '/\\/\\', blurb: 'Meaning, no syntax' },
  { id: 'seal', name: 'Sovereign Seal', glyph: '}0{', blurb: 'Hash ring' },
  { id: 'sbx1', name: 'SBX1 Tank', glyph: '[ ]', blurb: 'XChaCha20 seal' },
  { id: 'qr', name: 'QR Forge', glyph: '▦', blurb: 'Scannable PNG' },
  { id: 'workbench', name: 'Symbol Workbench', glyph: 'Z3', blurb: 'Draw · seal' },
  { id: 'lattice', name: 'Lattice Visualizer', glyph: '•8•', blurb: '141 agents' },
  { id: 'code', name: 'Code Visualizer', glyph: '[8-0-8]', blurb: 'AST focus' },
  { id: 'battery', name: 'Battery Handshake', glyph: '~-', blurb: '15% consent' },
  { id: 'hash', name: 'Hash Forge', glyph: '0', blurb: 'SHA + simhash' },
  { id: 'morse', name: 'Morse Lattice', glyph: '-~', blurb: 'Tap · vibrate' },
  { id: 'add', name: 'Add Tool', glyph: '+', blurb: 'Compose symbols' },
];

export { concat };
