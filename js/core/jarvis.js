// J.A.R.V.I.S. — the Holomat's voice assistant (Claude API + on-device speech).
// Lives globally: the HUD's TALK button, the "Jarvis" wake word and the Jarvis
// console all talk to this one assistant, which can operate the Holomat via tools.
import { converse, describeError, hasKey, isAbort } from './claude.js';
import { speaker, listenOnce, WakeWord, canListen } from './speech.js';
import { settings, loadJSON, saveJSON } from './store.js';
import { toast, currentPanel, onPanelChange, h } from './ui.js';
import { sfx } from './audio.js';
import { hand } from './hand.js';
import { detectDevice } from './device.js';

export const THEMES = { cyan: 188, blue: 212, ice: 176, green: 145, gold: 45, orange: 28, red: 355, purple: 275, pink: 320 };

class Jarvis extends EventTarget {
  constructor() {
    super();
    this.state = 'idle';
    this.messages = [];     // Claude conversation (append-only for this session)
    this.log = [];          // transcript entries for the UI
    this.lastLatency = 0;
    this.api = null;
    this.timers = [];
    this.memories = loadJSON('jarvis.memories', []);
    this._system = null;
    this.wake = new WakeWord((rest) => this._onWake(rest));
    this._listenAfterSpeech = false;
    speaker.addEventListener('state', (e) => {
      if (e.detail === 'speaking') this._setState('speaking');
      else if (this.state === 'speaking') {
        this._setState('idle');
        if (this._listenAfterSpeech) { this._listenAfterSpeech = false; setTimeout(() => this.pushToTalk(), 150); }
      }
    });
    setInterval(() => this._tickTimers(), 500);
    onPanelChange(() => this._renderBar());
    this._dismissedAt = 0;
    document.getElementById('jarvis-bar')?.addEventListener('click', () => {
      // tap the subtitle bar to dismiss it (and silence Jarvis)
      this._dismissedAt = Date.now();
      if (this.state === 'speaking') speaker.stop();
      this._renderBar();
    });
  }

  bind(api) { this.api = api; }

  // ---------------------------------------------------------------- state / ui
  _setState(st) {
    if (this.state === st) return;
    this.state = st;
    if (st === 'idle') this.wake.resume(); else this.wake.pause();
    this.dispatchEvent(new CustomEvent('state', { detail: st }));
    this._renderBar();
  }

  _addLog(role, text, extra = {}) {
    const entry = { role, text, at: Date.now(), ...extra };
    this.log.push(entry);
    if (this.log.length > 200) this.log.shift();
    this._emitLog();
    return entry;
  }
  _emitLog() { this.dispatchEvent(new CustomEvent('log')); this._renderBar(); }

  _renderBar() {
    const bar = document.getElementById('jarvis-bar');
    if (!bar) return;
    const inConsole = currentPanel()?.id === 'jarvis';
    const last = [...this.log].reverse().find((e) => e.role === 'assistant' || e.role === 'user');
    const fresh = last && Date.now() - last.at < 9000 && last.at > this._dismissedAt;
    const visible = !inConsole && (this.state !== 'idle' || fresh);
    bar.classList.toggle('hidden', !visible);
    bar.classList.remove('listening', 'thinking', 'speaking');
    if (this.state !== 'idle') bar.classList.add(this.state);
    const who = bar.querySelector('.jb-who');
    const text = bar.querySelector('.jb-text');
    who.textContent = { idle: 'J.A.R.V.I.S.', listening: 'J.A.R.V.I.S. · LISTENING', thinking: 'J.A.R.V.I.S. · PROCESSING', speaking: 'J.A.R.V.I.S.' }[this.state];
    if (this.state === 'listening') { text.className = 'jb-text jb-user'; text.textContent = this._interim || 'Go ahead…'; }
    else if (last) { text.className = 'jb-text' + (last.role === 'user' ? ' jb-user' : ''); text.textContent = last.text || '…'; }
    clearTimeout(this._barT);
    if (visible && this.state === 'idle') this._barT = setTimeout(() => this._renderBar(), 9200);
  }

