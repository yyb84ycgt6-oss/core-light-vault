// Direct Message hub: you message the eYe Router; it answers micro intents
// itself and wakes a counselor for macro ones. History lives in meadow_chats.
// Counselors are real only when attached: a runner/Ollama URL for Jackie and
// Local Llama, API keys for Grok (xAI) and DeepSeek. Offline with nothing
// attached, the eYe says so instead of pretending.
import { get, put, all } from '../pwa/storage.js';
import { route, trace, COUNSELORS } from '../core/eye.js';

const SETTINGS_KEY = 'meadow:settings';

export function loadSettings() {
  try {
    return { runnerUrl: '', xaiKey: '', deepseekKey: '', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { runnerUrl: '', xaiKey: '', deepseekKey: '' };
  }
}
export function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

export function endpointFor(counselor, s = loadSettings()) {
  switch (counselor) {
    case 'jackie':
    case 'llama':
      return s.runnerUrl ? { base: s.runnerUrl, key: '', model: 'llama-3.2-3b-instruct' } : null;
    case 'grok':
      return s.xaiKey ? { base: 'https://api.x.ai/v1', key: s.xaiKey, model: 'grok-3-mini' } : null;
    case 'deepseek':
      return s.deepseekKey ? { base: 'https://api.deepseek.com/v1', key: s.deepseekKey, model: 'deepseek-chat' } : null;
    default:
      return null;
  }
}

const PERSONA = {
  jackie: 'You are Meta Jackie, the balanced counselor of the Meadow (temperament 0.15). Calm, brief, practical.',
  grok: 'You are Grok, the wild counselor of the Meadow. Lateral, surprising, still useful. Brief.',
  deepseek: 'You are DeepSeek, the scribe of the Meadow. Precise, structured, concise.',
  llama: 'You are Local Llama, the offline counselor of the Meadow. Brief.',
};

/** Stream an OpenAI-compatible SSE completion. Yields text deltas. */
export async function* streamCounselor(counselor, history, { signal, fetchImpl = fetch } = {}) {
  const ep = endpointFor(counselor);
  if (!ep) throw Object.assign(new Error('not attached'), { code: 'NOT_ATTACHED' });
  const res = await fetchImpl(`${ep.base.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', ...(ep.key ? { Authorization: `Bearer ${ep.key}` } : {}) },
    body: JSON.stringify({ model: ep.model, stream: true, max_tokens: 600, messages: [{ role: 'system', content: PERSONA[counselor] }, ...history] }),
  });
  if (!res.ok) throw new Error(`${COUNSELORS[counselor].name}: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const td = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += td.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const t = JSON.parse(data).choices?.[0]?.delta?.content;
        if (t) yield t;
      } catch {
        /* keep-alive or partial */
      }
    }
  }
}

export async function saveMessage(thread, msg) {
  const id = `${thread}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 6)}`;
  await put('meadow_chats', id, { thread, ...msg, at: Date.now() });
  return id;
}

export async function loadThread(thread) {
  return (await all('meadow_chats')).map(([, v]) => v).filter((m) => m.thread === thread).sort((a, b) => a.at - b.at);
}

export async function reputationTable() {
  return (await get('meadow_core', 'route-reputation')) || { jackie: 0.6, grok: 0.5, deepseek: 0.55, llama: 0.5 };
}
export async function rateRoute(counselor, useful) {
  const t = await reputationTable();
  t[counselor] = Math.max(0, Math.min(1, (t[counselor] ?? 0.5) + (useful ? 0.07 : -0.12)));
  await put('meadow_core', 'route-reputation', t);
  return t;
}

export { route, trace };
