// Prism Ring (Jacky): 24-segment ring geometry and hit-testing. Tech domains
// occupy the top half, esoteric the bottom, so each mirror pair sits opposite.
import { DOMAINS, TECH_DOMAINS, ESOTERIC_DOMAINS } from './knowledgeMatrix.js';

export const SEGMENTS = 24;
const STEP = (2 * Math.PI) / SEGMENTS;

/** Ring order: tech 0..11 clockwise from 12 o'clock, esoteric mirrors opposite them. */
export function ringOrder() {
  const order = new Array(SEGMENTS);
  TECH_DOMAINS.forEach((d, i) => {
    order[i] = { ...d, ring: 'tech' };
    const mirror = ESOTERIC_DOMAINS.find((e) => e.id === d.mirror);
    order[i + 12] = { ...mirror, ring: 'esoteric' };
  });
  return order;
}

export function segmentAngles(i) {
  const start = -Math.PI / 2 - STEP / 2 + i * STEP;
  return { start, end: start + STEP, mid: start + STEP / 2 };
}

/** SVG path for an annular sector. */
export function sectorPath(i, rInner, rOuter, cx = 0, cy = 0, gap = 0.012) {
  const { start, end } = segmentAngles(i);
  const a0 = start + gap;
  const a1 = end - gap;
  const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return `M ${p(rOuter, a0)} A ${rOuter} ${rOuter} 0 0 1 ${p(rOuter, a1)} L ${p(rInner, a1)} A ${rInner} ${rInner} 0 0 0 ${p(rInner, a0)} Z`;
}

export function labelPoint(i, r, cx = 0, cy = 0) {
  const { mid } = segmentAngles(i);
  return { x: cx + r * Math.cos(mid), y: cy + r * Math.sin(mid) };
}

/** Which segment is under (x, y) relative to the centre, if within the annulus. */
export function hitTest(x, y, rInner, rOuter) {
  const r = Math.hypot(x, y);
  if (r < rInner || r > rOuter) return -1;
  const a = Math.atan2(y, x) + Math.PI / 2 + STEP / 2;
  return ((Math.floor(a / STEP) % SEGMENTS) + SEGMENTS) % SEGMENTS;
}

export const visibleInMode = (domain, mode) => mode === 'all' || domain.ring === mode;
export { DOMAINS };
