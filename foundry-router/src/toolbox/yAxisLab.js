// Y-Axis Collapse Lab: runs the collapse in a Web Worker (keeps 60 fps) and
// exposes the measured ratio / retention trade-off.

export const LAB_SAMPLE = Array.from(
  { length: 12 },
  () =>
    'The neutron star at the core of the foundry pulses with light. Every conversation becomes a save, every save becomes a pod. ' +
    'The router chooses a provider, streams tokens and falls back when a provider is rate limited. Memory stays constant because records ' +
    'are decrypted sixteen kilobytes at a time. The eye watches battery and thermal limits and asks before it rests.',
).join(' ');

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../workers/collapse.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'collapse worker crashed'));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

/**
 * @param {string} text
 * @param {{k?:number, curveTo?:number, embedder?:'hash'|{repo:string,file:string,tokenizer:string}}} opts
 */
export function runCollapse(text, opts = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, text, ...opts });
  });
}

export const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : b >= 1024 ? `${(b / 1024).toFixed(2)} KB` : `${b} B`);
