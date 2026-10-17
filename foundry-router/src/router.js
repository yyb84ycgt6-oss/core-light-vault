// Free AI Router Fabric: OpenAI-compatible /v1/chat/completions over SSE with a
// fallback chain, exponential backoff (500ms * 2^n on 429/5xx), per-provider
// request windows and live model discovery (GET /models) so retired model IDs
// heal themselves instead of breaking the chain.
//
// Keys are passed in by the caller (from the local vault) and are only ever
// sent to the provider they belong to.

export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 8000;
export const MAX_RETRIES = 2;

/**
 * Provider registry. Order = default fallback chain. `rpm` is the free-tier
 * request budget we enforce locally; `free` is the human note. Model IDs drift:
 * `prefs` are tried against the provider's live /models list when the default
 * is gone.
 */
export const PROVIDERS = [
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    model: 'llama-3.3-70b-versatile',
    prefs: ['llama-3\\.3-70b', 'llama-3\\.1-8b', 'llama'],
    rpm: 30,
    free: '30 req/min free · ~300 tok/s (Groq = LPU chip company, not Grok)',
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    kind: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    keyEnv: 'CEREBRAS_API_KEY',
    model: 'llama-3.3-70b',
    prefs: ['llama-3\\.3-70b', 'llama', 'gpt-oss', 'qwen'],
    rpm: 30,
    free: '14k req/day free · ~1800 tok/s',
    keyUrl: 'https://cloud.cerebras.ai',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    kind: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    model: 'gemini-2.0-flash',
    prefs: ['gemini-2\\.5-flash$', 'gemini-2\\.0-flash$', 'flash'],
    rpm: 60,
    free: '1M tokens/day free tier (1.5-flash is retired; 2.x flash used)',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    prefs: ['meta-llama/.*:free$', 'google/gemma.*:free$', ':free$'],
    rpm: 20,
    free: ':free models · 20 req/min · sends HTTP-Referer + X-Title',
    keyUrl: 'https://openrouter.ai/keys',
    headers: () => ({
      'HTTP-Referer': typeof location !== 'undefined' ? location.origin : 'http://localhost',
      'X-Title': 'Foundry Router',
    }),
  },
  {
    id: 'together',
    label: 'Together',
    kind: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    keyEnv: 'TOGETHER_API_KEY',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
    prefs: ['Llama-3\\.3-70B.*Free', 'Llama-3\\.1-8B', 'llama', 'mixtral'],
    rpm: 60,
    free: '$5 starter credit · llama-3 / mixtral',
    keyUrl: 'https://api.together.xyz/settings/api-keys',
  },
  {
    id: 'fireworks',
    label: 'Fireworks',
    kind: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    keyEnv: 'FIREWORKS_API_KEY',
    model: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
    prefs: ['llama-v3p3-70b', 'llama-v3p1-8b', 'llama'],
    rpm: 60,
    free: '$5 starter credit',
    keyUrl: 'https://fireworks.ai/account/api-keys',
  },
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    kind: 'openai',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    keyEnv: 'DEEPINFRA_API_KEY',
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    prefs: ['Llama-3\\.3-70B', 'Llama-3\\.1-8B', 'llama'],
    rpm: 60,
    free: '$5 starter credit',
    keyUrl: 'https://deepinfra.com/dash/api_keys',
  },
  {
    id: 'xai',
    label: 'xAI',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    keyEnv: 'XAI_API_KEY',
    model: 'grok-3-mini',
    prefs: ['grok-3-mini', 'grok-.*mini', 'grok'],
    rpm: 60,
    free: '$5 credit · Grok = xAI model (not Groq)',
    keyUrl: 'https://console.x.ai',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyEnv: 'ANTHROPIC_API_KEY',
    model: 'claude-haiku-5-5',
    prefs: ['haiku', 'sonnet'],
    rpm: 50,
    free: '$5 credit · Haiku tier (claude-3-5-haiku is retired)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    model: 'gpt-4o-mini',
    prefs: ['gpt-4o-mini', 'mini$', 'gpt'],
    rpm: 60,
    free: '$5 credit · gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    keyEnv: null,
    model: 'llama3.2',
    prefs: ['llama3\\.2', 'llama3', 'llama'],
    rpm: 0,
    free: 'Unlimited local · public via ngrok http 11434 or Cloudflare Tunnel',
    keyUrl: 'https://ollama.com/download',
    headers: (p) => (/ngrok/.test(p.baseUrl) ? { 'ngrok-skip-browser-warning': 'true' } : {}),
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    kind: 'openai',
    baseUrl: 'https://router.huggingface.co/v1',
    keyEnv: 'HF_TOKEN',
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    prefs: ['Llama-3\\.1-8B', 'llama'],
    rpm: 30,
    free: 'Rate-limited free credits (api-inference is now the Inference Providers router)',
    keyUrl: 'https://huggingface.co/settings/tokens',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    keyEnv: 'MISTRAL_API_KEY',
    model: 'mistral-small-latest',
    prefs: ['mistral-small', 'small', 'mistral'],
    rpm: 60,
    free: 'Free experiment tier',
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'cohere',
    label: 'Cohere',
    kind: 'openai',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    keyEnv: 'COHERE_API_KEY',
    model: 'command-r7b-12-2024',
    prefs: ['command-r7b', 'command-r', 'command'],
    rpm: 20,
    free: 'Trial key · OpenAI compatibility endpoint',
    keyUrl: 'https://dashboard.cohere.com/api-keys',
  },
  {
    id: 'anyscale',
    label: 'Anyscale',
    kind: 'openai',
    baseUrl: 'https://api.endpoints.anyscale.com/v1',
    keyEnv: 'ANYSCALE_API_KEY',
    model: 'meta-llama/Meta-Llama-3-8B-Instruct',
    prefs: ['llama'],
    rpm: 30,
    free: 'Anyscale Endpoints was shut down (2024); kept for completeness, off by default',
    deprecated: true,
  },
];