  // ---------------------------------------------------------------- voice
  announce(text) {
    this._addLog('assistant', text, { local: true });
    speaker.say(text);
  }

  async pushToTalk() {
    if (this.state === 'listening') { this._rec?.stop(); return; }
    if (!canListen) {
      toast('Speech recognition is not available here — type to Jarvis instead', 'warn');
      this.api?.openApp('jarvis');
      return;
    }
    speaker.stop();
    this.abort?.abort();
    sfx.tick();
    this._interim = '';
    this._setState('listening');
    this._rec = listenOnce({ onInterim: (t) => { this._interim = t; this._renderBar(); this.dispatchEvent(new CustomEvent('interim', { detail: t })); } });
    let text = '';
    try { text = await this._rec.promise; }
    catch (e) { toast(e.message, 'bad'); }
    this._rec = null;
    this._interim = '';
    this._setState('idle');
    if (text) this.ask(text);
  }

  setWakeWord(on) {
    settings.set('wakeWord', on);
    if (on) {
      if (!canListen) { toast('Wake word needs speech recognition (Safari 14.5+)', 'warn'); return false; }
      this.wake.start();
      toast('Listening for “Jarvis”', 'ok');
    } else this.wake.stop();
    return true;
  }

  _onWake(rest) {
    sfx.tick();
    if (rest && rest.split(/\s+/).length >= 2) this.ask(rest);
    else { this._listenAfterSpeech = true; this.announce(`Yes, ${settings.get('callsign')}?`); }
  }

  // ---------------------------------------------------------------- claude
  _systemPrompt() {
    if (this._system) return this._system;
    const callsign = settings.get('callsign') || 'Sir';
    const mem = this.memories.length ? `\n\nThings the user asked you to remember:\n${this.memories.map((m) => `- ${m}`).join('\n')}` : '';
    this._system = `You are J.A.R.V.I.S., the AI that runs this Holomat — a holographic, hand-tracked tabletop interface running on the user's iPad. Address the user as "${callsign}". Personality: calm, precise, quietly witty and unfailingly helpful, like an impeccable digital butler.

Your replies are spoken aloud by a speech synthesizer and shown as subtitles:
- Keep replies short: one to three sentences unless the user asks for detail.
- Use plain conversational sentences: no markdown, lists, emoji or code blocks.
- Say numbers and units the way a person would speak them.

You can operate the Holomat with your tools: open or close apps (optionally straight into a specific game), show the app launcher, toggle hand tracking, start hand calibration, set timers, change the HUD colour theme, report system status, and remember facts for later. When the user asks for something a tool can do, use the tool, then confirm briefly. If nothing can do what was asked, say so plainly instead of guessing. Use web search only for current events or facts you cannot know.

Holomat apps:
- games: 2D arcade (pong, orbs, snake, memory)
- multiplayer: online play with another Holomat (tictactoe, connect4, hockey)
- circuit: PCB / circuit designer assisted by Claude
- claude: text and voice chat with Claude
- ruler: precise on-screen ruler; it knows this iPad's real pixel density
- games3d: 3D holographic games (runner, stack, breaker)
- jarvis: your full console
- settings: system configuration (API key, voice, hand tracking)

Each user message starts with a bracketed live status line from the Holomat; use it when relevant and never read it out.${mem}`;
    return this._system;
  }

  _contextLine() {
    const now = new Date();
    const f = hand.lastFrame;
    const panel = currentPanel();
    return `[status · ${now.toLocaleString()} · open app: ${panel ? panel.id : 'none'} · hand tracking: ${hand.running ? `on, ${f ? f.hands.length : 0} hands` : 'off'} · timers: ${this.timers.length}]`;
  }

