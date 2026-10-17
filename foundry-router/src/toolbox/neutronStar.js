// Neutron Star viz: pulsing core, N tilted accretion-disk layers, a star field.
// iPhone budget: DPR capped at 1.5, one rAF loop, paused when the tab is hidden
// or the canvas scrolls off-screen, and prefers-reduced-motion honoured.
import { mulberry32 } from '../lib/collapse.js';

export const DPR_CAP = 1.5;

export function createNeutronStar(canvas, initial) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let params = { corePulse: 0.87, diskLayers: 6, stars: 200, ...initial };
  let stars = [];
  let w = 0;
  let h = 0;
  let raf = 0;
  let visible = true;
  let fps = 0;
  let frames = 0;
  let lastFpsT = performance.now();
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function seedStars() {
    const rand = mulberry32(200 + params.stars);
    stars = Array.from({ length: params.stars }, () => ({ x: rand(), y: rand(), r: rand() * 1.2 + 0.2, tw: rand() * Math.PI * 2 }));
  }

  function resize() {
    const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(t) {
    const s = t / 1000;
    ctx.fillStyle = '#05060d';
    ctx.fillRect(0, 0, w, h);
    for (const st of stars) {
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(st.tw + s * 1.7));
      ctx.fillStyle = `rgba(200,215,255,${a.toFixed(3)})`;
      ctx.fillRect(st.x * w, st.y * h, st.r, st.r);
    }
    const cx = w / 2;
    const cy = h / 2;
    const base = Math.min(w, h) * 0.09;
    const pulse = 1 + 0.18 * params.corePulse * Math.sin(s * Math.PI * 2 * 1.4);

    for (let i = 0; i < params.diskLayers; i++) {
      const rx = base * (2.1 + i * 0.55);
      const ry = rx * 0.28;
      const rot = -0.35 + s * (0.25 / (i + 1));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.35);
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      const hue = 190 + i * 22;
      ctx.strokeStyle = `hsla(${hue},95%,65%,${(0.55 - i * 0.06).toFixed(2)})`;
      ctx.lineWidth = Math.max(1, 3.2 - i * 0.35);
      ctx.setLineDash([rx * 0.35, rx * 0.12]);
      ctx.lineDashOffset = -rot * rx * 2;
      ctx.stroke();
      ctx.restore();
    }

    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 2.4 * pulse);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(170,220,255,0.95)');
    g.addColorStop(0.45, 'rgba(90,120,255,0.35)');
    g.addColorStop(1, 'rgba(20,30,90,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, base * 2.4 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // Polar beams (the pulsar lighthouse).
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(s * 0.9);
    const beam = ctx.createLinearGradient(0, -h, 0, h);
    beam.addColorStop(0, 'rgba(120,200,255,0)');
    beam.addColorStop(0.5, `rgba(160,220,255,${(0.18 * params.corePulse).toFixed(3)})`);
    beam.addColorStop(1, 'rgba(120,200,255,0)');
    ctx.fillStyle = beam;
    ctx.fillRect(-base * 0.25, -h, base * 0.5, h * 2);
    ctx.restore();
  }

  function loop(t) {
    raf = 0;
    if (!visible || document.hidden) return;
    draw(reduced ? 0 : t);
    frames++;
    if (t - lastFpsT >= 1000) {
      fps = Math.round((frames * 1000) / (t - lastFpsT));
      frames = 0;
      lastFpsT = t;
    }
    if (!reduced) raf = requestAnimationFrame(loop);
  }

  const start = () => {
    if (!raf) raf = requestAnimationFrame(loop);
  };
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        if (visible) start();
      })
    : null;
  io?.observe(canvas);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { resize(); start(); }) : null;
  ro?.observe(canvas);
  const onVis = () => !document.hidden && start();
  document.addEventListener('visibilitychange', onVis);

  seedStars();
  resize();
  start();

  return {
    update(next) {
      const starsChanged = next.stars !== undefined && next.stars !== params.stars;
      params = { ...params, ...next };
      if (starsChanged) seedStars();
      start();
    },
    get fps() {
      return fps;
    },
    destroy() {
      cancelAnimationFrame(raf);
      io?.disconnect();
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    },
  };
}
