import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeTool, OPS, toMorse, fromMorse, TOOLS, morsePattern } from '../src/router/toolbox.js';
import { visualize } from '../src/router/code-visualizer.js';
import { downloadFile, assetStatus, readAsset, CHUNK } from '../src/router/download-manager.js';
import { streamCounselor, saveSettings } from '../src/router/chat.js';

test('13 tools', () => assert.equal(TOOLS.length, 13));

test('composed tools are undone by their mirror tools (equilibrium)', async () => {
  const text = 'Nothing deletes. It composts. }0{';
  for (const seq of [['{'], ['[', 'q'], ['~'], ['-_0_-', '{', '['], ['q', '-_0_-']]) {
    const tool = composeTool('t', seq);
    const back = composeTool('m', tool.mirror);
    const out = await tool.run(text);
    assert.notEqual(out, text);
    const restored = await back.run(out);
    assert.equal(seq.includes('~') ? restored.toUpperCase() : restored, seq.includes('~') ? 'NOTHING DELETES IT COMPOSTS 0' : text, `seq ${seq.join(' ')}`);
  }
  assert.equal(composeTool('h', ['0']).oneWay, true);
  assert.throws(() => composeTool('x', ['?']), /No operation/);
});

test('morse is its own mirror; vibration pattern timing', () => {
  assert.equal(toMorse('sos eye'), '... --- ... / . -.-- .');
  assert.equal(fromMorse(toMorse('meadow eye')), 'meadow eye');
  assert.deepEqual(morsePattern('.-'), [120, 120, 360, 120]);
  assert.equal(OPS['~'].label, 'morse ⇄ text');
});

test('code visualizer: AST path under the cursor, view routing, folds the rest', () => {
  const code = `function a() {\n  return 1;\n}\n\nfunction b(xs) {\n  for (const x of xs) {\n    log(x);\n  }\n}\n\nclass C {\n  m() {\n    return 2;\n  }\n}\n`;
  const cursor = code.indexOf('log(x)') + 1;
  const v = visualize(code, cursor);
  assert.equal(v.ok, true);
  assert.equal(v.view, 'call-chain');
  assert.deepEqual(v.path.map((p) => p.type).slice(0, 3), ['FunctionDeclaration', 'BlockStatement', 'ForOfStatement']);
  assert.match(v.folded, /function a\(\) \{ ⋯ folded 3 lines \}/);
  assert.match(v.folded, /class C \{ ⋯ folded 5 lines \}/);
  assert.match(v.folded, /log\(x\)/);
  assert.equal(visualize('const = ;', 0).ok, false);
});

test('download manager: ranged 8 MiB chunks into IndexedDB, resumes after a failure', async () => {
  const total = CHUNK * 2 + 1000;
  const bytes = new Uint8Array(total).map((_, i) => i % 251);
  let calls = 0;
  let failOnce = true;
  const fetchImpl = async (url, { headers = {} } = {}) => {
    calls++;
    const m = /bytes=(\d+)-(\d+)/.exec(headers.Range || '');
    if (!m) return new Response(bytes, { status: 200 });
    const [s, e] = [+m[1], +m[2]];
    if (s === CHUNK && failOnce) {
      failOnce = false;
      throw new TypeError('network dropped');
    }
    return new Response(bytes.slice(s, e + 1), { status: 206, headers: { 'content-range': `bytes ${s}-${e}/${total}` } });
  };
  const asset = { id: 'demo', files: [{ repo: 'r/x', file: 'f.bin', mb: 16 }] };
  await assert.rejects(downloadFile('demo', asset.files[0], { fetchImpl }), /network dropped/);
  let st = await assetStatus(asset);
  assert.equal(st.complete, false);
  assert.equal(st.loaded, CHUNK);
  const progress = [];
  await downloadFile('demo', asset.files[0], { fetchImpl, onProgress: (p) => progress.push(p.loaded) });
  st = await assetStatus(asset);
  assert.equal(st.complete, true);
  assert.equal(progress[0], CHUNK); // resumed, chunk 0 not refetched
  const blob = await readAsset('demo', 'f.bin');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  assert.ok(calls <= 5);
});

test('counselor stream: OpenAI SSE from an attached runner; refuses when nothing is attached', async () => {
  globalThis.localStorage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = v; } };
  saveSettings({ runnerUrl: '', xaiKey: '', deepseekKey: '' });
  await assert.rejects(async () => { for await (const _ of streamCounselor('jackie', [])); }, /not attached/);
  saveSettings({ runnerUrl: 'http://localhost:8080/v1' });
  const body = ['Hel', 'lo'].map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
  let seenUrl;
  const fetchImpl = async (url) => {
    seenUrl = url;
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  let text = '';
  for await (const t of streamCounselor('jackie', [{ role: 'user', content: 'hi' }], { fetchImpl })) text += t;
  assert.equal(text, 'Hello');
  assert.equal(seenUrl, 'http://localhost:8080/v1/chat/completions');
});