export const LOCAL_PROVIDERS = {
  webllm: { id: 'webllm', label: 'WebLLM', kind: 'webllm', model: 'SmolLM2-135M-Instruct', free: 'On-device WebGPU, offline' },
  meta: { id: 'meta', label: 'Meta AI Direct', kind: 'bridge', model: 'meta.ai', free: 'Hand-off to meta.ai (no public API)' },
};

export const providerById = (id) => PROVIDERS.find((p) => p.id === id) || LOCAL_PROVIDERS[id] || null;
export const DEFAULT_CHAIN = PROVIDERS.filter((p) => !p.deprecated).map((p) => p.id);

/** Router chips from the spec. Each chip pins a provider + model; failover continues down the chain. */
export const CHIPS = [
  { id: 'meta-direct', label: 'Meta AI Direct', provider: 'meta', model: 'meta.ai' },
  { id: 'llama-1b-groq', label: 'Llama 3.2 1B · Groq', provider: 'groq', model: 'llama-3.2-1b-preview', prefs: ['llama-3\\.2-1b', 'llama-3\\.2-3b', 'llama-3\\.1-8b-instant'] },
  { id: 'llama-70b-cerebras', label: 'Llama 3.3 70B · Cerebras', provider: 'cerebras', model: 'llama-3.3-70b' },
  { id: 'llama-8b-openrouter', label: 'Llama 3.1 8B · OpenRouter free', provider: 'openrouter', model: 'meta-llama/llama-3.1-8b-instruct:free', prefs: ['llama-3\\.1-8b.*:free', 'llama.*:free'] },
  { id: 'gemma-groq', label: 'Gemma 2 9B · Groq', provider: 'groq', model: 'gemma2-9b-it', prefs: ['gemma', 'llama-3\\.1-8b-instant'] },
  { id: 'grok-mini', label: 'Grok 3 Mini · xAI', provider: 'xai', model: 'grok-3-mini' },
  { id: 'ollama-local', label: 'Ollama Local', provider: 'ollama', model: 'llama3.2' },
  { id: 'webllm', label: 'WebLLM Offline · SmolLM2-135M', provider: 'webllm', model: 'SmolLM2-135M-Instruct' },
];

