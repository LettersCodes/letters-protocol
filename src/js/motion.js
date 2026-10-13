// Motion layer: damped spring solver, scroll reveal, parallax, spotlight, progress, count-up.
// Everything collapses to instant when the system asks for reduced motion or the viewer switches motion off.
const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
let userOff = false;

export const systemReduced = () => mq.matches;
export const motionOn = () => !mq.matches && !userOff;
export function setUserMotion(on) {
  userOff = !on;
  document.documentElement.dataset.motion = on ? 'on' : 'off';
  window.dispatchEvent(new Event('letters-motion'));
}

// A damped harmonic oscillator. Semi-implicit Euler on a fixed small step keeps it stable at any frame rate.
export class Spring {
  constructor(x = 0, { k = 170, c = 18, m = 1 } = {}) {
    this.x = x; this.v = 0; this.t = x; this.k = k; this.c = c; this.m = m;
  }
  step(dt) {
    const h = 1 / 240;
    let n = Math.min(60, Math.max(1, Math.ceil(dt / h)));
    const s = dt / n;
    while (n--) {
      const a = (-this.k * (this.x - this.t) - this.c * this.v) / this.m;
      this.v += a * s;
      this.x += this.v * s;
    }
  }
  get settled() { return Math.abs(this.x - this.t) < 0.01 && Math.abs(this.v) < 0.01; }
}

// One shared frame loop: tasks return true while they still need frames.
const tasks = new Set();
let raf = 0, last = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const t of [...tasks]) if (!t(dt, now)) tasks.delete(t);
  raf = tasks.size ? requestAnimationFrame(loop) : 0;
}
export function addTask(fn) {
  tasks.add(fn);
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
}

// Scroll reveal with staggered springs.
export function initReveal() {
  const els = [...document.querySelectorAll('[data-reveal]')];
  const show = (el) => { el.style.opacity = ''; el.style.transform = ''; el.classList.add('is-in'); };
  if (!motionOn() || !('IntersectionObserver' in window)) { els.forEach(show); return; }
  const play = (el, delay) => {
    const sp = new Spring(30, { k: 170, c: 20 });
    sp.t = 0;
    let started = false;
    setTimeout(() => {
      started = true;
      if (!motionOn()) { show(el); return; }
      addTask((dt) => {
        sp.step(dt);
        const p = Math.max(0, Math.min(1, 1 - sp.x / 30));
        el.style.opacity = String(p);
        el.style.transform = `translateY(${sp.x.toFixed(2)}px)`;
        if (sp.settled) { show(el); return false; }
        return true;
      });
    }, delay);
    return started;
  };
  const io = new IntersectionObserver((entries) => {
    const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
    vis.forEach((e, i) => { io.unobserve(e.target); play(e.target, i * 70); });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  els.forEach((e) => io.observe(e));
}

// Parallax depth layers: pointer and scroll drive springs; layers move through the individual `translate` property.
export function initParallax(stage) {
  const items = [...stage.querySelectorAll('[data-depth]')].map((el) => ({ el, d: parseFloat(el.dataset.depth) || 0 }));
  const px = new Spring(0, { k: 90, c: 16 }), py = new Spring(0, { k: 90, c: 16 }), sc = new Spring(0, { k: 120, c: 20 });
  let running = false;
  const apply = () => {
    for (const { el, d } of items) {
      el.style.translate = `${(-px.x * d * 30).toFixed(2)}px ${(-py.x * d * 22 + sc.x * d * 90).toFixed(2)}px`;
    }
  };
  const kick = () => {
    if (running || !motionOn()) return;
    running = true;
    addTask((dt) => {
      px.step(dt); py.step(dt); sc.step(dt);
      apply();
      if (px.settled && py.settled && sc.settled) { running = false; return false; }
      return true;
    });
  };
  const onScroll = () => {
    if (!motionOn()) return;
    const r = stage.getBoundingClientRect();
    sc.t = Math.max(-1, Math.min(1, -r.top / Math.max(1, r.height)));
    kick();
  };
  stage.addEventListener('pointermove', (e) => {
    if (!motionOn() || e.pointerType === 'touch') return;
    const r = stage.getBoundingClientRect();
    px.t = ((e.clientX - r.left) / r.width) * 2 - 1;
    py.t = ((e.clientY - r.top) / r.height) * 2 - 1;
    kick();
  }, { passive: true });
  stage.addEventListener('pointerleave', () => { px.t = 0; py.t = 0; kick(); });
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// Spotlight: a CSS pool of light that tracks the pointer over any .spot element.
export function initSpotlight() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let cur = null;
  document.addEventListener('pointermove', (e) => {
    const t = e.target instanceof Element ? e.target.closest('.spot') : null;
    if (cur && cur !== t) cur.classList.remove('lit');
    if (t) {
      const r = t.getBoundingClientRect();
      t.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      t.style.setProperty('--my', (e.clientY - r.top) + 'px');
      t.classList.add('lit');
    }
    cur = t;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { if (cur) cur.classList.remove('lit'); cur = null; });
}

export function initProgress() {
  const bar = document.querySelector('#progress i');
  if (!bar) return;
  const upd = () => {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.transform = `scaleX(${h > 0 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0})`;
  };
  window.addEventListener('scroll', upd, { passive: true });
  window.addEventListener('resize', upd);
  upd();
}

// Count-up: eases from the old value to the new one, then the caller flashes the cell.
export function tween(el, from, to, fmt, duration = 700) {
  if (el._tw) el._tw.dead = true;
  if (!motionOn() || !Number.isFinite(from) || !Number.isFinite(to) || from === to) { el.textContent = fmt(to); return; }
  const job = { dead: false };
  el._tw = job;
  const t0 = performance.now();
  addTask((dt, now) => {
    if (job.dead) return false;
    const t = Math.min(1, (now - t0) / duration);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (t >= 1) { el.textContent = fmt(to); return false; }
    return true;
  });
}

export function flash(el, dir) {
  if (!motionOn() || !dir) return;
  el.classList.remove('flash-up', 'flash-dn');
  void el.offsetWidth;
  el.classList.add(dir > 0 ? 'flash-up' : 'flash-dn');
}

// Keep --hh in step with the real height of the sticky top bar.
export function initBarHeight() {
  const bar = document.getElementById('top-bar');
  if (!bar) return;
  const set = () => document.documentElement.style.setProperty('--hh', bar.offsetHeight + 'px');
  set();
  if ('ResizeObserver' in window) new ResizeObserver(set).observe(bar);
  window.addEventListener('resize', set);
}

export function initSpy() {
  const links = [...document.querySelectorAll('#nav a[data-spy]')];
  if (!links.length || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.setAttribute('aria-current', String(a.dataset.spy === e.target.id)));
    }
  }, { rootMargin: '-40% 0px -55% 0px' });
  for (const a of links) { const s = document.getElementById(a.dataset.spy); if (s) io.observe(s); }
}
