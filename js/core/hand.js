// Hand tracking engine.
//  • Camera → MediaPipe HandLandmarker (on-device, iPad CPU, in a Worker when
//    the browser allows, otherwise on the main thread).
//  • Maps the index fingertip to the screen (via calibration homography).
//  • Pinch (thumb + index) = touch down / up, dwell = click.
//  • Synthesises PointerEvents + clicks so every button, slider and game canvas
//    in the app works with hands exactly like with a finger on the glass.
import { settings } from './store.js';
import { OneEuro } from './filters.js';
import { applyH } from './homography.js';
import { sfx } from './audio.js';
import { s } from './ui.js';

const WASM_LOCAL = new URL('../../vendor/mediapipe/wasm', import.meta.url).href;
const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL = new URL('../../models/hand_landmarker.task', import.meta.url).href;
const BUNDLE_URL = new URL('../../vendor/mediapipe/vision_bundle.js', import.meta.url).href;
const WORKER_URL = new URL('./hand-worker.js', import.meta.url).href;

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
export const CURSOR_LANDMARK = 8; // index fingertip

const CLICKABLE = 'button, .hbtn, .hcard, .toggle, .app-node, .hud-btn, .reactor-hit, [data-click]';
const NO_SCROLL_DRAG = 'canvas, .hslider, [data-drag]';

// ------------------------------------------------------------------ detectors
class WorkerDetector {
  async init(cfg) {
    if (typeof createImageBitmap !== 'function' || typeof Worker !== 'function') throw new Error('no worker support');
    this.worker = new Worker(WORKER_URL);
    this.pending = new Map();
    this.seq = 0;
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('worker init timeout')), 45000);
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') { clearTimeout(t); resolve(); }
        else if (m.type === 'error') { clearTimeout(t); reject(new Error(m.message)); }
        else if (m.type === 'result') {
          const p = this.pending.get(m.id);
          if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m); }
        }
      };
      this.worker.onerror = (e) => { clearTimeout(t); reject(new Error(e.message || 'worker error')); };
      this.worker.postMessage({ type: 'init', ...cfg });
    });
    this.kind = 'worker';
  }
  async detect(video, ts) {
    const bitmap = await createImageBitmap(video);
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'frame', id, ts, bitmap }, [bitmap]);
    });
  }
  setOptions(options) { this.worker?.postMessage({ type: 'options', options }); }
  close() { this.worker?.terminate(); this.worker = null; this.pending?.clear(); }
}

let bundlePromise = null;
function loadVisionBundle() {
  if (window.Vision) return Promise.resolve(window.Vision);
  bundlePromise ||= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = BUNDLE_URL;
    el.onload = () => resolve(window.Vision);
    el.onerror = () => reject(new Error('could not load MediaPipe bundle'));
    document.head.append(el);
  });
  return bundlePromise;
}

class InlineDetector {
  async init(cfg) {
    const { FilesetResolver, HandLandmarker } = await loadVisionBundle();
    const simd = await FilesetResolver.isSimdSupported();
    const base = simd ? cfg.wasmLocal : cfg.wasmCdn;
    const sfxn = simd ? '' : '_nosimd';
    const fileset = { wasmLoaderPath: `${base}/vision_wasm${sfxn}_internal.js`, wasmBinaryPath: `${base}/vision_wasm${sfxn}_internal.wasm` };
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: cfg.model, delegate },
      runningMode: 'VIDEO', numHands: cfg.numHands,
      minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { this.lm = await HandLandmarker.createFromOptions(fileset, opts(cfg.delegate)); }
    catch (e) { if (cfg.delegate === 'CPU') throw e; this.lm = await HandLandmarker.createFromOptions(fileset, opts('CPU')); }
    this.kind = 'main';
  }
  async detect(video, ts) {
    const t0 = performance.now();
    const r = this.lm.detectForVideo(video, ts);
    const ms = performance.now() - t0;
    return {
      ms,
      result: {
        landmarks: r.landmarks || [],
        handedness: (r.handedness || r.handednesses || []).map((c) => (c && c[0] ? { name: c[0].categoryName, score: c[0].score } : { name: '', score: 0 })),
      },
    };
  }
  setOptions(options) { this.lm?.setOptions(options); }
  close() { try { this.lm?.close(); } catch {} this.lm = null; }
}

