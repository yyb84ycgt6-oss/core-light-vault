// Historical Transparency log: every routing decision (attempt, retry,
// failover, heal, done), seal and restore is appended to IndexedDB as a
// SHA-256 hash chain, so lineage can be verified and edits are detectable.
import { idbGetAll, idbPut, idbClear, STORES } from '../storage/idb.js';
import { sha256Hex } from '../longString.js';

let tail = null; // { seq, hash }
let chain = Promise.resolve();

async function lastEntry() {
  if (tail) return tail;
  const all = await idbGetAll(STORES.log).catch(() => []);
  const last = all.at(-1);
  tail = last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: '0'.repeat(64) };
  return tail;
}

const canonical = (e) => JSON.stringify({ ts: e.ts, type: e.type, provider: e.provider ?? null, model: e.model ?? null, detail: e.detail ?? null, prev: e.prev });

/** Append an entry; serialised so the chain never forks. */
export function appendLog(entry) {
  const next = chain.then(async () => {
    const prev = await lastEntry();
    const e = { ts: Date.now(), type: entry.type, provider: entry.provider ?? null, model: entry.model ?? null, detail: entry.detail ?? null, prev: prev.hash };
    e.hash = await sha256Hex(canonical(e));
    try {
      const seq = await idbPut(STORES.log, e);
      tail = { seq, hash: e.hash };
      e.seq = seq;
    } catch {
      e.persisted = false; // keep tail on the last stored entry so the chain stays intact
    }
    return e;
  });
  chain = next.catch(() => null); // one failed append must not wedge the queue
  return next;
}

export async function readLog(limit = 200) {
  const all = await idbGetAll(STORES.log).catch(() => []);
  return all.slice(-limit).reverse();
}

/** Recompute the chain. Returns { ok, entries, brokenAt }. */
export async function verifyLog() {
  const all = await idbGetAll(STORES.log).catch(() => []);
  let prev = '0'.repeat(64);
  for (const e of all) {
    if (e.prev !== prev || (await sha256Hex(canonical(e))) !== e.hash) return { ok: false, entries: all.length, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true, entries: all.length, brokenAt: null };
}

export async function clearLog() {
  await chain;
  await idbClear(STORES.log);
  tail = { seq: 0, hash: '0'.repeat(64) };
}

export async function exportLog() {
  return JSON.stringify(await idbGetAll(STORES.log).catch(() => []), null, 2);
}
