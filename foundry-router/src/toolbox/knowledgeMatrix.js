// Knowledge Matrix: 12 technical + 12 esoteric domains on one 24-segment ring.
// Text is scored against each domain's keyword lexicon (whole-word matches,
// sublinear term frequency), and each technical domain has a declared mirror on
// the esoteric side so the ring can show cross-links.

export const TECH_DOMAINS = [
  { id: 'ai', name: 'AI / ML', glyph: '◎', mirror: 'hermeticism', kw: ['model', 'neural', 'training', 'inference', 'embedding', 'llm', 'transformer', 'gradient', 'token', 'agent', 'dataset', 'weights'] },
  { id: 'crypto', name: 'Cryptography', glyph: '⚿', mirror: 'kabbalah', kw: ['encrypt', 'decrypt', 'cipher', 'aes', 'key', 'hash', 'sha', 'signature', 'nonce', 'pbkdf2', 'entropy', 'gcm'] },
  { id: 'distributed', name: 'Distributed Systems', glyph: '⛬', mirror: 'iching', kw: ['consensus', 'replica', 'node', 'cluster', 'failover', 'latency', 'partition', 'queue', 'shard', 'router', 'fallback'] },
  { id: 'compilers', name: 'Compilers', glyph: '⟁', mirror: 'gnosticism', kw: ['parser', 'ast', 'syntax', 'compile', 'bytecode', 'token', 'grammar', 'lexer', 'ir', 'optimizer'] },
  { id: 'gpu', name: 'Graphics / GPU', glyph: '◈', mirror: 'sacred-geometry', kw: ['shader', 'webgpu', 'gpu', 'render', 'canvas', 'pixel', 'texture', 'vertex', 'frame', 'fps'] },
  { id: 'networking', name: 'Networking', glyph: '⌬', mirror: 'mythology', kw: ['http', 'tcp', 'packet', 'tunnel', 'ngrok', 'sse', 'stream', 'socket', 'cors', 'latency', 'dns'] },
  { id: 'databases', name: 'Databases', glyph: '⛁', mirror: 'alchemy', kw: ['index', 'query', 'transaction', 'atomic', 'indexeddb', 'schema', 'commit', 'rollback', 'table', 'storage'] },
  { id: 'os', name: 'Operating Systems', glyph: '⚙', mirror: 'taoism', kw: ['kernel', 'process', 'thread', 'memory', 'scheduler', 'file', 'filesystem', 'opfs', 'cache', 'ram'] },
  { id: 'dsp', name: 'Signal Processing', glyph: '∿', mirror: 'numerology', kw: ['audio', 'fft', 'spectrum', 'frequency', 'mel', 'filter', 'signal', 'sample', 'wave', 'noise'] },
  { id: 'robotics', name: 'Robotics / Edge', glyph: '⚘', mirror: 'astrology', kw: ['sensor', 'battery', 'thermal', 'device', 'edge', 'iphone', 'power', 'actuator', 'embedded', 'offline'] },
  { id: 'quantum', name: 'Quantum Computing', glyph: '⚛', mirror: 'tarot', kw: ['qubit', 'quantum', 'superposition', 'entanglement', 'gate', 'decoherence', 'amplitude', 'measurement'] },
  { id: 'security', name: 'Security', glyph: '⛨', mirror: 'sufism', kw: ['attack', 'threat', 'exploit', 'xss', 'injection', 'scam', 'phishing', 'vulnerability', 'sandbox', 'auth'] },
];

