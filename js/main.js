// J.A.R.V.I.S. HOLOMAT — main HUD, boot sequence, reactor launcher and app host.
import { settings } from './core/store.js';
import { sfx, unlockAudio } from './core/audio.js';
import { h, s, GLYPHS, toast, openPanel, onPanelChange, currentPanel, clamp } from './core/ui.js';
import { hand } from './core/hand.js';
import { runCalibration, isCalibrating } from './core/calibration.js';
import { unlockSpeech, speaker } from './core/speech.js';
import { hasKey } from './core/claude.js';
import { detectDevice } from './core/device.js';
import { jarvis } from './core/jarvis.js';

// ------------------------------------------------------------------ apps
export const APPS = [
  { id: 'games', name: 'GAMES', sub: 'ARCADE', icon: 'games', title: 'HOLO ARCADE', desc: 'Hand-controlled arcade games', load: () => import('./apps/games.js') },
  { id: 'multiplayer', name: 'MULTIPLAYER', sub: 'ONLINE LINK', icon: 'multiplayer', title: 'MULTIPLAYER LINK', desc: 'Play online with another Holomat', load: () => import('./apps/multiplayer.js') },
  { id: 'circuit', name: 'CIRCUIT LAB', sub: 'PCB DESIGN', icon: 'circuit', title: 'CIRCUIT LAB', desc: 'Design PCBs with Claude', load: () => import('./apps/circuit.js') },
  { id: 'claude', name: 'CLAUDE', sub: 'AI TALK', icon: 'claude', title: 'CLAUDE // TALK', desc: 'Talk and chat with Claude', load: () => import('./apps/chat.js') },
  { id: 'ruler', name: 'RULER', sub: 'MEASURE', icon: 'ruler', title: 'PRECISION RULER', desc: 'Measure on the iPad surface', load: () => import('./apps/ruler.js') },
  { id: 'games3d', name: '3D GAMES', sub: 'HOLO SIM', icon: 'games3d', title: '3D HOLO SIM', desc: '3D holographic games', load: () => import('./apps/games3d.js') },
  { id: 'jarvis', name: 'J.A.R.V.I.S.', sub: 'ASSISTANT', icon: 'jarvis', title: 'J.A.R.V.I.S.', desc: 'Your AI assistant', load: () => import('./apps/jarvis.js') },
  { id: 'settings', name: 'SYSTEM', sub: 'CONFIG', icon: 'settings', title: 'SYSTEM CONFIG', desc: 'Settings & calibration', load: () => import('./apps/settings.js') },
];

let openToken = 0;
export async function openApp(id, opts = {}) {
  const app = APPS.find((a) => a.id === id);
  if (!app) throw new Error(`unknown app ${id}`);
  const token = ++openToken;
  let mod;
  try { mod = await app.load(); }
  catch (e) { console.error(e); toast(`Could not load ${app.name}: ${e.message}`, 'bad'); return null; }
  if (token !== openToken) return null;
  const panel = openPanel({ id, title: app.title, sub: app.desc, icon: app.icon });
  const ctx = { panel, body: panel.body, openApp, closeApp, opts };
  try {
    const cleanup = await mod.default.mount(ctx);
    if (typeof cleanup === 'function') panel.onClose(cleanup);
  } catch (e) {
    console.error(e);
    toast(`${app.name} failed: ${e.message}`, 'bad');
  }
  return panel;
}
export function closeApp() { currentPanel()?.close(); }

// ------------------------------------------------------------------ theme
function applyTheme() { document.documentElement.style.setProperty('--hue', settings.get('hue')); }
applyTheme();
settings.subscribe((p) => { if ('hue' in p) applyTheme(); });

