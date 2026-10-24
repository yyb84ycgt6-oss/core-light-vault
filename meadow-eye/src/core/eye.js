// eYe Class micro-orchestrator: a deterministic state router, not a generator.
// One job: read an intent and route it. Micro intents (about 80%) are handled
// by local tools in microseconds; macro intents (about 20%) go to a counselor
// model. The rule table is data, so its footprint is measurable (a few kB);
// "fits in L2" is a budget we respect, not something JS can pin.

export const RULES = [
  { id: 'decompress', re: /\b(decompress|bdpq|recall|reconstruct|unpod|restore)\b/i, tool: 'decompress' },
  { id: 'compress', re: /\b(compress|qpdb|pod it|seal|forge string|atomic)\b/i, tool: 'compress' },
  { id: 'collapse', re: /\b(collapse|y-?axis|fingerprint|essence)\b/i, tool: 'collapse' },
  { id: 'encrypt', re: /\b(encrypt|sbx1|tank|lock)\b/i, tool: 'sbx1' },
  { id: 'qr', re: /\b(qr|barcode|scan code)\b/i, tool: 'qr' },
  { id: 'hash', re: /\b(hash|sha|digest|checksum)\b/i, tool: 'hash' },
  { id: 'morse', re: /\b(morse|dots? and dash)/i, tool: 'morse' },
  { id: 'symbol', re: /\b(symbol|glyph|sigil|draw)\b/i, tool: 'workbench' },
  { id: 'archive', re: /\b(archive|remember|find|search|query)\b/i, tool: 'archive' },
  { id: 'battery', re: /\b(battery|power|rest|sleep)\b/i, tool: 'battery' },
  { id: 'code', re: /\b(function|const|=>|class |debug|ast|code)\b/i, tool: 'code' },
  { id: 'lattice', re: /\b(lattice|agents?|meadow|swarm)\b/i, tool: 'lattice' },
];

export const COUNSELORS = {
  jackie: { id: 'jackie', name: 'Meta Jackie', glyph: '}0{', temperament: 0.15, role: 'balanced', color: '#a8ff8a' },
  grok: { id: 'grok', name: 'Grok', glyph: '/\\/\\', temperament: 0.9, role: 'wild', color: '#c49bff' },
  deepseek: { id: 'deepseek', name: 'DeepSeek', glyph: '-_0_-', temperament: 0.3, role: 'scribe', color: '#22d3ee' },
  llama: { id: 'llama', name: 'Local Llama', glyph: '[8-0-8]', temperament: 0.4, role: 'offline', color: '#f59e0b' },
};

const MACRO = /\b(why|explain|write|story|poem|essay|plan|think|imagine|should i|advice|create|design)\b|\?$/i;
const WILD = /\b(wild|crazy|imagine|chaos|brainstorm|weird)\b/i;
const SCRIBE = /\b(summari[sz]e|document|write up|notes|record)\b/i;

/**
 * Route one message. Pure and deterministic.
 * @returns {{scale:'micro'|'macro', tool?:string, counselor?:string, rule:string, us:number}}
 */
export function route(text, { reputation = {} } = {}) {
  const t0 = performance.now();
  const s = String(text || '').trim();
  let out;
  const hit = RULES.find((r) => r.re.test(s));
  if (hit && !(MACRO.test(s) && s.split(/\s+/).length > 12)) out = { scale: 'micro', tool: hit.tool, rule: hit.id };
  else {
    let counselor = WILD.test(s) ? 'grok' : SCRIBE.test(s) ? 'deepseek' : 'jackie';
    // Routing table reputation: a counselor that keeps disappointing yields to the next best.
    const rep = (id) => reputation[id] ?? 0.5;
    if (rep(counselor) < 0.3) counselor = Object.keys(COUNSELORS).sort((a, b) => rep(b) - rep(a))[0];
    out = { scale: 'macro', counselor, rule: counselor === 'jackie' ? 'balanced-default' : counselor };
  }
  out.us = Math.max(1, Math.round((performance.now() - t0) * 1000));
  return out;
}

export function footprintBytes() {
  return new TextEncoder().encode(JSON.stringify(RULES.map((r) => [r.id, r.re.source, r.tool])) + MACRO.source + WILD.source + SCRIBE.source).length;
}

export function trace(r) {
  return r.scale === 'micro'
    ? `eYe analyzed · micro · ${r.rule} → ${r.tool} (${r.us} µs)`
    : `eYe analyzed · macro → routed to ${COUNSELORS[r.counselor].name}, waking… (${r.us} µs)`;
}
