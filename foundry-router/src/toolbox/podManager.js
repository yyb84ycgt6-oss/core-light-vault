// Pod Manager: create / mount (/pods/) / release Volatile Pods and compare
// streamed (M(t) = 16 KiB-class constant) against burst (M(t) = |D|) release.
import { sealPodProduction, mountPod, releasePod, listPods, deletePod, POD_LIMIT_BYTES } from '../longString.js';

export { sealPodProduction as createPod, mountPod, releasePod, deletePod, POD_LIMIT_BYTES };

/** Mount every pod in /pods/ (decrypting only each small index). */
export async function mountAll() {
  const out = [];
  for (const name of await listPods()) {
    try {
      out.push(await mountPod(name));
    } catch (err) {
      out.push({ name, path: `/pods/${name}`, error: err.code || err.message, sealed: true });
    }
  }
  return out;
}

/** Release the same pod both ways and report measured working sets. */
export async function compareStreamBurst(name) {
  const stream = await releasePod(name, { mode: 'stream' });
  const burst = await releasePod(name, { mode: 'burst' });
  return {
    plainBytes: stream.report.plainBytes,
    stream: stream.report,
    burst: burst.report,
    ratio: burst.report.peakWorkingBytes / Math.max(1, stream.report.peakWorkingBytes),
  };
}

export function lockDateFromDays(days) {
  return days > 0 ? Date.now() + days * 86_400_000 : null;
}