  _tools() {
    const api = this.api || {};
    const appIds = (api.apps || []).map((a) => a.id);
    return [
      {
        name: 'open_app',
        description: 'Open a Holomat app. Optionally jump straight into one item inside it (a game id such as pong, orbs, snake, memory, runner, stack, breaker, tictactoe, connect4, hockey).',
        input_schema: { type: 'object', properties: { app: { type: 'string', enum: appIds }, item: { type: 'string', description: 'Optional game/item id inside the app' } }, required: ['app'] },
        run: async ({ app, item }) => { await api.openApp(app, item ? { item } : {}); return { opened: app, item: item || null }; },
      },
      {
        name: 'close_app',
        description: 'Close the currently open app and return to the main HUD.',
        input_schema: { type: 'object', properties: {} },
        run: async () => { const p = currentPanel(); api.closeApp(); return { closed: p ? p.id : null }; },
      },
      {
        name: 'show_launcher',
        description: 'Open (true) or collapse (false) the ring of 8 app icons around the central core.',
        input_schema: { type: 'object', properties: { open: { type: 'boolean' } }, required: ['open'] },
        run: async ({ open }) => { api.closeApp(); api.toggleLauncher(open); return { launcher: open }; },
      },
      {
        name: 'set_hand_tracking',
        description: 'Turn camera hand tracking on or off.',
        input_schema: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'] },
        run: async ({ enabled }) => { await api.toggleTracking(enabled); return { tracking: hand.running, status: hand.statusText }; },
      },
      {
        name: 'start_calibration',
        description: 'Start the guided hand calibration (pinch scan + five on-screen targets).',
        input_schema: { type: 'object', properties: {} },
        run: async () => { api.closeApp(); api.runCalibration(); return { started: true }; },
      },
      {
        name: 'set_timer',
        description: 'Start a countdown timer shown on the HUD; Jarvis announces when it finishes.',
        input_schema: { type: 'object', properties: { seconds: { type: 'number', description: 'Duration in seconds' }, label: { type: 'string' } }, required: ['seconds'] },
        run: async ({ seconds, label }) => {
          if (!(seconds > 0 && seconds <= 86400)) throw new Error('seconds must be between 1 and 86400');
          this.addTimer(seconds, label || 'timer');
          return { started: true, seconds, label: label || 'timer' };
        },
      },
      {
        name: 'cancel_timers',
        description: 'Cancel all running timers.',
        input_schema: { type: 'object', properties: {} },
        run: async () => { const n = this.timers.length; this.timers.forEach((t) => t.el.remove()); this.timers = []; return { cancelled: n }; },
      },
      {
        name: 'set_theme',
        description: 'Change the colour of the holographic HUD.',
        input_schema: { type: 'object', properties: { color: { type: 'string', enum: Object.keys(THEMES) } }, required: ['color'] },
        run: async ({ color }) => { settings.set('hue', THEMES[color]); return { theme: color }; },
      },
      {
        name: 'get_system_status',
        description: 'Report Holomat diagnostics: device, display size, hand tracking performance, calibration, Claude model, timers.',
        input_schema: { type: 'object', properties: {} },
        run: async () => {
          const d = detectDevice();
          return {
            time: new Date().toString(),
            device: d.name, screen_mm: [Math.round(d.widthMm), Math.round(d.heightMm)], diagonal_in: +d.diagIn.toFixed(1), ppi: d.ppi,
            hand_tracking: { status: hand.status, backend: hand.backend, fps: Math.round(hand.fps), inference_ms: Math.round(hand.inferMs), hands_visible: hand.lastFrame ? hand.lastFrame.hands.length : 0 },
            calibrated: !!hand.activeCalibration(),
            model: settings.get('model'),
            timers: this.timers.map((t) => ({ label: t.label, remaining_s: Math.max(0, Math.round((t.end - Date.now()) / 1000)) })),
            online: navigator.onLine,
          };
        },
      },
      {
        name: 'remember',
        description: 'Save a short fact or preference about the user for future sessions.',
        input_schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
        run: async ({ note }) => {
          this.memories.push(note.slice(0, 300));
          if (this.memories.length > 40) this.memories.shift();
          saveJSON('jarvis.memories', this.memories);
          return { saved: true, total: this.memories.length };
        },
      },
    ];
  }