// ------------------------------------------------------------------ HUD
const hudEl = document.getElementById('hud');
const fx = document.getElementById('fx');
const fxCtx = fx.getContext('2d');
const R = {}; // live references into the current HUD svg
const state = { launcher: false, animating: false, az: 0, el: 0 };

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;
const easeOutBack = (t) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
function tween(dur, fn, ease = easeOutCubic, delay = 0) {
  return new Promise((resolve) => {
    const start = performance.now() + delay;
    const step = (now) => {
      if (now < start) { requestAnimationFrame(step); return; }
      const p = Math.min(1, (now - start) / dur);
      fn(ease(p), p);
      if (p < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}

const polar = (r, deg) => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
const hexPts = (r, rot = 30) => Array.from({ length: 6 }, (_, i) => polar(r, rot + i * 60).map((v) => v.toFixed(2)).join(',')).join(' ');
function arcPath(r, a0, a1) {
  const [x0, y0] = polar(r, a0), [x1, y1] = polar(r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
const txt = (x, y, str, cls, size, anchor = 'middle', extra = {}) =>
  s('text', { x, y, class: cls, 'font-size': size, 'text-anchor': anchor, 'dominant-baseline': 'middle', ...extra }, str);

function layout() {
  const W = innerWidth, H = innerHeight;
  const landscape = W / H >= 1.12;
  let VW, VH;
  if (landscape) { VH = 1000; VW = (1000 * W) / H; } else { VW = 1000; VH = (1000 * H) / W; }
  const cx = VW / 2;
  if (landscape) {
    return {
      landscape, VW, VH, cx, boxY: 100, gaugeY: 232, gaugeR: 52,
      gaugeXs: [0.15, 0.27, 0.39, 0.61, 0.73, 0.85].map((f) => f * VW),
      panelY: 335, rx: cx, ry: 600, rR: 135, ring: [Math.min(380, VW * 0.5 - 330), 235],
      bottomY: 908, bottomXs: [cx - 420, cx - 250, cx + 250, cx + 420], labelY: 975, edge: cx - 70,
    };
  }
  return {
    landscape, VW, VH, cx, boxY: 100, gaugeY: 236, gaugeR: 50,
    gaugeXs: [0, 1, 2, 3, 4, 5].map((i) => cx + (i - 2.5) * 152),
    panelY: 330, rx: cx, ry: VH * 0.6, rR: 130, ring: [330, 330],
    bottomY: VH - 112, bottomXs: [cx - 340, cx - 170, cx + 170, cx + 340], labelY: VH - 30, edge: cx - 40,
  };
}

function buildHud() {
  const L = layout();
  R.L = L;
  const svg = s('svg', { viewBox: `0 0 ${L.VW.toFixed(1)} ${L.VH.toFixed(1)}`, preserveAspectRatio: 'xMidYMid meet', class: 'hud-root' + (state.launcher ? ' launcher-open' : '') });
  R.svg = svg;
  svg.append(s('defs', null,
    s('radialGradient', { id: 'coreGrad' },
      s('stop', { offset: '0%', style: 'stop-color:#fff; stop-opacity:.95' }),
      s('stop', { offset: '35%', style: 'stop-color: var(--c-hi); stop-opacity:.9' }),
      s('stop', { offset: '70%', style: 'stop-color: var(--c); stop-opacity:.35' }),
      s('stop', { offset: '100%', style: 'stop-color: var(--c); stop-opacity:0' })),
    s('radialGradient', { id: 'floorGrad' },
      s('stop', { offset: '0%', style: 'stop-color: var(--c); stop-opacity:.16' }),
      s('stop', { offset: '100%', style: 'stop-color: var(--c); stop-opacity:0' })),
    s('filter', { id: 'glow', x: '-50%', y: '-50%', width: '200%', height: '200%' },
      s('feGaussianBlur', { stdDeviation: 4, result: 'b' }),
      s('feMerge', null, s('feMergeNode', { in: 'b' }), s('feMergeNode', { in: 'SourceGraphic' })))));

  svg.append(corners(L), topBox(L), gauges(L), sidePanels(L), traces(L), reactor(L), launcherRing(L), bottomBar(L));
  svg.append(txt(L.cx, L.labelY, 'MAIN SENSOR ARRAY', 't-hud', 15, 'middle', { 'letter-spacing': '0.3em' }));
  hudEl.replaceChildren(svg);
  updateMetrics(true);
  if (currentPanel()) svg.classList.add('app-active');
}

function corners(L) {
  const g = s('g', { class: 'dim-when-open' });
  const k = 46, m = 22;
  for (const [x, y, sx, sy] of [[m, m, 1, 1], [L.VW - m, m, -1, 1], [m, L.VH - m, 1, -1], [L.VW - m, L.VH - m, -1, -1]]) {
    g.append(s('path', { d: `M${x} ${y + sy * k}V${y}H${x + sx * k}`, class: 's-thick' }));
  }
  return g;
}

function topBox(L) {
  const { cx, boxY: y } = L;
  const w = 170, hh = 46;
  const g = s('g', { class: 'dim-when-open' });
  g.append(s('rect', { x: cx - w, y: y - hh, width: 2 * w, height: 2 * hh, class: 's-faint', style: 'fill: var(--c-a05)' }));
  for (const [x, yy, sx, sy] of [[cx - w, y - hh, 1, 1], [cx + w, y - hh, -1, 1], [cx - w, y + hh, 1, -1], [cx + w, y + hh, -1, -1]]) {
    g.append(s('path', { d: `M${x} ${yy + sy * 16}V${yy}H${x + sx * 16}`, class: 's-line' }));
  }
  g.append(s('path', { d: `M${cx - w - 150} ${y - hh}H${cx - w}M${cx + w + 150} ${y - hh}H${cx + w}M${cx - w - 150} ${y - hh}l-10 10M${cx + w + 150} ${y - hh}l10 10`, class: 's-thin' }));
  R.az = txt(cx - w + 4, y - hh - 14, 'AZIMUTH 00.0', 't-dim', 12, 'start');
  R.elv = txt(cx + w - 4, y - hh - 14, 'ELEVATION 00.0', 't-dim', 12, 'end');
  g.append(R.az, R.elv);
  [-95, 0, 95].forEach((dx, i) => {
    const big = i === 1;
    const r = big ? 28 : 20;
    const cg = s('g', { transform: `translate(${cx + dx} ${y})` });
    const spin = s('g', { class: i === 1 ? 'spin' : 'spin-rev', style: `--dur:${big ? 9 : 14}s` });
    spin.append(s('circle', { r, class: 's-line', 'stroke-dasharray': big ? '10 6' : '4 4' }));
    cg.append(spin,
      s('circle', { r: r * 0.45, class: 's-thin' }),
      s('path', { d: `M${-r - 10} 0H${-r * 0.6}M${r * 0.6} 0H${r + 10}M0 ${-r - 8}V${-r * 0.6}M0 ${r * 0.6}V${r + 8}`, class: 's-line' }),
      s('circle', { r: 2.5, class: 's-fill' }));
    if (!big) cg.append(s('path', { d: `M${-r - 16} ${-r * 0.5}l6 ${r * 0.5}l-6 ${r * 0.5}M${r + 16} ${-r * 0.5}l-6 ${r * 0.5}l6 ${r * 0.5}`, class: 's-thin' }));
    g.append(cg);
  });
  return g;
}

const GAUGES = [
  { key: 'fps', label: 'SYS 01', unit: 'TRACK FPS' },
  { key: 'ms', label: 'SYS 02', unit: 'CPU MS' },
  { key: 'hands', label: 'SYS 03', unit: 'HANDS' },
  { key: 'conf', label: 'SYS 04', unit: 'CONFIDENCE' },
  { key: 'pinch', label: 'SYS 05', unit: 'PINCH' },
  { key: 'clock', label: 'SYS 06', unit: 'LOCAL TIME' },
];

function gauges(L) {
  const g = s('g', { class: 'dim-when-open' });
  R.gauges = [];
  GAUGES.forEach((def, i) => {
    const x = L.gaugeXs[i], y = L.gaugeY, r = L.gaugeR;
    const gg = s('g', { transform: `translate(${x.toFixed(1)} ${y})` });
    const outer = s('g', { class: i % 2 ? 'spin-rev' : 'spin', style: `--dur:${16 + i * 5}s` });
    const style = i % 3;
    if (style === 0) outer.append(s('circle', { r, class: 's-line', 'stroke-dasharray': '3 5' }));
    else if (style === 1) outer.append(s('path', { d: `${arcPath(r, 0, 100)} ${arcPath(r, 140, 240)} ${arcPath(r, 280, 340)}`, class: 's-thick' }));
    else for (let a = 0; a < 360; a += 15) { const [x0, y0] = polar(r - 4, a), [x1, y1] = polar(r + 2, a); outer.append(s('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 's-thin' })); }
    const C = 2 * Math.PI * (r * 0.78);
    const track = s('circle', { r: r * 0.78, class: 's-faint', 'stroke-width': 5 });
    const arc = s('circle', { r: r * 0.78, fill: 'none', 'stroke-width': 5, style: 'stroke: var(--c)', 'stroke-dasharray': `0 ${C}`, transform: 'rotate(-90)' });
    const val = txt(0, -3, '--', 't-mono', 17);
    const unit = txt(0, 15, def.unit.split(' ')[0], 't-dim', 8.5);
    gg.append(outer, track, arc, s('circle', { r: r * 0.55, class: 's-faint' }), val, unit,
      txt(0, r + 20, def.label, 't-hud', 11));
    R.gauges.push({ arc, val, C, def });
    g.append(gg);
  });
  return g;
}

function sidePanels(L) {
  const g = s('g', { class: 'dim-when-open' });
  const mk = (left) => {
    const w = 236, x = left ? 30 : L.VW - 30 - w, y = L.panelY;
    const pg = s('g', { transform: `translate(${x.toFixed(1)} ${y})` });
    const title = left ? 'SIGNAL QUALITY' : 'SYSTEM CORE';
    pg.append(s('rect', { x: left ? 0 : w - 4, y: -9, width: 4, height: 18, class: 's-fill' }));
    pg.append(txt(left ? 12 : w - 12, 0, title, 't-hud', 13, left ? 'start' : 'end'));
    const bars = [];
    const bx = left ? 168 : 8;
    for (let i = 0; i < 6; i++) {
      const b = s('rect', { x: bx + i * 10, y: 34, width: 6, height: 20, class: 's-fill', opacity: 0.85 });
      bars.push(b); pg.append(b);
    }
    pg.append(s('path', { d: `M${bx - 4} 58H${bx + 62}`, class: 's-thin' }));
    const lines = [0, 1, 2].map((i) => {
      const t = txt(left ? 0 : w, 82 + i * 22, '', 't-dim', 13, left ? 'start' : 'end');
      pg.append(t); return t;
    });
    pg.append(s('path', { d: left ? `M0 20H${w * 0.55}l8 8` : `M${w} 20H${w * 0.45}l-8 8`, class: 's-thin' }));
    return { pg, bars, lines };
  };
  R.left = mk(true); R.right = mk(false);
  g.append(R.left.pg, R.right.pg);
  return g;
}

function traces(L) {
  const g = s('g', { class: 'dim-when-open' });
  const { rx, ry, rR, edge } = L;
  const routes = [
    [[rR + 18, -62], [rR + 80, -62], [rR + 150, -132], [edge, -132]],
    [[rR + 22, -22], [rR + 118, -22], [rR + 158, -62], [edge - 70, -62]],
    [[rR + 22, 26], [rR + 140, 26], [rR + 188, 74], [edge - 30, 74]],
    [[rR + 12, 72], [rR + 58, 72], [rR + 112, 126], [edge, 126]],
  ];
  for (const side of [-1, 1]) {
    routes.forEach((pts, i) => {
      const P = pts.map(([dx, dy]) => [rx + side * dx, ry + dy]).filter(([x]) => (side < 0 ? x > 40 : x < L.VW - 40));
      if (P.length < 2) return;
      const d = 'M' + P.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L');
      g.append(s('path', { d, class: 's-dim' }));
      g.append(s('path', { d, class: side < 0 ? 'flow' : 'flow-rev', style: `stroke: var(--c-hi); fill:none; stroke-width: 2; --dur:${1.6 + i * 0.5}s` }));
      const [ex, ey] = P[P.length - 1];
      g.append(s('circle', { cx: ex, cy: ey, r: 5, class: 's-fill-deep' }));
      P.slice(1, -1).forEach(([px, py]) => g.append(s('circle', { cx: px, cy: py, r: 2.5, class: 's-fill' })));
    });
  }
  // the two labelled nodes from the reference HUD
  const lx = rx - (rR + 112) - Math.max(0, edge - rR - 112) * 0.55, rxx = rx + (rR + 112) + Math.max(0, edge - rR - 112) * 0.55;
  R.menuNode = hudButton(lx, ry + 126, 'MENU', 'grid', 'menu', 22, true);
  g.append(R.menuNode, txt(rxx, ry + 158, 'FLOW', 't-hud', 11));
  g.append(s('circle', { cx: rxx, cy: ry + 126, r: 12, class: 's-line pulse-op' }));
  return g;
}

function reactor(L) {
  const { rx, ry, rR } = L;
  const g = s('g', { transform: `translate(${rx.toFixed(1)} ${ry.toFixed(1)})` });
  g.append(s('circle', { r: rR * 2.2, fill: 'url(#floorGrad)' }));
  const label = s('g', { class: 'hide-when-open' },
    txt(0, -rR - 52, 'TRACKING ACTIVE', 't-hud', 13, 'middle', { 'letter-spacing': '0.25em' }),
    s('path', { d: `M-9 ${-rR - 34}l9 9 9-9`, class: 's-line' }));
  R.trackLabel = label.firstChild;
  g.append(label);

  const boost = s('g', {}); // extra rotation during the launch animation
  R.boost = boost;
  // outer tick ring
  const ticks = s('g', { class: 'spin', style: '--dur:80s' });
  ticks.append(s('circle', { r: rR, class: 's-line' }));
  for (let a = 0; a < 360; a += 5) {
    const long = a % 30 === 0;
    const [x0, y0] = polar(rR + 2, a), [x1, y1] = polar(rR + (long ? 14 : 7), a);
    ticks.append(s('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: long ? 's-line' : 's-thin' }));
  }
  // segmented ring
  const seg = s('g', { class: 'spin-rev', style: '--dur:26s' });
  for (let i = 0; i < 8; i++) seg.append(s('path', { d: arcPath(rR * 0.86, i * 45 + 4, i * 45 + 36), class: 's-thick', 'stroke-width': 7, opacity: i % 2 ? 0.55 : 1 }));
  // dashed ring
  const dash = s('g', { class: 'spin', style: '--dur:14s' });
  dash.append(s('circle', { r: rR * 0.72, class: 's-line', 'stroke-dasharray': '2 7', 'stroke-width': 3 }));
  // marker ring
  const mark = s('g', { class: 'spin-rev', style: '--dur:34s' });
  mark.append(s('circle', { r: rR * 0.6, class: 's-thin' }));
  for (const a of [0, 120, 240]) { const [x, y] = polar(rR * 0.6, a); mark.append(s('path', { d: `M${x} ${y}l-6 -9h12z`, class: 's-fill', transform: `rotate(${a + 90} ${x} ${y})` })); }
  // fast arcs
  const fast = s('g', { class: 'spin', style: '--dur:7s' });
  fast.append(s('path', { d: `${arcPath(rR * 0.46, 0, 110)} ${arcPath(rR * 0.46, 180, 290)}`, class: 's-thick', 'stroke-width': 4 }));
  boost.append(ticks, seg, dash, mark, fast);
  g.append(boost);

  // crosshair
  g.append(s('path', { d: `M${-rR * 0.95} 0H${-rR * 0.36}M${rR * 0.36} 0H${rR * 0.95}M0 ${-rR * 0.95}V${-rR * 0.36}M0 ${rR * 0.36}V${rR * 0.95}`, class: 's-faint' }));
  // sweep needle (the arrow in the reference)
  const needle = s('g', { class: 'spin', style: '--dur:12s' });
  const [nx, ny] = polar(rR * 1.28, -40);
  needle.append(s('line', { x1: 0, y1: 0, x2: nx, y2: ny, class: 's-line' }), s('circle', { cx: nx, cy: ny, r: 4, class: 's-fill' }));
  g.append(needle);
  // core
  R.coreGlow = s('circle', { r: rR * 0.34, fill: 'url(#coreGrad)', class: 'pulse-op', style: '--dur:3s' });
  R.core = s('circle', { r: rR * 0.17, class: 's-fill-deep', 'stroke-width': 3 });
  g.append(R.coreGlow, R.core, s('circle', { r: rR * 0.07, class: 's-fill' }));
  R.flash = s('circle', { r: rR * 0.2, fill: '#fff', opacity: 0 });
  g.append(R.flash);
  R.waves = s('g');
  g.append(R.waves);
  R.statusTxt = txt(0, rR + 30, '', 't-mono', 12);
  g.append(R.statusTxt);
  const hit = s('circle', { r: rR + 10, fill: 'transparent', class: 'reactor-hit', 'data-click': '' });
  hit.addEventListener('click', () => toggleLauncher());
  g.append(hit);
  R.reactor = g;
  return g;
}

function launcherRing(L) {
  const { rx, ry, rR } = L;
  const g = s('g');
  R.nodes = [];
  const [ax, ay] = L.ring;
  APPS.forEach((app, i) => {
    const deg = -90 + i * 45;
    const [ux, uy] = polar(1, deg);
    const tx = rx + ux * ax, ty = ry + uy * ay;
    const len = Math.hypot(tx - rx, ty - ry);
    const dx = (tx - rx) / len, dy = (ty - ry) / len;
    const lx0 = rx + dx * (rR + 8), ly0 = ry + dy * (rR + 8), lx1 = tx - dx * 58, ly1 = ty - dy * 58;
    const lineLen = Math.max(1, Math.hypot(lx1 - lx0, ly1 - ly0));
    const line = s('line', { x1: lx0, y1: ly0, x2: lx1, y2: ly1, class: 's-line', 'stroke-dasharray': `${lineLen} ${lineLen}`, 'stroke-dashoffset': lineLen, opacity: 0.7 });
    const node = s('g', { class: 'app-node', 'data-app': app.id, style: 'opacity:0', transform: `translate(${rx} ${ry}) scale(0.2)` });
    const gl = s('g', { transform: 'translate(-17 -21) scale(1.42)' });
    gl.append(s('path', { d: GLYPHS[app.icon], fill: 'none', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: 'stroke: var(--c-hi)' }));
    node.append(
      s('polygon', { points: hexPts(52, 0), class: 'an-face' }),
      s('polygon', { points: hexPts(52, 0), class: 's-line an-ring' }),
      s('polygon', { points: hexPts(44, 0), class: 's-faint' }),
      gl,
      txt(0, 70, app.name, 't-hud an-label', 13),
      txt(0, 87, app.sub, 't-dim', 9.5));
    node.addEventListener('click', () => { if (!state.animating) { sfx.click(); openApp(app.id); } });
    g.append(line, node);
    R.nodes.push({ node, line, lineLen, tx, ty, app });
  });
  if (state.launcher) setLauncherFrame(1);
  return g;
}

function hudButton(x, y, label, icon, action, r = 34, hex = false) {
  const g = s('g', { class: 'hud-btn', transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, 'data-action': action });
  if (hex) g.append(s('polygon', { points: hexPts(r, 30), class: 'hb-face' }), s('polygon', { points: hexPts(r, 30), class: 's-line hb-ring' }), s('polygon', { points: hexPts(r * 0.8, 30), class: 's-faint' }));
  else g.append(s('circle', { r, class: 'hb-face' }), s('circle', { r, class: 's-line hb-ring' }), s('circle', { r: r * 0.78, class: 's-faint', 'stroke-dasharray': '3 4' }));
  const k = (r * 0.9) / 12;
  const gl = s('g', { transform: `translate(${-12 * k} ${-12 * k}) scale(${k})` });
  gl.append(s('path', { d: GLYPHS[icon], fill: 'none', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: 'stroke: var(--c-hi)' }));
  g.append(gl, txt(0, r + 18, label, 't-hud', 11));
  g.addEventListener('click', () => { sfx.click(); hudAction(action); });
  return g;
}

function bottomBar(L) {
  const g = s('g');
  const [a, b, c, d] = L.bottomXs;
  R.btnCal = hudButton(a, L.bottomY, 'CALIBRATE', 'hand', 'calibrate', 38, true);
  R.btnTrack = hudButton(b, L.bottomY, 'TRACKING', 'eye', 'tracking', 32);
  R.btnTalk = hudButton(c, L.bottomY, 'TALK', 'mic', 'talk', 32);
  R.btnSys = hudButton(d, L.bottomY, 'SYSTEM', 'settings', 'system', 38, true);
  g.append(R.btnCal, R.btnTrack, R.btnTalk, R.btnSys);
  return g;
}

async function hudAction(action) {
  if (action === 'calibrate') runCalibration();
  else if (action === 'tracking') toggleTracking();
  else if (action === 'talk') jarvis.pushToTalk();
  else if (action === 'system') openApp('settings');
  else if (action === 'menu') toggleLauncher();
}

export async function toggleTracking(on = !hand.running) {
  settings.set('tracking', on);
  if (on) {
    try { await hand.start(); toast('Hand tracking online · processing on this iPad', 'ok'); }
    catch (e) { toast(`Hand tracking unavailable: ${e.message}`, 'bad', 5000); }
  } else { hand.stop(); toast('Hand tracking offline'); }
}

// ------------------------------------------------------------------ launcher animation
function setLauncherFrame(p, staggered = false) {
  const { rx, ry } = R.L;
  R.nodes.forEach(({ node, line, lineLen, tx, ty }, i) => {
    const q = staggered ? clamp((p * 1.6 - i * 0.075) / 1, 0, 1) : p;
    const e = staggered ? easeOutBack(q) : q;
    const x = rx + (tx - rx) * e, y = ry + (ty - ry) * e;
    node.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(0.2 + 0.8 * Math.min(1.08, e)).toFixed(3)})`);
    node.style.opacity = Math.min(1, q * 2).toFixed(2);
    node.style.pointerEvents = p > 0.95 ? '' : 'none';
    line.setAttribute('stroke-dashoffset', (lineLen * (1 - clamp(q * 1.3 - 0.3, 0, 1))).toFixed(1));
  });
}

export function toggleLauncher(open = !state.launcher) {
  if (state.animating || open === state.launcher) return;
  state.animating = true;
  state.launcher = open;
  R.svg.classList.toggle('launcher-open', open);
  if (open) {
    sfx.power();
    burst(R.L.rx, R.L.ry);
    // core flash
    tween(700, (e) => { R.flash.setAttribute('r', R.L.rR * (0.2 + e * 0.9)); R.flash.setAttribute('opacity', (1 - e) * 0.9); });
    // shockwaves
    for (let i = 0; i < 3; i++) {
      const w = s('circle', { r: R.L.rR * 0.3, class: 's-line', 'stroke-width': 3 - i * 0.7 });
      R.waves.append(w);
      tween(1000, (e) => { w.setAttribute('r', R.L.rR * (0.3 + e * 4.5)); w.setAttribute('opacity', (1 - e).toFixed(3)); }, easeOutCubic, i * 150).then(() => w.remove());
    }
    // rings spin up
    tween(1300, (e) => R.boost.setAttribute('transform', `rotate(${(e * 540).toFixed(1)})`), easeOutQuart);
    typeStatus('◢ SYSTEMS ONLINE · 8 MODULES READY');
    tween(1100, (_, p) => setLauncherFrame(p, true), (t) => t, 180).then(() => { setLauncherFrame(1); state.animating = false; });
  } else {
    sfx.powerDown();
    tween(420, (e) => setLauncherFrame(1 - e), easeInCubic).then(() => { setLauncherFrame(0); state.animating = false; });
    tween(600, (e) => R.boost.setAttribute('transform', `rotate(${(-e * 180).toFixed(1)})`), easeOutCubic);
    typeStatus('');
  }
}

let typeTimer = null;
function typeStatus(str) {
  clearInterval(typeTimer);
  let i = 0;
  R.statusTxt.textContent = '';
  if (!str) return;
  typeTimer = setInterval(() => { R.statusTxt.textContent = str.slice(0, ++i); if (i >= str.length) clearInterval(typeTimer); }, 28);
}

// particle burst on the fx canvas
const particles = [];
let fxRunning = false;
function burst(vx, vy) {
  const scale = Math.min(innerWidth / R.L.VW, innerHeight / R.L.VH);
  const ox = (innerWidth - R.L.VW * scale) / 2, oy = (innerHeight - R.L.VH * scale) / 2;
  const x = ox + vx * scale, y = oy + vy * scale;
  for (let i = 0; i < 140; i++) {
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 9;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: 0.012 + Math.random() * 0.02, size: 1 + Math.random() * 2.5 });
  }
  if (!fxRunning) { fxRunning = true; requestAnimationFrame(fxLoop); }
}
function fxLoop() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (fx.width !== innerWidth * dpr) { fx.width = innerWidth * dpr; fx.height = innerHeight * dpr; }
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fxCtx.clearRect(0, 0, innerWidth, innerHeight);
  const col = getComputedStyle(document.documentElement).getPropertyValue('--c-hi').trim();
  fxCtx.fillStyle = col;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vx *= 0.97; p.vy *= 0.97; p.life -= p.decay;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    fxCtx.globalAlpha = p.life;
    fxCtx.fillRect(p.x, p.y, p.size, p.size);
  }
  fxCtx.globalAlpha = 1;
  if (particles.length) requestAnimationFrame(fxLoop);
  else { fxRunning = false; fxCtx.clearRect(0, 0, innerWidth, innerHeight); }
}

// ------------------------------------------------------------------ live metrics
const NODE_ID = '0x' + Math.floor(Math.random() * 0xfff).toString(16).toUpperCase().padStart(3, '0');
function updateMetrics(force = false) {
  if (!R.gauges) return;
  const f = hand.running ? hand.lastFrame : null;
  const hands = f ? f.hands : [];
  const prim = hands[0];
  const now = new Date();
  const values = {
    fps: hand.running ? [Math.round(hand.fps), hand.fps / 30] : ['OFF', 0],
    ms: hand.running ? [Math.round(hand.inferMs), hand.inferMs / 60] : ['--', 0],
    hands: [hands.length, hands.length / 2],
    conf: prim ? [Math.round(prim.score * 100), prim.score] : ['--', 0],
    pinch: prim ? [prim.pinch ? 'LOCK' : Math.round(clamp(1 - (prim.pinchRatio - settings.get('pinchOn')) / 0.8, 0, 1) * 100), prim.pinch ? 1 : clamp(1 - (prim.pinchRatio - settings.get('pinchOn')) / 0.8, 0, 1)] : ['--', 0],
    clock: [`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, now.getSeconds() / 60],
  };
  for (const g of R.gauges) {
    const [v, frac] = values[g.def.key];
    g.val.textContent = v;
    g.arc.setAttribute('stroke-dasharray', `${(clamp(frac, 0, 1) * g.C).toFixed(1)} ${g.C.toFixed(1)}`);
  }
  if (prim) {
    state.az = (prim.x / innerWidth - 0.5) * 120;
    state.el = (0.5 - prim.y / innerHeight) * 80;
  } else {
    state.az += Math.sin(Date.now() / 3000) * 0.05;
  }
  R.az.textContent = `AZIMUTH ${state.az.toFixed(1)}`;
  R.elv.textContent = `ELEVATION ${state.el.toFixed(1)}`;

  const st = hand.status;
  const calibrated = !!hand.activeCalibration();
  const lt = R.left.lines, rt = R.right.lines;
  lt[0].textContent = `STATUS: ${st === 'running' ? (hands.length ? 'OPTIMAL' : 'SEARCHING') : st === 'error' ? 'FAULT' : st === 'starting' ? 'BOOTING' : 'STANDBY'}`;
  lt[1].textContent = `NODE: ${NODE_ID} · ${settings.get('facingMode') === 'user' ? 'FRONT' : 'REAR'} CAM`;
  lt[2].textContent = `CALIBRATION: ${calibrated ? 'LOCKED' : 'DEFAULT'}`;
  rt[0].textContent = `READY STATE: ${jarvis.state.toUpperCase()}`;
  rt[1].textContent = `UPLINK: ${hasKey() ? 'SECURE' : 'NO API KEY'}`;
  rt[2].textContent = `LATENCY: ${jarvis.lastLatency ? jarvis.lastLatency + 'ms' : hand.running ? Math.round(hand.inferMs) + 'ms' : '--'}`;
  const amp = hand.running ? 0.35 + 0.65 * Math.min(1, hand.fps / 30) : 0.15;
  for (const pnl of [R.left, R.right]) pnl.bars.forEach((b) => { const hgt = 4 + Math.random() * 20 * amp; b.setAttribute('y', 54 - hgt); b.setAttribute('height', hgt); });
  R.trackLabel.textContent = st === 'running' ? (hands.length ? `TRACKING ACTIVE · ${hands.length} HAND${hands.length > 1 ? 'S' : ''}` : 'TRACKING ACTIVE') : st === 'starting' ? 'TRACKING BOOT…' : 'TOUCH MODE';
  R.btnTrack.classList.toggle('on', hand.running);
  R.btnTalk.classList.toggle('on', jarvis.state === 'listening');
}
setInterval(updateMetrics, 250);

// ------------------------------------------------------------------ monitor widget
const monitor = document.getElementById('monitor');
const monCanvas = monitor.querySelector('canvas');
const monStat = monitor.querySelector('.mon-stat');
monitor.addEventListener('click', () => { if (!isCalibrating()) runCalibration(); });
hand.onFrame((f) => {
  if (monitor.classList.contains('hidden')) return;
  hand.drawPreview(monCanvas);
  monStat.children[0].textContent = `${f.hands.length} HAND${f.hands.length === 1 ? '' : 'S'}`;
  monStat.children[1].textContent = `${Math.round(f.fps)}FPS · ${Math.round(f.ms)}MS`;
});
function syncMonitor() { monitor.classList.toggle('hidden', !(settings.get('showMonitor') && hand.running)); }
hand.addEventListener('status', syncMonitor);
settings.subscribe((p) => { if ('showMonitor' in p) syncMonitor(); });

// ------------------------------------------------------------------ panels ↔ HUD
onPanelChange((p) => R.svg?.classList.toggle('app-active', !!p));

let resizeT = null;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(buildHud, 120); });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

// ------------------------------------------------------------------ boot
jarvis.bind({ openApp, closeApp, toggleLauncher, toggleTracking, runCalibration, apps: APPS });
buildHud();

const boot = document.getElementById('boot');
const bootLog = boot.querySelector('.boot-log');
const dev = detectDevice();
const lines = [
  'J.A.R.V.I.S. HOLOMAT // BUILD 1.0',
  `DISPLAY ........ ${dev.isIPad ? dev.name.toUpperCase() : dev.name.toUpperCase()}`,
  'HAND TRACKING .. ON-DEVICE · iPad CPU (WASM SIMD)',
  `CLAUDE UPLINK .. ${hasKey() ? 'KEY PRESENT' : 'NO KEY — ADD IN SYSTEM'}`,
  `CALIBRATION .... ${settings.get('calibration') ? 'STORED' : 'NOT SET'}`,
];
let li = 0;
const logTimer = setInterval(() => {
  bootLog.textContent += (li ? '\n' : '') + '› ' + lines[li++];
  if (li >= lines.length) clearInterval(logTimer);
}, 170);

boot.querySelector('.boot-go').addEventListener('click', async () => {
  unlockAudio();
  unlockSpeech();
  sfx.boot();
  boot.classList.add('gone');
  setTimeout(() => boot.remove(), 900);
  setTimeout(() => toggleLauncher(true), 700);
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  setTimeout(() => jarvis.announce(`Good ${part}, ${settings.get('callsign')}. Holomat systems are online.${hasKey() ? '' : ' Add your Claude API key in System to wake me up properly.'}`), 900);
  if (settings.get('tracking')) {
    try {
      await hand.start();
      if (!hand.activeCalibration()) setTimeout(() => toast('Tip: tap CALIBRATE for precise hand control', 'info', 5000), 2500);
    } catch (e) {
      toast(`Hand tracking unavailable: ${e.message} — touch still works`, 'warn', 6000);
    }
  }
  if (settings.get('wakeWord')) jarvis.setWakeWord(true);
});

// ------------------------------------------------------------------ PWA
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW failed', e)));
}

window.holomat = { hand, settings, openApp, toggleLauncher, jarvis, speaker };
