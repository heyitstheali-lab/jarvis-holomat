// DOM helpers, holographic controls, panels (app windows), toasts and modals.
// Every control is built from plain click / pointer events so it works the same
// for a real finger on the glass and for the synthetic events from hand tracking.
import { sfx } from './audio.js';

export const NS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  appendKids(el, children);
  return el;
}

export function s(tag, props, ...children) {
  const el = document.createElementNS(NS, tag);
  applyProps(el, props, true);
  appendKids(el, children);
  return el;
}

function applyProps(el, props, isSvg = false) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (!isSvg && k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
}

function appendKids(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// ---------------------------------------------------------------- glyphs
// 24×24 stroke icons (drawn with currentColor).
export const GLYPHS = {
  games: 'M6 9.5h4M8 7.5v4M15.5 10h.01M18 8.5h.01M17.5 12h.01M7 5h10a5 5 0 0 1 5 5v2.5a3.5 3.5 0 0 1-6.3 2.1L14.5 13h-5l-1.2 1.6A3.5 3.5 0 0 1 2 12.5V10a5 5 0 0 1 5-5z',
  multiplayer: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9M12 3C9.4 5.6 8.2 8.6 8.2 12s1.2 6.4 3.8 9',
  circuit: 'M7 7h10v10H7zM9.5 3v4M14.5 3v4M9.5 17v4M14.5 17v4M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4M10 10h4v4h-4z',
  claude: 'M4 5h16v11H9l-5 4zM8 9.5h8M8 12.5h5M18.5 2.5l.7 1.5 1.5.7-1.5.7-.7 1.5-.7-1.5-1.5-.7 1.5-.7z',
  ruler: 'M3 16.5L16.5 3 21 7.5 7.5 21zM7 12.5l2 2M9.5 10l1.5 1.5M12 7.5l2 2M14.5 5l1.5 1.5',
  games3d: 'M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3zM12 12l8.5-4.7M12 12L3.5 7.3M12 12v9.5',
  jarvis: 'M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19zM12 6.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 1 0 0-11zM12 9.5l2.2 3.8H9.8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2',
  settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 1 0 0-7zM12 2l2 2.6 3.2-.6.6 3.2L20.4 9 19 12l1.4 3-2.6 1.8-.6 3.2-3.2-.6L12 22l-2-2.6-3.2.6-.6-3.2L3.6 15 5 12 3.6 9l2.6-1.8.6-3.2 3.2.6z',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1.5a6 6 0 0 1-4.8-2.4L3.2 15a1.6 1.6 0 0 1 2.5-2l2.3 2.4',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7',
  close: 'M5 5l14 14M19 5L5 19',
  back: 'M15 4l-8 8 8 8',
  send: 'M3 11.5L21 3l-8.5 18-2.2-7.3z',
  speaker: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  trash: 'M4 6.5h16M9 6.5V4h6v2.5M6.5 6.5l1 14h9l1-14M10 10v7M14 10v7',
  plus: 'M12 4v16M4 12h16',
  minus: 'M4 12h16',
  rotate: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
  download: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  sparkle: 'M12 3l1.8 4.6L18.5 9.5l-4.7 1.9L12 16l-1.8-4.6L5.5 9.5l4.7-1.9zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  play: 'M7 4.5v15l12-7.5z',
  refresh: 'M4 12a8 8 0 0 1 13.7-5.7L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.7L4 15.5M4 20v-4.5h4.5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3.6-3.6a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3.6 3.6a4 4 0 0 0 5.7 5.7l1-1',
  move: 'M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5',
  wire: 'M4 18h5V6h6v12h5M4 18a1.5 1.5 0 1 0 0 .01M20 18a1.5 1.5 0 1 0 0 .01',
  eye: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6z',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9zM12 11.2a.8.8 0 1 0 0 1.6.8.8 0 1 0 0-1.6z',
  power: 'M12 3v8M7.5 6.2a7.5 7.5 0 1 0 9 0',
  angle: 'M4 20h16M4 20L16 6M9.5 20a6 6 0 0 0-1.7-4.2',
  area: 'M4 4h16v16H4zM4 9h3M4 14h3M9 4v3M14 4v3',
  grid: 'M4 4h16v16H4zM4 12h16M12 4v16',
  card: 'M3 6h18v12H3zM3 10h18M6 15h4',
};

export function glyph(name, cls = '') {
  const el = s('svg', { viewBox: '0 0 24 24', class: cls, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  el.append(s('path', { d: GLYPHS[name] || GLYPHS.target }));
  return el;
}

// ---------------------------------------------------------------- controls
export function button(label, onClick, { cls = '', icon = null, title = null } = {}) {
  const b = h('button', { class: `hbtn ${cls}`, type: 'button', title: title || undefined });
  if (icon) b.append(glyph(icon));
  if (label) b.append(h('span', null, label));
  b.addEventListener('click', (e) => { sfx.click(); onClick && onClick(e); });
  return b;
}

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'seg' });
  const btns = options.map((o) => {
    const b = h('button', { class: 'hbtn' + (o.value === value ? ' on' : ''), type: 'button' }, o.label);
    b.addEventListener('click', () => {
      sfx.click();
      btns.forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      onChange(o.value);
    });
    return b;
  });
  wrap.append(...btns);
  wrap.setValue = (v) => btns.forEach((b, i) => b.classList.toggle('on', options[i].value === v));
  return wrap;
}

