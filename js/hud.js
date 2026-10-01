// HOME SCREEN — the user's Holomat drawing, brought to life.
// The armor hologram (cut from assets/home-design.jpg) stands in the centre;
// everything around it is live vector HUD: heading tape, alerts, clock,
// system list, honeycomb, globe, quick-action column, SIGNAL / BATTERY arcs and
// the date. Tapping the arc reactor powers up and launches the 8 modules out of it.
import { settings } from './core/store.js';
import { sfx } from './core/audio.js';
import { s, GLYPHS, clamp, onPanelChange } from './core/ui.js';
import { hand } from './core/hand.js';
import { hasKey } from './core/claude.js';
import { jarvis, THEMES } from './core/jarvis.js';

const BUST_URL = new URL('../assets/armor-hologram.webp', import.meta.url).href;
const BUST = { w: 740, h: 660, reactor: [365, 538], hue: 192 }; // reactor centre inside the cut-out
const WHITE = '#eaf8ff';
const RED = '#ff4d5e';

let cfg = null;               // { apps, openApp, action(name) }
const R = {};                 // live references into the current svg
const state = { launcher: false, animating: false, heading: 40, battery: null };

// ------------------------------------------------------------------ helpers
const ease = {
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  outBack: (t) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
function tween(dur, fn, e = ease.outCubic, delay = 0) {
  return new Promise((resolve) => {
    const start = performance.now() + delay;
    const step = (now) => {
      if (now < start) { requestAnimationFrame(step); return; }
      const p = Math.min(1, (now - start) / dur);
      fn(e(p), p);
      if (p < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}
const polar = (r, deg) => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
const polyPts = (n, r, rot = 0) => Array.from({ length: n }, (_, i) => polar(r, rot + (i * 360) / n).map((v) => v.toFixed(1)).join(',')).join(' ');
const arcD = (r, a0, a1) => {
  const [x0, y0] = polar(r, a0), [x1, y1] = polar(r, a1);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
};
const T = (x, y, str, cls, size, anchor = 'middle', extra = {}) =>
  s('text', { x: +x.toFixed(1), y: +y.toFixed(1), class: cls, 'font-size': size, 'text-anchor': anchor, 'dominant-baseline': 'middle', ...extra }, str);
function glyphG(name, x, y, size, cls = '', stroke = null) {
  const k = size / 24;
  const g = s('g', { transform: `translate(${(x - size / 2).toFixed(1)} ${(y - size / 2).toFixed(1)}) scale(${k.toFixed(3)})`, class: cls });
  g.append(s('path', { d: GLYPHS[name] || GLYPHS.target, fill: 'none', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: `stroke: ${stroke || 'var(--c-hi)'}` }));
  return g;
}

// ------------------------------------------------------------------ layout
// Landscape keeps the drawing's 2000 × 1508 proportions (height fixed, width
// follows the screen); portrait stacks the same pieces around a centred bust.
function layout() {
  const W = innerWidth, H = innerHeight;
  const land = W / H >= 1.1;
  const VH = land ? 1508 : Math.round((2000 * H) / W);
  const VW = land ? (1508 * W) / H : 2000;
  const cx = VW / 2;
  const k = land ? 1 : 1.2;
  const bustTop = land ? 330 : Math.round(VH * 0.46 - 330);
  const rx = cx - BUST.w / 2 + BUST.reactor[0], ry = bustTop + BUST.reactor[1];
  return {
    land, VW, VH, cx, k, bustTop, rx, ry,
    listY: land ? 455 : 470,
    hive: land ? [330, 1050] : [330, VH - 640],
    globe: land ? [VW - 430, 1000] : [VW - 330, VH - 640],
    colX: VW - 100,
    colY: land ? [535, 625, 713, 801, 889, 985] : [540, 640, 740, 840, 940, 1040],
    ring: land ? [560, 380] : [600, 470],
    arcBottom: VH - 173,
    emY: VH - 228,
    dateY: VH - 62,
  };
}

// ------------------------------------------------------------------ build
export function initHud(c) {
  cfg = c;
  buildHud();
  let t = null;
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(buildHud, 120); });
  onPanelChange((p) => R.svg?.classList.toggle('app-active', !!p));
  settings.subscribe((p) => { if ('hue' in p) applyHueFilter(); });
  if (navigator.getBattery) navigator.getBattery().then((b) => { state.battery = b; }).catch(() => {});
  setInterval(update, 250);
  requestAnimationFrame(animate);
}

function buildHud() {
  const L = layout();
  R.L = L;
  const svg = s('svg', { viewBox: `0 0 ${L.VW.toFixed(1)} ${L.VH}`, preserveAspectRatio: 'xMidYMid meet', class: 'hud-root home' + (state.launcher ? ' launcher-open' : '') });
  R.svg = svg;
  svg.append(s('defs', null,
    s('radialGradient', { id: 'coreGrad' },
      s('stop', { offset: '0%', style: 'stop-color:#fff; stop-opacity:.95' }),
      s('stop', { offset: '30%', style: 'stop-color: var(--c-hi); stop-opacity:.8' }),
      s('stop', { offset: '65%', style: 'stop-color: var(--c); stop-opacity:.25' }),
      s('stop', { offset: '100%', style: 'stop-color: var(--c); stop-opacity:0' })),
    s('radialGradient', { id: 'floorGrad' },
      s('stop', { offset: '0%', style: 'stop-color: var(--c); stop-opacity:.13' }),
      s('stop', { offset: '100%', style: 'stop-color: var(--c); stop-opacity:0' })),
    s('linearGradient', { id: 'scanGrad', x1: 0, y1: 0, x2: 0, y2: 1 },
      s('stop', { offset: '0%', style: 'stop-color: var(--c-hi); stop-opacity:0' }),
      s('stop', { offset: '80%', style: 'stop-color: var(--c-hi); stop-opacity:.5' }),
      s('stop', { offset: '100%', style: 'stop-color: #fff; stop-opacity:.95' })),
    s('linearGradient', { id: 'barGrad', x1: 0, y1: 0, x2: 1, y2: 0 },
      s('stop', { offset: '0%', style: 'stop-color: var(--c-mid); stop-opacity:.55' }),
      s('stop', { offset: '100%', style: 'stop-color: var(--c-hi); stop-opacity:.9' })),
    s('filter', { id: 'bustHue', 'color-interpolation-filters': 'sRGB' }, R.hueMatrix = s('feColorMatrix', { type: 'hueRotate', values: 0 })),
    s('mask', { id: 'bustMask', maskUnits: 'userSpaceOnUse', x: L.cx - BUST.w / 2, y: L.bustTop, width: BUST.w, height: BUST.h },
      s('image', { href: BUST_URL, x: L.cx - BUST.w / 2, y: L.bustTop, width: BUST.w, height: BUST.h, preserveAspectRatio: 'none' })),
    s('clipPath', { id: 'tapeClip' }, s('rect', { x: L.cx - Math.min(790, L.cx - (L.land ? 330 : 400)) + 30, y: 0, width: 2 * Math.min(790, L.cx - (L.land ? 330 : 400)) - 60, height: 140 }))));

  svg.append(backdrop(L), tape(L), counters(L), topDecor(L), clockPanel(L), statusList(L), honeycomb(L),
    rightColumn(L), globe(L), bottomArcs(L), emblem(L), dateText(L), bust(L), reactor(L), launcherRing(L));
  cfg.mount.replaceChildren(svg);
  applyHueFilter();
  update();
  if (document.body.classList.contains('app-open')) svg.classList.add('app-active');
}

function applyHueFilter() {
  if (!R.bustImg) return;
  const d = ((settings.get('hue') - BUST.hue + 540) % 360) - 180;
  // only filter when the theme is far from the drawing's own cyan (keeps it cheap)
  if (Math.abs(d) < 10) R.bustImg.removeAttribute('filter');
  else { R.hueMatrix.setAttribute('values', d.toFixed(0)); R.bustImg.setAttribute('filter', 'url(#bustHue)'); }
}

function backdrop(L) {
  const g = s('g', { 'pointer-events': 'none' });
  g.append(
    s('rect', { x: L.cx - 780, y: 120, width: 520, height: L.VH - 330, fill: 'hsl(200 60% 50% / .025)' }),
    s('rect', { x: L.cx + 260, y: 120, width: 520, height: L.VH - 330, fill: 'hsl(200 60% 50% / .025)' }),
    s('rect', { x: L.cx - 270, y: 110, width: 540, height: L.VH - 110, fill: 'rgba(0,0,0,.28)' }),
    s('circle', { cx: L.rx, cy: L.ry, r: 620, fill: 'url(#floorGrad)' }));
  return g;
}

// heading tape across the top (follows your hand)
function tape(L) {
  const g = s('g');
  const hw = Math.min(790, L.cx - (L.land ? 330 : 400)); // stay clear of the camera monitor (top-left)
  const x0 = L.cx - hw, x1 = L.cx + hw, y = 48;
  R.tapeHalf = hw;
  g.append(
    s('path', { d: `M${x0} ${y}L${x0 + 24} ${y - 22}H${x1 - 24}L${x1} ${y}L${x1 - 24} ${y + 22}H${x0 + 24}Z`, class: 's-line', style: 'fill: hsl(var(--hue) 80% 50% / .05)' }),
    s('path', { d: `M${x0 + 12} ${y + 34}H${L.cx - 80}l16 14M${x1 - 12} ${y + 34}H${L.cx + 80}l-16 14`, class: 's-thin' }),
    s('path', { d: `M${x0 + 8} ${y}H${x0 + 30}M${x1 - 30} ${y}H${x1 - 8}`, class: 's-line' }));
  const clip = s('g', { 'clip-path': 'url(#tapeClip)' });
  R.tapeTicks = s('path', { class: 's-line', 'stroke-width': 2 });
  R.tapeLabels = Array.from({ length: 12 }, () => T(0, y + 50, '', 't-dim', 16));
  clip.append(R.tapeTicks, ...R.tapeLabels);
  g.append(clip,
    s('path', { d: `M${L.cx} ${y - 20}V${y + 20}`, stroke: RED, 'stroke-width': 3 }),
    s('path', { d: `M${L.cx} ${y + 27}l7 8-7 8-7-8z`, fill: RED }));
  R.tapeY = y;
  return g;
}

// alert counters under the tape: hands seen + running timers
function counters(L) {
  const g = s('g');
  const y = 142;
  R.cntHands = T(L.cx - 108, y, '0', 't-white', 48, 'end');
  R.cntTimers = T(L.cx + 66, y, '0', 't-white', 48, 'end');
  g.append(R.cntHands,
    s('rect', { x: L.cx - 92, y: y - 20, width: 50, height: 40, rx: 4, style: 'fill: var(--c-a35); stroke: var(--c-hi); stroke-width: 1.5' }),
    glyphG('hand', L.cx - 67, y, 30, '', WHITE),
    R.cntTimers,
    glyphG('timer', L.cx + 98, y, 40, '', RED));
  return g;
}

function topDecor(L) {
  const g = s('g', { class: 'dim-when-open', 'pointer-events': 'none' });
  const c = L.cx;
  g.append(
    s('path', { d: `M${c - 460} 252H${c - 70}l12-12H${c - 30}`, class: 's-thin' }),
    s('rect', { x: c - 50, y: 232, width: 34, height: 8, class: 's-fill', opacity: 0.8 }),
    s('rect', { x: c - 10, y: 232, width: 20, height: 8, class: 's-fill', opacity: 0.5 }),
    T(c + 110, 228, 'TIME / DATE', 't-hud', 18),
    s('path', { d: `M${c - 10} 262H${c + 175}M${c + 10} 270H${c + 120}`, class: 's-thin' }),
    // left / right mid lines (from the drawing)
    s('path', { d: `M420 ${L.bustTop + 242}H640l10-10H700`, class: 's-thin' }),
    T(560, L.bustTop + 216, '▪ ▪▪ ▪▪', 't-dim', 14),
    s('path', { d: `M${L.cx + 290} ${L.bustTop + 242}H${L.cx + 575}`, class: 's-thin' }),
    s('path', { d: `M${L.cx + 470} ${L.bustTop + 236}h30`, class: 's-line' }),
    // vertical rail beside the honeycomb
    s('path', { d: `M${L.hive[0] + 175} ${L.hive[1] - 235}V${L.hive[1] + 100}M${L.hive[0] + 168} ${L.hive[1] - 235}h14v10h-14z`, class: 's-thin' }));
  return g;
}

function clockPanel(L) {
  const g = s('g');
  const xr = L.VW - 310, y = 318;
  R.clock = T(xr, y, '00:00', 't-clock', 124, 'end');
  R.clockSub = T(xr, y + 52, '', 't-dim', 19, 'end');
  R.secTrack = s('rect', { x: xr - 320, y: y + 70, width: 320, height: 5, class: 's-fill-dim' });
  R.secBar = s('rect', { x: xr - 320, y: y + 70, width: 0, height: 5, class: 's-fill' });
  g.append(
    s('path', { d: `M${L.cx + 200} 240H${L.cx + 380}L${L.cx + 440} 300H${xr - 345}`, class: 's-line' }),
    s('path', { d: `M${xr - 140} 172H${L.VW - 90}l-18 18`, class: 's-line' }),
    T(L.VW - 120, 198, 'LOCAL TIME', 't-dim', 17, 'end'),
    s('path', { d: `M${L.VW - 200} 276H${L.VW - 40}M${L.VW - 70} 250L${L.VW - 150} 330H${L.VW - 270}`, class: 's-thin' }),
    T(L.VW - 60, 262, 'SYNC', 't-dim', 12, 'end'),
    T(xr - 320, y + 52, 'HOURS', 't-hud', 15, 'start'),
    R.clock, R.clockSub, R.secTrack, R.secBar);
  return g;
}

// left column: live system list (number + label + status pill)
const ROWS = [
  ['TRK', 'hand tracking fps'], ['HND', 'hands'], ['CAL', 'calibration'], ['API', 'claude key'],
  ['VOX', 'voice'], ['NET', 'network'], ['CPU', 'inference ms'],
];
function statusList(L) {
  const g = s('g');
  R.rows = ROWS.map(([label], i) => {
    const y = L.listY + i * 97 * (L.land ? 1 : 1.02);
    const num = T(80, y, '--', 't-white', 25, 'start');
    const pill = s('rect', { x: 186, y: y - 8, width: 32, height: 16, rx: 8, fill: RED });
    g.append(
      s('path', { d: `M18 ${y}H66`, stroke: WHITE, 'stroke-width': 4, opacity: 0.85 }),
      num, T(134, y + 1, label, 't-dim', 17, 'start'), pill);
    return { num, pill };
  });
  return g;
}

function honeycomb(L) {
  const g = s('g', { class: 'dim-when-open', 'pointer-events': 'none' });
  const [hx, hy] = L.hive;
  const r = 30, w = r * 1.5, hh = r * Math.sqrt(3);
  const cells = [];
  for (let q = -2; q <= 3; q++) for (let rr = -2; rr <= 2; rr++) {
    const dist = (Math.abs(q) + Math.abs(rr) + Math.abs(q + rr)) / 2;
    if (dist > 2 && !(q === 3 && (rr === -2 || rr === -1))) continue;
    if ((q === -2 && rr === 2) || (q === 1 && rr === 1)) continue;
    cells.push([hx + q * w, hy + (rr + q / 2) * hh]);
  }
  R.cellGlow = s('circle', { r: 46, fill: 'url(#coreGrad)', opacity: 0.85 });
  g.append(R.cellGlow);
  R.cells = cells.map(([x, y]) => {
    const p = s('polygon', { points: polyPts(6, r - 3, 0), transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, class: 'hc-cell' });
    g.append(p);
    return { p, x, y };
  });
  R.cellIdx = Math.floor(cells.length / 3);
  return g;
}

// right column: quick actions in the drawing's icon frames
const QUICK = [
  { action: 'calibrate', icon: 'hand', label: 'CALIBRATE', frame: 'burst' },
  { action: 'tracking', icon: 'eye', label: 'TRACKING', frame: 'hex' },
  { action: 'talk', icon: 'mic', label: 'TALK', frame: 'oct' },
  { action: 'launcher', icon: 'grid', label: 'MODULES', frame: 'ring' },
  { action: 'theme', icon: 'sparkle', label: 'THEME', frame: 'double' },
  { action: 'system', icon: 'settings', label: 'SYSTEM', frame: 'ring' },
];
function rightColumn(L) {
  const g = s('g');
  const x = L.colX, ys = L.colY, k = L.k;
  g.append(s('path', { d: `M${x + 52 * k} ${ys[0] - 80}V${ys[ys.length - 1] + 70}M${x + 46 * k} ${ys[0] - 80}h12`, class: 's-thin' }),
    s('path', { d: `M${x - 210} ${ys[0] - 2}H${x - 60}`, class: 's-thin' }));
  R.quick = QUICK.map((q, i) => {
    const y = ys[i];
    const b = s('g', { class: 'hud-btn quick', 'data-action': q.action, transform: `translate(${x.toFixed(1)} ${y})` });
    const r = 34 * k;
    b.append(s('rect', { x: -46 * k, y: -42 * k, width: 92 * k, height: 84 * k, rx: 6, class: 'rc-box' }));
    if (q.frame === 'burst') {
      b.append(s('circle', { r: r * 0.8, class: 'hb-face' }), s('circle', { r: r * 0.8, class: 's-line hb-ring' }));
      for (let a = 0; a < 360; a += 30) { const [x0, y0] = polar(r * 0.95, a), [x1, y1] = polar(r * 1.25, a); b.append(s('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 's-thin' })); }
    } else if (q.frame === 'hex') b.append(s('polygon', { points: polyPts(6, r * 1.1, 0), class: 'hb-face' }), s('polygon', { points: polyPts(6, r * 1.1, 0), class: 's-line hb-ring' }));
    else if (q.frame === 'oct') b.append(s('polygon', { points: polyPts(8, r * 1.1, 22.5), class: 'hb-face' }), s('polygon', { points: polyPts(8, r * 1.1, 22.5), class: 's-line hb-ring', 'stroke-width': 3 }));
    else if (q.frame === 'double') b.append(s('circle', { r: r * 1.1, class: 'hb-face' }), s('circle', { r: r * 1.1, class: 's-line hb-ring' }), s('circle', { r: r * 0.85, class: 's-faint', 'stroke-dasharray': '4 5' }));
    else b.append(s('circle', { r: r * 1.1, class: 'hb-face' }), s('circle', { r: r * 1.1, class: 's-line hb-ring', 'stroke-width': 2.5 }));
    b.append(glyphG(q.icon, 0, 0, 34 * k),
      T(-60 * k, 0, q.label, 't-dim', 17 * k, 'end'),
      s('path', { d: `M${70 * k} 0h18`, stroke: RED, 'stroke-width': 3, class: 'rc-dash' }),
      s('rect', { x: -50 * k, y: -44 * k, width: 100 * k, height: 88 * k, fill: 'transparent' }));
    b.addEventListener('click', () => { sfx.click(); cfg.action(q.action); });
    g.append(b);
    return b;
  });
  return g;
}

// wire-frame globe (rotates)
function globe(L) {
  const [gx, gy] = L.globe, r = 112;
  const g = s('g', { class: 'dim-when-open', 'pointer-events': 'none' });
  R.globeBack = s('path', { class: 's-faint' });
  R.globeFront = s('path', { class: 's-line', opacity: 0.85 });
  R.globeDots = s('path', { stroke: WHITE, 'stroke-width': 4, 'stroke-linecap': 'round' });
  g.append(s('circle', { cx: gx, cy: gy, r: r + 26, fill: 'url(#floorGrad)' }),
    s('circle', { cx: gx, cy: gy, r: r + 1, class: 's-line' }),
    s('circle', { cx: gx, cy: gy, r: r + 9, class: 's-faint', 'stroke-dasharray': '2 6' }),
    R.globeBack, R.globeFront, R.globeDots);
  R.globeGeo = { gx, gy, r };
  return g;
}

// the big SIGNAL / BATTERY arcs at the bottom
function bottomArcs(L) {
  const g = s('g');
  const cx = L.cx, low = L.arcBottom;
  const R0 = ((cx - 20) ** 2 + 210 ** 2) / 420;     // passes (20, low-210) and bottoms out at (cx, low)
  const cy = low - R0;
  const pt = (r, x) => { const dx = x - cx; return [x, cy + Math.sqrt(Math.max(0, r * r - dx * dx))]; };
  const arc = (r, xa, xb) => { const [x0, y0] = pt(r, xa), [x1, y1] = pt(r, xb); return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r.toFixed(1)} ${r.toFixed(1)} 0 0 ${xb > xa ? 0 : 1} ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  const band = (r0, r1, xa, xb) => {
    const [ax0, ay0] = pt(r0, xa), [bx0, by0] = pt(r0, xb), [ax1, ay1] = pt(r1, xa), [bx1, by1] = pt(r1, xb);
    const sw = xb > xa ? 0 : 1;
    return `M${ax0.toFixed(1)} ${ay0.toFixed(1)}A${r0.toFixed(1)} ${r0.toFixed(1)} 0 0 ${sw} ${bx0.toFixed(1)} ${by0.toFixed(1)}L${bx1.toFixed(1)} ${by1.toFixed(1)}A${r1.toFixed(1)} ${r1.toFixed(1)} 0 0 ${1 - sw} ${ax1.toFixed(1)} ${ay1.toFixed(1)}Z`;
  };
  R.arcs = { pt, band, R0 };
  for (const side of [-1, 1]) {
    const edge = side < 0 ? 20 : L.VW - 20;
    const inner = cx + side * 300;
    const barA = side < 0 ? 300 : L.VW - 300, barB = cx + side * 315;
    g.append(
      s('path', { d: arc(R0, edge, inner), class: 's-line', 'stroke-width': 2 }),
      s('path', { d: band(R0 + 26, R0 + 92, barA, barB), style: 'fill: hsl(var(--hue) 70% 30% / .25); stroke: var(--c-a35); stroke-width: 1.5' }),
      s('path', { d: arc(R0 + 118, side < 0 ? 100 : L.VW - 100, cx + side * 310), class: 's-thin' }),
      s('path', { d: band(R0 + 168, R0 + 196, side < 0 ? 70 : L.VW - 70, cx + side * 330), style: 'fill: hsl(var(--hue) 30% 40% / .16); stroke: none' }));
    // ticks
    for (let x = barA; side < 0 ? x <= barB : x >= barB; x += side * -95) {
      const [x0, y0] = pt(R0 + 96, x), [x1, y1] = pt(R0 + 150, x);
      g.append(s('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 's-line', 'stroke-width': 2 }), s('circle', { cx: x1, cy: y1 + 4, r: 4, fill: WHITE }));
    }
    const fill = s('path', { fill: 'url(#barGrad)' });
    const [lx, ly] = pt(R0 - 18, side < 0 ? 470 : L.VW - 470);
    const rot = (Math.atan2(ly - cy, lx - cx) * 180) / Math.PI - 90; // tangent to the arc
    const label = T(lx, ly, side < 0 ? 'SIGNAL' : 'BATTERY', 't-arc', 54, 'middle', { transform: `rotate(${rot.toFixed(2)} ${lx.toFixed(1)} ${ly.toFixed(1)})` });
    const [vx, vy] = pt(R0 + 59, side < 0 ? barB - 70 : barB + 70);
    const val = T(vx, vy, '--', 't-mono', 20, 'middle', { transform: `rotate(${rot.toFixed(2)} ${vx.toFixed(1)} ${vy.toFixed(1)})` });
    g.append(fill, label, val);
    // tiles in the corner
    for (const [tx, ty, sz] of [[140, 230, 64], [215, 175, 58], [120, 140, 50], [230, 95, 54], [175, 48, 40]]) {
      const x = side < 0 ? tx : L.VW - tx, y = L.VH - ty;
      g.append(s('rect', { x: x - sz / 2, y: y - sz / 2, width: sz, height: sz, transform: `rotate(${side * 28} ${x} ${y})`, style: 'fill: hsl(200 25% 70% / .12); stroke: hsl(200 30% 75% / .18)' }));
    }
    if (side < 0) { R.sigFill = fill; R.sigVal = val; R.sigRange = [barA, barB]; }
    else { R.batFill = fill; R.batVal = val; R.batLabel = label; R.batRange = [barA, barB]; }
  }
  return g;
}

function emblem(L) {
  const g = s('g', { class: 'hud-btn emblem dim-when-open', 'data-action': 'launcher', transform: `translate(${L.cx} ${L.emY})` });
  g.append(
    s('path', { d: `M${-150} -108H150`, class: 's-thin' }),
    s('circle', { r: 74, class: 'hb-face' }),
    s('circle', { r: 74, fill: 'none', stroke: '#a9bcc8', 'stroke-width': 3 }),
    s('polygon', { points: polyPts(6, 56, 30), fill: 'none', stroke: '#a9bcc8', 'stroke-width': 2, opacity: 0.8 }),
    s('path', { d: 'M0 -34L30 18H-30Z', fill: 'none', stroke: WHITE, 'stroke-width': 4, 'stroke-linejoin': 'round' }),
    s('circle', { r: 9, fill: WHITE }),
    s('path', { d: 'M-118 -14l-26 -18M-118 0h-34M-118 14l-26 18M118 -14l26 -18M118 0h34M118 14l26 18', stroke: '#a9bcc8', 'stroke-width': 3, 'stroke-linecap': 'round' }));
  g.addEventListener('click', () => { sfx.click(); cfg.action('launcher'); });
  return g;
}

function dateText(L) {
  R.date = T(L.cx, L.dateY, '', 't-date', 64);
  return R.date;
}

// the armor hologram from the drawing
function bust(L) {
  const wrap = s('g', { class: 'bust-wrap', 'pointer-events': 'none' });
  const inner = s('g', { class: 'bust' });
  const x = L.cx - BUST.w / 2, y = L.bustTop;
  R.bustImg = s('image', { href: BUST_URL, x, y, width: BUST.w, height: BUST.h, preserveAspectRatio: 'none' });
  const scan = s('g', { mask: 'url(#bustMask)' }, s('rect', { class: 'bust-scan', x, y: y - 120, width: BUST.w, height: 120, fill: 'url(#scanGrad)' }));
  inner.append(R.bustImg, scan);
  wrap.append(inner);
  return wrap;
}

function reactor(L) {
  const g = s('g', { transform: `translate(${L.rx.toFixed(1)} ${L.ry.toFixed(1)})` });
  R.coreGlow = s('circle', { r: 150, fill: 'url(#coreGrad)', class: 'pulse-op', style: '--dur:2.6s', opacity: 0.55 });
  const boost = s('g');
  R.boost = boost;
  const ring1 = s('g', { class: 'spin', style: '--dur:9s' }, s('circle', { r: 92, class: 's-line', 'stroke-dasharray': '3 9', 'stroke-width': 2, opacity: 0.8 }));
  const ring2 = s('g', { class: 'spin-rev', style: '--dur:14s' });
  for (let i = 0; i < 4; i++) ring2.append(s('path', { d: arcD(110, i * 90 + 10, i * 90 + 70), class: 's-line', 'stroke-width': 3, opacity: 0.75 }));
  const ring3 = s('g', { class: 'spin', style: '--dur:40s' });
  for (let a = 0; a < 360; a += 10) { const [x0, y0] = polar(124, a), [x1, y1] = polar(a % 30 ? 130 : 138, a); ring3.append(s('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 's-thin' })); }
  boost.append(ring1, ring2, ring3);
  R.hintRing = s('circle', { r: 100, class: 's-line hint-ring', 'stroke-width': 2 });
  R.flash = s('circle', { r: 30, fill: '#fff', opacity: 0 });
  R.waves = s('g');
  R.statusTxt = T(0, BUST.h - BUST.reactor[1] + 36, '', 't-mono', 21);
  const hit = s('circle', { r: 135, fill: 'transparent', class: 'reactor-hit', 'data-click': '' });
  hit.addEventListener('click', () => toggleLauncher());
  g.append(R.coreGlow, boost, R.hintRing, R.flash, R.waves, R.statusTxt, hit);
  return g;
}

// the 8 modules — they fly out of the arc reactor
function launcherRing(L) {
  const g = s('g');
  R.nodes = [];
  const [ax, ay] = L.ring, k = L.k;
  cfg.apps.forEach((app, i) => {
    const deg = -67.5 + i * 45;
    const [ux, uy] = polar(1, deg);
    const tx = L.rx + ux * ax, ty = L.ry + uy * ay;
    const len = Math.hypot(tx - L.rx, ty - L.ry), dx = (tx - L.rx) / len, dy = (ty - L.ry) / len;
    const x0 = L.rx + dx * 140, y0 = L.ry + dy * 140, x1 = tx - dx * 90 * k, y1 = ty - dy * 90 * k;
    const lineLen = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    const line = s('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 's-line', 'stroke-width': 2, 'stroke-dasharray': `${lineLen} ${lineLen}`, 'stroke-dashoffset': lineLen, opacity: 0.75 });
    // hidden icons wait inside the reactor: invisible AND untouchable until deployed
    const node = s('g', { class: 'app-node', 'data-app': app.id, style: 'opacity:0; pointer-events:none', transform: `translate(${L.rx} ${L.ry}) scale(0.15)` });
    node.append(
      s('polygon', { points: polyPts(6, 80 * k, 0), class: 'an-face' }),
      s('polygon', { points: polyPts(6, 80 * k, 0), class: 's-line an-ring', 'stroke-width': 2.5 }),
      s('polygon', { points: polyPts(6, 68 * k, 0), class: 's-faint' }),
      glyphG(app.icon, 0, -4 * k, 54 * k),
      T(0, 108 * k, app.name, 't-hud an-label', 23 * k),
      T(0, 134 * k, app.sub, 't-dim', 15 * k));
    node.addEventListener('click', () => { if (!state.animating) { sfx.click(); cfg.openApp(app.id); } });
    g.append(line, node);
    R.nodes.push({ node, line, lineLen, tx, ty });
  });
  setLauncherFrame(state.launcher ? 1 : 0);
  return g;
}

// ------------------------------------------------------------------ launcher animation
function setLauncherFrame(p, staggered = false) {
  const { rx, ry } = R.L;
  R.nodes.forEach(({ node, line, lineLen, tx, ty }, i) => {
    const q = staggered ? clamp(p * 1.6 - i * 0.075, 0, 1) : p;
    const e = staggered ? ease.outBack(q) : q;
    const x = rx + (tx - rx) * e, y = ry + (ty - ry) * e;
    node.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(0.15 + 0.85 * Math.min(1.08, e)).toFixed(3)})`);
    node.style.opacity = Math.min(1, q * 2).toFixed(2);
    node.style.pointerEvents = p > 0.95 ? 'auto' : 'none';
    line.setAttribute('stroke-dashoffset', (lineLen * (1 - clamp(q * 1.3 - 0.3, 0, 1))).toFixed(1));
  });
}

export function isLauncherOpen() { return state.launcher; }

export function toggleLauncher(open = !state.launcher) {
  if (state.animating || open === state.launcher || !R.svg) return;
  state.animating = true;
  state.launcher = open;
  R.svg.classList.toggle('launcher-open', open);
  if (open) {
    sfx.power();
    burst(R.L.rx, R.L.ry);
    tween(750, (e) => { R.flash.setAttribute('r', 30 + e * 190); R.flash.setAttribute('opacity', ((1 - e) * 0.95).toFixed(3)); });
    for (let i = 0; i < 4; i++) {
      const w = s('circle', { r: 60, class: 's-line', 'stroke-width': 4 - i * 0.8 });
      R.waves.append(w);
      tween(1100, (e) => { w.setAttribute('r', 60 + e * 900); w.setAttribute('opacity', (1 - e).toFixed(3)); }, ease.outCubic, i * 140).then(() => w.remove());
    }
    tween(1300, (e) => R.boost.setAttribute('transform', `rotate(${(e * 720).toFixed(1)})`), ease.outQuart);
    typeStatus('◢ ARC REACTOR ONLINE · 8 MODULES DEPLOYED');
    tween(1150, (_, p) => setLauncherFrame(p, true), (t) => t, 200).then(() => { setLauncherFrame(1); state.animating = false; });
  } else {
    sfx.powerDown();
    tween(420, (e) => setLauncherFrame(1 - e), ease.inCubic).then(() => { setLauncherFrame(0); state.animating = false; typeStatus('▸ TAP THE ARC REACTOR', true); });
    tween(600, (e) => R.boost.setAttribute('transform', `rotate(${(-e * 180).toFixed(1)})`));
    typeStatus('');
  }
}

let typeTimer = null;
function typeStatus(str, hint = false) {
  clearInterval(typeTimer);
  let i = 0;
  R.statusTxt.textContent = '';
  R.statusTxt.classList.toggle('pulse-op', hint);
  if (!str) return;
  typeTimer = setInterval(() => { R.statusTxt.textContent = str.slice(0, ++i); if (i >= str.length) clearInterval(typeTimer); }, 26);
}

// particle burst (fx canvas)
const fx = document.getElementById('fx');
const fxCtx = fx.getContext('2d');
const particles = [];
let fxRunning = false;
function burst(vx, vy) {
  const scale = Math.min(innerWidth / R.L.VW, innerHeight / R.L.VH);
  const ox = (innerWidth - R.L.VW * scale) / 2, oy = (innerHeight - R.L.VH * scale) / 2;
  const x = ox + vx * scale, y = oy + vy * scale;
  for (let i = 0; i < 170; i++) {
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 10;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: 0.011 + Math.random() * 0.02, size: 1 + Math.random() * 2.8 });
  }
  if (!fxRunning) { fxRunning = true; requestAnimationFrame(fxLoop); }
}
function fxLoop() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (fx.width !== Math.round(innerWidth * dpr)) { fx.width = Math.round(innerWidth * dpr); fx.height = Math.round(innerHeight * dpr); }
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fxCtx.clearRect(0, 0, innerWidth, innerHeight);
  fxCtx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--c-hi').trim();
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

// ------------------------------------------------------------------ live data (4×/s)
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
let tick = 0;
function update() {
  if (!R.svg) return;
  tick++;
  const now = new Date();
  const f = hand.running ? hand.lastFrame : null;
  const hands = f ? f.hands : [];
  const prim = hands[0];

  R.clock.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  R.clockSub.textContent = `SEC ${String(now.getSeconds()).padStart(2, '0')} · ${now.getFullYear()}`;
  R.secBar.setAttribute('width', ((now.getSeconds() + now.getMilliseconds() / 1000) / 60 * 320).toFixed(1));
  R.date.textContent = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${String(now.getDate()).padStart(2, '0')}`;
  R.cntHands.textContent = hands.length;
  R.cntTimers.textContent = jarvis.timers.length;

  const calibrated = !!hand.activeCalibration();
  const rows = [
    [hand.running ? String(Math.round(hand.fps)).padStart(2, '0') : '--', hand.running],
    [String(hands.length).padStart(2, '0'), hands.length > 0],
    [calibrated ? 'OK' : '--', calibrated],
    [hasKey() ? 'OK' : '--', hasKey()],
    [settings.get('voiceEnabled') ? 'ON' : '--', settings.get('voiceEnabled')],
    [navigator.onLine ? 'OK' : '--', navigator.onLine],
    [hand.running ? String(Math.round(hand.inferMs)).padStart(2, '0') : '--', hand.running && hand.inferMs < 45],
  ];
  rows.forEach(([v, ok], i) => { R.rows[i].num.textContent = v; R.rows[i].pill.setAttribute('fill', ok ? 'var(--c)' : RED); });

  // SIGNAL = hand-tracking signal quality · BATTERY = device battery (or CPU headroom)
  const sig = hand.running ? clamp(hand.fps / 30, 0, 1) * (prim ? 0.6 + 0.4 * prim.score : 0.75) : 0;
  setBar(R.sigFill, R.sigRange, sig);
  R.sigVal.textContent = hand.running ? `${Math.round(sig * 100)}%` : 'TOUCH';
  let bat, batText;
  if (state.battery) { bat = state.battery.level; batText = `${Math.round(bat * 100)}%${state.battery.charging ? ' ⚡' : ''}`; R.batLabel.textContent = 'BATTERY'; }
  else { bat = hand.running ? clamp(1 - hand.inferMs / 50, 0.05, 1) : 1; batText = `${Math.round(bat * 100)}%`; R.batLabel.textContent = 'CPU CORE'; }
  setBar(R.batFill, R.batRange, bat);
  R.batVal.textContent = batText;

  const q = R.quick;
  q[0].classList.toggle('on', calibrated);
  q[1].classList.toggle('on', hand.running);
  q[2].classList.toggle('on', jarvis.state === 'listening');
  q[3].classList.toggle('on', state.launcher);

  // honeycomb: a lit cell wanders (follows your hand when one is visible)
  if (prim && R.cells.length) {
    const [hx, hy] = R.L.hive;
    const tx = hx + (prim.x / innerWidth - 0.5) * 260, ty = hy + (prim.y / innerHeight - 0.5) * 220;
    let best = 0, bd = Infinity;
    R.cells.forEach((c, i) => { const d = Math.hypot(c.x - tx, c.y - ty); if (d < bd) { bd = d; best = i; } });
    R.cellIdx = best;
  } else if (tick % 5 === 0) {
    const cur = R.cells[R.cellIdx];
    const near = R.cells.map((c, i) => [Math.hypot(c.x - cur.x, c.y - cur.y), i]).filter(([d]) => d > 1 && d < 60);
    if (near.length) R.cellIdx = near[Math.floor(Math.random() * near.length)][1];
  }
  R.cells.forEach((c, i) => c.p.classList.toggle('lit', i === R.cellIdx));
  const lit = R.cells[R.cellIdx];
  if (lit) { R.cellGlow.setAttribute('cx', lit.x.toFixed(1)); R.cellGlow.setAttribute('cy', lit.y.toFixed(1)); }

  if (!state.launcher && !state.animating && !R.statusTxt.textContent) typeStatus('▸ TAP THE ARC REACTOR', true);
}

function setBar(el, [a, b], level) {
  const x = a + (b - a) * clamp(level, 0, 1);
  if (Math.abs(x - a) < 2) { el.setAttribute('d', ''); return; }
  el.setAttribute('d', R.arcs.band(R.arcs.R0 + 32, R.arcs.R0 + 86, a, x));
}

// ------------------------------------------------------------------ animation (~30 fps, home screen only)
let lastAnim = 0;
function animate(now) {
  requestAnimationFrame(animate);
  if (!R.svg || document.hidden || document.body.classList.contains('app-open') || now - lastAnim < 33) return;
  const dt = Math.min(0.1, (now - lastAnim) / 1000);
  lastAnim = now;
  // heading tape: drifts, and follows the hand's azimuth
  const prim = hand.running && hand.lastFrame ? hand.lastFrame.hands[0] : null;
  if (prim) state.heading += (((prim.x / innerWidth - 0.5) * 120 + 180) - state.heading) * Math.min(1, dt * 3);
  else state.heading += dt * 1.5;
  drawTape(state.heading);
  drawGlobe(now / 1000);
}

function drawTape(h) {
  const { cx } = R.L, y = R.tapeY, px = 9.6;
  let d = '';
  const start = Math.floor((h - 82) / 2) * 2;
  for (let deg = start; deg <= h + 82; deg += 2) {
    const x = (cx + (deg - h) * px).toFixed(1);
    if (((deg % 10) + 10) % 10 === 0) d += `M${x} ${y - 12}V${y + 12}M${(+x - 7).toFixed(1)} ${y}H${(+x + 7).toFixed(1)}`;
    else d += `M${x} ${y - 5}V${y + 5}`;
  }
  R.tapeTicks.setAttribute('d', d);
  let li = 0;
  for (let deg = Math.ceil((h - 80) / 20) * 20; deg <= h + 80 && li < R.tapeLabels.length; deg += 20) {
    const t = R.tapeLabels[li++];
    t.setAttribute('x', (cx + (deg - h) * px).toFixed(1));
    t.textContent = String(((deg % 360) + 360) % 360).padStart(3, '0');
  }
  for (; li < R.tapeLabels.length; li++) R.tapeLabels[li].textContent = '';
}

function drawGlobe(t) {
  const { gx, gy, r } = R.globeGeo;
  const tilt = 0.38, ct = Math.cos(tilt), st = Math.sin(tilt);
  const rot = t * 0.35;
  let front = '', back = '';
  // unit-sphere point → screen (x, y) + depth (z > 0 faces the viewer)
  const P = (x, y, z) => [gx + r * x, gy - r * (y * ct - z * st), y * st + z * ct];
  const geo = (lat, lon) => P(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
  const line = (pts) => {
    let pf = false, pb = false;
    for (const [x, y, z] of pts) {
      const p = `${x.toFixed(1)} ${y.toFixed(1)}`;
      if (z >= 0) { front += (pf ? 'L' : 'M') + p; pf = true; pb = false; }
      else { back += (pb ? 'L' : 'M') + p; pb = true; pf = false; }
    }
  };
  for (let m = 0; m < 6; m++) {
    const lon = rot + (m * Math.PI) / 6, sl = Math.sin(lon), cl = Math.cos(lon);
    const pts = [];
    for (let i = 0; i <= 60; i++) { const a = (i / 60) * Math.PI * 2; pts.push(P(Math.sin(a) * sl, Math.cos(a), Math.sin(a) * cl)); }
    line(pts);
  }
  for (const latDeg of [-60, -30, 0, 30, 60]) {
    const lat = (latDeg * Math.PI) / 180, pts = [];
    for (let i = 0; i <= 48; i++) pts.push(geo(lat, (i / 48) * Math.PI * 2));
    line(pts);
  }
  R.globeFront.setAttribute('d', front);
  R.globeBack.setAttribute('d', back);
  let dots = '';
  for (const [la, lo] of [[0.6, 0.3], [0.2, 1.4], [-0.4, 2.2], [0.9, 3.1], [-0.2, 4.4], [0.4, 5.3]]) {
    const [x, y, z] = geo(la, lo + rot);
    if (z > 0.1) dots += `M${x.toFixed(1)} ${y.toFixed(1)}h0.1`;
  }
  R.globeDots.setAttribute('d', dots);
}

export function cycleTheme() {
  const names = Object.keys(THEMES);
  const cur = settings.get('hue');
  const i = names.findIndex((n) => THEMES[n] === cur);
  const next = names[(i + 1) % names.length];
  settings.set('hue', THEMES[next]);
  return next;
}
