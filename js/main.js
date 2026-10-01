// J.A.R.V.I.S. HOLOMAT — app host, boot sequence and quick actions (home screen lives in hud.js).
import { settings } from './core/store.js';
import { sfx, unlockAudio } from './core/audio.js';
import { toast, openPanel, currentPanel } from './core/ui.js';
import { hand } from './core/hand.js';
import { runCalibration, isCalibrating } from './core/calibration.js';
import { unlockSpeech, speaker } from './core/speech.js';
import { hasKey } from './core/claude.js';
import { detectDevice } from './core/device.js';
import { jarvis } from './core/jarvis.js';
import { initHud, toggleLauncher, cycleTheme } from './hud.js';

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

// ------------------------------------------------------------------ home screen
async function hudAction(action) {
  if (action === 'calibrate') runCalibration();
  else if (action === 'tracking') toggleTracking();
  else if (action === 'talk') jarvis.pushToTalk();
  else if (action === 'system') openApp('settings');
  else if (action === 'launcher') toggleLauncher();
  else if (action === 'theme') toast(`HUD colour: ${cycleTheme().toUpperCase()}`);
}

export async function toggleTracking(on = !hand.running) {
  settings.set('tracking', on);
  if (on) {
    try { await hand.start(); toast('Hand tracking online · processing on this iPad', 'ok'); }
    catch (e) { toast(`Hand tracking unavailable: ${e.message}`, 'bad', 5000); }
  } else { hand.stop(); toast('Hand tracking offline'); }
}

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

document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

// ------------------------------------------------------------------ boot
jarvis.bind({ openApp, closeApp, toggleLauncher, toggleTracking, runCalibration, apps: APPS });
initHud({ mount: document.getElementById('hud'), apps: APPS, openApp, action: hudAction });

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
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  setTimeout(() => jarvis.announce(`Good ${part}, ${settings.get('callsign')}. Holomat systems are online. Tap the arc reactor to deploy your modules.${hasKey() ? '' : ' And add your Claude API key in System to wake me up properly.'}`), 900);
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