// ---------------------------------------------------------------------------
// SSE parser (WHATWG event-stream framing)
// ---------------------------------------------------------------------------

export function createSSEParser() {
  let buffer = '';
  let data = [];
  let event = '';
  const out = [];
  const dispatch = () => {
    if (data.length) out.push({ event: event || 'message', data: data.join('\n') });
    data = [];
    event = '';
  };
  const line = (l) => {
    if (l === '') return dispatch();
    if (l[0] === ':') return; // comment / keep-alive
    const colon = l.indexOf(':');
    const field = colon === -1 ? l : l.slice(0, colon);
    let value = colon === -1 ? '' : l.slice(colon + 1);
    if (value[0] === ' ') value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
  };
  return {
    /** Feed decoded text; returns complete events. */
    push(text) {
      buffer += text;
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const c = buffer[i];
        if (c === '\n' || c === '\r') {
          if (c === '\r' && i === buffer.length - 1) break; // maybe \r\n split across chunks
          line(buffer.slice(start, i));
          if (c === '\r' && buffer[i + 1] === '\n') i++;
          start = i + 1;
        }
      }
      buffer = buffer.slice(start);
      return out.splice(0);
    },
    /** Flush at end of stream. */
    end() {
      if (buffer) line(buffer.replace(/\r$/, ''));
      buffer = '';
      dispatch();
      return out.splice(0);
    },
  };
}

// ---------------------------------------------------------------------------
// Errors, backoff, rate windows
// ---------------------------------------------------------------------------

export class ProviderError extends Error {
  constructor(provider, { status = 0, kind, message, retryAfterMs = null }) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.kind = kind; // auth | rate | server | model | network | bad_request | stream
    this.retryAfterMs = retryAfterMs;
  }
  get retryable() {
    return this.kind === 'rate' || this.kind === 'server';
  }
}

export function backoffDelay(attempt, retryAfterMs = null) {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return retryAfterMs != null ? Math.min(BACKOFF_CAP_MS, Math.max(exp, retryAfterMs)) : exp;
}

function parseRetryAfter(h) {
  if (!h) return null;
  const s = Number(h);
  if (Number.isFinite(s)) return s * 1000;
  const t = Date.parse(h);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : null;
}

const windows = new Map();

/** Sliding 60 s request window per provider. Returns false when the local budget is spent. */
export function takeSlot(providerId, rpm, now = Date.now()) {
  if (!rpm) return true;
  const w = (windows.get(providerId) || []).filter((t) => now - t < 60_000);
  if (w.length >= rpm) {
    windows.set(providerId, w);
    return false;
  }
  w.push(now);
  windows.set(providerId, w);
  return true;
}
export const _resetWindows = () => windows.clear();

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

function classify(provider, status, bodyText, retryAfterMs) {
  let msg = bodyText?.slice(0, 300) || `HTTP ${status}`;
  try {
    const j = JSON.parse(bodyText);
    msg = j.error?.message || j.message || j.error || msg;
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
  } catch {
    /* plain text body */
  }
  const modelGone = /model|not.?found|does not exist|decommissioned|deprecated|unknown/i.test(msg);
  let kind = 'bad_request';
  if (status === 401 || status === 403) kind = 'auth';
  else if (status === 429) kind = 'rate';
  else if (status >= 500) kind = 'server';
  else if ((status === 404 || status === 400 || status === 422) && modelGone) kind = 'model';
  return new ProviderError(provider, { status, kind, message: `HTTP ${status} ${msg}`, retryAfterMs });
}

// ---------------------------------------------------------------------------
// Request builders + streaming adapters
// ---------------------------------------------------------------------------

