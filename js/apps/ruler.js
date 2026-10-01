// PRECISION RULER — detects the iPad model (→ true pixels per millimetre),
// draws real-scale rulers and lets you measure lines, angles and areas on the
// glass with a finger or a pinch-drag. Credit-card calibration for other devices.
import { h, button, segmented, slider, modal, toast, fitCanvas } from '../core/ui.js';
import { settings } from '../core/store.js';
import { detectDevice, allModels } from '../core/device.js';
import { themeColors } from './game-kit.js';
import { sfx } from '../core/audio.js';

const CARD_W = 85.6, CARD_H = 53.98; // ISO/IEC 7810 ID-1 (credit card) in mm

export default {
  mount({ body, panel }) {
    let dev = detectDevice();
    let mode = 'line';
    let units = 'metric';
    const shapes = [];
    let draft = null;
    const C = themeColors();

    const info = h('div', { class: 'mono', style: { fontSize: '13px', color: 'var(--c)', lineHeight: '1.5' } });
    const toolbar = h('div', { class: 'toolbar' },
      segmented([{ value: 'line', label: 'Line' }, { value: 'angle', label: 'Angle' }, { value: 'area', label: 'Area' }], mode, (v) => { mode = v; draft = null; draw(); }),
      h('div', { class: 'sep' }),
      segmented([{ value: 'metric', label: 'cm / mm' }, { value: 'imperial', label: 'inches' }], units, (v) => { units = v; draw(); }),
      h('div', { class: 'sep' }),
      button('Undo', () => { shapes.pop(); draw(); }, { cls: 'small' }),
      button('Clear', () => { shapes.length = 0; draft = null; draw(); }, { cls: 'small', icon: 'trash' }),
      h('div', { class: 'sep' }),
      button('Scale', () => calibrate(), { cls: 'small', icon: 'card' }),
      dev.candidates.length > 1 ? button('Model', () => chooseModel(), { cls: 'small' }) : null);
    const canvas = h('canvas', { style: { position: 'absolute', inset: '0', width: '100%', height: '100%', touchAction: 'none' } });
    const stageEl = h('div', { class: 'game-stage' }, canvas,
      h('div', { style: { position: 'absolute', right: '16px', bottom: '14px', padding: '10px 14px', background: 'var(--panel)', border: '1px solid var(--c-a35)', pointerEvents: 'none', maxWidth: '60%' } }, info));
    body.append(toolbar, stageEl);
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0;

    const renderInfo = () => {
      dev = detectDevice();
      const src = { manual: 'CARD-CALIBRATED', model: 'DETECTED MODEL', default: 'ESTIMATE — CALIBRATE WITH A CARD' }[dev.source];
      info.replaceChildren(
        h('div', { style: { color: 'var(--c-hi)', fontSize: '14px' } }, dev.name.toUpperCase()),
        h('div', null, `${dev.ppi} PPI · ${dev.px[0]}×${dev.px[1]} px · ${dev.pxPerMm.toFixed(3)} pt/mm`),
        h('div', null, `SCREEN ${dev.widthMm.toFixed(1)} × ${dev.heightMm.toFixed(1)} mm · ${dev.diagIn.toFixed(1)}″ DIAGONAL`),
        h('div', { style: { color: dev.source === 'default' ? 'var(--warn)' : 'var(--ok)' } }, `SCALE: ${src}${dev.ambiguous ? ' · TAP MODEL TO CONFIRM' : ''}`));
      panel.setSub(`${dev.name} · ${dev.ppi} ppi`);
    };
    renderInfo();
    if (dev.source === 'default') toast('Unknown screen — tap SCALE and match a credit card for exact measurements', 'warn', 5500);

    const mm = () => dev.pxPerMm;
    const fmtLen = (px) => {
      const vmm = px / mm();
      if (units === 'imperial') return `${(vmm / 25.4).toFixed(2)} in`;
      return vmm >= 100 ? `${(vmm / 10).toFixed(1)} cm` : `${vmm.toFixed(1)} mm`;
    };
    const fmtArea = (a) => {
      const v = a / (mm() * mm());
      return units === 'imperial' ? `${(v / 645.16).toFixed(2)} in²` : v >= 10000 ? `${(v / 100).toFixed(1)} cm²` : `${v.toFixed(0)} mm²`;
    };

    const drawRulers = () => {
      const k = mm();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, W, 46); ctx.fillRect(0, 0, 46, H);
      ctx.strokeStyle = C.c; ctx.fillStyle = C.hi; ctx.lineWidth = 1;
      ctx.font = '11px "Share Tech Mono", monospace';
      if (units === 'metric') {
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.beginPath();
        for (let i = 0; i * k <= W; i++) {
          const x = Math.round(i * k) + 0.5;
          const len = i % 10 === 0 ? 26 : i % 5 === 0 ? 17 : 10;
          ctx.moveTo(x, 0); ctx.lineTo(x, len);
          if (i % 10 === 0 && i) ctx.fillText(String(i / 10), x, 29);
        }
        for (let i = 0; i * k <= H; i++) {
          const y = Math.round(i * k) + 0.5;
          const len = i % 10 === 0 ? 26 : i % 5 === 0 ? 17 : 10;
          ctx.moveTo(0, y); ctx.lineTo(len, y);
        }
        ctx.stroke();
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        for (let i = 10; i * k <= H; i += 10) ctx.fillText(String(i / 10), 29, i * k);
        ctx.fillStyle = C.c; ctx.fillText('cm', 52, 22);
      } else {
        const ki = k * 25.4 / 16; // sixteenths of an inch
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.beginPath();
        for (let i = 0; i * ki <= W; i++) {
          const x = Math.round(i * ki) + 0.5;
          const len = i % 16 === 0 ? 26 : i % 8 === 0 ? 19 : i % 4 === 0 ? 14 : i % 2 === 0 ? 10 : 6;
          ctx.moveTo(x, 0); ctx.lineTo(x, len);
          if (i % 16 === 0 && i) ctx.fillText(String(i / 16), x, 29);
        }
        for (let i = 0; i * ki <= H; i++) {
          const y = Math.round(i * ki) + 0.5;
          const len = i % 16 === 0 ? 26 : i % 8 === 0 ? 19 : i % 4 === 0 ? 14 : i % 2 === 0 ? 10 : 6;
          ctx.moveTo(0, y); ctx.lineTo(len, y);
        }
        ctx.stroke();
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        for (let i = 16; i * ki <= H; i += 16) ctx.fillText(String(i / 16), 29, i * ki);
        ctx.fillStyle = C.c; ctx.fillText('in', 52, 22);
      }
    };

    const label = (text, x, y) => {
      ctx.font = '700 15px Orbitron, sans-serif';
      const tw = ctx.measureText(text).width + 16;
      ctx.fillStyle = 'rgba(0,10,16,0.85)'; ctx.fillRect(x - tw / 2, y - 14, tw, 28);
      ctx.strokeStyle = C.c; ctx.lineWidth = 1; ctx.strokeRect(x - tw / 2 + 0.5, y - 13.5, tw - 1, 27);
      ctx.fillStyle = C.hi; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y + 1);
    };
    const dot = (x, y) => { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); ctx.strokeStyle = C.c; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.stroke(); };

    const drawShape = (sh) => {
      ctx.shadowColor = C.c; ctx.shadowBlur = 10;
      ctx.strokeStyle = C.hi; ctx.lineWidth = 2;
      if (sh.type === 'line') {
        const [a, b] = sh.pts;
        if (!b) { dot(a[0], a[1]); return; }
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        // end caps perpendicular
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), px = Math.cos(ang + Math.PI / 2) * 12, py = Math.sin(ang + Math.PI / 2) * 12;
        ctx.beginPath(); for (const p of [a, b]) { ctx.moveTo(p[0] - px, p[1] - py); ctx.lineTo(p[0] + px, p[1] + py); } ctx.stroke();
        ctx.shadowBlur = 0;
        let deg = (-ang * 180) / Math.PI; if (deg < 0) deg += 360;
        label(`${fmtLen(Math.hypot(b[0] - a[0], b[1] - a[1]))} · ${deg.toFixed(1)}°`, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 22);
      } else if (sh.type === 'area') {
        const [a, b] = sh.pts;
        if (!b) { dot(a[0], a[1]); return; }
        const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), hh = Math.abs(b[1] - a[1]);
        ctx.fillStyle = C.c; ctx.globalAlpha = 0.1; ctx.fillRect(x, y, w, hh); ctx.globalAlpha = 1;
        ctx.strokeRect(x, y, w, hh);
        ctx.shadowBlur = 0;
        label(`${fmtLen(w)} × ${fmtLen(hh)}`, x + w / 2, y - 20);
        label(fmtArea(w * hh), x + w / 2, y + hh / 2);
      } else if (sh.type === 'angle') {
        const [v, p1, p2] = sh.pts;
        ctx.beginPath(); ctx.moveTo(p1 ? p1[0] : v[0], p1 ? p1[1] : v[1]); ctx.lineTo(v[0], v[1]); if (p2) ctx.lineTo(p2[0], p2[1]); ctx.stroke();
        ctx.shadowBlur = 0;
        dot(v[0], v[1]);
        if (p1 && p2) {
          const a1 = Math.atan2(p1[1] - v[1], p1[0] - v[0]), a2 = Math.atan2(p2[1] - v[1], p2[0] - v[0]);
          let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
          ctx.strokeStyle = C.c; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(v[0], v[1], 46, a1, a1 + d, d < 0); ctx.stroke();
          const mid = a1 + d / 2;
          label(`${Math.abs((d * 180) / Math.PI).toFixed(1)}°`, v[0] + Math.cos(mid) * 84, v[1] + Math.sin(mid) * 84);
        }
      }
      ctx.shadowBlur = 0;
    };

    const draw = () => {
      if (!W) return;
      ctx.clearRect(0, 0, W, H);
      // faint 1 cm grid
      const k = mm() * (units === 'metric' ? 10 : 25.4);
      ctx.strokeStyle = C.c; ctx.globalAlpha = 0.07; ctx.beginPath();
      for (let x = k; x < W; x += k) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = k; y < H; y += k) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke(); ctx.globalAlpha = 1;
      drawRulers();
      shapes.forEach(drawShape);
      if (draft) drawShape(draft);
      if (!shapes.length && !draft) {
        ctx.fillStyle = C.dim; ctx.font = '600 18px Rajdhani, sans-serif'; ctx.textAlign = 'center';
        const hint = mode === 'angle' ? 'Tap the corner, then one point on each arm' : mode === 'area' ? 'Drag a box over the object' : 'Drag (or pinch-drag) from one edge to the other';
        ctx.fillText(hint, W / 2, H / 2);
      }
    };

    const unfit = fitCanvas(canvas, (w, hh, dpr) => { W = w; H = hh; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); }, 3);

    const at = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    let activeId = null;
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const p = at(e);
      if (mode === 'angle') {
        if (!draft) draft = { type: 'angle', pts: [p] };
        else draft.pts.push(p);
        sfx.tick();
        if (draft.pts.length === 3) { shapes.push(draft); draft = null; sfx.score(); }
        draw();
        return;
      }
      activeId = e.pointerId;
      draft = { type: mode, pts: [p, p] };
      sfx.tick();
      draw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (mode === 'angle' && draft) { const p = at(e); const pts = draft.pts.slice(0, draft.pts.length); draw(); drawShape({ type: 'angle', pts: [...pts, p].slice(0, 3) }); return; }
      if (activeId !== e.pointerId || !draft) return;
      draft.pts[1] = at(e);
      draw();
    });
    const end = (e) => {
      if (activeId !== e.pointerId || !draft) return;
      activeId = null;
      const [a, b] = draft.pts;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 8) { shapes.push(draft); sfx.score(); }
      draft = null;
      draw();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    function calibrate() {
      let k = mm();
      const card = h('div', { style: { border: '2px solid var(--c-hi)', borderRadius: '10px', boxShadow: '0 0 18px var(--c-a60)', margin: '16px auto', position: 'relative', background: 'var(--c-a10)' } },
        h('div', { class: 'mono', style: { position: 'absolute', left: '10px', top: '8px', fontSize: '12px', color: 'var(--c)' } }, 'PLACE A CREDIT / ID CARD HERE'));
      const size = () => { card.style.width = `${CARD_W * k}px`; card.style.height = `${CARD_H * k}px`; };
      size();
      const val = h('b', null, '');
      const upd = () => { val.textContent = `${k.toFixed(3)} pt/mm`; };
      upd();
      const dlg = modal({
        title: 'SCALE CALIBRATION',
        body: h('div', null,
          h('div', null, 'Lay any bank card or ID card on the screen and resize the outline until it matches the card exactly.'),
          card,
          h('div', { class: 'field-label' }, h('span', null, 'Size'), val),
          slider({ min: k * 0.7, max: k * 1.3, step: 0.001, value: k, onInput: (v) => { k = v; size(); upd(); } })),
        actions: [
          { label: 'Use detected', onClick: () => { settings.set('pxPerMm', null); renderInfo(); draw(); toast('Using detected scale'); } },
          { label: 'Save', cls: 'primary', onClick: () => { settings.set('pxPerMm', +k.toFixed(4)); renderInfo(); draw(); toast('Scale calibrated', 'ok'); } },
        ],
      });
      dlg.el.style.width = 'min(820px, 100%)';
    }

    function chooseModel() {
      const list = dev.candidates.length ? dev.candidates : allModels();
      const m = modal({
        title: 'WHICH iPAD IS THIS?',
        body: h('div', { class: 'col' }, h('div', { class: 'muted' }, 'These models share the same screen resolution but have different pixel density.'),
          ...list.map((x) => button(`${x.name} · ${x.ppi} ppi`, () => { settings.set('ipadModel', x.id); renderInfo(); draw(); m.close(); }))),
        actions: [{ label: 'Close' }],
      });
    }
    if (dev.ambiguous) setTimeout(chooseModel, 400);

    return () => unfit();
  },
};
