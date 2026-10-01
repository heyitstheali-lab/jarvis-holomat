// CIRCUIT LAB — a holographic PCB / circuit designer with a Claude "engineer".
// Grid unit = 1.27 mm (half of the 0.1" pin pitch), so through-hole parts land
// on real footprints. Claude can lay out a whole circuit from a description
// (build_circuit tool), review the current board, or answer questions about it.
import { h, button, md, toast, modal, download, glyph, fitCanvas } from '../core/ui.js';
import { converse, describeError, hasKey, isAbort } from '../core/claude.js';
import { loadJSON, saveJSON } from '../core/store.js';
import { sfx } from '../core/audio.js';
import { themeColors } from './game-kit.js';

const BOARD = { w: 80, h: 50 }; // grid units (101.6 × 63.5 mm)
const MM = 1.27;

// ------------------------------------------------------------------ part library
const icPins = (p) => {
  const n = Math.max(4, Math.min(40, (p.pins || 8) - ((p.pins || 8) % 2)));
  const half = n / 2, w = p.width || (n > 20 ? 12 : 6);
  const out = [];
  for (let i = 0; i < half; i++) out.push([-w / 2, -(half - 1) + 2 * i, String(i + 1)]);
  for (let i = 0; i < half; i++) out.push([w / 2, (half - 1) - 2 * i, String(half + i + 1)]);
  return out;
};
const headerPins = (p) => {
  const n = Math.max(1, Math.min(20, p.pins || 4));
  return Array.from({ length: n }, (_, i) => [0, -(n - 1) + 2 * i, String(i + 1)]);
};

export const LIB = {
  resistor: { label: 'Resistor', prefix: 'R', value: '220Ω', pins: [[-4, 0, '1'], [4, 0, '2']], box: [-3, -1, 3, 1] },
  capacitor: { label: 'Capacitor', prefix: 'C', value: '100nF', pins: [[-1, 0, '1'], [1, 0, '2']], box: [-1.6, -1.4, 1.6, 1.4] },
  electrolytic: { label: 'Elec. cap', prefix: 'C', value: '10µF', pins: [[-1, 0, '+'], [1, 0, '-']], box: [-2.2, -2.2, 2.2, 2.2] },
  led: { label: 'LED', prefix: 'D', value: 'Red', pins: [[-1, 0, 'A'], [1, 0, 'K']], box: [-2, -2, 2, 2] },
  diode: { label: 'Diode', prefix: 'D', value: '1N4148', pins: [[-4, 0, 'A'], [4, 0, 'K']], box: [-2.6, -0.9, 2.6, 0.9] },
  npn: { label: 'NPN', prefix: 'Q', value: '2N2222', pins: [[-2, 0, 'E'], [0, 0, 'B'], [2, 0, 'C']], box: [-2.6, -2.2, 2.6, 1.2] },
  pnp: { label: 'PNP', prefix: 'Q', value: '2N3906', pins: [[-2, 0, 'E'], [0, 0, 'B'], [2, 0, 'C']], box: [-2.6, -2.2, 2.6, 1.2] },
  pot: { label: 'Pot', prefix: 'RV', value: '10kΩ', pins: [[-2, 2, '1'], [0, 2, 'W'], [2, 2, '3']], box: [-3.2, -2.6, 3.2, 3] },
  switch: { label: 'Switch', prefix: 'SW', value: 'Push', pins: [[-3, 0, '1'], [3, 0, '2']], box: [-2.6, -2.6, 2.6, 2.6] },
  battery: { label: 'Battery', prefix: 'BT', value: '9V', pins: [[0, -2, '+'], [0, 2, '-']], box: [-3, -3.6, 3, 3.6] },
  buzzer: { label: 'Buzzer', prefix: 'BZ', value: 'Piezo', pins: [[-2, 0, '+'], [2, 0, '-']], box: [-3.6, -3.6, 3.6, 3.6] },
  ic: { label: 'IC (DIP)', prefix: 'U', value: 'NE555', pins: icPins, box: (p) => { const n = p.pins || 8; const w = p.width || (n > 20 ? 12 : 6); return [-w / 2 + 0.8, -n / 2, w / 2 - 0.8, n / 2]; }, params: true },
  header: { label: 'Header', prefix: 'J', value: '1x4', pins: headerPins, box: (p) => { const n = p.pins || 4; return [-1, -n, 1, n]; }, params: true },
  vcc: { label: 'VCC', prefix: 'PWR', value: '5V', pins: [[0, 1, '1']], box: [-1.6, -1.8, 1.6, 1] },
  gnd: { label: 'GND', prefix: 'GND', value: 'GND', pins: [[0, -1, '1']], box: [-1.6, -1, 1.6, 1.8] },
};
const TYPES = Object.keys(LIB);

const rotPt = (x, y, r) => (r === 90 ? [-y, x] : r === 180 ? [-x, -y] : r === 270 ? [y, -x] : [x, y]);
export function pinsOf(part) {
  const def = LIB[part.type];
  const local = typeof def.pins === 'function' ? def.pins(part) : def.pins;
  return local.map(([px, py, name]) => { const [rx, ry] = rotPt(px, py, part.rot || 0); return { x: part.x + rx, y: part.y + ry, name, ref: part.ref }; });
}
function bboxOf(part) {
  const def = LIB[part.type];
  const b = typeof def.box === 'function' ? def.box(part) : def.box;
  const pts = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(([x, y]) => rotPt(x, y, part.rot || 0));
  const xs = pts.map((p) => p[0]).concat(pinsOf(part).map((p) => p.x - part.x));
  const ys = pts.map((p) => p[1]).concat(pinsOf(part).map((p) => p.y - part.y));
  return [part.x + Math.min(...xs) - 0.6, part.y + Math.min(...ys) - 0.6, part.x + Math.max(...xs) + 0.6, part.y + Math.max(...ys) + 0.6];
}

