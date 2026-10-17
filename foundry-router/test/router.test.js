import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createSSEParser,
  extractDelta,
  streamProvider,
  routeChat,
  selectRouter,
  backoffDelay,
  resolveModel,
  providerById,
  toAnthropicMessages,
  PROVIDERS,
  CHIPS,
  _resetWindows,
  _resetModelCache,
} from '../src/router.js';

beforeEach(() => {
  _resetWindows();
  _resetModelCache();
});

function sseResponse(chunks, status = 200) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}
const jsonResponse = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });
const delta = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;

async function drain(gen) {
  let text = '';
  for await (const d of gen) if (d.text) text += d.text;
  return text;
}

test('SSE parser handles split lines, CRLF split across chunks, comments and multi-line data', () => {
  const p = createSSEParser();
  const events = [
    ...p.push(': keep-alive\n\nda'),
    ...p.push('ta: {"a":1}\r'),
    ...p.push('\n\r\nevent: content_block_delta\ndata: line1\ndata: line2\n'),
    ...p.push('\ndata: [DONE]'),
    ...p.end(),
  ];
  assert.deepEqual(events, [
    { event: 'message', data: '{"a":1}' },
    { event: 'content_block_delta', data: 'line1\nline2' },
    { event: 'message', data: '[DONE]' },
  ]);
});

test('extractDelta understands OpenAI and Anthropic shapes', () => {
  assert.equal(extractDelta('openai', { data: JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }) }).text, 'hi');
  assert.equal(extractDelta('openai', { data: '[DONE]' }).done, true);
  assert.equal(
    extractDelta('anthropic', { data: JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'yo' } }) }).text,
    'yo',
  );
  assert.equal(extractDelta('anthropic', { data: JSON.stringify({ type: 'message_stop' }) }).done, true);
  assert.match(extractDelta('openai', { data: JSON.stringify({ error: { message: 'boom' } }) }).error, /boom/);
});

test('streamProvider streams deltas incrementally from a real ReadableStream', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return sseResponse([delta('Hel'), delta('lo'), 'data: [DONE]\n\n']);
  };
  const p = providerById('groq');
  const text = await drain(streamProvider(p, { model: 'm', messages: [{ role: 'user', content: 'x' }], apiKey: 'k', fetchImpl }));
  assert.equal(text, 'Hello');
  assert.equal(seen.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(seen.init.headers.Authorization, 'Bearer k');
  assert.equal(JSON.parse(seen.init.body).stream, true);
});

test('OpenRouter sends HTTP-Referer and X-Title; Anthropic sends browser headers', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return sseResponse(['data: [DONE]\n\n']);
  };
  await drain(streamProvider(providerById('openrouter'), { model: 'm', messages: [], apiKey: 'k', fetchImpl }));
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].init.headers['X-Title'], 'Foundry Router');
  assert.ok(calls[0].init.headers['HTTP-Referer']);
  await drain(streamProvider(providerById('anthropic'), { model: 'm', messages: [{ role: 'user', content: 'x' }], apiKey: 'k', fetchImpl }));
  assert.equal(calls[1].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[1].init.headers['x-api-key'], 'k');
  assert.equal(calls[1].init.headers['anthropic-dangerous-direct-browser-access'], 'true');
});

test('anthropic message mapping: system lifted, roles merged, starts with user', () => {
  const r = toAnthropicMessages([
    { role: 'system', content: 'be kind' },
    { role: 'assistant', content: 'stale' },
    { role: 'user', content: 'a' },
    { role: 'user', content: 'b' },
    { role: 'assistant', content: 'c' },
  ]);
  assert.equal(r.system, 'be kind');
  assert.deepEqual(r.messages, [
    { role: 'user', content: 'a\n\nb' },
    { role: 'assistant', content: 'c' },
  ]);
});

test('backoff is 500ms * 2^n, capped, and honours Retry-After', () => {
  assert.deepEqual([0, 1, 2, 3].map((n) => backoffDelay(n)), [500, 1000, 2000, 4000]);
  assert.equal(backoffDelay(10), 8000);
  assert.equal(backoffDelay(0, 3000), 3000);
});

test('429 retries with exponential backoff then succeeds', async () => {
  const delays = [];
  let n = 0;
  const fetchImpl = async () => (++n <= 2 ? jsonResponse({ error: { message: 'rate limited' } }, 429) : sseResponse([delta('ok'), 'data: [DONE]\n\n']));
  const events = [];
  const plan = selectRouter({ chain: ['groq'] });
  const text = await drain(
    routeChat({ messages: [{ role: 'user', content: 'x' }], plan, keys: { GROQ_API_KEY: 'k' }, fetchImpl, sleepImpl: async (ms) => delays.push(ms), onEvent: (e) => events.push(e) }),
  );
  assert.equal(text, 'ok');
  assert.deepEqual(delays, [500, 1000]);
  assert.equal(events.at(-1).badge, 'Groq · llama-3.3-70b-versatile');
});