export const ESOTERIC_DOMAINS = [
  { id: 'hermeticism', name: 'Hermeticism', glyph: '☿', mirror: 'ai', kw: ['as above', 'mentalism', 'correspondence', 'vibration', 'polarity', 'rhythm', 'hermes', 'principle', 'mind'] },
  { id: 'kabbalah', name: 'Kabbalah', glyph: '✡', mirror: 'crypto', kw: ['sephirot', 'gematria', 'tree of life', 'ein sof', 'hidden', 'letters', 'cipher', 'emanation'] },
  { id: 'iching', name: 'I Ching', glyph: '☯', mirror: 'distributed', kw: ['hexagram', 'trigram', 'change', 'yin', 'yang', 'oracle', 'line', 'balance'] },
  { id: 'gnosticism', name: 'Gnosticism', glyph: '✧', mirror: 'compilers', kw: ['gnosis', 'demiurge', 'aeon', 'sophia', 'archon', 'knowledge', 'spark', 'hidden'] },
  { id: 'sacred-geometry', name: 'Sacred Geometry', glyph: '⬡', mirror: 'gpu', kw: ['golden ratio', 'fibonacci', 'mandala', 'flower of life', 'spiral', 'symmetry', 'ring', 'circle'] },
  { id: 'mythology', name: 'Mythology', glyph: '☉', mirror: 'networking', kw: ['myth', 'hero', 'dragon', 'god', 'legend', 'quest', 'journey', 'lore', 'jade'] },
  { id: 'alchemy', name: 'Alchemy', glyph: '🜍', mirror: 'databases', kw: ['transmutation', 'philosopher', 'mercury', 'sulfur', 'salt', 'gold', 'prima materia', 'solve et coagula', 'distill'] },
  { id: 'taoism', name: 'Taoism', glyph: '☯︎', mirror: 'os', kw: ['tao', 'wu wei', 'flow', 'stillness', 'emptiness', 'harmony', 'nature', 'rest'] },
  { id: 'numerology', name: 'Numerology', glyph: '∞', mirror: 'dsp', kw: ['number', 'seven', 'three', 'nine', 'digit', 'sum', 'cycle', 'frequency'] },
  { id: 'astrology', name: 'Astrology', glyph: '♄', mirror: 'robotics', kw: ['star', 'planet', 'zodiac', 'neutron', 'orbit', 'moon', 'sun', 'cosmic', 'constellation'] },
  { id: 'tarot', name: 'Tarot', glyph: '🂠', mirror: 'quantum', kw: ['arcana', 'card', 'fool', 'tower', 'spread', 'reading', 'fate', 'chance'] },
  { id: 'sufism', name: 'Sufism', glyph: '✺', mirror: 'security', kw: ['heart', 'whirling', 'dhikr', 'veil', 'path', 'love', 'remembrance', 'guard'] },
];

export const DOMAINS = [...TECH_DOMAINS.map((d) => ({ ...d, ring: 'tech' })), ...ESOTERIC_DOMAINS.map((d) => ({ ...d, ring: 'esoteric' }))];
export const domainById = (id) => DOMAINS.find((d) => d.id === id) || null;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matchers = new Map(DOMAINS.map((d) => [d.id, d.kw.map((k) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(k)}`, 'giu'))]));

/** Score text against all 24 domains. Returns [{id, score, hits}] normalised to max = 1. */
export function scoreDomains(text) {
  const t = String(text || '').toLowerCase();
  const raw = DOMAINS.map((d) => {
    const hits = [];
    let s = 0;
    matchers.get(d.id).forEach((re, i) => {
      const n = (t.match(re) || []).length;
      if (n) {
        hits.push(d.kw[i]);
        s += 1 + Math.log(n);
      }
    });
    return { id: d.id, ring: d.ring, score: s, hits };
  });
  const max = Math.max(...raw.map((r) => r.score), 0);
  return raw.map((r) => ({ ...r, score: max ? r.score / max : 0 }));
}

/** Cross-links: tech/esoteric mirror pairs both present in the text. */
export function crossLinks(scores, threshold = 0.15) {
  const by = new Map(scores.map((s) => [s.id, s]));
  return TECH_DOMAINS.filter((d) => by.get(d.id).score >= threshold && by.get(d.mirror).score >= threshold).map((d) => ({
    tech: d.id,
    esoteric: d.mirror,
    strength: Math.min(by.get(d.id).score, by.get(d.mirror).score),
  }));
}

/** Persona hint for the router when Jacky has a domain selected on the Prism Ring. */
export function jackySystemPrompt(domainId) {
  const d = domainById(domainId);
  if (!d) return null;
  const m = domainById(d.mirror);
  return `You are Jacky, the Foundry Router companion. Lens: ${d.name} (${d.ring}); its mirror on the ring is ${m?.name}. Answer clearly and practically; draw on the lens when it genuinely helps.`;
}
