// Shared bits for the canvas games: picker cards, stage, pointer tracking
// (finger or hand cursor), theme colours, particles and high scores.
import { h, glyph, button, fitCanvas } from '../core/ui.js';
import { loadJSON, saveJSON } from '../core/store.js';

export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  return { c: g('--c'), hi: g('--c-hi'), mid: g('--c-mid'), dim: g('--c-dim'), deep: g('--c-deep'), bg: g('--bg0'), bad: '#ff5c6c', ok: '#4dffb2', warn: '#ffc14d', hue: +g('--hue') || 188 };
}

export function best(key) { return loadJSON('best.' + key, 0); }
export function saveBest(key, score, lowerIsBetter = false) {
  const b = best(key);
  if (!b || (lowerIsBetter ? score < b : score > b)) { saveJSON('best.' + key, score); return true; }
  return false;
}

/** Card grid picker. items: [{id, title, desc, icon, tag}] */
export function picker(items, onPick) {
  const grid = h('div', { class: 'card-grid' });
  for (const it of items) {
    const card = h('div', { class: 'hcard', 'data-click': '' },
      it.tag ? h('div', { class: 'hc-tag' }, it.tag) : null,
      glyph(it.icon, 'hc-glyph'),
      h('div', { class: 'hc-title' }, it.title),
      h('div', { class: 'hc-desc' }, it.desc));
    card.addEventListener('click', () => onPick(it.id));
    grid.append(card);
  }
  return h('div', { class: 'scroll', 'data-scroll': '', style: { flex: '1' } }, grid);
}

/** A full-size canvas stage with HUD + game-over overlay. */
export function stage(container, { webgl = false } = {}) {
  const canvas = h('canvas');
  const hud = h('div', { class: 'game-hud' });
  const el = h('div', { class: 'game-stage' }, canvas, hud);
  container.append(el);
  const ctx = webgl ? null : canvas.getContext('2d');
  const st = { el, canvas, ctx, hud, w: 0, h: 0, dpr: 1, onResize: null };
  if (webgl) {
    // three.js manages the drawing buffer; just report the CSS size
    const ro = new ResizeObserver(() => {
      st.w = canvas.clientWidth; st.h = canvas.clientHeight; st.dpr = Math.min(2, devicePixelRatio || 1);
      if (st.w && st.h) st.onResize && st.onResize(st.w, st.h);
    });
    ro.observe(canvas);
    st.unfit = () => ro.disconnect();
  } else {
    st.unfit = fitCanvas(canvas, (w, hh, dpr) => {
      st.w = w; st.h = hh; st.dpr = dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      st.onResize && st.onResize(w, hh);
    });
  }
  st.overlay = (title, text, actions) => {
    st.clearOverlay();
    const ov = h('div', { class: 'game-over' }, h('h2', null, title), text ? h('p', null, text) : null,
      h('div', { class: 'go-row' }, actions.map(([label, fn, cls]) => button(label, fn, { cls: `big ${cls || ''}` }))));
    el.append(ov);
    st._ov = ov;
  };
  st.clearOverlay = () => { st._ov?.remove(); st._ov = null; };
  return st;
}

/** Tracks every pointer (finger or hand cursor) over an element, in element coords. */
export function pointerTracker(el) {
  const pts = new Map();
  const listeners = { down: [], up: [] };
  const pos = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const upd = (e, down) => {
    const [x, y] = pos(e);
    let p = pts.get(e.pointerId);
    if (!p) { p = { id: e.pointerId, x, y, down: false, hand: !!e.isHand }; pts.set(e.pointerId, p); }
    p.x = x; p.y = y; p.t = performance.now(); p.hand = !!e.isHand;
    if (down !== undefined) p.down = down;
    return p;
  };
  const onDown = (e) => { const p = upd(e, true); listeners.down.forEach((f) => f(p, e)); e.preventDefault(); };
  const onMove = (e) => upd(e);
  const onUp = (e) => { const p = upd(e, false); listeners.up.forEach((f) => f(p, e)); if (!p.hand) setTimeout(() => { if (!p.down) pts.delete(e.pointerId); }, 600); };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  const fresh = () => [...pts.values()].filter((p) => performance.now() - p.t < 700);
  return {
    on(type, fn) { listeners[type].push(fn); },
    all: fresh,
    latest() { return fresh().sort((a, b) => b.t - a.t)[0] || null; },
    destroy() {
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
    },
  };
}

/** requestAnimationFrame loop with dt (seconds, clamped). */
export function loop(fn) {
  let raf = 0, last = performance.now(), running = true;
  const step = (now) => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    fn(dt, now);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => { running = false; cancelAnimationFrame(raf); };
}

export class Particles {
  constructor() { this.list = []; }
  burst(x, y, color, n = 24, speed = 220) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      this.list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, color, size: 1.5 + Math.random() * 2.5 });
    }
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; p.life -= dt * 1.6;
      if (p.life <= 0) this.list.splice(i, 1);
    }
  }
  draw(ctx) {
    for (const p of this.list) { ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); }
    ctx.globalAlpha = 1;
  }
}

export function drawGrid(ctx, w, hh, color, step = 40) {
  ctx.strokeStyle = color; ctx.globalAlpha = 0.08; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = (w % step) / 2; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, hh); }
  for (let y = (hh % step) / 2; y < hh; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function glowText(ctx, text, x, y, size, color, align = 'center') {
  ctx.font = `900 ${size}px Orbitron, sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}