export function toggle(label, value, onChange, sub = null) {
  const el = h('div', { class: 'toggle' + (value ? ' on' : ''), role: 'switch' },
    h('div', null, h('div', { class: 'tg-label' }, label), sub ? h('div', { class: 'tg-sub' }, sub) : null),
    h('div', { class: 'tg-sw' }));
  el.addEventListener('click', () => {
    sfx.click();
    const on = !el.classList.contains('on');
    el.classList.toggle('on', on);
    onChange(on);
  });
  el.setValue = (v) => el.classList.toggle('on', !!v);
  return el;
}

/** Pointer-driven slider (native range inputs can't be dragged by synthetic hand events). */
export function slider({ min = 0, max = 1, step = 0.01, value = 0, onInput, onChange }) {
  const el = h('div', { class: 'hslider' });
  const track = h('div', { class: 'hs-track' });
  const fill = h('div', { class: 'hs-fill' });
  const knob = h('div', { class: 'hs-knob' });
  el.append(track, fill, knob);
  let v = value;
  const render = () => {
    const f = (v - min) / (max - min);
    const w = el.clientWidth - 24;
    knob.style.left = `${12 + f * w}px`;
    fill.style.width = `${f * w}px`;
  };
  const fromX = (clientX) => {
    const r = el.getBoundingClientRect();
    let f = (clientX - r.left - 12) / Math.max(1, r.width - 24);
    f = Math.min(1, Math.max(0, f));
    let nv = min + f * (max - min);
    nv = Math.round(nv / step) * step;
    nv = +nv.toFixed(6);
    if (nv !== v) { v = nv; render(); onInput && onInput(v); }
  };
  let dragging = null;
  el.addEventListener('pointerdown', (e) => {
    dragging = e.pointerId; fromX(e.clientX);
    try { el.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => { if (dragging === e.pointerId) fromX(e.clientX); });
  const end = (e) => { if (dragging === e.pointerId) { dragging = null; onChange && onChange(v); } };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  new ResizeObserver(render).observe(el);
  requestAnimationFrame(render);
  el.setValue = (nv) => { v = nv; render(); };
  return el;
}

export function field(label, control, valueText = null) {
  const lab = h('div', { class: 'field-label' }, h('span', null, label), valueText !== null ? h('b', null, valueText) : null);
  const row = h('div', { class: 'field-row' }, lab, control);
  row.setValueText = (t) => { const b = lab.querySelector('b'); if (b) b.textContent = t; };
  return row;
}

// ---------------------------------------------------------------- toasts
export function toast(msg, type = 'info', ms = 3200) {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts' }); document.body.append(host); }
  const t = h('div', { class: `toast ${type}` }, msg);
  host.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
  return t;
}

// ---------------------------------------------------------------- modal
export function modal({ title, body, actions = [], dismissable = true }) {
  const layer = document.getElementById('overlay-layer');
  const box = h('div', { class: 'modal' },
    h('h3', null, title),
    h('div', { class: 'modal-body scroll', 'data-scroll': '' }, body));
  const back = h('div', { class: 'modal-backdrop' }, box);
  const close = () => back.remove();
  const row = h('div', { class: 'modal-actions' });
  for (const a of actions) {
    row.append(button(a.label, () => { if (a.onClick?.() !== false) close(); }, { cls: a.cls || '' }));
  }
  if (actions.length) box.append(row);
  if (dismissable) back.addEventListener('click', (e) => { if (e.target === back) close(); });
  layer.append(back);
  return { close, el: box };
}

export function confirmBox(title, text, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    modal({
      title, body: h('div', null, text), dismissable: false,
      actions: [
        { label: 'Cancel', onClick: () => resolve(false) },
        { label: okLabel, cls: 'primary', onClick: () => resolve(true) },
      ],
    });
  });
}

