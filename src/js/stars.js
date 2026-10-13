// Pixel starfield for the stage: two canvases (far and near) that the parallax layer moves independently.
// Colours are read from the tokens at runtime; nothing here names a colour.
import { addTask, motionOn } from './motion.js';

const LAYERS = [
  { id: 'stars-far', density: 5200, size: 2, alpha: [0.25, 0.6], accent: 0.12 },
  { id: 'stars-near', density: 9500, size: 3, alpha: [0.5, 1], accent: 0.3 },
];

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function initStars(stage) {
  const css = getComputedStyle(document.documentElement);
  const light = css.getPropertyValue('--cream-hi').trim();
  const cyan = css.getPropertyValue('--accent').trim();
  const layers = LAYERS.map((cfg, li) => {
    const cv = document.getElementById(cfg.id);
    return cv ? { cfg, cv, ctx: cv.getContext('2d'), stars: [], li } : null;
  }).filter(Boolean);
  if (!layers.length) return;

  const build = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const L of layers) {
      const w = Math.max(1, Math.round(L.cv.clientWidth)), h = Math.max(1, Math.round(L.cv.clientHeight));
      L.cv.width = Math.round(w * dpr); L.cv.height = Math.round(h * dpr);
      L.w = w; L.h = h; L.dpr = dpr;
      const rnd = seeded(7919 * (L.li + 1));
      const n = Math.round((w * h) / L.cfg.density);
      L.stars = Array.from({ length: n }, () => ({
        x: Math.floor(rnd() * w), y: Math.floor(rnd() * h),
        a: L.cfg.alpha[0] + rnd() * (L.cfg.alpha[1] - L.cfg.alpha[0]),
        ph: rnd() * Math.PI * 2, sp: 0.6 + rnd() * 1.6,
        c: rnd() < L.cfg.accent ? cyan : light,
      }));
    }
  };

  const draw = (t) => {
    for (const L of layers) {
      const { ctx, dpr, cfg } = L;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, L.w, L.h);
      for (const s of L.stars) {
        const tw = motionOn() ? 0.55 + 0.45 * Math.sin(t * 0.001 * s.sp + s.ph) : 1;
        ctx.globalAlpha = Math.max(0.08, s.a * tw);
        ctx.fillStyle = s.c;
        ctx.fillRect(s.x, s.y, cfg.size, cfg.size);
      }
    }
    for (const L of layers) L.ctx.globalAlpha = 1;
  };

  let visible = true, running = false, lastDraw = 0;
  const start = () => {
    if (running || !motionOn() || !visible) return;
    running = true;
    addTask((dt, now) => {
      if (!motionOn() || !visible) { running = false; return false; }
      if (now - lastDraw > 100) { lastDraw = now; draw(now); }
      return true;
    });
  };

  build();
  draw(0);
  if ('ResizeObserver' in window) new ResizeObserver(() => { build(); draw(performance.now()); }).observe(stage);
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) start(); }).observe(stage);
  window.addEventListener('letters-motion', () => { draw(performance.now()); start(); });
  start();
}
