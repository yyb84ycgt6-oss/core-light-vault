import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeScam, SCAM_PATTERNS, SCAM_SAMPLE } from '../src/toolbox/scamDetector.js';
import { analyzeCode, CODE_SAMPLE } from '../src/toolbox/codeAnalyzer.js';
import { scoreDomains, crossLinks, DOMAINS } from '../src/toolbox/knowledgeMatrix.js';
import { ringOrder, hitTest, segmentAngles } from '../src/toolbox/prismRing.js';
import { appendLog, readLog, verifyLog, clearLog } from '../src/toolbox/transparencyLog.js';
import { fsWrite, fsRead, fsList, fsRename, fsDelete, fsMkdir, fsBackend, saveWorkingSet, detectDotSaved } from '../src/toolbox/fileSystem.js';
import { idbGetAll, idbPut, STORES } from '../src/storage/idb.js';
import { TOOLS } from '../src/toolbox/index.js';

test('there are exactly 10 tools', () => assert.equal(TOOLS.length, 10));

test('scam detector: 10 patterns weighted 0.85-0.92, sample is high risk, benign text is clean', () => {
  assert.equal(SCAM_PATTERNS.length, 10);
  for (const p of SCAM_PATTERNS) assert.ok(p.weight >= 0.85 && p.weight <= 0.92);
  const r = analyzeScam(SCAM_SAMPLE);
  assert.equal(r.level, 'high');
  assert.ok(r.risk > 0.99);
  for (const id of ['credentials', 'payment-rails', 'impersonation', 'urgency', 'links', 'advance-fee']) assert.ok(r.matches.some((m) => m.id === id), id);
  const clean = analyzeScam('Lunch at noon? I can bring the notes from yesterday.');
  assert.equal(clean.level, 'none');
  assert.equal(clean.risk, 0);
  assert.ok(analyzeScam('Срочно сообщите код из смс').risk > 0.75); // 1-(1-.92*.6)(1-.87*.6) = 0.786
});

test('code analyzer finds every planted issue through the AST and grades F', () => {
  const r = analyzeCode(CODE_SAMPLE);
  assert.equal(r.mode, 'ast');
  const rules = new Set(r.findings.map((f) => f.rule));
  for (const rule of ['eval', 'innerHTML', 'secret', 'randomToken', 'unguardedAwait', 'unguardedParse', 'consoleLog']) assert.ok(rules.has(rule), rule);
  assert.equal(r.grade, 'F');
  assert.deepEqual(r.outline.map((o) => `${o.kind}:${o.name}`), ['import:./client.js', 'const:API_KEY', 'async fn:login']);
});

test('code analyzer respects try/catch and passes clean code', () => {
  const r = analyzeCode(`export async function ok(){ try { const r = await fetch('/x'); return JSON.parse(await r.text()); } catch (e) { return null; } }`);
  assert.equal(r.findings.length, 0);
  assert.equal(r.grade, 'A');
  const ts = analyzeCode('const x: number = 1; console.log(x)');
  assert.equal(ts.mode, 'pattern');
  assert.ok(ts.findings.some((f) => f.rule === 'consoleLog'));
});

test('knowledge matrix scores 24 domains and links mirrors', () => {
  assert.equal(DOMAINS.length, 24);
  const s = scoreDomains('AES-GCM encrypt with a nonce and key hash; gematria is a hidden cipher of letters in the sephirot.');
  const top = [...s].sort((a, b) => b.score - a.score);
  assert.equal(top[0].id, 'crypto');
  assert.ok(crossLinks(s).some((l) => l.tech === 'crypto' && l.esoteric === 'kabbalah'));
});

test('prism ring: 24 segments, mirrors opposite, hit-test agrees with geometry', () => {
  const order = ringOrder();
  assert.equal(order.length, 24);
  assert.equal(order[0].mirror, order[12].id);
  for (let i = 0; i < 24; i++) {
    const { mid } = segmentAngles(i);
    assert.equal(hitTest(Math.cos(mid) * 100, Math.sin(mid) * 100, 80, 120), i);
  }
  assert.equal(hitTest(0, 0, 80, 120), -1);
});

test('transparency log is a verifiable hash chain and detects edits', async () => {
  await clearLog();
  await appendLog({ type: 'attempt', provider: 'groq', model: 'm' });
  await appendLog({ type: 'failover', provider: 'groq', detail: '401' });
  await appendLog({ type: 'done', provider: 'cerebras', model: 'm2' });
  assert.equal((await readLog()).length, 3);
  assert.deepEqual(await verifyLog(), { ok: true, entries: 3, brokenAt: null });
  const all = await idbGetAll(STORES.log);
  await idbPut(STORES.log, { ...all[1], detail: 'edited' });
  const v = await verifyLog();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, all[1].seq);
});

test('file system (IndexedDB backend): folders, save/open/rename/delete, dotSaved', async () => {
  assert.equal(await fsBackend(), 'idb');
  await fsMkdir('lore/dragon');
  await fsWrite('lore', 'jade.md', '# Jade');
  await fsWrite('lore/dragon', 'veil.md', 'scales');
  assert.deepEqual((await fsList('lore')).map((e) => `${e.kind}:${e.name}`), ['directory:dragon', 'file:jade.md']);
  assert.deepEqual((await fsList('')).map((e) => `${e.kind}:${e.name}`), ['directory:lore']);
  assert.equal(await fsRead('lore', 'jade.md'), '# Jade');
  await fsRename('lore', 'jade.md', 'jade-atelier.md');
  assert.equal(await fsRead('lore', 'jade-atelier.md'), '# Jade');
  await assert.rejects(fsRead('lore', 'jade.md'));
  await assert.rejects(fsWrite('lore', '../escape', 'x'));
  await assert.rejects(fsWrite('../up', 'a', 'x'));

  const saved = await saveWorkingSet([{ name: 'n.txt', folder: 'notes', content: 'hi', dotSaved: false }]);
  assert.equal(saved[0].dotSaved, true);
  assert.equal(await detectDotSaved({ name: 'n.txt', folder: 'notes', content: 'hi' }), true);
  assert.equal(await detectDotSaved({ name: 'n.txt', folder: 'notes', content: 'changed' }), false);

  await fsDelete('', 'lore', { directory: true });
  assert.deepEqual((await fsList('')).map((e) => e.name), ['notes']);
});
