// Synthesised UI sound effects (WebAudio — no audio files needed).
import { settings } from './store.js';

let ctx = null;
let master = null;

export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function tone({ f = 880, f2 = null, type = 'sine', dur = 0.12, vol = 0.3, delay = 0, attack = 0.004, q = null }) {
  if (!ctx || !settings.get('sfx')) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t0);
  if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = osc;
  if (q) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    osc.connect(bp); node = bp;
  }
  node.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

function noise({ dur = 0.3, vol = 0.15, delay = 0, from = 4000, to = 300 }) {
  if (!ctx || !settings.get('sfx')) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(from, t0);
  lp.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(lp); lp.connect(g); g.connect(master);
  src.start(t0);
}

export const sfx = {
  hover: () => tone({ f: 1500, dur: 0.035, vol: 0.05 }),
  click: () => { tone({ f: 1100, f2: 1700, type: 'triangle', dur: 0.07, vol: 0.22 }); },
  pinch: () => tone({ f: 900, f2: 1300, type: 'sine', dur: 0.05, vol: 0.12 }),
  open: () => { tone({ f: 420, f2: 1200, type: 'sawtooth', dur: 0.22, vol: 0.08, q: 6 }); tone({ f: 1600, dur: 0.12, vol: 0.12, delay: 0.12 }); },
  close: () => { tone({ f: 1200, f2: 380, type: 'sawtooth', dur: 0.2, vol: 0.07, q: 6 }); },
  success: () => { tone({ f: 880, dur: 0.1, vol: 0.18 }); tone({ f: 1320, dur: 0.16, vol: 0.18, delay: 0.09 }); },
  error: () => { tone({ f: 220, type: 'square', dur: 0.14, vol: 0.12 }); tone({ f: 180, type: 'square', dur: 0.2, vol: 0.12, delay: 0.12 }); },
  tick: () => tone({ f: 2200, dur: 0.02, vol: 0.06 }),
  score: () => { tone({ f: 1046, dur: 0.07, vol: 0.16 }); tone({ f: 1568, dur: 0.1, vol: 0.14, delay: 0.06 }); },
  hit: () => tone({ f: 320, f2: 160, type: 'triangle', dur: 0.08, vol: 0.25 }),
  boom: () => { noise({ dur: 0.45, vol: 0.25 }); tone({ f: 120, f2: 40, type: 'sine', dur: 0.4, vol: 0.3 }); },
  power: () => {
    tone({ f: 60, f2: 240, type: 'sawtooth', dur: 0.9, vol: 0.09, q: 3 });
    tone({ f: 120, f2: 960, type: 'sine', dur: 0.8, vol: 0.12 });
    noise({ dur: 0.6, vol: 0.06, from: 800, to: 6000, delay: 0.1 });
    tone({ f: 1320, dur: 0.5, vol: 0.12, delay: 0.75 });
    tone({ f: 1980, dur: 0.6, vol: 0.08, delay: 0.82 });
  },
  powerDown: () => { tone({ f: 900, f2: 120, type: 'sine', dur: 0.5, vol: 0.12 }); },
  boot: () => { for (let i = 0; i < 5; i++) tone({ f: 600 + i * 180, dur: 0.05, vol: 0.08, delay: i * 0.07 }); },
  alarm: () => { for (let i = 0; i < 6; i++) tone({ f: i % 2 ? 1320 : 990, type: 'square', dur: 0.12, vol: 0.12, delay: i * 0.16 }); },
};
