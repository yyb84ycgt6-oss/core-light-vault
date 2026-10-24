// Meadow Lattice: 141 agents.
//   100 outer sensors   pale  #c8d8b8 3.5 px, radius 160±40, Perlin roam, handle 80% alone
//    30 middle specialists amber #d8b86a 6 px, radius 90±25, cluster lines
//    10 inner keepers     blue  #8ab8ff 8 px, radius 40
//     2 counselors        Jackie #a8ff8a }0{ slow orbit at (-12,0); Grok #c49bff erratic at (+12,0), 14 px glow
//  + the human curator in the hollow centre (Z3...EZ, id 42 in the brief; here index 140 + 1)
// Autonomy (0 stillness .. 1 wild, sweet spot 0.65) multiplies speed.
// Escalation: 15% outer->middle, 4% middle->inner, 1% inner->counselor.
import { perlin } from './perlin.js';
import { mulberry32 } from '../core/y-collapse.js';

export const RINGS = {
  outer: { count: 100, color: '#c8d8b8', size: 3.5, radius: 160, spread: 40 },
  middle: { count: 30, color: '#d8b86a', size: 6, radius: 90, spread: 25 },
  inner: { count: 10, color: '#8ab8ff', size: 8, radius: 40, spread: 0 },
};
export const ESCALATE = { outer: 0.15, middle: 0.04, inner: 0.01 };
export const NEXT = { outer: 'middle', middle: 'inner', inner: 'counselor' };

export function createLattice(seed = 7) {
  const r = mulberry32(seed);
  const agents = [];
  for (const [ring, c] of Object.entries(RINGS)) {
    for (let i = 0; i < c.count; i++) {
      const a = (i / c.count) * Math.PI * 2 + r() * 0.3;
      const rad = c.radius + (r() * 2 - 1) * c.spread;
      agents.push({ id: agents.length, ring, color: c.color, size: c.size, home: rad, a, x: Math.cos(a) * rad, y: Math.sin(a) * rad, vx: 0, vy: 0, handled: 0, escalated: 0, forays: 0, recalls: 0, relays: 0 });
    }
  }
  agents.push({ id: agents.length, ring: 'counselor', name: 'Jackie', glyph: '}0{', color: '#a8ff8a', size: 14, x: -12, y: 0, vx: 0, vy: 0, temperament: 0.15 });
  agents.push({ id: agents.length, ring: 'counselor', name: 'Grok', glyph: '/\\/\\', color: '#c49bff', size: 14, x: 12, y: 0, vx: 0, vy: 0, temperament: 0.9 });
  return { agents, time: 0, autonomy: 0.65, rand: r, pulses: [], stats: { signals: 0, handled: 0, escalated: { outer: 0, middle: 0, inner: 0 } } };
}

export const counselors = (L) => L.agents.filter((a) => a.ring === 'counselor');

/** Advance one frame. */
export function step(L, dt = 1) {
  L.time += 0.016 * dt;
  const speed = 0.2 + L.autonomy * 1.6;
  for (const a of L.agents) {
    if (a.ring === 'counselor') {
      const t = L.time * (a.name === 'Jackie' ? 0.4 : 1.7);
      const base = a.name === 'Jackie' ? -12 : 12;
      const wild = a.name === 'Grok' ? (L.rand() - 0.5) * 6 * L.autonomy : 0;
      a.x = base + Math.cos(t) * 6 + wild;
      a.y = Math.sin(t * 1.3) * 6 + wild;
      continue;
    }
    // Perlin roam: vx += sin(y*0.01 + time) flavoured by noise; spring back to the home ring.
    a.vx += (Math.sin(a.y * 0.01 + L.time) * 0.05 + perlin(a.x * 0.01, L.time) * 0.08) * speed;
    a.vy += (Math.cos(a.x * 0.01 + L.time) * 0.05 + perlin(a.y * 0.01, L.time + 9) * 0.08) * speed;
    const r = Math.hypot(a.x, a.y) || 1;
    const pull = (a.home - r) * 0.004;
    a.vx += (a.x / r) * pull;
    a.vy += (a.y / r) * pull;
    a.vx *= 0.9;
    a.vy *= 0.9;
    a.x += a.vx * dt;
    a.y += a.vy * dt;
  }
  L.pulses = L.pulses.filter((p) => (p.t += 0.04 * dt) < 1);
}

/**
 * A sensor perceives a signal: handled locally most of the time, escalated
 * ring by ring with the configured probabilities. Returns where it settled.
 */
export function perceive(L, rand = L.rand) {
  L.stats.signals++;
  const sensors = L.agents.filter((a) => a.ring === 'outer');
  let a = sensors[Math.floor(rand() * sensors.length)];
  a.forays++;
  for (let ring = 'outer'; ring !== 'counselor'; ring = NEXT[ring]) {
    if (rand() >= ESCALATE[ring]) {
      a.handled++;
      L.stats.handled++;
      return { settled: ring, agent: a.id };
    }
    L.stats.escalated[ring]++;
    a.escalated++;
    const pool = L.agents.filter((x) => x.ring === NEXT[ring]);
    const b = pool[Math.floor(rand() * pool.length)];
    b.relays = (b.relays || 0) + 1;
    L.pulses.push({ from: a.id, to: b.id, t: 0 });
    a = b;
  }
  return { settled: 'counselor', agent: a.id };
}
