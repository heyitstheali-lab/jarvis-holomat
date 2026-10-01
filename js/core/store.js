// Persistent settings + small JSON storage helpers (localStorage, wrapped so a
// private-mode / quota failure never breaks the app).

const KEY = 'holomat.settings.v1';

export const DEFAULTS = {
  // Claude
  apiKey: '',
  model: 'claude-opus-5-5',
  callsign: 'Sir',
  webSearch: true,

  // Hand tracking (all inference runs on-device on the iPad CPU)
  tracking: true,
  facingMode: 'user',      // 'user' (front) | 'environment' (rear, for a downward "holomat" rig)
  mirror: true,            // only used without calibration
  maxHands: 2,
  delegate: 'CPU',         // 'CPU' (default, as requested) | 'GPU'
  clickMode: 'both',       // 'pinch' | 'dwell' | 'both'
  dwellMs: 1000,
  smoothing: 0.5,          // 0 = raw/fast … 1 = very smooth
  showSkeleton: true,
  showMonitor: true,
  pinchOn: 0.32,           // pinch ratio thresholds (thumb–index / palm size)
  pinchOff: 0.46,
  calibration: null,       // { H:[9], orientation, at }

  // Voice
  voiceEnabled: true,
  voiceName: '',
  speechRate: 1.0,
  wakeWord: false,

  // Display / audio
  hue: 188,
  sfx: true,

  // Ruler
  pxPerMm: null,           // manual override (credit-card calibration)
  ipadModel: null,         // user-confirmed model id when screen size is ambiguous
};

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}

let state = readAll();
const subs = new Set();

export const settings = {
  get(key) { return state[key]; },
  all() { return { ...state }; },
  set(keyOrObj, value) {
    const patch = typeof keyOrObj === 'string' ? { [keyOrObj]: value } : keyOrObj;
    state = { ...state, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
    for (const fn of subs) { try { fn(patch, state); } catch (e) { console.error(e); } }
  },
  reset() {
    const keep = { apiKey: state.apiKey };
    state = { ...DEFAULTS, ...keep };
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
    for (const fn of subs) fn(state, state);
  },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
};

export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem('holomat.' + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

export function saveJSON(key, value) {
  try { localStorage.setItem('holomat.' + key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function clearAllData() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('holomat.')).forEach((k) => localStorage.removeItem(k));
  } catch {}
}
