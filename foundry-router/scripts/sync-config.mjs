// Regenerates api_forge_config.json and .env.example from src/router.js
// (the single source of truth). Run: npm run sync:config
import { writeFileSync } from 'node:fs';
import { PROVIDERS, LOCAL_PROVIDERS, CHIPS, BACKOFF_BASE_MS, BACKOFF_CAP_MS, MAX_RETRIES } from '../src/router.js';

const root = new URL('../', import.meta.url);

const config = {
  name: 'Meta Foundry Router v1 - API forge',
  note: 'Generated from src/router.js by scripts/sync-config.mjs. Model IDs drift; the router heals them via GET /models.',
  protocol: 'OpenAI-compatible POST {baseUrl}/chat/completions, stream:true, SSE "data:" lines (Anthropic: /messages)',
  backoff: { baseMs: BACKOFF_BASE_MS, capMs: BACKOFF_CAP_MS, maxRetriesPerProvider: MAX_RETRIES, retryOn: [429, 500, 502, 503, 504], formula: 'min(cap, max(base * 2^n, Retry-After))' },
  failover: { on: ['401/403 auth', 'network/CORS', 'model gone after heal attempt', 'retries exhausted', 'local rpm window full', 'no key'], neverAfterPartialOutput: true },
  eyeGates: { batteryPct: 15, thermalC: 70, action: 'force WebLLM offline only' },
  fallbackChain: PROVIDERS.map(({ id, label, kind, baseUrl, keyEnv, model, prefs, rpm, free, keyUrl, deprecated }) => ({
    id, label, kind, baseUrl, keyEnv, model, prefs, rpm, free, keyUrl: keyUrl || null, enabledByDefault: !deprecated,
  })),
  local: Object.values(LOCAL_PROVIDERS),
  chips: CHIPS,
};
writeFileSync(new URL('api_forge_config.json', root), JSON.stringify(config, null, 2) + '\n');

const env = [
  '# Foundry Router - local key vault shape.',
  '# Copy to .env.local for local dev only. VITE_* values are inlined into the JS bundle',
  '# at build time, so never build/deploy a public site with real keys in here.',
  '# The in-app vault (Router tab) stores keys in localStorage instead and only sends',
  '# each key to its own provider.',
  '',
  ...PROVIDERS.filter((p) => p.keyEnv).flatMap((p) => [
    `# ${p.label} - ${p.baseUrl} - ${p.free}${p.keyUrl ? ` - ${p.keyUrl}` : ''}`,
    `VITE_${p.keyEnv}=`,
    '',
  ]),
  '# Ollama needs no key. Override the base URL to reach it through a tunnel:',
  '# ngrok http 11434   or   cloudflared tunnel --url http://localhost:11434',
  'VITE_OLLAMA_BASE_URL=http://localhost:11434/v1',
  '',
];
writeFileSync(new URL('.env.example', root), env.join('\n'));
console.log('wrote api_forge_config.json and .env.example');
