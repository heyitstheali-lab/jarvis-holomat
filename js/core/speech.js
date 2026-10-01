// Voice I/O using the iPad's built-in engines (no ElevenLabs, no extra keys):
//  • speechSynthesis for Jarvis' voice (prefers a British male voice)
//  • (webkit)SpeechRecognition for push-to-talk and the optional "Jarvis" wake word
import { settings } from './store.js';

const synth = window.speechSynthesis || null;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
export const canSpeak = !!synth;
export const canListen = !!SR;

let voices = [];
function loadVoices() { voices = synth ? synth.getVoices() : []; }
if (synth) {
  loadVoices();
  if (synth.addEventListener) synth.addEventListener('voiceschanged', loadVoices);
  else synth.onvoiceschanged = loadVoices;
}

export function listVoices() {
  loadVoices();
  return voices.filter((v) => /^en/i.test(v.lang)).sort((a, b) => (a.lang === b.lang ? a.name.localeCompare(b.name) : a.lang.localeCompare(b.lang)));
}

export function pickVoice() {
  if (!voices.length) loadVoices();
  const wanted = settings.get('voiceName');
  if (wanted) { const v = voices.find((x) => x.name === wanted); if (v) return v; }
  const prefs = ['Daniel', 'Arthur', 'Oliver', 'Google UK English Male', 'Microsoft Ryan', 'Microsoft George', 'Malcolm', 'Rishi', 'Aaron'];
  for (const p of prefs) {
    const v = voices.find((x) => x.name.includes(p) && /^en/i.test(x.lang));
    if (v) return v;
  }
  return voices.find((x) => x.lang === 'en-GB') || voices.find((x) => /^en/i.test(x.lang)) || null;
}

/** iOS only allows speech after a user gesture — call once from a tap. */
export function unlockSpeech() {
  if (!synth) return;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); } catch {}
}

export function cleanForSpeech(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, ' (code shown on screen) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'the link on screen')
    .replace(/[*_#>|]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text) {
  const out = [];
  const parts = text.match(/[^.!?;:\n]+[.!?;:]*\s*/g) || [text];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > 200 && cur) { out.push(cur.trim()); cur = ''; }
    cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

class Speaker extends EventTarget {
  constructor() { super(); this.pending = 0; }
  get speaking() { return this.pending > 0; }

  _emit(state) { this.dispatchEvent(new CustomEvent('state', { detail: state })); }

  _speakChunk(chunk) {
    if (!synth || !chunk) return;
    const u = new SpeechSynthesisUtterance(chunk);
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-GB';
    u.rate = settings.get('speechRate') || 1;
    u.pitch = 0.92;
    const done = () => {
      if (u._done) return;
      u._done = true;
      this.pending = Math.max(0, this.pending - 1);
      if (!this.pending) this._emit('idle');
    };
    u.onend = done; u.onerror = done;
    if (!this.pending) this._emit('speaking');
    this.pending++;
    synth.speak(u);
  }

  say(text, { interrupt = true } = {}) {
    if (!synth || !settings.get('voiceEnabled')) return;
    if (interrupt) this.stop();
    for (const s of splitSentences(cleanForSpeech(text))) this._speakChunk(s);
  }

  /** Speak a streaming reply sentence-by-sentence as it arrives. */
  stream() {
    let buf = '';
    let inCode = false;
    const flush = (force) => {
      // drop fenced code from speech
      for (;;) {
        const fence = buf.indexOf('```');
        if (fence < 0) break;
        if (!inCode) { const before = buf.slice(0, fence); buf = buf.slice(fence + 3); this._sayPart(before); inCode = true; }
        else { buf = buf.slice(fence + 3); inCode = false; }
      }
      if (inCode) { buf = ''; return; }
      const m = force ? buf.length : Math.max(buf.lastIndexOf('. '), buf.lastIndexOf('! '), buf.lastIndexOf('? '), buf.lastIndexOf('\n'));
      if (m > 0) { this._sayPart(buf.slice(0, m + 1)); buf = buf.slice(m + 1); }
    };
    return {
      push: (d) => { buf += d; flush(false); },
      end: () => flush(true),
    };
  }

  _sayPart(t) {
    if (!synth || !settings.get('voiceEnabled')) return;
    for (const s of splitSentences(cleanForSpeech(t))) this._speakChunk(s);
  }

  stop() {
    if (!synth) return;
    synth.cancel();
    if (this.pending) { this.pending = 0; this._emit('idle'); }
  }
}

export const speaker = new Speaker();

// ------------------------------------------------------------------ recognition
/** One utterance of speech → text. Returns { promise, stop }. */
export function listenOnce({ onInterim, lang = navigator.language || 'en-US' } = {}) {
  if (!SR) return { promise: Promise.reject(new Error('Speech recognition is not supported in this browser')), stop() {} };
  const rec = new SR();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '';
  let interim = '';
  const promise = new Promise((resolve, reject) => {
    rec.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onInterim && onInterim((finalText + ' ' + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') resolve((finalText || interim).trim());
      else reject(new Error(e.error === 'not-allowed' ? 'Microphone / speech permission denied' : `Speech error: ${e.error}`));
    };
    rec.onend = () => resolve((finalText || interim).trim());
  });
  try { rec.start(); } catch (e) { return { promise: Promise.reject(e), stop() {} }; }
  return { promise, stop: () => { try { rec.stop(); } catch {} } };
}

/** Continuous listener for the wake word "Jarvis". */
export class WakeWord {
  constructor(onWake) { this.onWake = onWake; this.active = false; this.paused = false; this.rec = null; }
  start() {
    if (!SR || this.active) return false;
    this.active = true;
    this._run();
    return true;
  }
  stop() { this.active = false; this._kill(); }
  pause() { this.paused = true; this._kill(); }
  resume() { if (!this.active) return; this.paused = false; if (!this.rec) this._run(); }
  _kill() { if (this.rec) { const r = this.rec; this.rec = null; r.onend = null; try { r.abort(); } catch {} } }
  _run() {
    if (!this.active || this.paused || this.rec) return;
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const t = e.results[i][0].transcript;
        const m = t.match(/\b(?:hey\s+)?jarvis\b[,.!?]?\s*(.*)$/i);
        if (m) { this.onWake(m[1].trim()); }
      }
    };
    rec.onerror = (e) => { if (e.error === 'not-allowed') this.active = false; };
    rec.onend = () => { this.rec = null; if (this.active && !this.paused) setTimeout(() => this._run(), 350); };
    this.rec = rec;
    try { rec.start(); } catch { this.rec = null; }
  }
}