// ------------------------------------------------------------------ netlist / DRC
/** every grid point an orthogonal polyline passes through */
function pathKeys(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1];
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let st = i ? 1 : 0; st <= n; st++) out.push(`${Math.round(x0 + ((x1 - x0) * st) / (n || 1))},${Math.round(y0 + ((y1 - y0) * st) / (n || 1))}`);
  }
  return out;
}
export function analyze(design) {
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const add = (k) => { if (!parent.has(k)) parent.set(k, k); };
  const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const key = (x, y) => `${x},${y}`;
  const allPins = design.parts.flatMap((p) => pinsOf(p).map((pin) => ({ ...pin, part: p })));
  for (const pin of allPins) add(key(pin.x, pin.y));
  // A trace connects to every pad it runs over, and to another trace only where
  // one of their endpoints meets the other (a junction) — plain crossings don't.
  const through = new Map(); // grid point → wire ids passing through it
  design.wires.forEach((w, i) => {
    const id = `w${i}`;
    add(id);
    for (const k of pathKeys(w.points)) {
      if (!through.has(k)) through.set(k, []);
      through.get(k).push(id);
    }
  });
  for (const pin of allPins) for (const id of through.get(key(pin.x, pin.y)) || []) union(key(pin.x, pin.y), id);
  design.wires.forEach((w, i) => {
    const pts = w.points;
    for (const [x, y] of [pts[0], pts[pts.length - 1]]) for (const id of through.get(key(x, y)) || []) union(`w${i}`, id);
  });
  const nets = new Map();
  for (const pin of allPins) {
    const r = find(key(pin.x, pin.y));
    if (!nets.has(r)) nets.set(r, []);
    nets.get(r).push(pin);
  }
  // name nets: power flags give names
  let n = 0;
  const named = [];
  for (const pins of nets.values()) {
    const flag = pins.find((p) => p.part.type === 'vcc' || p.part.type === 'gnd');
    const name = flag ? (flag.part.type === 'gnd' ? 'GND' : flag.part.value || 'VCC') : `N${++n}`;
    named.push({ name, flagged: !!flag, pins: pins.filter((p) => p.part.type !== 'vcc' && p.part.type !== 'gnd') });
  }
  const real = named.filter((nn) => nn.pins.length);
  // a lone pin is "open" unless it is tied to a supply flag
  const unconnected = real.filter((nn) => nn.pins.length === 1 && !nn.flagged).map((nn) => `${nn.pins[0].ref}.${nn.pins[0].name}`);
  const warnings = [];
  if (unconnected.length) warnings.push(`${unconnected.length} unconnected pin(s): ${unconnected.slice(0, 12).join(', ')}${unconnected.length > 12 ? '…' : ''}`);
  const offBoard = design.parts.filter((p) => { const b = bboxOf(p); return b[0] < 0 || b[1] < 0 || b[2] > BOARD.w || b[3] > BOARD.h; });
  if (offBoard.length) warnings.push(`Off the board edge: ${offBoard.map((p) => p.ref).join(', ')}`);
  const leds = design.parts.filter((p) => p.type === 'led');
  for (const led of leds) {
    const ps = pinsOf(led);
    const touchesR = real.some((nn) => nn.pins.some((p) => p.ref === led.ref) && nn.pins.some((p) => p.part.type === 'resistor'));
    if (!touchesR && ps.length) warnings.push(`${led.ref}: no series resistor found next to the LED`);
  }
  return { nets: real, unconnected, warnings };
}

function netlistText(design) {
  const { nets, warnings } = analyze(design);
  const lines = [`# ${design.name || 'Untitled'} — Holomat Circuit Lab netlist`, '', '## Parts'];
  for (const p of design.parts) lines.push(`${p.ref}\t${LIB[p.type].label}\t${p.value || ''}${p.pins ? `\t${p.pins} pins` : ''}`);
  lines.push('', '## Nets');
  for (const nn of nets) lines.push(`${nn.name}: ${nn.pins.map((p) => `${p.ref}.${p.name}`).join(' ')}`);
  if (warnings.length) lines.push('', '## Checks', ...warnings.map((w) => `! ${w}`));
  return lines.join('\n');
}

// ------------------------------------------------------------------ Claude prompts
const LIB_DOC = TYPES.map((t) => {
  const d = LIB[t];
  const pins = typeof d.pins === 'function' ? (t === 'ic' ? 'DIP with `pins` (even 4–40); pin 1 top-left, counting down the left side then up the right side; rows 6 units apart (12 when pins > 20); pins 2 units apart' : 'single-row header with `pins` (1–20) pins named 1..n, vertical, 2 units apart, centred on the part position') : d.pins.map(([x, y, n]) => `${n}@(${x},${y})`).join(' ');
  return `- ${t} (ref ${d.prefix}#): ${pins}`;
}).join('\n');

const SYSTEM = `You are the Claude Engineer inside the Holomat Circuit Lab, a through-hole PCB designer.

Board: ${BOARD.w} × ${BOARD.h} grid units, origin top-left, x to the right, y down. 1 grid unit = 1.27 mm; 0.1" pin pitch = 2 units.
Parts are placed by their centre (x, y) in whole grid units. rotation is 0, 90, 180 or 270 degrees clockwise; a pin at local (px, py) rotated 90° ends up at (-py, px).
Part library — type (reference prefix): pin name@(local x, local y)
${LIB_DOC}
vcc and gnd are power flags: every pin wired to one joins that supply net (use value like "5V", "9V", "3V3" on vcc). Use them instead of long supply traces.

When asked to design a circuit, call build_circuit once with the complete design:
- Choose realistic hobby through-hole parts and correct values (always add current-limiting resistors for LEDs, decoupling caps for ICs).
- Name pins in connections as REF.PIN, e.g. "R1.1", "U1.8", "D1.A", "Q1.B", "BT1.+".
- Lay parts out cleanly: keep them inside x 6–${BOARD.w - 6}, y 6–${BOARD.h - 6}, at least 8 units apart, signal flowing left to right, supply flags near the parts they feed.
After the tool call, explain in 2–5 sentences how the circuit works and why you picked the key values.
For reviews and questions, be concrete and practical: name parts by reference, give values, and flag anything that could damage a part or a person. Use short markdown.`;