  async ask(text, { speak = true } = {}) {
    text = String(text || '').trim();
    if (!text) return;
    speaker.stop();
    // let an interrupted request finish writing its tool results so the
    // conversation history stays valid (tool_use is always followed by results)
    this.abort?.abort();
    await this._pending?.catch(() => {});
    this._addLog('user', text);
    if (!hasKey()) {
      this.announce(`I'll need a Claude API key before I can think, ${settings.get('callsign')}. You can add one in System.`);
      return;
    }
    const ctrl = new AbortController();
    this.abort = ctrl;
    this.messages.push({ role: 'user', content: `${this._contextLine()}\n${text}` });
    this._setState('thinking');
    const entry = this._addLog('assistant', '');
    const sp = speak ? speaker.stream() : null;
    const t0 = performance.now();
    let first = true;
    try {
      this._pending = converse({
        system: this._systemPrompt(),
        messages: this.messages,
        tools: this._tools(),
        effort: 'low',
        maxTokens: 8000,
        webSearch: settings.get('webSearch'),
        signal: ctrl.signal,
        onText: (d) => {
          if (first) { this.lastLatency = Math.round(performance.now() - t0); first = false; }
          entry.text += d;
          sp && sp.push(d);
          this._emitLog();
        },
        onToolUse: (name) => { this._addLog('tool', name.replace(/_/g, ' ')); },
      });
      const res = await this._pending;
      sp && sp.end();
      if (res.refused) {
        const msg = `I'm afraid that's not something I can help with, ${settings.get('callsign')}.`;
        entry.text += (entry.text ? ' ' : '') + msg;
        speak && speaker.say(msg, { interrupt: false });
      }
      if (!entry.text.trim()) entry.text = 'Done.';
    } catch (e) {
      if (isAbort(e)) { entry.text = entry.text || '(interrupted)'; }
      else {
        entry.text = describeError(e);
        entry.error = true;
        sfx.error();
        speak && speaker.say('I ran into a problem reaching my servers. Details are on screen.');
      }
    } finally {
      this._emitLog();
      if (this.abort === ctrl) {
        this.abort = null;
        this._setState(speaker.speaking ? 'speaking' : 'idle');
      }
    }
  }

  stop() { this.abort?.abort(); this._rec?.stop(); speaker.stop(); this._setState('idle'); }

  resetConversation() {
    this.stop();
    this.messages = [];
    this.log = [];
    this._system = null;
    this._emitLog();
  }

  forgetMemories() { this.memories = []; saveJSON('jarvis.memories', []); this._system = null; }

  // ---------------------------------------------------------------- timers
  addTimer(seconds, label) {
    const host = document.getElementById('timers');
    const el = h('div', { class: 'timer-chip' });
    host.append(el);
    const t = { end: Date.now() + seconds * 1000, label, el, done: false };
    this.timers.push(t);
    this._tickTimers();
  }

  _tickTimers() {
    const now = Date.now();
    for (const t of [...this.timers]) {
      const rem = Math.max(0, Math.ceil((t.end - now) / 1000));
      const mm = Math.floor(rem / 60), ss = rem % 60;
      t.el.replaceChildren(h('small', null, t.label.toUpperCase()), `${mm}:${String(ss).padStart(2, '0')}`);
      if (rem <= 0 && !t.done) {
        t.done = true;
        t.el.classList.add('done');
        sfx.alarm();
        this.announce(`${settings.get('callsign')}, your ${t.label} is complete.`);
        setTimeout(() => { t.el.remove(); this.timers = this.timers.filter((x) => x !== t); }, 8000);
      }
    }
  }
}

export const jarvis = new Jarvis();
