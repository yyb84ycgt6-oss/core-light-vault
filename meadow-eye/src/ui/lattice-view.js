// LATTICE: the 141-agent meadow drawn on canvas. Trails fade at 0.08 alpha,
// thickness follows reputation, escalations travel as amber pulses, the human
// curator sits hollow at the centre. Pauses off-screen; DPR capped at 1.5.
import { h } from './dom.js';
import { createLattice, step, perceive, counselors } from '../lattice/agents.js';
import { createReputation, standing, signal, topPeers, specialization } from '../lattice/reputation.js';
import { shouldEscalate, packet, dualResponse, PATH } from '../lattice/bridge.js';

export const world = { L: createLattice(), rep: createReputation(), formation: null };

export function drawLattice(canvas, { formation = null, interactive = true } = {}) {
  const ctx = canvas.getContext('2d');
  const W = world;
  let raf = 0;
  let alive = true;
  let tick = 0;
  const resize = () => {
    const dpr = Math.min(1.5, devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, r.width * dpr);
    canvas.height = Math.max(1, r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080a12';
    ctx.fillRect(0, 0, r.width, r.height);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const frame = () => {
    raf = 0;
    if (!alive || document.hidden) return;
    const r = canvas.getBoundingClientRect();
    const cx = r.width / 2;
    const cy = r.height / 2;
    const scale = Math.min(r.width, r.height) / 440;
    step(W.L);
    if (++tick % 10 === 0) {
      const res = perceive(W.L);
      signal(W.rep, res.agent, (res.agent + 1) % 141, Math.random() > 0.25);
    }
    // Trails: fade instead of clear.
    ctx.fillStyle = 'rgba(8,10,18,0.08)';
    ctx.fillRect(0, 0, r.width, r.height);
    const f = formation || W.formation;
    W.L.agents.forEach((a, i) => {
      let { x, y } = a;
      if (f?.length && a.ring !== 'counselor') {
        const t = f[i % f.length];
        a.x += (t[0] / scale - a.x) * 0.08;
        a.y += (t[1] / scale - a.y) * 0.08;
        x = a.x;
        y = a.y;
      }
      const px = cx + x * scale;
      const py = cy + y * scale;
      const size = a.size * (a.ring === 'counselor' ? 1 : 0.6 + standing(W.rep, i) * 0.8) * Math.max(0.6, scale);
      ctx.beginPath();
      ctx.fillStyle = a.color;
      ctx.shadowColor = a.color;
      ctx.shadowBlur = a.ring === 'counselor' ? 18 : a.ring === 'outer' ? 4 : 8;
      ctx.arc(px, py, size / 2, 0, Math.PI * 2);
      ctx.fill();
      if (a.ring === 'middle' && i % 3 === 0) {
        const b = W.L.agents[100 + ((i - 100 + 1) % 30)];
        ctx.strokeStyle = 'rgba(216,184,106,0.12)';
        ctx.lineWidth = Math.max(0.5, standing(W.rep, i) * 3 * scale);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(cx + b.x * scale, cy + b.y * scale);
        ctx.stroke();
      }
    });
    ctx.shadowBlur = 0;
    for (const p of W.L.pulses) {
      const a = W.L.agents[p.from];
      const b = W.L.agents[p.to];
      ctx.fillStyle = `rgba(245,158,11,${1 - p.t})`;
      ctx.beginPath();
      ctx.arc(cx + (a.x + (b.x - a.x) * p.t) * scale, cy + (a.y + (b.y - a.y) * p.t) * scale, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Human curator: hollow white centre.
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 9 * Math.max(0.7, scale), 0, Math.PI * 2);
    ctx.stroke();
    raf = requestAnimationFrame(frame);
  };
  const start = () => !raf && alive && (raf = requestAnimationFrame(frame));
  const io = new IntersectionObserver(([e]) => e.isIntersecting && start());
  io.observe(canvas);
  document.addEventListener('visibilitychange', start);
  start();
  return {
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', start);
    },
  };
}

export function renderLattice(root) {
  const canvas = h('canvas.lattice', { 'aria-label': 'Meadow lattice of 141 agents' });
  const stats = h('div.mono.dim');
  const slider = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: world.L.autonomy, 'aria-label': 'Autonomy' });
  const label = h('span.mono', {}, `autonomy ${world.L.autonomy.toFixed(2)}`);
  slider.oninput = () => {
    world.L.autonomy = +slider.value;
    label.textContent = `autonomy ${(+slider.value).toFixed(2)}${Math.abs(slider.value - 0.65) < 0.02 ? ' · sweet spot' : ''}`;
  };
  const bridgeOut = h('div');
  const runBridge = () => {
    const ctx = { uncertainty: 0.78, attempted: 3, resource: 0.4, novelty: 0.6 };
    if (!shouldEscalate(ctx)) return;
    const pkt = packet({ seed: 'Z3 }0{ EZ', context: 'A sensor cannot classify a recurring signal in the outer ring.', ...ctx });
    const r = dualResponse(pkt);
    bridgeOut.replaceChildren(
      h('div.mono.dim', {}, `packet ${new TextEncoder().encode(pkt).length} B ≤ 512 · path ${PATH.join(' → ')}`),
      ...['jackie', 'grok'].map((who) =>
        h('div.card.rough', { style: { borderColor: who === 'jackie' ? '#a8ff8a' : '#c49bff' } },
          h('div', {}, r[who]),
          h('button.btn.sm', { onclick: (e) => { e.target.textContent = 'Re-injected via middle ring'; e.target.disabled = true; } }, 'Re-inject'),
        ),
      ),
      h('div.dim', {}, 'You choose what returns to the meadow. Autonomy stays with the swarm.'),
    );
  };
  const view = drawLattice(canvas);
  const timer = setInterval(() => {
    const s = world.L.stats;
    const c = counselors(world.L);
    const peers = topPeers(world.rep, 0, 5).map((p) => `${p.j}:${p.trust.toFixed(2)}`).join(' ');
    const roles = ['outer', 'middle', 'inner'].map((ring) => {
      const a = world.L.agents.find((x) => x.ring === ring);
      return `${ring} #${a.id} ${specialization(a)}`;
    });
    stats.textContent = `signals ${s.signals} · handled locally ${s.signals ? Math.round((100 * s.handled) / s.signals) : 0}% · ↑middle ${s.escalated.outer} ↑inner ${s.escalated.middle} ↑counselor ${s.escalated.inner} · ${c.map((x) => x.glyph).join(' ')} · agent 0 trusts ${peers} · ${roles.join(' · ')}`;
  }, 500);
  root.append(
    h('section.page', {},
      h('h2', {}, 'Meadow Lattice · 141'),
      canvas,
      h('div.row', {}, label, slider),
      stats,
      h('div.legend.mono', {}, h('i', { style: { background: '#c8d8b8' } }), '100 sensors ', h('i', { style: { background: '#d8b86a' } }), '30 specialists ', h('i', { style: { background: '#8ab8ff' } }), '10 keepers ', h('i', { style: { background: '#a8ff8a' } }), 'Jackie ', h('i', { style: { background: '#c49bff' } }), 'Grok ', h('i.hollow'), 'you'),
      h('h2', {}, 'Counselor Bridge'),
      h('p.dim', {}, 'Escalates when uncertainty > 0.72, attempts ≥ 3, resource > 0.8 or novelty > 0.85, in a packet of at most 512 bytes.'),
      h('button.btn.primary', { onclick: runBridge }, 'Send a stuck signal upward'),
      bridgeOut,
    ),
  );
  return () => {
    clearInterval(timer);
    view.destroy();
  };
}
