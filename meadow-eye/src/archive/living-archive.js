// Living Archive. "Nothing deletes. It composts."
// Entries hold a 32-dim Int8 semantic vector (brute-force search, no vector
// DB, fine on an iPhone 12), a decay weight, access count and versions.
// decay *= 0.99 per day; each access adds +0.07 (capped at 1); below 0.3 an
// entry composts. "Return to Infinity" keeps only the essence (vector,
// fingerprint, name) and lets the payload go.
import { get, put, all, del } from '../pwa/storage.js';
import { docVector, cosineInt8 } from '../core/y-collapse.js';

export const DAILY_DECAY = 0.99;
export const ACCESS_BOOST = 0.07;
export const COMPOST_AT = 0.3;

export const SEED = ['}0{', '-_0_-', '[8-0-8]', '[8~{-o-o-}~8]', 'qpdb', 'bdpq', 'Z3', 'EZ', '/\\/\\/\\/\\', '//|\\\\', '•8•', '-0-', '~-', '_-[}-_0_-{]-_'];
const SEED_MEANING = {
  '}0{': 'neutron eye balanced center stillness',
  '-_0_-': 'balanced conduit flow between',
  '[8-0-8]': 'skeleton loop boundary origin',
  '[8~{-o-o-}~8]': 'bounded double loop thread breathing',
  qpdb: 'forward collapse compression query buffer',
  bdpq: 'reverse mirror reconstruction decompression',
  Z3: 'opening seal sigil begin',
  EZ: 'closing seal sigil end',
  '/\\/\\/\\/\\': 'field wave signal mountain',
  '//|\\\\': 'branching field tree decision',
  '•8•': 'infinity loop held between points',
  '-0-': 'zero on a thread neutral',
  '~-': 'thread wave settling',
  '_-[}-_0_-{]-_': 'gate boundary balanced core',
};

export const state = (e) => (e.decay < COMPOST_AT ? 'compost' : 'alive');

export function makeEntry(name, text, extra = {}) {
  return {
    id: extra.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    text,
    vec: Array.from(docVector(`${name} ${text}`)),
    decay: 1,
    accessCount: 0,
    versions: [{ v: 1, at: Date.now() }],
    ...extra,
  };
}

export async function seedArchive() {
  // A flag, not "is the archive empty": a symbol sealed before the first visit must not block the seeds.
  if (!(await get('meadow_core', 'archive-seeded'))) {
    for (const [i, s] of SEED.entries()) await put('meadow_archive', `seed-${i}`, makeEntry(s, SEED_MEANING[s], { id: `seed-${i}`, seed: true }));
    await put('meadow_core', 'archive-seeded', true);
  }
  return listArchive();
}

export async function listArchive() {
  return (await all('meadow_archive')).map(([, v]) => v).sort((a, b) => b.decay - a.decay);
}

export async function remember(name, text, extra) {
  const id = extra?.id;
  const prev = id ? await get('meadow_archive', id) : null;
  const e = prev
    ? { ...prev, text, vec: Array.from(docVector(`${name} ${text}`)), decay: 1, versions: [...prev.versions, { v: prev.versions.length + 1, at: Date.now() }], ...extra }
    : makeEntry(name, text, extra);
  await put('meadow_archive', e.id, e);
  return e;
}

export async function access(id) {
  const e = await get('meadow_archive', id);
  if (!e) return null;
  e.accessCount++;
  e.decay = Math.min(1, e.decay + ACCESS_BOOST);
  await put('meadow_archive', id, e);
  return e;
}

/** One day passes for the whole meadow. */
export async function decayDay(days = 1) {
  const out = [];
  for (const [id, e] of await all('meadow_archive')) {
    if (e.infinity) continue;
    e.decay *= DAILY_DECAY ** days;
    await put('meadow_archive', id, e);
    out.push(e);
  }
  return out;
}

/** Return to Infinity: the payload goes back; the essence (name, vector) stays. */
export async function returnToInfinity(id) {
  const e = await get('meadow_archive', id);
  if (!e) return null;
  const essence = { id, name: e.name, vec: e.vec, decay: 0, infinity: true, returnedAt: Date.now(), versions: e.versions.length };
  await put('meadow_archive', id, essence);
  return essence;
}

/** Brute-force semantic query over Int8 vectors, weighted by decay. */
export async function query(text, k = 5) {
  const q = docVector(text);
  return (await listArchive())
    .filter((e) => !e.infinity)
    .map((e) => ({ e, score: cosineInt8(q, Int8Array.from(e.vec)) * (0.5 + 0.5 * e.decay) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export const _delete = (id) => del('meadow_archive', id); // tests only: the UI never deletes
