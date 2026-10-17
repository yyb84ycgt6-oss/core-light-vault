// Counselor Bridge: when a sensor is stuck it asks upward, but small.
// Trigger: uncertainty > 0.72, or attempted >= 3, or resource > 0.8, or novelty > 0.85.
// Packet <= 512 bytes: { seed, context (<= 280 chars), attempted, uncertainty }.
// Both counselors answer (Jackie balanced, Grok wild); the human picks what is
// re-injected through the middle ring, so the swarm keeps its autonomy.

export const MAX_PACKET = 512;

export function shouldEscalate({ uncertainty = 0, attempted = 0, resource = 0, novelty = 0 }) {
  return uncertainty > 0.72 || attempted >= 3 || resource > 0.8 || novelty > 0.85;
}

export function packet({ seed, context = '', attempted = 0, uncertainty = 0 }) {
  let ctx = String(context).slice(0, 280);
  const make = () => JSON.stringify({ seed, context: ctx, attempted, uncertainty: +uncertainty.toFixed(3) });
  let s = make();
  while (new TextEncoder().encode(s).length > MAX_PACKET && ctx.length) {
    ctx = ctx.slice(0, -8);
    s = make();
  }
  return s;
}

/** Path the packet travels: outer sensor -> middle -> inner -> counselor ring. */
export const PATH = ['outer', 'middle', 'inner', 'counselor'];

/** Two offline counselor voices on the same packet (no model needed). */
export function dualResponse(pkt) {
  const p = JSON.parse(pkt);
  const ctx = p.context || 'the signal';
  return {
    jackie: `}0{ Slow down. "${ctx.slice(0, 60)}" has been tried ${p.attempted}×. Narrow it: keep one variable, return the rest to infinity, try again from stillness.`,
    grok: `/\\/\\ Flip it. If "${ctx.slice(0, 60)}" keeps failing, invert the assumption: mirror the approach (q↔p) and see what the opposite path finds.`,
  };
}
