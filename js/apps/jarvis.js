// J.A.R.V.I.S. console — animated voice core, transcript, typed + spoken commands.
import { h, button, toggle, fitCanvas, toast } from '../core/ui.js';
import { jarvis } from '../core/jarvis.js';
import { settings } from '../core/store.js';
import { canListen } from '../core/speech.js';
import { hasKey } from '../core/claude.js';
import { themeColors } from './game-kit.js';

const QUICK = [
  'Status report',
  'Set a five minute timer for tea',
  'Switch to red alert colours',
  'Open the arcade',
  'Calibrate my hands',
  'What’s happening in the news today?',
];

export default {
  mount({ body, panel }) {
    const canvas = h('canvas', { style: { width: '100%', height: '100%', display: 'block' } });
    const stateEl = h('div', { class: 'hud-font', style: { position: 'absolute', left: '0', right: '0', bottom: '18px', textAlign: 'center', fontSize: '14px', color: 'var(--c-hi)', letterSpacing: '.3em' } });
    const core = h('div', { style: { position: 'relative', flex: '1', minHeight: '220px' } }, canvas, stateEl);
    const talk = button(canListen ? 'Tap to talk' : 'Voice input unavailable', () => jarvis.pushToTalk(), { cls: 'big primary', icon: 'mic' });
    talk.style.margin = '0 auto 18px';
    if (!canListen) talk.disabled = true;
    const left = h('div', { style: { flex: '1.1', display: 'flex', flexDirection: 'column', minWidth: '0' } }, core, talk);

    const log = h('div', { class: 'chat-log scroll', 'data-scroll': '' });
    const input = h('input', { class: 'hinput', placeholder: 'Type a command for Jarvis…', enterkeyhint: 'send' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const submit = () => { const t = input.value.trim(); if (!t) return; input.value = ''; jarvis.ask(t); };
    const chips = h('div', { class: 'chips', style: { paddingTop: '10px' } }, QUICK.map((q) => button(q, () => jarvis.ask(q), { cls: 'small' })));
    const side = h('div', { class: 'side', style: { width: 'min(460px, 46%)' } }, log, chips,
      h('div', { class: 'chat-input' }, input, button('', submit, { cls: 'icon primary', icon: 'send' })));
    body.append(h('div', { class: 'split' }, left, side));

    panel.addTool(toggle('Wake word', settings.get('wakeWord'), (v) => jarvis.setWakeWord(v)));
    panel.addTool(button('Stop', () => jarvis.stop(), { cls: 'small' }));
    panel.addTool(button('Reset', () => { jarvis.resetConversation(); toast('Conversation cleared'); }, { cls: 'small', icon: 'refresh' }));
    panel.setSub(hasKey() ? `Claude-powered assistant · ${settings.get('model')}` : 'Needs a Claude API key — add it in SYSTEM');

    const renderLog = () => {
      const items = jarvis.log.slice(-60).map((e) => {
        if (e.role === 'tool') return h('div', { class: 'msg-tool' }, `▸ ${e.text.toUpperCase()}`);
        return h('div', { class: `msg ${e.role === 'user' ? 'user' : 'assistant'}${e.error ? ' error' : ''}` },
          h('div', { class: 'who' }, e.role === 'user' ? (settings.get('callsign') || 'YOU').toUpperCase() : 'J.A.R.V.I.S.'),
          h('div', null, e.text || '…'));
      });
      if (!items.length) items.push(h('div', { class: 'muted', style: { padding: '20px' } }, 'Say “Jarvis…” (with the wake word on), tap the talk button, or type a command. Jarvis can open apps, start timers, change the HUD colour, calibrate your hands and answer questions.'));
      log.replaceChildren(...items);
      log.scrollTop = log.scrollHeight;
    };
    const renderState = () => {
      stateEl.textContent = { idle: 'STANDING BY', listening: 'LISTENING', thinking: 'PROCESSING', speaking: 'SPEAKING' }[jarvis.state];
      talk.classList.toggle('on', jarvis.state === 'listening');
    };
    let interim = '';
    const onLog = () => renderLog();
    const onState = () => { renderState(); if (jarvis.state !== 'listening') interim = ''; };
    const onInterim = (e) => { interim = e.detail; stateEl.textContent = `“${interim}”`; };
    jarvis.addEventListener('log', onLog);
    jarvis.addEventListener('state', onState);
    jarvis.addEventListener('interim', onInterim);
    renderLog(); renderState();

    // animated voice core
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, raf = 0, level = 0;
    const unfit = fitCanvas(canvas, (w, hh, dpr) => { W = w; H = hh; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); });
    const C = themeColors();
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      if (!W) return;
      const t = now / 1000;
      const st = jarvis.state;
      const target = st === 'speaking' ? 0.6 + Math.abs(Math.sin(t * 9)) * 0.4 * Math.abs(Math.sin(t * 2.3)) : st === 'listening' ? 0.45 + Math.sin(t * 5) * 0.15 : st === 'thinking' ? 0.35 : 0.15;
      level += (target - level) * 0.15;
      const cx = W / 2, cy = H / 2 - 10, R = Math.min(W, H) * 0.36;
      ctx.clearRect(0, 0, W, H);
      const col = st === 'listening' ? C.ok : C.c;
      // glow
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.75);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.35 + level * 0.5; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 0.75, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      // rings
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
      const spin = t * (st === 'thinking' ? 3 : 0.6);
      ctx.lineWidth = 7;
      for (let i = 0; i < 6; i++) { ctx.globalAlpha = i % 2 ? 0.5 : 1; ctx.beginPath(); ctx.arc(cx, cy, R * 0.86, spin + i * 1.047 + 0.08, spin + i * 1.047 + 0.85); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.62, -spin * 1.6, -spin * 1.6 + 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.62, -spin * 1.6 + 3.14, -spin * 1.6 + 5.14); ctx.stroke();
      // radial voice bars
      const bars = 72;
      ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let i = 0; i < bars; i++) {
        const a = (i / bars) * Math.PI * 2;
        const n = Math.sin(i * 0.7 + t * 6) * 0.5 + Math.sin(i * 1.9 - t * 4.3) * 0.5;
        const len = 6 + Math.max(0, n) * 34 * level;
        ctx.globalAlpha = 0.5 + level * 0.5;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (R + 8), cy + Math.sin(a) * (R + 8)); ctx.lineTo(cx + Math.cos(a) * (R + 8 + len), cy + Math.sin(a) * (R + 8 + len)); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // core
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, R * (0.12 + level * 0.06), 0, 7); ctx.fill();
      ctx.font = `900 ${Math.max(14, R * 0.12)}px Orbitron, sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = C.hi;
      ctx.fillText('J.A.R.V.I.S.', cx, cy + R * 0.42);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf); unfit();
      jarvis.removeEventListener('log', onLog);
      jarvis.removeEventListener('state', onState);
      jarvis.removeEventListener('interim', onInterim);
    };
  },
};
