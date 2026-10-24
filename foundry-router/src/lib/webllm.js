// On-device LLM through WebLLM (WebGPU), hosted in a Web Worker so the UI
// thread stays at 60 fps while tokens are generated.
//
// SmolLM2-135M-Instruct ships from mlc-ai as q0f16 (needs shader-f16) and
// q0f32. Download is ~270 MB (f16), cached by WebLLM in the Cache API, after
// which it runs fully offline.

export const WEBLLM_MODELS = {
  f16: 'SmolLM2-135M-Instruct-q0f16-MLC',
  f32: 'SmolLM2-135M-Instruct-q0f32-MLC',
};

export async function webgpuInfo() {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return { supported: false, reason: 'WebGPU unavailable (needs Safari 26+ on iOS or Chrome 113+)' };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
    if (!adapter) return { supported: false, reason: 'No WebGPU adapter' };
    return {
      supported: true,
      f16: adapter.features.has('shader-f16'),
      vendor: adapter.info?.vendor || '',
      architecture: adapter.info?.architecture || '',
      maxBufferMB: Math.round((adapter.limits?.maxBufferSize || 0) / 2 ** 20),
    };
  } catch (err) {
    return { supported: false, reason: String(err?.message || err) };
  }
}

let enginePromise = null;
let currentModel = null;
let wantedModel = null; // set by the Asset Store; null = SmolLM2-135M default
const progressListeners = new Set();

export const onWebLLMProgress = (fn) => {
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
};

/** Resolve the concrete MLC build for this GPU (q*f16 needs shader-f16, else the f32 twin). */
export async function pickModel(requested = wantedModel) {
  const info = await webgpuInfo();
  if (!info.supported) throw new Error(info.reason);
  const id = requested || WEBLLM_MODELS.f16;
  return info.f16 ? id : id.replace('q0f16', 'q0f32').replace('q4f16_1', 'q4f32_1');
}

export const activeModel = () => currentModel || wantedModel || WEBLLM_MODELS.f16;

export function getEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const modelId = await pickModel();
      const webllm = await import('@mlc-ai/web-llm');
      const worker = new Worker(new URL('../workers/webllm.worker.js', import.meta.url), { type: 'module' });
      const engine = await webllm.CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: (r) => progressListeners.forEach((fn) => fn(r)),
      });
      currentModel = modelId;
      return engine;
    })().catch((err) => {
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

/**
 * Download + load an MLC model and make it the offline brain. Weights land in
 * WebLLM's Cache Storage, so later sessions start offline.
 */
export async function prepareModel(mlcId, onProgress = () => {}) {
  const off = onWebLLMProgress(onProgress);
  try {
    wantedModel = mlcId;
    const target = await pickModel(mlcId);
    const engine = await getEngine();
    if (currentModel !== target) {
      await engine.reload(target);
      currentModel = target;
    }
    return target;
  } finally {
    off();
  }
}

export async function isModelCached(mlcId = wantedModel) {
  try {
    const modelId = await pickModel(mlcId);
    const { hasModelInCache } = await import('@mlc-ai/web-llm');
    return await hasModelInCache(modelId);
  } catch {
    return false;
  }
}

/** Local engine for router.routeChat({ localEngines: { webllm } }). */
export async function* webllmEngine({ messages, signal, onEvent = () => {} }) {
  const off = onWebLLMProgress((r) => onEvent({ type: 'progress', provider: 'webllm', text: r.text, progress: r.progress }));
  try {
    const engine = await getEngine();
    const stream = await engine.chat.completions.create({
      messages: messages.map(({ role, content }) => ({ role, content })),
      stream: true,
      temperature: 0.7,
      max_tokens: 512,
    });
    for await (const chunk of stream) {
      if (signal?.aborted) {
        engine.interruptGenerate();
        throw new DOMException('Aborted', 'AbortError');
      }
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield { text, model: currentModel };
    }
  } finally {
    off();
  }
}