function authHeaders(p, apiKey) {
  if (p.kind === 'anthropic') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export function toAnthropicMessages(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = [];
  for (const m of messages) {
    if (m.role === 'system' || !m.content) continue;
    const last = turns.at(-1);
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else turns.push({ role: m.role, content: m.content });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return { system: system || undefined, messages: turns };
}

export function buildRequest(p, { model, messages, apiKey, maxTokens = 1024, temperature = 0.7, baseUrl }) {
  const base = (baseUrl || p.baseUrl).replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', ...authHeaders(p, apiKey), ...(p.headers ? p.headers({ ...p, baseUrl: base }) : {}) };
  if (p.kind === 'anthropic') {
    const { system, messages: turns } = toAnthropicMessages(messages);
    return {
      url: `${base}/messages`,
      init: { method: 'POST', headers, body: JSON.stringify({ model, max_tokens: maxTokens, temperature, stream: true, system, messages: turns }) },
    };
  }
  return {
    url: `${base}/chat/completions`,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, stream: true, temperature, max_tokens: maxTokens, messages: messages.map(({ role, content }) => ({ role, content })) }),
    },
  };
}

/** Pull text deltas out of one SSE event for the given provider kind. */
export function extractDelta(kind, evt) {
  if (evt.data === '[DONE]') return { done: true };
  let j;
  try {
    j = JSON.parse(evt.data);
  } catch {
    return {};
  }
  if (j.error || j.type === 'error') {
    const e = j.error || {};
    return { error: e.message || JSON.stringify(e), status: e.code || e.status };
  }
  if (kind === 'anthropic') {
    if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') return { text: j.delta.text };
    if (j.type === 'message_stop') return { done: true };
    if (j.type === 'message_delta' && j.usage) return { usage: j.usage };
    return {};
  }
  const choice = j.choices?.[0];
  const text = choice?.delta?.content ?? choice?.message?.content ?? '';
  return { text: text || '', finish: choice?.finish_reason || null, usage: j.usage || j.x_groq?.usage || null };
}

/**
 * Stream one completion from one provider. Yields { text } deltas.
 * Throws ProviderError (classified) on failure.
 */
export async function* streamProvider(p, { model, messages, apiKey, signal, baseUrl, fetchImpl = globalThis.fetch }) {
  const { url, init } = buildRequest(p, { model, messages, apiKey, baseUrl });
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ProviderError(p.id, { kind: 'network', message: `network/CORS failure: ${err?.message || err}` });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw classify(p.id, res.status, body, parseRetryAfter(res.headers.get('retry-after')));
  }
  const ctype = res.headers.get('content-type') || '';
  if (!ctype.includes('text/event-stream') && ctype.includes('json')) {
    // Provider ignored stream:true - accept the whole message.
    const j = await res.json();
    const text = p.kind === 'anthropic' ? (j.content || []).map((c) => c.text || '').join('') : j.choices?.[0]?.message?.content || '';
    if (text) yield { text };
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSSEParser();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const events = done ? parser.end() : parser.push(decoder.decode(value, { stream: true }));
      for (const evt of events) {
        const d = extractDelta(p.kind, evt);
        if (d.error) throw new ProviderError(p.id, { kind: 'stream', message: d.error, status: Number(d.status) || 0 });
        if (d.text) yield { text: d.text };
        if (d.usage) yield { usage: d.usage };
        if (d.done) finished = true;
      }
      if (done || finished) break;
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
    else reader.releaseLock?.();
  }
}

// ---------------------------------------------------------------------------
// Model discovery
// ---------------------------------------------------------------------------

const modelCache = new Map();

