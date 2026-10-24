import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('manifest: 100 unique models, 20/20/30/30, tiers match sizes, core 8 present', () => {
  const m = JSON.parse(read('public/models/manifest.json'));
  assert.equal(m.models.length, 100);
  assert.equal(new Set(m.models.map((x) => x.id)).size, 100);
  assert.deepEqual(m.groups, { 'ultra-tiny': 20, small: 20, medium: 30, balanced: 30 });
  for (const x of m.models) {
    const tier = x.sizeMB <= 100 ? 'green' : x.sizeMB <= 500 ? 'yellow' : x.sizeMB <= 1000 ? 'orange' : 'red';
    assert.equal(x.tier, tier, x.id);
    if (!x.local) assert.equal(x.url, `https://huggingface.co/${x.repo}/resolve/main/${x.file}`);
    if (x.runtime === 'webllm') assert.match(x.webllm, /-MLC$/);
  }
  assert.equal(m.core.length, 8);
  assert.equal(m.companion.models.length, 2);
  for (const g of m.companion.models) assert.match(g.file, /Q4_K_M\.gguf$/);
  for (const id of m.core) assert.ok(m.models.some((x) => x.id === id), id);
});

test('model_list.txt has one line per model, huggingface-cli ready', () => {
  const lines = read('model_list.txt').trim().split('\n');
  assert.equal(lines.length, 100);
  assert.equal(lines.filter((l) => l.startsWith('huggingface-cli download ')).length, 99);
  assert.equal(lines.filter((l) => l.startsWith('#')).length, 1); // BC-ResNet has no public weights
});

test('.env.example lists every keyed provider', () => {
  const env = read('.env.example');
  for (const k of ['GROQ_API_KEY', 'CEREBRAS_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'XAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'HF_TOKEN'])
    assert.match(env, new RegExp(`^VITE_${k}=$`, 'm'));
});
