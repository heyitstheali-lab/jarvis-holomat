// CLAUDE // TALK — chat with Claude by text or voice, replies stream in and can be spoken.
import { h, button, md, toast, glyph } from '../core/ui.js';
import { converse, describeError, hasKey, isAbort, MODELS } from '../core/claude.js';
import { settings, loadJSON, saveJSON } from '../core/store.js';
import { speaker, listenOnce, canListen } from '../core/speech.js';
import { sfx } from '../core/audio.js';

const SYSTEM = `You are Claude, talking with the user through their Holomat — a holographic, hand-tracked interface running on an iPad lying on their desk. Be warm, sharp and genuinely helpful.
Keep answers focused and reasonably concise; the user may be reading on a tabletop display or listening through text-to-speech. Markdown is rendered (bold, lists, code blocks), so use it when it helps clarity.`;

const STARTERS = [
  'What can you help me with on my Holomat?',
  'Explain how hand tracking with a camera works',
  'Give me a mind-blowing science fact',
  'Help me plan a weekend electronics project',
];

export default {
  mount({ body, panel }) {
    let messages = loadJSON('chat.messages', []);
    let display = loadJSON('chat.display', []);
    let speak = loadJSON('chat.speak', false);
    let ctrl = null;
    let pending = null;

    const log = h('div', { class: 'chat-log scroll', 'data-scroll': '' });
    const input = h('textarea', { class: 'hinput', rows: 1, placeholder: hasKey() ? 'Message Claude…' : 'Add your Claude API key in SYSTEM first', enterkeyhint: 'send' });
    const sendBtn = button('', () => send(), { cls: 'icon primary', icon: 'send', title: 'Send' });
    const micBtn = button('', () => dictate(), { cls: 'icon', icon: 'mic', title: 'Speak' });
    const stopBtn = button('Stop', () => ctrl?.abort(), { cls: 'small danger' });
    stopBtn.style.display = 'none';
    if (!canListen) micBtn.style.display = 'none';
    const chips = h('div', { class: 'chips' });
    body.append(h('div', { class: 'chat-wrap' }, log, chips, h('div', { class: 'chat-input' }, input, stopBtn, micBtn, sendBtn)));

    const speakBtn = panel.addTool(button(speak ? 'Voice on' : 'Voice off', () => {
      speak = !speak; saveJSON('chat.speak', speak);
      speakBtn.classList.toggle('on', speak);
      speakBtn.querySelector('span').textContent = speak ? 'Voice on' : 'Voice off';
      if (!speak) speaker.stop();
    }, { cls: 'small' + (speak ? ' on' : ''), icon: 'speaker' }));
    panel.addTool(button('New chat', () => {
      ctrl?.abort(); speaker.stop();
      messages = []; display = []; persist(); render();
    }, { cls: 'small', icon: 'plus' }));
    const modelName = () => MODELS.find((m) => m.id === settings.get('model'))?.label || settings.get('model');
    panel.setSub(`Claude ${modelName()} · voice ${canListen ? 'in/out' : 'out'}`);

    const persist = () => { saveJSON('chat.messages', messages); saveJSON('chat.display', display.slice(-200)); };

    const bubble = (d) => {
      const el = h('div', { class: `msg ${d.role}${d.error ? ' error' : ''}` },
        h('div', { class: 'who' }, d.role === 'user' ? 'YOU' : 'CLAUDE'));
      const content = h('div');
      if (d.role === 'user') content.textContent = d.text; else content.innerHTML = md(d.text || '') + (d.streaming ? '<span class="cursor-blink"></span>' : '');
      el.append(content);
      el._content = content;
      return el;
    };
    const render = () => {
      log.replaceChildren(...display.map(bubble));
      chips.replaceChildren();
      if (!display.length) {
        log.append(h('div', { class: 'center-fill muted' }, glyph('claude', 'hc-glyph'), h('div', { class: 'hud-font', style: { color: 'var(--c-hi)' } }, 'CLAUDE ONLINE'), h('div', null, hasKey() ? 'Type, or tap the mic and talk.' : 'Add your Claude API key in SYSTEM to start.')));
        for (const s of STARTERS) chips.append(button(s, () => send(s), { cls: 'small' }));
      }
      log.scrollTop = log.scrollHeight;
    };
    render();

    const autosize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(160, input.scrollHeight)}px`; };
    input.addEventListener('input', autosize);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

    async function dictate() {
      speaker.stop();
      micBtn.classList.add('on');
      const rec = listenOnce({ onInterim: (t) => { input.value = t; autosize(); } });
      micBtn.onclick = () => rec.stop();
      try {
        const text = await rec.promise;
        if (text) { input.value = text; send(); }
      } catch (e) { toast(e.message, 'bad'); }
      finally { micBtn.classList.remove('on'); micBtn.onclick = null; }
    }

    async function send(text = input.value) {
      text = String(text).trim();
      if (!text) return;
      if (!hasKey()) { toast('Add your Claude API key in SYSTEM first', 'warn'); return; }
      if (ctrl) { ctrl.abort(); await pending?.catch(() => {}); }
      input.value = ''; autosize();
      speaker.stop();
      sfx.click();
      display.push({ role: 'user', text });
      messages.push({ role: 'user', content: text });
      const d = { role: 'assistant', text: '', streaming: true };
      display.push(d);
      render();
      const el = log.lastElementChild;
      const sp = speak ? speaker.stream() : null;
      ctrl = new AbortController();
      const mine = ctrl;
      stopBtn.style.display = '';
      let raf = 0;
      const paint = () => { raf = 0; el._content.innerHTML = md(d.text) + '<span class="cursor-blink"></span>'; log.scrollTop = log.scrollHeight; };
      try {
        pending = converse({
          system: SYSTEM, messages, effort: 'medium', maxTokens: 32000,
          webSearch: settings.get('webSearch'), signal: mine.signal,
          onText: (t) => { d.text += t; sp && sp.push(t); if (!raf) raf = requestAnimationFrame(paint); },
        });
        const res = await pending;
        sp && sp.end();
        if (res.refused) d.text += (d.text ? '\n\n' : '') + '_Claude declined to continue this request._';
      } catch (e) {
        if (!isAbort(e)) { d.text = describeError(e); d.error = true; sfx.error(); }
        else d.text += d.text ? '\n\n_(stopped)_' : '_(stopped)_';
      } finally {
        d.streaming = false;
        if (ctrl === mine) { ctrl = null; stopBtn.style.display = 'none'; }
        persist();
        const idx = display.indexOf(d);
        if (idx >= 0 && el.isConnected) el.replaceWith(bubble(d));
        log.scrollTop = log.scrollHeight;
      }
    }

    return () => { ctrl?.abort(); };
  },
};