export async function listModels(p, { apiKey, baseUrl, fetchImpl = globalThis.fetch, signal } = {}) {
  const base = (baseUrl || p.baseUrl).replace(/\/+$/, '');
  const cacheKey = `${p.id}|${base}`;
  if (modelCache.has(cacheKey)) return modelCache.get(cacheKey);
  const headers = { ...authHeaders(p, apiKey), ...(p.headers ? p.headers({ ...p, baseUrl: base }) : {}) };
  const res = await fetchImpl(`${base}/models`, { headers, signal });
  if (!res.ok) throw classify(p.id, res.status, await res.text().catch(() => ''), null);
  const j = await res.json();
  const ids = (j.data || j.models || []).map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean)
    .map((id) => id.replace(/^models\//, ''));
  modelCache.set(cacheKey, ids);
  return ids;
}
export const _resetModelCache = () => modelCache.clear();

const NON_CHAT = /embed|whisper|tts|speech|guard|moderation|rerank|image|dall-e|transcribe|audio|vision-preview|search/i;

export function resolveModel(desired, ids, prefs = []) {
  if (ids.includes(desired)) return desired;
  const chat = ids.filter((id) => !NON_CHAT.test(id));
  for (const pref of prefs) {
    const re = new RegExp(pref, 'i');
    const hit = chat.find((id) => re.test(id));
    if (hit) return hit;
  }
  return chat[0] || null;
}

// ---------------------------------------------------------------------------
// eYe-aware selection + the fallback chain
// ---------------------------------------------------------------------------

/**
 * selectRouter: battery < 15 % or thermal > 70 C forces the offline WebLLM
 * engine only (sovereign mode). Otherwise the pinned chip goes first, then the
 * free chain in order.
 */
export function selectRouter({ system = {}, chip = null, chain = DEFAULT_CHAIN, gates = { batteryPct: 15, thermalC: 70 } } = {}) {
  const lowBattery = typeof system.battery === 'number' && system.battery < gates.batteryPct;
  const hot = typeof system.thermal === 'number' && system.thermal > gates.thermalC;
  if (lowBattery || hot) {
    return {
      mode: 'sovereign-offline',
      reason: lowBattery ? `battery ${system.battery}% < ${gates.batteryPct}%` : `thermal ${system.thermal}°C > ${gates.thermalC}°C`,
      steps: [{ provider: 'webllm', model: LOCAL_PROVIDERS.webllm.model }],
    };
  }
  const steps = [];
  if (chip) steps.push({ provider: chip.provider, model: chip.model, prefs: chip.prefs });
  for (const id of chain) {
    if (chip && id === chip.provider) continue;
    const p = providerById(id);
    if (p && !p.deprecated) steps.push({ provider: id, model: p.model, prefs: p.prefs });
  }
  return { mode: 'cloud-chain', reason: chip ? `pinned ${chip.label}` : 'default free chain', steps };
}

/**
 * Route a chat across the plan's steps.
 * Emits events through onEvent and yields { text } deltas.
 * Never fails over after text has streamed (that would splice two answers).
 *
 * @param {object} o
 * @param {Array<{role,content}>} o.messages
 * @param {{steps:Array<{provider,model,prefs?}>}} o.plan from selectRouter
 * @param {Record<string,string>} o.keys env-shaped key map (GROQ_API_KEY, ...)
 * @param {Record<string,{baseUrl?:string, model?:string}>} [o.overrides]
 * @param {(e:object)=>void} [o.onEvent]
 * @param {(steps, ctx)=>AsyncGenerator} [o.localEngines] { webllm: fn }
 */
export async function* routeChat({ messages, plan, keys = {}, overrides = {}, signal, onEvent = () => {}, localEngines = {}, fetchImpl, sleepImpl = sleep }) {
  const failures = [];
  for (const step of plan.steps) {
    const p = providerById(step.provider);
    if (!p) continue;
    const ov = overrides[p.id] || {};
    let model = ov.model || step.model;
    const badge = () => `${p.label} · ${model}`;

    if (p.kind === 'webllm' || p.kind === 'bridge') {
      const engine = localEngines[p.id];
      if (!engine) {
        failures.push({ provider: p.id, reason: 'engine unavailable' });
        onEvent({ type: 'skip', provider: p.id, reason: 'engine unavailable' });
        continue;
      }
      onEvent({ type: 'attempt', provider: p.id, model, attempt: 0 });
      let streamed = false;
      try {
        for await (const d of engine({ messages, signal, onEvent })) {
          if (d.model) model = d.model;
          if (d.text) {
            streamed = true;
            yield { text: d.text, badge: badge() };
          }
        }
        onEvent({ type: 'done', provider: p.id, model, badge: badge() });
        return { provider: p.id, model, badge: badge(), failures };
      } catch (err) {
        if (err?.name === 'AbortError' || streamed) throw err;
        failures.push({ provider: p.id, reason: err.message });
        onEvent({ type: 'failover', provider: p.id, reason: err.message });
        continue;
      }
    }

    const apiKey = p.keyEnv ? keys[p.keyEnv] : null;
    if (p.keyEnv && !apiKey) {
      failures.push({ provider: p.id, reason: 'no key in vault' });
      onEvent({ type: 'skip', provider: p.id, reason: 'no key in vault' });
      continue;
    }
    if (!takeSlot(p.id, p.rpm)) {
      failures.push({ provider: p.id, reason: `local window full (${p.rpm}/min)` });
      onEvent({ type: 'skip', provider: p.id, reason: `local window full (${p.rpm}/min)` });
      continue;
    }

    let healed = false;
    for (let attempt = 0; ; attempt++) {
      onEvent({ type: 'attempt', provider: p.id, model, attempt });
      let streamed = false;
      try {
        for await (const d of streamProvider(p, { model, messages, apiKey, signal, baseUrl: ov.baseUrl, fetchImpl })) {
          if (d.text) {
            streamed = true;
            yield { text: d.text, badge: badge() };
          }
        }
        onEvent({ type: 'done', provider: p.id, model, badge: badge() });
        return { provider: p.id, model, badge: badge(), failures };
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        if (streamed) {
          onEvent({ type: 'error', provider: p.id, reason: `stream broke after partial output: ${err.message}` });
          throw err;
        }
        const e = err instanceof ProviderError ? err : new ProviderError(p.id, { kind: 'network', message: String(err?.message || err) });
        if (e.kind === 'model' && !healed) {
          healed = true;
          try {
            const ids = await listModels(p, { apiKey, baseUrl: ov.baseUrl, fetchImpl, signal });
            const next = resolveModel(model, ids, step.prefs || p.prefs);
            if (next && next !== model) {
              onEvent({ type: 'heal', provider: p.id, from: model, to: next });
              model = next;
              attempt--;
              continue;
            }
          } catch {
            /* discovery failed: fall through to failover */
          }
        }
        if (e.retryable && attempt < MAX_RETRIES) {
          const delay = backoffDelay(attempt, e.retryAfterMs);
          onEvent({ type: 'retry', provider: p.id, status: e.status, delayMs: delay });
          await sleepImpl(delay, signal);
          continue;
        }
        failures.push({ provider: p.id, reason: e.message });
        onEvent({ type: 'failover', provider: p.id, reason: e.message, kind: e.kind });
        break;
      }
    }
  }
  const err = new Error(`All providers failed: ${failures.map((f) => `${f.provider} (${f.reason})`).join('; ') || 'empty plan'}`);
  err.failures = failures;
  throw err;
}

// ---------------------------------------------------------------------------
// Meta AI Direct bridge
// ---------------------------------------------------------------------------

/**
 * Meta AI has no public chat API. When this app is embedded (iframe) by a host
 * that speaks the bridge protocol, the prompt goes to the parent via
 * postMessage, addressed to the parent's own origin (never '*'). Standalone, the
 * prompt is copied and meta.ai is opened.
 */
export async function* metaBridgeEngine({ messages }) {
  const prompt = messages.filter((m) => m.role === 'user').at(-1)?.content || '';
  const embedded = typeof window !== 'undefined' && window.parent && window.parent !== window;
  const parentOrigin = (() => {
    try {
      return document.referrer ? new URL(document.referrer).origin : null;
    } catch {
      return null;
    }
  })();
  if (embedded && parentOrigin) {
    window.parent.postMessage({ type: 'foundry:meta-ai', prompt }, parentOrigin);
    yield { text: `Sent to the host page (${parentOrigin}) through the postMessage bridge. Meta AI's reply appears there.` };
    return;
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(prompt);
    copied = true;
  } catch {
    /* clipboard blocked */
  }
  if (typeof window !== 'undefined') window.open('https://www.meta.ai/', '_blank', 'noopener');
  yield {
    text: `Meta AI has no public API, so this chat can't stream it directly. ${copied ? 'Your prompt is on the clipboard: ' : 'Copy your prompt and '}paste it into meta.ai (opened in a new tab). Embedded in a host page, this chip uses window.parent.postMessage instead.`,
  };
}