// ------------------------------------------------------------------ engine
class HandEngine extends EventTarget {
  constructor() {
    super();
    this.status = 'off';
    this.statusText = 'Hand tracking offline';
    this.running = false;
    this.tracks = [];
    this.fps = 0;
    this.inferMs = 0;
    this.backend = '';
    this.suspendPointers = false;
    this.listeners = new Set();
    this._lastResultAt = 0;
    this._lastVT = -1;
    this._busy = false;
    this._tick = this._tick.bind(this);
    this.cursorEls = [];
    settings.subscribe((patch) => this._onSettings(patch));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.running && this.video) this.video.play().catch(() => {});
    });
  }

  /** Subscribe to every processed frame: fn({ hands, fps, ms }) */
  onFrame(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  _setStatus(status, text) {
    this.status = status; this.statusText = text;
    this.dispatchEvent(new CustomEvent('status', { detail: { status, text } }));
  }

  async start() {
    if (this.running || this.status === 'starting') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this._setStatus('error', 'Camera API unavailable (needs HTTPS)');
      throw new Error('Camera API unavailable — open the Holomat over HTTPS');
    }
    this._setStatus('starting', 'Requesting camera…');
    try {
      await this._startCamera();
      if (!this.detector) {
        this._setStatus('starting', 'Loading hand model (on-device)…');
        await this._initDetector();
      }
      this._ensureOverlay();
      this.running = true;
      this._setStatus('running', `Tracking on iPad ${this.backend}`);
      requestAnimationFrame(this._tick);
    } catch (err) {
      this._stopCamera();
      this._setStatus('error', err.message || String(err));
      throw err;
    }
  }

  stop() {
    this.running = false;
    this._stopCamera();
    for (const t of this.tracks) this._releaseTrack(t);
    this.tracks = [];
    this._renderOverlay(true);
    this._setStatus('off', 'Hand tracking offline');
  }

  async _startCamera() {
    this._stopCamera();
    const facingMode = settings.get('facingMode');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
    });
    this.stream = stream;
    if (!this.video) {
      const v = document.createElement('video');
      v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.muted = true; v.autoplay = true;
      Object.assign(v.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none', zIndex: '-1' });
      document.body.append(v);
      this.video = v;
    }
    this.video.srcObject = stream;
    await this.video.play();
    await new Promise((r) => (this.video.readyState >= 2 ? r() : this.video.addEventListener('loadeddata', r, { once: true })));
  }

  _stopCamera() {
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.video) this.video.srcObject = null;
  }

  async _initDetector() {
    const cfg = {
      wasmLocal: WASM_LOCAL, wasmCdn: WASM_CDN, model: MODEL_URL,
      numHands: settings.get('maxHands'), delegate: settings.get('delegate'),
    };
    let det = new WorkerDetector();
    try {
      await det.init(cfg);
      // verify the worker can actually process a frame (createImageBitmap from video)
      await det.detect(this.video, performance.now());
    } catch (err) {
      console.info('[hand] worker path unavailable, using main thread:', err.message);
      det.close();
      det = new InlineDetector();
      await det.init(cfg);
    }
    this.detector = det;
    this.backend = `${settings.get('delegate')}${det.kind === 'worker' ? ' · worker' : ''}`;
  }

  async _restartDetector() {
    const was = this.running;
    this.running = false;
    this.detector?.close();
    this.detector = null;
    if (was) { this.running = false; this.status = 'off'; await this.start().catch(() => {}); }
  }

  _onSettings(patch) {
    if ('maxHands' in patch && this.detector) this.detector.setOptions({ numHands: patch.maxHands });
    if ('delegate' in patch) this._restartDetector();
    if ('facingMode' in patch && this.running) { this.running = false; this.status = 'off'; this.start().catch(() => {}); }
    if ('smoothing' in patch) for (const t of this.tracks) this._configureFilters(t);
    if ('showSkeleton' in patch && !patch.showSkeleton) this._renderOverlay(true);
  }

  async _tick() {
    if (!this.running) return;
    requestAnimationFrame(this._tick);
    if (this._busy || document.hidden) return;
    const v = this.video;
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    if (v.currentTime === this._lastVT) return;
    this._lastVT = v.currentTime;
    this._busy = true;
    const ts = performance.now();
    try {
      const { result, ms } = await this.detector.detect(v, ts);
      if (this.running && result) this._process(result, ts, ms);
    } catch (err) {
      console.warn('[hand] detect failed', err);
    } finally {
      this._busy = false;
    }
  }

  // ---------------------------------------------------------------- mapping
  orientation() { return innerWidth >= innerHeight ? 'landscape' : 'portrait'; }

  activeCalibration() {
    const c = settings.get('calibration');
    if (!c || !c.H) return null;
    if (c.orientation !== this.orientation()) return null;
    if (c.facingMode && c.facingMode !== settings.get('facingMode')) return null;
    return c;
  }

  /** raw normalised video coords → screen px */
  mapRaw(x, y) {
    const W = innerWidth, H = innerHeight;
    const cal = this.activeCalibration();
    if (cal) { const [u, v] = applyH(cal.H, x, y); return [u * W, v * H]; }
    const mx = settings.get('mirror') ? 1 - x : x;
    const m = 0.14;
    return [((mx - m) / (1 - 2 * m)) * W, ((y - m) / (1 - 2 * m)) * H];
  }

  // ---------------------------------------------------------------- per-frame
  _process(result, ts, ms) {
    const dt = ts - (this._lastResultAt || ts);
    this._lastResultAt = ts;
    if (dt > 0) this.fps = this.fps ? this.fps * 0.85 + (1000 / dt) * 0.15 : 1000 / dt;
    this.inferMs = this.inferMs ? this.inferMs * 0.85 + ms * 0.15 : ms;

    const vw = this.video.videoWidth || 640, vh = this.video.videoHeight || 480;
    const dets = result.landmarks.map((lm, i) => {
      const tip = lm[CURSOR_LANDMARK];
      const [sx, sy] = this.mapRaw(tip.x, tip.y);
      const P = (p) => [p.x * vw, p.y * vh, p.z * vw];
      const d = (a, b) => { const A = P(a), B = P(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
      const palm = Math.max(1, d(lm[0], lm[9]));
      return {
        lm, sx, sy, rawX: tip.x, rawY: tip.y,
        pinchRatio: d(lm[4], lm[8]) / palm,
        palmPx: palm,
        handedness: result.handedness[i]?.name || '',
        score: result.handedness[i]?.score || 0,
      };
    });

    // --- associate detections with existing tracks (nearest neighbour)
    const diag = Math.hypot(innerWidth, innerHeight);
    const unmatched = new Set(dets.map((_, i) => i));
    const pairs = [];
    for (const t of this.tracks) for (const i of unmatched) pairs.push([Math.hypot(t.sx - dets[i].sx, t.sy - dets[i].sy), t, i]);
    pairs.sort((a, b) => a[0] - b[0]);
    const used = new Set();
    for (const [dist, t, i] of pairs) {
      if (used.has(t) || !unmatched.has(i) || dist > diag * 0.45) continue;
      used.add(t); unmatched.delete(i);
      this._updateTrack(t, dets[i], ts);
    }
    for (const i of unmatched) {
      const slot = [0, 1, 2, 3].find((n) => !this.tracks.some((t) => t.slot === n));
      const t = this._newTrack(slot);
      this.tracks.push(t);
      this._updateTrack(t, dets[i], ts);
      used.add(t);
    }
    for (const t of [...this.tracks]) {
      if (!used.has(t)) {
        t.missing = (t.missing || 0) + 1;
        if (t.missing > 4) { this._releaseTrack(t); this.tracks.splice(this.tracks.indexOf(t), 1); }
      } else t.missing = 0;
    }

    // --- pointer synthesis
    if (!this.suspendPointers) for (const t of this.tracks) if (!t.missing) this._pointer(t, ts);

    this._renderOverlay();
    const frame = {
      hands: this.tracks.filter((t) => !t.missing).map((t) => ({
        id: t.id, slot: t.slot, pointerId: t.pointerId, x: t.x, y: t.y, rawX: t.rawX, rawY: t.rawY,
        pinch: t.pinched, pinchRatio: t.pinchRatio, handedness: t.handedness, score: t.score,
        landmarks: t.lm, screenLandmarks: t.screenLm,
      })),
      fps: this.fps, ms: this.inferMs, ts, videoWidth: vw, videoHeight: vh,
    };
    this.lastFrame = frame;
    for (const fn of this.listeners) { try { fn(frame); } catch (e) { console.error(e); } }
  }

  _newTrack(slot) {
    const t = {
      id: Math.random().toString(36).slice(2, 8), slot, pointerId: 100 + slot,
      pinched: false, onCount: 0, offCount: 0, history: [], lockDX: 0, lockDY: 0,
      down: false, capture: null, hoverEl: null, dwellEl: null, dwellStart: 0, dwellDoneEl: null, dwell: 0,
    };
    this._configureFilters(t);
    return t;
  }

  _configureFilters(t) {
    const sm = settings.get('smoothing'); // 0..1
    const minCutoff = 3.2 - sm * 2.8;    // 3.2 Hz (raw) … 0.4 Hz (smooth)
    const beta = 0.012 - sm * 0.008;
    t.fx = new OneEuro(minCutoff, beta, 1.0);
    t.fy = new OneEuro(minCutoff, beta, 1.0);
  }

  _updateTrack(t, d, ts) {
    const sec = ts / 1000;
    t.lm = d.lm; t.rawX = d.rawX; t.rawY = d.rawY; t.handedness = d.handedness; t.score = d.score;
    t.sx = d.sx; t.sy = d.sy;
    const fx = t.fx.filter(d.sx, sec), fy = t.fy.filter(d.sy, sec);
    t.history.push({ ts, x: fx, y: fy });
    while (t.history.length > 12) t.history.shift();
    t.pinchRatio = d.pinchRatio;
    t.screenLm = d.lm.map((p) => this.mapRaw(p.x, p.y));

    // pinch state machine with hysteresis + 2-frame debounce
    const on = settings.get('pinchOn'), off = settings.get('pinchOff');
    t.pinchStarted = t.pinchEnded = false;
    if (!t.pinched) {
      t.onCount = d.pinchRatio < on ? t.onCount + 1 : 0;
      if (t.onCount >= 2) {
        t.pinched = true; t.pinchStarted = true; t.offCount = 0;
        // click-lock: closing a pinch drags the fingertip; use where it was ~110ms ago
        const past = t.history.find((h) => ts - h.ts <= 130) || t.history[0];
        t.lockDX = past.x - fx; t.lockDY = past.y - fy;
      }
    } else {
      t.offCount = d.pinchRatio > off ? t.offCount + 1 : 0;
      if (t.offCount >= 2) { t.pinched = false; t.pinchEnded = true; t.onCount = 0; }
    }
    if (!t.pinched && !t.pinchEnded) { t.lockDX *= 0.6; t.lockDY *= 0.6; }
    t.x = fx + t.lockDX;
    t.y = fy + t.lockDY;
  }

  _hit(x, y) {
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
    return document.elementFromPoint(x, y);
  }

  _fire(type, target, t, buttons) {
    if (!target) return null;
    const init = {
      bubbles: true, cancelable: true, composed: true,
      clientX: t.x, clientY: t.y, screenX: t.x, screenY: t.y,
      pointerId: t.pointerId, pointerType: 'touch', isPrimary: t.slot === 0,
      button: type === 'pointermove' ? -1 : 0, buttons, pressure: buttons ? 0.5 : 0, width: 24, height: 24,
    };
    let ev;
    try { ev = new PointerEvent(type, init); } catch { ev = new MouseEvent(type, init); }
    ev.isHand = true;
    target.dispatchEvent(ev);
    return ev;
  }

  _click(el, t) {
    if (!el) return;
    if (el.matches?.('input, textarea')) el.focus();
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: t.x, clientY: t.y, view: window });
    ev.isHand = true;
    el.dispatchEvent(ev);
  }

  _setHover(t, el) {
    const target = el?.closest?.(CLICKABLE) || null;
    if (target === t.hoverEl) return target;
    t.hoverEl?.classList?.remove('holo-hover');
    if (target) { target.classList.add('holo-hover'); sfx.hover(); }
    t.hoverEl = target;
    return target;
  }

  _pointer(t, ts) {
    const el = this._hit(t.x, t.y);
    const mode = settings.get('clickMode');

    if (t.pinchStarted && mode !== 'dwell') {
      t.down = true;
      t.capture = el;
      t.downX = t.x; t.downY = t.y; t.moved = 0; t.scrolling = false;
      t.scrollEl = el?.closest?.('.scroll, [data-scroll]') || null;
      if (t.scrollEl && el.closest(NO_SCROLL_DRAG)) t.scrollEl = null;
      t.lastY = t.y;
      sfx.pinch();
      this._fire('pointerdown', el, t, 1);
      el?.closest?.('.hbtn')?.classList.add('holo-press');
    }

    if (t.down) {
      t.moved = Math.max(t.moved, Math.hypot(t.x - t.downX, t.y - t.downY));
      this._fire('pointermove', t.capture, t, 1);
      if (t.scrollEl && t.moved > 16) {
        t.scrolling = true;
        t.scrollEl.scrollTop -= (t.y - t.lastY) * 1.6;
      }
      t.lastY = t.y;
      if (t.pinchEnded || !t.pinched) {
        t.down = false;
        this._fire('pointerup', t.capture, t, 0);
        document.querySelectorAll('.holo-press').forEach((n) => n.classList.remove('holo-press'));
        if (!t.scrolling && t.moved < 46) {
          const releaseEl = this._hit(t.x, t.y);
          const a = t.capture?.closest?.(CLICKABLE), b = releaseEl?.closest?.(CLICKABLE);
          const target = a && (a === b || !b) ? a : (b || t.capture);
          // clicking plain elements (e.g. canvas) is harmless; buttons get a real click
          if (target) this._click(target, t);
        }
        t.capture = null;
        t.dwellDoneEl = t.hoverEl; // don't immediately dwell-click what we just pinched
      }
      return;
    }

    // hovering
    this._fire('pointermove', el, t, 0);
    const hov = this._setHover(t, el);
    if (mode !== 'pinch' && hov && !hov.closest('[data-nodwell]')) {
      if (hov === t.dwellDoneEl) { t.dwell = 0; return; }
      if (hov !== t.dwellEl) { t.dwellEl = hov; t.dwellStart = ts; t.dwell = 0; return; }
      t.dwell = Math.min(1, (ts - t.dwellStart) / settings.get('dwellMs'));
      if (t.dwell >= 1) {
        t.dwell = 0; t.dwellDoneEl = hov; t.dwellEl = null;
        sfx.pinch();
        this._click(hov, t);
      }
    } else {
      t.dwellEl = null; t.dwell = 0;
      if (!hov) t.dwellDoneEl = null;
    }
  }

  _releaseTrack(t) {
    if (t.down) { this._fire('pointerup', t.capture, t, 0); t.down = false; }
    t.hoverEl?.classList?.remove('holo-hover');
    t.hoverEl = null;
  }

  // ---------------------------------------------------------------- overlay
  _ensureOverlay() {
    if (this.layer) return;
    this.layer = document.getElementById('cursor-layer');
    this.skel = document.createElement('canvas');
    this.skel.id = 'skeleton';
    this.layer.append(this.skel);
    this.skelCtx = this.skel.getContext('2d');
    const resize = () => { this.skel.width = innerWidth; this.skel.height = innerHeight; };
    resize();
    addEventListener('resize', resize);
  }

  _cursorEl(slot) {
    if (this.cursorEls[slot]) return this.cursorEls[slot];
    const C = 2 * Math.PI * 25;
    const svg = s('svg', { viewBox: '0 0 64 64' },
      s('circle', { class: 'hc-ring', cx: 32, cy: 32, r: 17 }),
      s('circle', { class: 'hc-dot', cx: 32, cy: 32, r: 3 }),
      s('path', { d: 'M32 4v8M32 52v8M4 32h8M52 32h8', stroke: 'currentColor', 'stroke-width': 1.5, style: 'stroke: var(--c)' }),
      s('circle', { class: 'hc-dwell', cx: 32, cy: 32, r: 25, 'stroke-dasharray': `0 ${C}` }),
      s('text', { class: 'hc-tag', x: 52, y: 14 }, ''));
    const el = document.createElement('div');
    el.className = 'hand-cursor lost';
    el.append(svg);
    this.layer.append(el);
    el._dwell = svg.querySelector('.hc-dwell');
    el._tag = svg.querySelector('.hc-tag');
    el._C = C;
    this.cursorEls[slot] = el;
    return el;
  }

  _renderOverlay(clear = false) {
    if (!this.layer) return;
    const live = clear ? [] : this.tracks.filter((t) => !t.missing);
    // cursors
    const show = new Set();
    if (!this.suspendPointers) {
      for (const t of live) {
        const el = this._cursorEl(t.slot);
        show.add(t.slot);
        el.classList.remove('lost');
        el.classList.toggle('pinch', !!t.pinched);
        el.style.transform = `translate3d(${t.x}px, ${t.y}px, 0)`;
        el._dwell.setAttribute('stroke-dasharray', `${(t.dwell || 0) * el._C} ${el._C}`);
        el._tag.textContent = live.length > 1 ? (t.handedness ? t.handedness[0] : '') : '';
      }
    }
    this.cursorEls.forEach((el, i) => { if (el && !show.has(i)) el.classList.add('lost'); });

    // holographic skeleton
    const ctx = this.skelCtx;
    ctx.clearRect(0, 0, this.skel.width, this.skel.height);
    if (!settings.get('showSkeleton') || clear) return;
    const col = getComputedStyle(document.documentElement).getPropertyValue('--c').trim() || '#3ef';
    ctx.lineCap = 'round';
    for (const t of live) {
      const p = t.screenLm;
      if (!p) continue;
      const ox = t.lockDX, oy = t.lockDY;
      ctx.strokeStyle = col; ctx.globalAlpha = 0.35; ctx.lineWidth = 3;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) { ctx.moveTo(p[a][0] + ox, p[a][1] + oy); ctx.lineTo(p[b][0] + ox, p[b][1] + oy); }
      ctx.stroke();
      ctx.globalAlpha = 0.8; ctx.fillStyle = col;
      for (let i = 0; i < p.length; i++) {
        ctx.beginPath(); ctx.arc(p[i][0] + ox, p[i][1] + oy, i % 4 === 0 ? 3.5 : 2.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Draw the camera image + raw landmarks into a canvas (monitor / calibration). */
  drawPreview(canvas, { mirror = settings.get('facingMode') === 'user' } = {}) {
    const v = this.video;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, hgt = canvas.height;
    ctx.save();
    if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    if (v && v.readyState >= 2) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(v, 0, 0, w, hgt);
      ctx.globalAlpha = 1;
    } else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hgt); }
    const col = getComputedStyle(document.documentElement).getPropertyValue('--c').trim() || '#3ef';
    for (const t of this.tracks) {
      if (t.missing || !t.lm) continue;
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, w / 160);
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) { ctx.moveTo(t.lm[a].x * w, t.lm[a].y * hgt); ctx.lineTo(t.lm[b].x * w, t.lm[b].y * hgt); }
      ctx.stroke();
      ctx.fillStyle = t.pinched ? '#fff' : col;
      ctx.beginPath(); ctx.arc(t.lm[8].x * w, t.lm[8].y * hgt, Math.max(3, w / 70), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

export const hand = new HandEngine();