test('auth failure fails over down the chain; missing keys are skipped', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('groq')) return jsonResponse({ error: { message: 'invalid api key' } }, 401);
    if (url.includes('openrouter')) return sseResponse([delta('from openrouter'), 'data: [DONE]\n\n']);
    throw new Error('unexpected ' + url);
  };
  const events = [];
  const plan = selectRouter({ chain: ['groq', 'cerebras', 'openrouter'] });
  const text = await drain(
    routeChat({ messages: [{ role: 'user', content: 'x' }], plan, keys: { GROQ_API_KEY: 'bad', OPENROUTER_API_KEY: 'k' }, fetchImpl, onEvent: (e) => events.push(e) }),
  );
  assert.equal(text, 'from openrouter');
  assert.deepEqual(events.filter((e) => e.type !== 'attempt').map((e) => `${e.type}:${e.provider}`), ['failover:groq', 'skip:cerebras', 'done:openrouter']);
});

test('network/CORS errors fail over', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('groq')) throw new TypeError('Failed to fetch');
    return sseResponse([delta('ollama says hi'), 'data: [DONE]\n\n']);
  };
  const plan = selectRouter({ chain: ['groq', 'ollama'] });
  const text = await drain(routeChat({ messages: [{ role: 'user', content: 'x' }], plan, keys: { GROQ_API_KEY: 'k' }, fetchImpl }));
  assert.equal(text, 'ollama says hi');
});

test('retired model IDs heal through GET /models', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'whisper-large-v3' }, { id: 'gpt-oss-120b' }, { id: 'llama-3.3-70b' }] });
    const body = JSON.parse(init.body);
    bodies.push(body.model);
    if (body.model === 'llama-3.3-70b-retired') return jsonResponse({ error: { message: 'The model `llama-3.3-70b-retired` does not exist' } }, 404);
    return sseResponse([delta(`served by ${body.model}`), 'data: [DONE]\n\n']);
  };
  const events = [];
  const plan = { steps: [{ provider: 'cerebras', model: 'llama-3.3-70b-retired' }] };
  const text = await drain(routeChat({ messages: [{ role: 'user', content: 'x' }], plan, keys: { CEREBRAS_API_KEY: 'k' }, fetchImpl, onEvent: (e) => events.push(e) }));
  assert.equal(text, 'served by llama-3.3-70b');
  assert.ok(events.some((e) => e.type === 'heal' && e.to === 'llama-3.3-70b'));
});

test('never fails over after partial output (no spliced answers)', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('groq')) return sseResponse([delta('partial'), `data: ${JSON.stringify({ error: { message: 'upstream died' } })}\n\n`]);
    return sseResponse([delta('SHOULD NOT APPEAR')]);
  };
  const plan = selectRouter({ chain: ['groq', 'ollama'] });
  let text = '';
  await assert.rejects(async () => {
    for await (const d of routeChat({ messages: [{ role: 'user', content: 'x' }], plan, keys: { GROQ_API_KEY: 'k' }, fetchImpl })) text += d.text || '';
  }, /upstream died/);
  assert.equal(text, 'partial');
});

test('local request window enforces the free-tier rpm', async () => {
  const fetchImpl = async () => sseResponse([delta('.'), 'data: [DONE]\n\n']);
  const plan = { steps: [{ provider: 'openrouter', model: 'm' }] };
  const run = () => drain(routeChat({ messages: [{ role: 'user', content: 'x' }], plan, keys: { OPENROUTER_API_KEY: 'k' }, fetchImpl }));
  for (let i = 0; i < 20; i++) await run();
  await assert.rejects(run, /local window full/);
});

test('eYe gates force the offline WebLLM engine only', () => {
  assert.deepEqual(selectRouter({ system: { battery: 14 } }).steps.map((s) => s.provider), ['webllm']);
  assert.deepEqual(selectRouter({ system: { thermal: 71 } }).steps.map((s) => s.provider), ['webllm']);
  const normal = selectRouter({ system: { battery: 80, thermal: 40 }, chip: CHIPS.find((c) => c.id === 'grok-mini') });
  assert.equal(normal.steps[0].provider, 'xai');
  assert.ok(!normal.steps.some((s) => s.provider === 'anyscale'));
});

test('local engines stream through the same fabric', async () => {
  const plan = selectRouter({ system: { battery: 10 } });
  const text = await drain(
    routeChat({
      messages: [{ role: 'user', content: 'x' }],
      plan,
      localEngines: {
        webllm: async function* () {
          yield { text: 'offline ' };
          yield { text: 'answer', model: 'SmolLM2-135M-Instruct-q0f16-MLC' };
        },
      },
    }),
  );
  assert.equal(text, 'offline answer');
});

test('resolveModel prefers the desired id, then prefs, skipping non-chat models', () => {
  assert.equal(resolveModel('a', ['a', 'b'], []), 'a');
  assert.equal(resolveModel('x', ['whisper-large-v3', 'gemma-7b', 'llama-3.1-8b-instant'], ['llama']), 'llama-3.1-8b-instant');
  assert.equal(resolveModel('x', ['text-embedding-3', 'gpt-4o-mini'], ['nope']), 'gpt-4o-mini');
});

test('api_forge_config.json mirrors the provider registry', () => {
  const cfg = JSON.parse(readFileSync(new URL('../api_forge_config.json', import.meta.url), 'utf8'));
  assert.deepEqual(
    cfg.fallbackChain.map((p) => [p.id, p.baseUrl, p.model, p.keyEnv, p.rpm]),
    PROVIDERS.map((p) => [p.id, p.baseUrl, p.model, p.keyEnv, p.rpm]),
  );
  assert.equal(cfg.backoff.baseMs, 500);
});