const BUILD_TOOL = {
  name: 'build_circuit',
  description: 'Replace the board with a complete circuit design: parts with positions plus point-to-point connections, which the Holomat routes as traces.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short project name' },
      parts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string' },
            type: { type: 'string', enum: TYPES },
            value: { type: 'string' },
            x: { type: 'integer' },
            y: { type: 'integer' },
            rotation: { type: 'integer', enum: [0, 90, 180, 270] },
            pins: { type: 'integer', description: 'Pin count for ic and header types' },
          },
          required: ['ref', 'type', 'value', 'x', 'y'],
        },
      },
      connections: {
        type: 'array',
        items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
      },
    },
    required: ['name', 'parts', 'connections'],
  },
};

// ------------------------------------------------------------------ app
export default {
  mount({ body, panel }) {
    const C = themeColors();
    let design = loadJSON('circuit.current', null) || { name: 'Untitled board', parts: [], wires: [] };
    let mode = 'select';          // select | wire | delete | place
    let placeType = null;
    let selected = null;          // { kind: 'part'|'wire', ref|index }
    let wireDraft = null;         // [[x,y], ...]
    let hover = null;             // grid point under the pointer
    let view = { s: 12, ox: 0, oy: 0 };
    let ctrl = null;
    let pending = null;
    const history = [];

    const save = () => saveJSON('circuit.current', design);
    const snapshot = () => { history.push(JSON.stringify(design)); if (history.length > 60) history.shift(); };
    const undo = () => { if (!history.length) return; design = JSON.parse(history.pop()); selected = null; changed(false); };

    // ---------------- toolbar
    const modeBtns = {};
    const modeBtn = (id, label, icon) => { const b = button(label, () => setMode(id), { cls: 'small', icon }); modeBtns[id] = b; return b; };
    const tb1 = h('div', { class: 'toolbar' },
      modeBtn('select', 'Select', 'move'), modeBtn('wire', 'Trace', 'wire'), modeBtn('delete', 'Delete', 'trash'),
      h('div', { class: 'sep' }),
      button('Rotate', () => rotateSel(), { cls: 'small', icon: 'rotate' }),
      button('Undo', undo, { cls: 'small' }),
      h('div', { class: 'sep' }),
      button('', () => zoom(1.25), { cls: 'small icon', icon: 'plus' }),
      button('', () => zoom(0.8), { cls: 'small icon', icon: 'minus' }),
      button('Fit', () => fit(), { cls: 'small' }),
      h('div', { class: 'sep' }),
      button('New', () => newBoard(), { cls: 'small' }),
      button('Open', () => openDialog(), { cls: 'small' }),
      button('Save', () => saveAs(), { cls: 'small', icon: 'save' }),
      button('Export', () => exportDialog(), { cls: 'small', icon: 'download' }));
    const partBtns = {};
    const tb2 = h('div', { class: 'toolbar', style: { paddingTop: '4px' } },
      h('span', { class: 'mono muted', style: { fontSize: '11px', letterSpacing: '.15em' } }, 'PARTS'),
      TYPES.map((t) => { const b = button(LIB[t].label, () => { placeType = t; setMode('place'); }, { cls: 'small' }); partBtns[t] = b; return b; }));

    const canvas = h('canvas', { style: { position: 'absolute', inset: '0', width: '100%', height: '100%', touchAction: 'none' } });
    const statusEl = h('div', { class: 'mono', style: { position: 'absolute', left: '12px', bottom: '10px', fontSize: '12px', color: 'var(--c)', pointerEvents: 'none', background: 'var(--panel)', padding: '6px 10px', border: '1px solid var(--c-a20)' } });
    const boardEl = h('div', { class: 'game-stage' }, canvas, statusEl);

    // ---------------- side panel
    const selBox = h('div', { style: { padding: '12px 14px', borderBottom: '1px solid var(--c-a20)' } });
    const prompt = h('textarea', { class: 'hinput', rows: 3, placeholder: 'Describe a circuit, e.g. “a 555 LED flasher powered by a 9V battery”, or ask about this board…' });
    const out = h('div', { class: 'msg assistant', style: { maxWidth: '100%', fontSize: '16px' } });
    const outWrap = h('div', { class: 'scroll', 'data-scroll': '', style: { flex: '1', padding: '10px 14px', minHeight: '80px' } }, out);
    const stopBtn = button('Stop', () => ctrl?.abort(), { cls: 'small danger' });
    stopBtn.style.display = 'none';
    const aiBox = h('div', { style: { padding: '12px 14px', borderBottom: '1px solid var(--c-a20)' } },
      h('div', { class: 'section-title', style: { marginTop: '0', display: 'flex', alignItems: 'center', gap: '8px' } }, glyph('sparkle', 'gi'), 'CLAUDE ENGINEER'),
      prompt,
      h('div', { class: 'row', style: { marginTop: '8px' } },
        button('Design', () => ai('design'), { cls: 'small primary', icon: 'sparkle' }),
        button('Review', () => ai('review'), { cls: 'small' }),
        button('Ask', () => ai('ask'), { cls: 'small' }),
        stopBtn));
    const side = h('div', { class: 'side' }, selBox, aiBox, outWrap);
    body.append(tb1, tb2, h('div', { class: 'split' }, boardEl, side));
    out.innerHTML = md(hasKey() ? 'Describe what you want to build and press **Design** — Claude will place the parts and wire the board. **Review** checks the current board.' : 'Add your Claude API key in **SYSTEM** to unlock the Claude Engineer. The editor works without it.');

    // ---------------- canvas / view
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0;
    const unfit = fitCanvas(canvas, (w, hh, dpr) => { const first = !W; W = w; H = hh; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); if (first) fit(); else draw(); });
    const toScreen = (x, y) => [view.ox + x * view.s, view.oy + y * view.s];
    const toGrid = (sx, sy) => [(sx - view.ox) / view.s, (sy - view.oy) / view.s];
    function fit() {
      if (!W) return;
      view.s = Math.min((W - 40) / BOARD.w, (H - 40) / BOARD.h);
      view.ox = (W - BOARD.w * view.s) / 2; view.oy = (H - BOARD.h * view.s) / 2;
      draw();
    }
    function zoom(f, cx = W / 2, cy = H / 2) {
      const ns = Math.max(4, Math.min(60, view.s * f));
      const k = ns / view.s;
      view.ox = cx - (cx - view.ox) * k; view.oy = cy - (cy - view.oy) * k; view.s = ns;
      draw();
    }

    function setMode(m) {
      mode = m;
      if (m !== 'wire') wireDraft = null;
      if (m !== 'place') placeType = null;
      Object.entries(modeBtns).forEach(([k, b]) => b.classList.toggle('on', k === m));
      Object.entries(partBtns).forEach(([k, b]) => b.classList.toggle('on', m === 'place' && k === placeType));
      draw();
    }

    // ---------------- drawing
    function drawPart(p, sel) {
      const pins = pinsOf(p);
      ctx.save();
      const [sx, sy] = toScreen(p.x, p.y);
      ctx.translate(sx, sy);
      ctx.rotate(((p.rot || 0) * Math.PI) / 180);
      const u = view.s;
      ctx.lineWidth = Math.max(1.2, u * 0.14);
      ctx.strokeStyle = sel ? '#ffffff' : 'rgba(225,250,255,0.85)';
      ctx.fillStyle = 'rgba(225,250,255,0.85)';
      ctx.shadowColor = C.c; ctx.shadowBlur = sel ? 14 : 0;
      const line = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * u, y * u) : ctx.moveTo(x * u, y * u))); ctx.stroke(); };
      const rect = (x0, y0, x1, y1, r = 0.3) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0 * u, y0 * u, (x1 - x0) * u, (y1 - y0) * u, r * u) : ctx.rect(x0 * u, y0 * u, (x1 - x0) * u, (y1 - y0) * u); ctx.stroke(); };
      const circ = (x, y, r) => { ctx.beginPath(); ctx.arc(x * u, y * u, r * u, 0, 7); ctx.stroke(); };
      switch (p.type) {
        case 'resistor': line([[-4, 0], [-2.6, 0]]); line([[2.6, 0], [4, 0]]); rect(-2.6, -0.8, 2.6, 0.8, 0.6); line([[-1.4, -0.8], [-1.4, 0.8]]); line([[-0.6, -0.8], [-0.6, 0.8]]); line([[0.6, -0.8], [0.6, 0.8]]); break;
        case 'capacitor': line([[-0.35, -1.2], [-0.35, 1.2]]); line([[0.35, -1.2], [0.35, 1.2]]); break;
        case 'electrolytic': circ(0, 0, 2); line([[-0.4, -1], [-0.4, 1]]); line([[0.4, -1], [0.4, 1]]); line([[-1.5, -1.2], [-0.9, -1.2]]); line([[-1.2, -1.5], [-1.2, -0.9]]); break;
        case 'led': circ(0, 0, 1.8); line([[-0.6, -0.8], [-0.6, 0.8], [0.6, 0], [-0.6, -0.8]]); line([[0.6, -0.8], [0.6, 0.8]]); line([[0.2, -1.1], [0.9, -1.9]]); line([[0.8, -0.9], [1.5, -1.7]]); break;
        case 'diode': line([[-4, 0], [-2.4, 0]]); line([[2.4, 0], [4, 0]]); rect(-2.4, -0.7, 2.4, 0.7, 0.3); ctx.fillRect(1.4 * u, -0.7 * u, 0.5 * u, 1.4 * u); break;
        case 'npn': case 'pnp': ctx.beginPath(); ctx.moveTo(-2.4 * u, 0.9 * u); ctx.lineTo(2.4 * u, 0.9 * u); ctx.arc(0, 0.9 * u, 2.4 * u, 0, Math.PI, true); ctx.stroke(); break;
        case 'pot': rect(-3, -2.4, 3, 1.2, 0.4); circ(0, -0.6, 1.3); line([[0, -0.6], [0.9, -1.5]]); break;
        case 'switch': rect(-2.4, -2.4, 2.4, 2.4, 0.4); circ(0, 0, 1.3); break;
        case 'battery': rect(-2.8, -3.4, 2.8, 3.4, 0.5); line([[-1.4, -0.6], [1.4, -0.6]]); line([[-0.7, 0.6], [0.7, 0.6]]); line([[-0.4, -2.2], [0.4, -2.2]]); line([[0, -2.6], [0, -1.8]]); break;
        case 'buzzer': circ(0, 0, 3.4); circ(0, 0, 0.6); break;
        case 'ic': { const b = LIB.ic.box(p); rect(b[0], b[1], b[2], b[3], 0.2); ctx.beginPath(); ctx.arc(0, b[1] * u, 0.7 * u, 0, Math.PI); ctx.stroke(); ctx.beginPath(); ctx.arc((b[0] + 0.8) * u, (b[1] + 0.9) * u, 0.25 * u, 0, 7); ctx.fill(); break; }
        case 'header': { const b = LIB.header.box(p); rect(b[0], b[1], b[2], b[3], 0.1); break; }
        case 'vcc': line([[0, 1], [0, -0.6]]); line([[-1.3, -0.6], [1.3, -0.6]]); line([[-0.8, -1.2], [0, -1.7], [0.8, -1.2]]); break;
        case 'gnd': line([[0, -1], [0, 0.4]]); line([[-1.3, 0.4], [1.3, 0.4]]); line([[-0.8, 0.9], [0.8, 0.9]]); line([[-0.3, 1.4], [0.3, 1.4]]); break;
        default: break;
      }
      ctx.restore();
      // pads (in world orientation)
      for (const pin of pins) {
        const [px, py] = toScreen(pin.x, pin.y);
        ctx.fillStyle = C.c; ctx.shadowColor = C.c; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(px, py, Math.max(3, view.s * 0.6), 0, 7); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = '#021014';
        ctx.beginPath(); ctx.arc(px, py, Math.max(1.4, view.s * 0.26), 0, 7); ctx.fill();
        if (view.s > 14 && (p.type === 'ic' || p.type === 'npn' || p.type === 'pnp' || p.type === 'led' || p.type === 'electrolytic' || p.type === 'battery')) {
          ctx.fillStyle = 'rgba(225,250,255,0.6)'; ctx.font = `${Math.round(view.s * 0.62)}px "Share Tech Mono"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(pin.name, px, py - view.s * 1.05);
        }
      }
      // label
      const b = bboxOf(p);
      const [lx, ly] = toScreen((b[0] + b[2]) / 2, b[1]);
      ctx.fillStyle = sel ? '#fff' : C.hi; ctx.font = `700 ${Math.max(9, Math.round(view.s * 0.8))}px Rajdhani, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${p.ref} ${p.type === 'vcc' || p.type === 'gnd' ? p.value : p.value || ''}`, lx, ly - 2);
    }

    function draw() {
      if (!W) return;
      ctx.clearRect(0, 0, W, H);
      // board
      const [bx, by] = toScreen(0, 0);
      const bw = BOARD.w * view.s, bh = BOARD.h * view.s;
      ctx.fillStyle = 'rgba(4, 40, 44, 0.75)';
      ctx.strokeStyle = C.c; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, view.s * 2) : ctx.rect(bx, by, bw, bh); ctx.fill(); ctx.stroke();
      // grid dots every 2 units
      ctx.fillStyle = C.c; ctx.globalAlpha = 0.28;
      const d = Math.max(1, view.s * 0.09);
      for (let x = 2; x < BOARD.w; x += 2) for (let y = 2; y < BOARD.h; y += 2) { const [sx, sy] = toScreen(x, y); ctx.fillRect(sx - d / 2, sy - d / 2, d, d); }
      ctx.globalAlpha = 1;
      // mounting holes
      for (const [mx, my] of [[3, 3], [BOARD.w - 3, 3], [3, BOARD.h - 3], [BOARD.w - 3, BOARD.h - 3]]) {
        const [sx, sy] = toScreen(mx, my); ctx.strokeStyle = C.dim; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, view.s * 1.3, 0, 7); ctx.stroke();
      }
      // traces
      const traceW = Math.max(2, view.s * 0.5);
      design.wires.forEach((w, i) => {
        const sel = selected?.kind === 'wire' && selected.index === i;
        ctx.strokeStyle = sel ? '#fff' : C.c; ctx.lineWidth = traceW; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.shadowColor = C.c; ctx.shadowBlur = sel ? 16 : 8;
        ctx.beginPath(); w.points.forEach(([x, y], j) => { const [sx, sy] = toScreen(x, y); j ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.stroke();
        ctx.shadowBlur = 0;
      });
      // parts
      for (const p of design.parts) drawPart(p, selected?.kind === 'part' && selected.ref === p.ref);
      // wire draft
      if (wireDraft && wireDraft.length) {
        const pts = hover ? [...wireDraft, ...route(wireDraft[wireDraft.length - 1], hover).slice(1)] : wireDraft;
        ctx.strokeStyle = '#fff'; ctx.globalAlpha = 0.7; ctx.lineWidth = traceW; ctx.setLineDash([view.s * 0.6, view.s * 0.5]);
        ctx.beginPath(); pts.forEach(([x, y], j) => { const [sx, sy] = toScreen(x, y); j ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      // hover marker / ghost part
      if (hover && (mode === 'wire' || mode === 'place')) {
        const [sx, sy] = toScreen(hover[0], hover[1]);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx, sy, view.s * 0.9, 0, 7); ctx.stroke();
        if (mode === 'place' && placeType) { ctx.globalAlpha = 0.45; drawPart(ghostPart(hover), false); ctx.globalAlpha = 1; }
      }
      const a = analyze(design);
      statusEl.textContent = `${design.name.toUpperCase()} · ${design.parts.length} PARTS · ${a.nets.length} NETS${a.unconnected.length ? ` · ${a.unconnected.length} OPEN PINS` : ' · ALL PINS CONNECTED'} · ${mode === 'place' ? `PLACE ${LIB[placeType].label.toUpperCase()}` : mode.toUpperCase()}`;
    }
    const ghostPart = (pt) => ({ type: placeType, ref: nextRef(placeType), value: LIB[placeType].value, x: pt[0], y: pt[1], rot: 0, pins: LIB[placeType].params ? (placeType === 'ic' ? 8 : 4) : undefined });

    // ---------------- editing helpers
    function nextRef(type) {
      const pre = LIB[type].prefix;
      let n = 1;
      while (design.parts.some((p) => p.ref === `${pre}${n}`)) n++;
      return `${pre}${n}`;
    }
    function route(a, b) {
      const [ax, ay] = a, [bx, by] = b;
      if (ax === bx && ay === by) return [a, b];
      const pads = new Set();
      for (const p of design.parts) for (const pin of pinsOf(p)) pads.add(`${pin.x},${pin.y}`);
      pads.delete(`${ax},${ay}`); pads.delete(`${bx},${by}`);
      const used = new Set(design.wires.flatMap((w) => pathKeys(w.points)));
      const boxes = design.parts.map(bboxOf);
      const cands = [[a, [bx, ay], b], [a, [ax, by], b]];
      const lo = (u, v) => Math.min(u, v) - 10, hi = (u, v) => Math.max(u, v) + 10;
      for (let x = lo(ax, bx); x <= hi(ax, bx); x++) cands.push([a, [x, ay], [x, by], b]);
      for (let y = lo(ay, by); y <= hi(ay, by); y++) cands.push([a, [ax, y], [bx, y], b]);
      let best = null, bestCost = Infinity;
      for (const c of cands) {
        const pts = c.filter((p, i) => i === 0 || p[0] !== c[i - 1][0] || p[1] !== c[i - 1][1]);
        if (pts.some(([x, y]) => x < 1 || y < 1 || x > BOARD.w - 1 || y > BOARD.h - 1)) continue;
        let cost = 0;
        const keys = pathKeys(pts);
        for (const k of keys) {
          if (pads.has(k)) cost += 1000;                 // would short another pad
          else if (used.has(k)) cost += 40;               // crosses / overlaps another trace
          const [x, y] = k.split(',').map(Number);
          if (boxes.some((bb) => x > bb[0] + 0.6 && x < bb[2] - 0.6 && y > bb[1] + 0.6 && y < bb[3] - 0.6)) cost += 3;
        }
        cost += keys.length + (pts.length - 2) * 4;
        if (cost < bestCost) { bestCost = cost; best = pts; }
      }
      return best || [a, [bx, ay], b];
    }
    function pinAt(gx, gy, tol = 0.9) {
      let best = null, bd = tol;
      for (const p of design.parts) for (const pin of pinsOf(p)) { const dd = Math.hypot(pin.x - gx, pin.y - gy); if (dd < bd) { bd = dd; best = pin; } }
      return best;
    }
    function partAt(gx, gy) {
      for (let i = design.parts.length - 1; i >= 0; i--) { const b = bboxOf(design.parts[i]); if (gx >= b[0] && gx <= b[2] && gy >= b[1] && gy <= b[3]) return design.parts[i]; }
      return null;
    }
    function wireAt(gx, gy) {
      for (let i = design.wires.length - 1; i >= 0; i--) {
        const pts = design.wires[i].points;
        for (let j = 0; j < pts.length - 1; j++) {
          const [x0, y0] = pts[j], [x1, y1] = pts[j + 1];
          const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((gx - x0) * dx + (gy - y0) * dy) / L2));
          if (Math.hypot(gx - (x0 + t * dx), gy - (y0 + t * dy)) < 0.7) return i;
        }
      }
      return -1;
    }
    function rotateSel() {
      if (selected?.kind !== 'part') { toast('Select a part to rotate'); return; }
      const p = design.parts.find((x) => x.ref === selected.ref);
      if (!p) return;
      snapshot(); p.rot = ((p.rot || 0) + 90) % 360; sfx.click(); changed();
    }
    function changed(snap = false) { if (snap) snapshot(); save(); renderSel(); draw(); }

    function renderSel() {
      selBox.replaceChildren();
      if (selected?.kind === 'part') {
        const p = design.parts.find((x) => x.ref === selected.ref);
        if (!p) { selected = null; return renderSel(); }
        const val = h('input', { class: 'hinput', value: p.value || '', style: { minHeight: '42px', fontSize: '16px' } });
        val.addEventListener('change', () => { snapshot(); p.value = val.value.trim(); changed(); });
        const ref = h('input', { class: 'hinput', value: p.ref, style: { minHeight: '42px', fontSize: '16px', width: '90px' } });
        ref.addEventListener('change', () => { const r = ref.value.trim().toUpperCase(); if (r && !design.parts.some((x) => x.ref === r)) { snapshot(); p.ref = r; selected.ref = r; changed(); } else ref.value = p.ref; });
        selBox.append(...[
          h('div', { class: 'section-title', style: { marginTop: '0' } }, `SELECTED · ${LIB[p.type].label.toUpperCase()}`),
          h('div', { class: 'row' }, ref, h('div', { class: 'grow' }, val)),
          LIB[p.type].params ? h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'mono muted' }, `PINS ${p.pins || (p.type === 'ic' ? 8 : 4)}`),
            button('−', () => { snapshot(); p.pins = Math.max(p.type === 'ic' ? 4 : 1, (p.pins || (p.type === 'ic' ? 8 : 4)) - (p.type === 'ic' ? 2 : 1)); changed(); }, { cls: 'small' }),
            button('+', () => { snapshot(); p.pins = Math.min(p.type === 'ic' ? 40 : 20, (p.pins || (p.type === 'ic' ? 8 : 4)) + (p.type === 'ic' ? 2 : 1)); changed(); }, { cls: 'small' })) : null,
          h('div', { class: 'row', style: { marginTop: '8px' } },
            button('Rotate', rotateSel, { cls: 'small', icon: 'rotate' }),
            button('Delete', () => { snapshot(); design.parts = design.parts.filter((x) => x !== p); selected = null; changed(); }, { cls: 'small danger', icon: 'trash' }))].filter(Boolean));
      } else if (selected?.kind === 'wire') {
        selBox.append(h('div', { class: 'section-title', style: { marginTop: '0' } }, 'SELECTED · TRACE'),
          button('Delete trace', () => { snapshot(); design.wires.splice(selected.index, 1); selected = null; changed(); }, { cls: 'small danger', icon: 'trash' }));
      } else {
        const a = analyze(design);
        selBox.append(h('div', { class: 'section-title', style: { marginTop: '0' } }, 'BOARD CHECK'),
          h('div', { class: 'muted', style: { fontSize: '15px' } }, a.warnings.length ? a.warnings.map((w) => h('div', null, `⚠ ${w}`)) : design.parts.length ? '✓ No problems found' : 'Empty board — pick a part, or let Claude design one.'));
      }
    }

    // ---------------- pointer interaction
    const active = new Map(); // pointerId → {x, y}
    let drag = null;          // { kind: 'part'|'pan'|'pinch', ... }
    const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const [sx, sy] = local(e);
      active.set(e.pointerId, { x: sx, y: sy });
      if (active.size === 2) {
        const [a, b] = [...active.values()];
        drag = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        return;
      }
      const [gx, gy] = toGrid(sx, sy);
      const snap = [Math.round(gx), Math.round(gy)];
      if (mode === 'place' && placeType) {
        snapshot();
        const p = ghostPart(snap);
        design.parts.push(p);
        selected = { kind: 'part', ref: p.ref };
        sfx.success();
        setMode('select');
        changed();
        return;
      }
      if (mode === 'wire') {
        const pin = pinAt(gx, gy);
        const pt = pin ? [pin.x, pin.y] : snap;
        if (!wireDraft) { wireDraft = [pt]; sfx.tick(); }
        else {
          const last = wireDraft[wireDraft.length - 1];
          if (last[0] === pt[0] && last[1] === pt[1]) { finishWire(); return; }
          wireDraft.push(...route(last, pt).slice(1));
          sfx.tick();
          if (pin && wireDraft.length > 1) finishWire();
        }
        draw();
        return;
      }
      if (mode === 'delete') {
        const p = partAt(gx, gy);
        if (p) { snapshot(); design.parts = design.parts.filter((x) => x !== p); sfx.hit(); changed(); return; }
        const wi = wireAt(gx, gy);
        if (wi >= 0) { snapshot(); design.wires.splice(wi, 1); sfx.hit(); changed(); }
        return;
      }
      // select
      const p = partAt(gx, gy);
      if (p) {
        selected = { kind: 'part', ref: p.ref };
        drag = { kind: 'part', p, dx: p.x - gx, dy: p.y - gy, moved: false, start: JSON.stringify(design) };
        renderSel(); draw();
        return;
      }
      const wi = wireAt(gx, gy);
      if (wi >= 0) { selected = { kind: 'wire', index: wi }; renderSel(); draw(); return; }
      selected = null; renderSel();
      drag = { kind: 'pan', sx, sy, ox: view.ox, oy: view.oy };
      draw();
    });
    canvas.addEventListener('pointermove', (e) => {
      const [sx, sy] = local(e);
      if (active.has(e.pointerId)) active.set(e.pointerId, { x: sx, y: sy });
      const [gx, gy] = toGrid(sx, sy);
      const pin = mode === 'wire' ? pinAt(gx, gy) : null;
      const nh = pin ? [pin.x, pin.y] : [Math.round(gx), Math.round(gy)];
      const hoverChanged = !hover || nh[0] !== hover[0] || nh[1] !== hover[1];
      hover = nh;
      if (drag?.kind === 'pinch' && active.size >= 2) {
        const [a, b] = [...active.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        view.ox += mx - drag.mx; view.oy += my - drag.my;
        zoom(d / (drag.d || d), mx, my);
        drag.d = d; drag.mx = mx; drag.my = my;
        return;
      }
      if (drag?.kind === 'part') {
        const nx = Math.round(gx + drag.dx), ny = Math.round(gy + drag.dy);
        if (nx !== drag.p.x || ny !== drag.p.y) { drag.p.x = nx; drag.p.y = ny; drag.moved = true; draw(); }
        return;
      }
      if (drag?.kind === 'pan') { view.ox = drag.ox + sx - drag.sx; view.oy = drag.oy + sy - drag.sy; draw(); return; }
      if (hoverChanged && (mode === 'wire' || mode === 'place')) draw();
    });
    const end = (e) => {
      active.delete(e.pointerId);
      if (drag?.kind === 'part' && drag.moved) { history.push(drag.start); save(); renderSel(); }
      if (drag?.kind !== 'pinch' || active.size === 0) drag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { hover = null; if (mode === 'wire' || mode === 'place') draw(); });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); const [sx, sy] = local(e); zoom(e.deltaY < 0 ? 1.1 : 0.9, sx, sy); }, { passive: false });

    function finishWire() {
      if (wireDraft && wireDraft.length > 1) {
        snapshot();
        design.wires.push({ points: wireDraft });
        sfx.success();
      }
      wireDraft = null;
      changed();
    }

    // ---------------- Claude
    function applyBuild(input) {
      const parts = [];
      const refs = new Set();
      for (const raw of input.parts) {
        if (!LIB[raw.type]) continue;
        let ref = String(raw.ref || '').toUpperCase().replace(/\s+/g, '') || `${LIB[raw.type].prefix}${parts.length + 1}`;
        while (refs.has(ref)) ref += "'";
        refs.add(ref);
        parts.push({
          ref, type: raw.type, value: String(raw.value ?? LIB[raw.type].value),
          x: Math.max(2, Math.min(BOARD.w - 2, Math.round(raw.x))), y: Math.max(2, Math.min(BOARD.h - 2, Math.round(raw.y))),
          rot: [0, 90, 180, 270].includes(raw.rotation) ? raw.rotation : 0,
          pins: LIB[raw.type].params ? Math.round(raw.pins || (raw.type === 'ic' ? 8 : 4)) : undefined,
        });
      }
      const next = { name: String(input.name || 'Claude design').slice(0, 60), parts, wires: [] };
      const pinMap = new Map();
      for (const p of parts) for (const pin of pinsOf(p)) pinMap.set(`${p.ref}.${pin.name}`.toUpperCase(), pin);
      const missing = [];
      const prevDesign = design;
      design = next; // route() checks against the new parts
      for (const c of input.connections) {
        const a = pinMap.get(String(c.from).toUpperCase().replace(/\s+/g, '')), b = pinMap.get(String(c.to).toUpperCase().replace(/\s+/g, ''));
        if (!a || !b) { missing.push(`${c.from}→${c.to}`); continue; }
        next.wires.push({ points: route([a.x, a.y], [b.x, b.y]) });
      }
      history.push(JSON.stringify(prevDesign));
      selected = null;
      fit(); changed();
      const chk = analyze(design);
      return { placed_parts: parts.length, traces: next.wires.length, unresolved_connections: missing, board_check: chk.warnings };
    }

    async function ai(kind) {
      if (!hasKey()) { toast('Add your Claude API key in SYSTEM to use the Claude Engineer', 'warn'); return; }
      const q = prompt.value.trim();
      if ((kind === 'design' || kind === 'ask') && !q) { toast(kind === 'design' ? 'Describe the circuit you want first' : 'Type a question first', 'warn'); prompt.focus(); return; }
      if (ctrl) { ctrl.abort(); await pending?.catch(() => {}); }
      const board = JSON.stringify({ name: design.name, parts: design.parts.map(({ ref, type, value, x, y, rot, pins }) => ({ ref, type, value, x, y, rotation: rot || 0, ...(pins ? { pins } : {}) })) });
      const netlist = netlistText(design);
      let userText;
      if (kind === 'design') userText = `Design this circuit and build it on the board with build_circuit:\n\n${q}`;
      else if (kind === 'review') userText = `Review this board like an experienced electronics engineer: will it work, what values or parts are wrong or missing, and what's risky? ${q ? `Focus: ${q}\n\n` : ''}Board parts:\n${board}\n\nNetlist and automatic checks:\n${netlist}`;
      else userText = `Question about my board: ${q}\n\nBoard parts:\n${board}\n\nNetlist:\n${netlist}`;
      const messages = [{ role: 'user', content: userText }];
      ctrl = new AbortController();
      const mine = ctrl;
      stopBtn.style.display = '';
      let text = '';
      out.classList.remove('error');
      out.innerHTML = md(kind === 'design' ? '_Engineering the circuit…_' : '_Analysing the board…_') + '<span class="cursor-blink"></span>';
      let raf = 0;
      const paint = () => { raf = 0; out.innerHTML = md(text) + '<span class="cursor-blink"></span>'; outWrap.scrollTop = outWrap.scrollHeight; };
      try {
        pending = converse({
          system: SYSTEM, messages, maxTokens: 32000,
          effort: kind === 'design' ? 'high' : 'medium',
          tools: kind === 'design' ? [{ ...BUILD_TOOL, run: async (input) => applyBuild(input) }] : [],
          signal: mine.signal,
          onText: (d) => { text += d; if (!raf) raf = requestAnimationFrame(paint); },
          onToolUse: () => { text += text ? '\n\n' : ''; text += '_▸ Placing parts and routing traces…_\n\n'; if (!raf) raf = requestAnimationFrame(paint); },
        });
        const res = await pending;
        if (res.refused) text += '\n\n_Claude declined this request._';
        if (kind === 'design') prompt.value = '';
        sfx.success();
      } catch (e) {
        if (!isAbort(e)) { text = describeError(e); out.classList.add('error'); sfx.error(); }
        else text += '\n\n_(stopped)_';
      } finally {
        if (ctrl === mine) { ctrl = null; stopBtn.style.display = 'none'; }
        cancelAnimationFrame(raf);
        out.innerHTML = md(text || '_No response._');
      }
    }

    // ---------------- files
    function newBoard() {
      snapshot();
      design = { name: 'Untitled board', parts: [], wires: [] };
      selected = null; changed(); fit();
    }
    function saveAs() {
      const name = h('input', { class: 'hinput', value: design.name });
      modal({
        title: 'SAVE BOARD', body: h('div', { class: 'col' }, h('div', null, 'Name'), name),
        actions: [{ label: 'Cancel' }, {
          label: 'Save', cls: 'primary', onClick: () => {
            design.name = name.value.trim() || 'Untitled board';
            const all = loadJSON('circuit.designs', []).filter((d) => d.name !== design.name);
            all.unshift({ name: design.name, at: Date.now(), data: design });
            saveJSON('circuit.designs', all.slice(0, 50)) ? toast('Board saved', 'ok') : toast('Storage full — export instead', 'bad');
            changed();
          },
        }],
      });
    }
    function openDialog() {
      const all = loadJSON('circuit.designs', []);
      const m = modal({
        title: 'OPEN BOARD',
        body: all.length ? h('div', { class: 'col' }, all.map((d) => h('div', { class: 'row' },
          button(`${d.name} · ${d.data.parts.length} parts`, () => { snapshot(); design = JSON.parse(JSON.stringify(d.data)); selected = null; changed(); fit(); m.close(); }, { cls: 'grow' }),
          button('', () => { saveJSON('circuit.designs', all.filter((x) => x !== d)); m.close(); openDialog(); }, { cls: 'small icon danger', icon: 'trash' })))) : h('div', { class: 'muted' }, 'No saved boards yet.'),
        actions: [{ label: 'Close' }],
      });
    }
    function exportDialog() {
      const slug = (design.name || 'board').replace(/[^\w-]+/g, '-').toLowerCase();
      modal({
        title: 'EXPORT',
        body: h('div', { class: 'col' },
          button('Board image (PNG)', () => { fit(); setTimeout(() => canvas.toBlob((b) => b && download(`${slug}.png`, b)), 50); }, { icon: 'download' }),
          button('Netlist (text)', () => download(`${slug}-netlist.txt`, netlistText(design), 'text/plain'), { icon: 'download' }),
          button('Design file (JSON)', () => download(`${slug}.holomat.json`, JSON.stringify(design, null, 2), 'application/json'), { icon: 'download' })),
        actions: [{ label: 'Close' }],
      });
    }

    setMode('select');
    renderSel();
    return () => { ctrl?.abort(); unfit(); };
  },
};
