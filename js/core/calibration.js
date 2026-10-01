// Hand calibration: (1) palm/pinch scan sets your personal pinch thresholds,
// (2) touch / point at 5 targets → homography from camera space to the screen,
// (3) live test. Works for a front camera (hands in the air) or a rear/top
// camera looking down at the iPad on a table (classic holomat rig).
import { hand } from './hand.js';
import { settings } from './store.js';
import { solveHomography, reprojectionError } from './homography.js';
import { h, s, button, toast } from './ui.js';
import { sfx } from './audio.js';

const TARGETS = [[0.1, 0.14], [0.9, 0.14], [0.9, 0.86], [0.1, 0.86], [0.5, 0.5]];
let active = null;

export function isCalibrating() { return !!active; }

export function runCalibration() {
  if (active) return active.promise;
  let resolveDone;
  const promise = new Promise((r) => (resolveDone = r));
  const layer = document.getElementById('overlay-layer');

  const title = h('h2', null, 'HAND CALIBRATION');
  const text = h('p', null, 'Starting camera…');
  const steps = h('div', { class: 'calib-steps' }, '');
  const cam = h('canvas', { width: 480, height: 360 });
  const camBox = h('div', { class: 'calib-cam' }, cam);
  const fill = h('div', { class: 'cm-fill', style: { width: '0%' } });
  const meterLabel = h('div', { class: 'cm-label' }, '');
  const meter = h('div', { class: 'calib-meter' }, h('div', { class: 'cm-bar' }, fill), meterLabel);
  const targetEl = h('div', { class: 'calib-target', style: { display: 'none' } });
  const ringC = 2 * Math.PI * 46;
  const ring = s('circle', { cx: 60, cy: 60, r: 46, fill: 'none', 'stroke-width': 5, style: 'stroke: var(--c-hi)', 'stroke-dasharray': `0 ${ringC}`, transform: 'rotate(-90 60 60)' });
  targetEl.append(s('svg', { viewBox: '0 0 120 120' },
    s('circle', { cx: 60, cy: 60, r: 46, class: 's-faint' }),
    s('circle', { cx: 60, cy: 60, r: 30, class: 's-line pulse-op' }),
    s('circle', { cx: 60, cy: 60, r: 5, class: 's-fill' }),
    s('path', { d: 'M60 0v22M60 98v22M0 60h22M98 60h22', class: 's-line' }),
    ring));
  const actions = h('div', { class: 'calib-actions' });
  const testArea = h('div', { style: { position: 'absolute', inset: '0', display: 'none' } });
  const root = h('div', { class: 'calib' }, camBox, targetEl, testArea,
    h('div', { class: 'calib-text' }, title, text, steps), meter, actions);
  layer.append(root);

  const st = {
    step: 'start', buf: [], open: null, closed: null, idx: 0, raw: [], stableSince: 0,
    pinchOn: settings.get('pinchOn'), pinchOff: settings.get('pinchOff'),
  };
  let off = null;
  hand.suspendPointers = true;

  const setActions = (list) => { actions.replaceChildren(...list.map(([l, fn, cls]) => button(l, fn, { cls: cls || '' }))); };
  const finish = (ok) => {
    off && off();
    hand.suspendPointers = false;
    root.remove();
    active = null;
    resolveDone(ok);
  };
  const progress = (p, label) => { fill.style.width = `${Math.round(Math.min(1, p) * 100)}%`; if (label !== undefined) meterLabel.textContent = label; };

  function go(step) {
    st.step = step; st.buf = []; st.stableSince = 0;
    progress(0, '');
    targetEl.style.display = 'none';
    testArea.style.display = 'none';
    camBox.style.display = '';
    camBox.style.width = '';
    if (step === 'open') {
      steps.textContent = 'STEP 1 / 4 · PALM SCAN';
      text.textContent = 'Hold one hand up to the camera, fingers spread wide, and keep it still.';
      setActions([['Cancel', () => finish(false)]]);
    } else if (step === 'pinch') {
      steps.textContent = 'STEP 2 / 4 · PINCH SCAN';
      text.textContent = 'Now pinch: touch your thumb tip to your index fingertip and hold.';
      setActions([['Skip', () => go('targets')], ['Cancel', () => finish(false)]]);
    } else if (step === 'targets') {
      st.idx = 0; st.raw = [];
      steps.textContent = 'STEP 3 / 4 · SPATIAL MAPPING';
      camBox.style.width = 'min(30vw, 300px)';
      showTarget();
      setActions([['Restart', () => go('targets')], ['Cancel', () => finish(false)]]);
    } else if (step === 'test') {
      steps.textContent = 'STEP 4 / 4 · VERIFY';
      text.textContent = 'Try it: move your fingertip over a target and pinch (or hold still) to hit it.';
      camBox.style.display = 'none';
      meter.style.display = 'none';
      hand.suspendPointers = false;
      buildTest();
      setActions([['Redo', () => { meter.style.display = ''; hand.suspendPointers = true; go('targets'); }], ['Done', () => { sfx.success(); toast('Calibration saved', 'ok'); finish(true); }, 'primary']]);
    }
  }

  function showTarget() {
    const [u, v] = TARGETS[st.idx];
    targetEl.style.display = '';
    targetEl.style.left = `${u * innerWidth}px`;
    targetEl.style.top = `${v * innerHeight}px`;
    ring.setAttribute('stroke-dasharray', `0 ${ringC}`);
    text.textContent = `Touch or point at target ${st.idx + 1} of ${TARGETS.length} with your index fingertip, then hold still.`;
    // keep the camera preview away from the active target
    camBox.style.top = v < 0.3 ? '70%' : v > 0.7 ? '32%' : '24%';
  }

  function buildTest() {
    testArea.replaceChildren();
    testArea.style.display = '';
    let hits = 0;
    const spots = [[0.2, 0.32], [0.8, 0.32], [0.5, 0.62], [0.22, 0.78], [0.78, 0.78]];
    spots.forEach(([u, v], i) => {
      const b = button(`TARGET ${i + 1}`, () => { b.classList.add('on'); b.querySelector('span').textContent = 'HIT ✓'; hits++; if (hits >= spots.length) toast('All targets hit — calibration looks good', 'ok'); }, { cls: 'big' });
      Object.assign(b.style, { position: 'absolute', left: `${u * 100}%`, top: `${v * 100}%`, transform: 'translate(-50%, -50%)' });
      testArea.append(b);
    });
  }

  const median = (arr) => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };

  function onFrame(frame) {
    hand.drawPreview(cam);
    const hd = frame.hands.slice().sort((a, b) => a.slot - b.slot)[0];
    const now = frame.ts;
    if (st.step === 'open' || st.step === 'pinch') {
      if (!hd) { st.buf = []; progress(0, 'NO HAND DETECTED'); return; }
      st.buf.push({ t: now, r: hd.pinchRatio });
      while (st.buf.length && now - st.buf[0].t > 1300) st.buf.shift();
      const rs = st.buf.map((b) => b.r);
      const m = median(rs);
      const want = st.step === 'open' ? m > 0.5 : (st.open ? m < st.open * 0.5 : m < 0.3);
      if (!want) { st.stableSince = 0; progress(0, st.step === 'open' ? `SPREAD FINGERS · ratio ${m.toFixed(2)}` : `PINCH TIGHTER · ratio ${m.toFixed(2)}`); return; }
      st.stableSince ||= now;
      const p = (now - st.stableSince) / 1100;
      progress(p, `SCANNING · ratio ${m.toFixed(2)}`);
      if (p >= 1) {
        sfx.success();
        if (st.step === 'open') { st.open = m; go('pinch'); }
        else {
          st.closed = m;
          const span = st.open - st.closed;
          st.pinchOn = +(st.closed + span * 0.38).toFixed(3);
          st.pinchOff = +(st.closed + span * 0.58).toFixed(3);
          settings.set({ pinchOn: st.pinchOn, pinchOff: st.pinchOff });
          go('targets');
        }
      }
    } else if (st.step === 'targets') {
      if (!hd) { st.buf = []; st.stableSince = 0; ring.setAttribute('stroke-dasharray', `0 ${ringC}`); progress(0, 'NO HAND DETECTED'); return; }
      st.buf.push({ t: now, x: hd.rawX, y: hd.rawY });
      while (st.buf.length && now - st.buf[0].t > 600) st.buf.shift();
      const mx = st.buf.reduce((a, b) => a + b.x, 0) / st.buf.length;
      const my = st.buf.reduce((a, b) => a + b.y, 0) / st.buf.length;
      const spread = Math.max(...st.buf.map((b) => Math.hypot(b.x - mx, b.y - my)));
      const prev = st.raw[st.raw.length - 1];
      const farEnough = !prev || Math.hypot(prev[0] - mx, prev[1] - my) > 0.06;
      if (spread > 0.014 || !farEnough || st.buf.length < 4) {
        st.stableSince = 0;
        ring.setAttribute('stroke-dasharray', `0 ${ringC}`);
        progress(0, !farEnough ? 'MOVE TO THE NEW TARGET' : 'HOLD STILL');
        return;
      }
      st.stableSince ||= now;
      const p = Math.min(1, (now - st.stableSince) / 900);
      ring.setAttribute('stroke-dasharray', `${p * ringC} ${ringC}`);
      progress(p, `LOCKING TARGET ${st.idx + 1}`);
      if (p >= 1) {
        sfx.score();
        st.raw.push([mx, my]);
        st.idx++;
        st.buf = []; st.stableSince = 0;
        if (st.idx < TARGETS.length) showTarget();
        else solve();
      }
    }
  }

  function solve() {
    try {
      const H = solveHomography(st.raw, TARGETS);
      const err = reprojectionError(H, st.raw, TARGETS);
      if (!(err < 0.08)) throw new Error(`points inconsistent (error ${(err * 100).toFixed(1)}%)`);
      settings.set({ calibration: { H, orientation: hand.orientation(), facingMode: settings.get('facingMode'), at: Date.now(), error: err } });
      go('test');
    } catch (e) {
      sfx.error();
      toast(`Calibration failed: ${e.message}. Let's try again.`, 'bad', 4500);
      go('targets');
    }
  }

  (async () => {
    setActions([['Cancel', () => finish(false)]]);
    try {
      if (!hand.running) await hand.start();
    } catch (e) {
      text.textContent = `Camera unavailable: ${e.message}`;
      sfx.error();
      return;
    }
    off = hand.onFrame(onFrame);
    go('open');
  })();

  active = { promise };
  return promise;
}
