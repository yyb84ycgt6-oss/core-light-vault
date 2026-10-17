// Signal Reputation: pairwise 141 x 141 Float32Array (~78 KB). Diagonal 1.0,
// off-diagonal starts in [0.45, 0.6]. +0.07 for a useful signal, -0.12 for
// noise, *0.99 per day toward forgetting. No global leaderboard: each agent
// only knows its own top-5 trusted peers. Specialisation emerges from who
// trusts whom.
import { mulberry32 } from '../core/y-collapse.js';

export const N = 141;
export const USEFUL = 0.07;
export const NOISY = -0.12;

export function createReputation(n = N, seed = 99) {
  const r = mulberry32(seed);
  const m = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) m[i * n + j] = i === j ? 1 : 0.45 + r() * 0.15;
  return { n, m };
}

const clamp = (x) => Math.max(0, Math.min(1, x));

export function signal(rep, from, to, useful) {
  const i = from * rep.n + to;
  rep.m[i] = clamp(rep.m[i] + (useful ? USEFUL : NOISY));
  return rep.m[i];
}

export function decayDay(rep, days = 1) {
  const f = 0.99 ** days;
  for (let i = 0; i < rep.n; i++) for (let j = 0; j < rep.n; j++) if (i !== j) rep.m[i * rep.n + j] *= f;
}

export const trust = (rep, i, j) => rep.m[i * rep.n + j];

export function topPeers(rep, i, k = 5) {
  return Array.from({ length: rep.n }, (_, j) => j)
    .filter((j) => j !== i)
    .sort((a, b) => trust(rep, i, b) - trust(rep, i, a))
    .slice(0, k)
    .map((j) => ({ j, trust: trust(rep, i, j) }));
}

/** Mean trust others place in i: drives visual thickness (rep * 3 px). */
export function standing(rep, i) {
  let s = 0;
  for (let k = 0; k < rep.n; k++) if (k !== i) s += trust(rep, k, i);
  return s / (rep.n - 1);
}

/** Emergent role from behaviour counters. */
export function specialization({ forays = 0, recalls = 0, relays = 0 }) {
  const max = Math.max(forays, recalls, relays);
  if (!max) return 'Wanderer';
  return max === forays ? 'Forager' : max === recalls ? 'Memory Keeper' : 'Bridge';
}
