import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedArchive, access, decayDay, query, returnToInfinity, state, remember, listArchive } from '../src/archive/living-archive.js';
import { createReputation, signal, decayDay as repDecay, topPeers, trust, N } from '../src/lattice/reputation.js';
import { shouldEscalate, packet, MAX_PACKET, dualResponse } from '../src/lattice/bridge.js';
import { createLattice, step, perceive } from '../src/lattice/agents.js';
import { evaluate, decline, acceptLearned, initialConsent } from '../src/pwa/battery.js';
import { mulberry32 } from '../src/core/y-collapse.js';

test('living archive: 14 seeds, decay, access boost, compost, return to infinity keeps essence', async () => {
  const seeds = await seedArchive();
  assert.equal(seeds.length, 14);
  const e = seeds[0];
  await decayDay(30);
  let all = await listArchive();
  const after = all.find((x) => x.id === e.id);
  assert.ok(Math.abs(after.decay - 0.99 ** 30) < 1e-9);
  const boosted = await access(e.id);
  assert.ok(Math.abs(boosted.decay - (0.99 ** 30 + 0.07)) < 1e-9);
  await decayDay(200);
  all = await listArchive();
  assert.equal(state(all.find((x) => x.id === e.id)), 'compost');
  const ess = await returnToInfinity(e.id);
  assert.equal(ess.infinity, true);
  assert.equal(ess.text, undefined);
  assert.ok(ess.vec.length === 32);
  const fresh = await remember('dawn', 'balanced neutron eye at rest');
  const hits = await query('neutron eye');
  assert.equal(hits[0].e.id, fresh.id);
  assert.ok(!hits.some((h) => h.e.id === e.id));
});

test('signal reputation: 141x141 Float32 (~78 KB), +0.07 / -0.12, daily decay, top-5 peers', () => {
  const rep = createReputation();
  assert.equal(rep.m.length, N * N);
  assert.ok(rep.m.byteLength < 81 * 1024);
  assert.equal(trust(rep, 3, 3), 1);
  const t0 = trust(rep, 1, 2);
  assert.ok(t0 >= 0.45 && t0 <= 0.6);
  for (let i = 0; i < 4; i++) signal(rep, 1, 2, true);
  assert.equal(topPeers(rep, 1)[0].j, 2);
  signal(rep, 1, 2, false);
  assert.ok(Math.abs(trust(rep, 1, 2) - Math.min(1, t0 + 0.28) + 0.12) < 1e-5);
  const before = trust(rep, 5, 6);
  repDecay(rep);
  assert.ok(Math.abs(trust(rep, 5, 6) - before * 0.99) < 1e-6);
  assert.equal(topPeers(rep, 0).length, 5);
});

test('counselor bridge: triggers, 512-byte cap, 280-char context, dual voices', () => {
  assert.equal(shouldEscalate({ uncertainty: 0.73 }), true);
  assert.equal(shouldEscalate({ attempted: 3 }), true);
  assert.equal(shouldEscalate({ resource: 0.81 }), true);
  assert.equal(shouldEscalate({ novelty: 0.86 }), true);
  assert.equal(shouldEscalate({ uncertainty: 0.7, attempted: 2, resource: 0.8, novelty: 0.85 }), false);
  const p = packet({ seed: 'Z3 }0{ EZ', context: '漢'.repeat(400), attempted: 3, uncertainty: 0.8 });
  assert.ok(new TextEncoder().encode(p).length <= MAX_PACKET);
  const r = dualResponse(packet({ seed: 's', context: 'route the signal', attempted: 3 }));
  assert.ok(r.jackie.startsWith('}0{') && r.grok.startsWith('/\\/\\'));
});

test('lattice: 100/30/10/2 agents, escalation ~15% / 4% / 1%, organic motion', () => {
  const L = createLattice();
  const count = (ring) => L.agents.filter((a) => a.ring === ring).length;
  assert.deepEqual([count('outer'), count('middle'), count('inner'), count('counselor')], [100, 30, 10, 2]);
  const r = mulberry32(1);
  for (let i = 0; i < 50_000; i++) perceive(L, r);
  const { signals, escalated } = L.stats;
  assert.ok(Math.abs(escalated.outer / signals - 0.15) < 0.01);
  assert.ok(Math.abs(escalated.middle / escalated.outer - 0.04) < 0.01);
  assert.ok(L.stats.handled / signals > 0.8);
  const x0 = L.agents[0].x;
  for (let i = 0; i < 30; i++) step(L);
  assert.notEqual(L.agents[0].x, x0);
});

test('battery consent: ask once at 15%, honour No, learned offer only on the 4th triage', () => {
  let s = initialConsent();
  let r = evaluate(14, false, s);
  assert.equal(r.action, 'ask');
  s = decline(r.state);
  assert.equal(evaluate(13, false, s).action, 'none'); // honoured, no nagging this cycle
  for (let cycle = 1; cycle <= 4; cycle++) {
    s = evaluate(50, false, s).state; // recharge resets the cycle
    s = evaluate(14, false, s).state;
    r = evaluate(2, false, s);
    if (cycle < 4) {
      assert.equal(r.action, 'triage', `cycle ${cycle}`);
      s = decline(r.state, { triage: true });
    } else assert.equal(r.action, 'offer-learned');
  }
  s = acceptLearned(r.state);
  s = evaluate(80, true, s).state;
  assert.equal(evaluate(5, false, s).action, 'auto-pod');
  assert.equal(evaluate(4, false, evaluate(5, false, s).state).action, 'none');
});

