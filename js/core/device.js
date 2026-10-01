// iPad detection + physical screen geometry for the ruler.
// Every iPad renders at 2× (devicePixelRatio 2); pixel density is 264 ppi for
// all full-size iPads and 326 ppi for the iPad mini, so the logical screen size
// tells us the model family and how many CSS px make a real millimetre.
import { settings } from './store.js';

// logical points (short × long) → candidates
const IPADS = [
  { id: 'ipad-9.7', pts: [768, 1024], name: 'iPad 9.7″ (iPad 5/6 · Air 1/2 · Pro 9.7)', ppi: 264, diag: 9.7 },
  { id: 'ipad-mini-7.9', pts: [768, 1024], name: 'iPad mini 2–5 (7.9″)', ppi: 326, diag: 7.9 },
  { id: 'ipad-10.2', pts: [810, 1080], name: 'iPad 10.2″ (7th–9th gen)', ppi: 264, diag: 10.2 },
  { id: 'ipad-10.5', pts: [834, 1112], name: 'iPad Air 3 / iPad Pro 10.5″', ppi: 264, diag: 10.5 },
  { id: 'ipad-10.9', pts: [820, 1180], name: 'iPad 10th/11th gen · iPad Air 11″ (4th gen +)', ppi: 264, diag: 10.9 },
  { id: 'ipad-pro-11', pts: [834, 1194], name: 'iPad Pro 11″ (1st–4th gen)', ppi: 264, diag: 11.0 },
  { id: 'ipad-pro-11-m4', pts: [834, 1210], name: 'iPad Pro 11″ (M4 / M5)', ppi: 264, diag: 11.1 },
  { id: 'ipad-mini-8.3', pts: [744, 1133], name: 'iPad mini 6 / 7 (8.3″)', ppi: 326, diag: 8.3 },
  { id: 'ipad-pro-12.9', pts: [1024, 1366], name: 'iPad Pro 12.9″ · iPad Air 13″', ppi: 264, diag: 12.9 },
  { id: 'ipad-pro-13-m4', pts: [1032, 1376], name: 'iPad Pro 13″ (M4 / M5)', ppi: 264, diag: 13.0 },
];

export function isIPad() {
  const ua = navigator.userAgent || '';
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
export function isIOS() { return isIPad() || /iPhone|iPod/.test(navigator.userAgent || ''); }
export function isStandalone() { return window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches || navigator.standalone === true; }

function screenPts() {
  const a = Math.round(screen.width), b = Math.round(screen.height);
  return [Math.min(a, b), Math.max(a, b)];
}

/** All models that match this screen (2 for the 768×1024 size). */
export function candidates() {
  if (!isIPad()) return [];
  const [w, h] = screenPts();
  return IPADS.filter((m) => m.pts[0] === w && m.pts[1] === h);
}

export function allModels() { return IPADS; }

/**
 * Best description of the device + the CSS-px-per-millimetre scale.
 * source: 'manual' (credit-card calibration) | 'model' | 'default'
 */
export function detectDevice() {
  const dpr = window.devicePixelRatio || 1;
  const [w, h] = screenPts();
  const manual = settings.get('pxPerMm');
  const cands = candidates();
  let model = null;
  if (cands.length) model = cands.find((c) => c.id === settings.get('ipadModel')) || cands[0];
  const ambiguous = cands.length > 1 && !cands.some((c) => c.id === settings.get('ipadModel'));

  let pxPerMm, source;
  if (manual) { pxPerMm = manual; source = 'manual'; }
  else if (model) { pxPerMm = model.ppi / dpr / 25.4; source = 'model'; }
  else { pxPerMm = 96 / 25.4; source = 'default'; } // CSS reference pixel
  const widthMm = w / pxPerMm, heightMm = h / pxPerMm;
  return {
    isIPad: isIPad(), model, ambiguous, candidates: cands, dpr, pts: [w, h], px: [w * dpr, h * dpr],
    ppi: model ? model.ppi : Math.round(pxPerMm * 25.4 * dpr),
    pxPerMm, source,
    widthMm, heightMm,
    diagIn: Math.hypot(widthMm, heightMm) / 25.4,
    name: model ? model.name : (isIOS() ? 'iOS device (unrecognised size)' : 'Non-iPad device'),
  };
}