// ---------------------------------------------------------------- panels
let current = null;
const panelListeners = new Set();
export function onPanelChange(fn) { panelListeners.add(fn); return () => panelListeners.delete(fn); }
export function currentPanel() { return current; }

/**
 * Opens a full-screen holo window. Returns { el, body, tools, setSub, close, onClose }.
 * Only one panel is open at a time.
 */
export function openPanel({ id, title, sub = '', icon = 'target' }) {
  if (current) current.close(true);
  const layer = document.getElementById('app-layer');
  const tools = h('div', { class: 'ph-tools' });
  const subEl = h('div', { class: 'ph-sub' }, sub);
  const closeBtn = button('', () => api.close(), { cls: 'panel-close icon', icon: 'close', title: 'Close' });
  tools.append(closeBtn);
  const head = h('div', { class: 'panel-head' },
    glyph(icon, 'ph-glyph'),
    h('div', { class: 'ph-titles' }, h('div', { class: 'ph-title' }, title), subEl),
    tools);
  const body = h('div', { class: 'panel-body' });
  const el = h('section', { class: 'holo-panel', 'data-panel': id }, head, body);
  layer.append(el);
  const closers = [];
  let closed = false;
  const api = {
    id, el, body, tools,
    setSub(t) { subEl.textContent = t; },
    addTool(node) { tools.insertBefore(node, closeBtn); return node; },
    onClose(fn) { closers.push(fn); },
    close(immediate = false) {
      if (closed) return;
      closed = true;
      for (const fn of closers.splice(0)) { try { fn(); } catch (e) { console.error(e); } }
      if (current === api) current = null;
      document.body.classList.remove('app-open');
      panelListeners.forEach((fn) => fn(null));
      if (immediate) { el.remove(); return; }
      sfx.close();
      el.classList.add('closing');
      setTimeout(() => el.remove(), 300);
    },
  };
  current = api;
  document.body.classList.add('app-open');
  sfx.open();
  panelListeners.forEach((fn) => fn(api));
  return api;
}

// ---------------------------------------------------------------- misc
export function fmt(n, d = 1) { return Number.isFinite(n) ? n.toFixed(d) : '--'; }
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Canvas sized to its CSS box at device pixel ratio; calls onResize(w, h, dpr). */
export function fitCanvas(canvas, onResize, maxDpr = 2) {
  const ro = new ResizeObserver(() => {
    const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    if (!w || !hgt) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    onResize && onResize(w, hgt, dpr);
  });
  ro.observe(canvas);
  return () => ro.disconnect();
}

/** Very small, safe markdown → HTML (escapes everything first). */
export function md(text) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts = String(text).split(/```/);
  let out = '';
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const nl = part.indexOf('\n');
      const code = nl >= 0 ? part.slice(nl + 1) : part;
      out += `<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`;
      return;
    }
    const lines = esc(part).split('\n');
    let list = null;
    let para = [];
    const flushPara = () => { if (para.length) { out += `<p>${inline(para.join('<br>'))}</p>`; para = []; } };
    const flushList = () => { if (list) { out += `<${list.t}>${list.items.map((x) => `<li>${inline(x)}</li>`).join('')}</${list.t}>`; list = null; } };
    for (const line of lines) {
      let m;
      if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { flushPara(); if (!list || list.t !== 'ul') { flushList(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flushPara(); if (!list || list.t !== 'ol') { flushList(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); }
      else if ((m = line.match(/^(#{1,4})\s+(.*)/))) { flushPara(); flushList(); out += `<h4>${inline(m[2])}</h4>`; }
      else if (!line.trim()) { flushPara(); flushList(); }
      else { flushList(); para.push(line); }
    }
    flushPara(); flushList();
  });
  return out;
  function inline(t) {
    return t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<i>$2</i>');
  }
}

export function download(filename, content, type = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}
