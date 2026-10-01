// SYSTEM — Claude API key, hand tracking, voice, theme, install help.
import { settings, clearAllData } from '../core/store.js';
import { h, button, segmented, toggle, slider, field, toast, confirmBox, glyph } from '../core/ui.js';
import { MODELS, testKey, describeError, hasKey } from '../core/claude.js';
import { hand } from '../core/hand.js';
import { runCalibration } from '../core/calibration.js';
import { listVoices, speaker, canListen, canSpeak } from '../core/speech.js';
import { jarvis, THEMES } from '../core/jarvis.js';
import { isStandalone, isIOS } from '../core/device.js';

export default {
  mount({ body, panel }) {
    const wrap = h('div', { class: 'scroll', 'data-scroll': '', style: { flex: '1', padding: '6px 22px 30px' } });
    const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '6px 34px' } });
    wrap.append(grid);
    body.append(wrap);
    const col = () => { const c = h('div'); grid.append(c); return c; };
    const unsubs = [];

    // ------------------------------------------------ Claude
    const c1 = col();
    c1.append(h('div', { class: 'section-title' }, 'Claude uplink'));
    const keyStatus = h('span', { class: 'badge' + (hasKey() ? ' ok' : ' warn') }, hasKey() ? 'KEY STORED' : 'NO KEY');
    const keyInput = h('input', { class: 'hinput', type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, value: settings.get('apiKey') || '' });
    const saveKey = () => {
      settings.set('apiKey', keyInput.value.trim());
      keyStatus.textContent = hasKey() ? 'KEY STORED' : 'NO KEY';
      keyStatus.className = 'badge' + (hasKey() ? ' ok' : ' warn');
    };
    keyInput.addEventListener('change', saveKey);
    c1.append(field('Anthropic API key', h('div', { class: 'col' }, keyInput,
      h('div', { class: 'row' },
        button('Save', () => { saveKey(); toast(hasKey() ? 'API key saved on this iPad' : 'API key cleared', hasKey() ? 'ok' : 'info'); }, { cls: 'primary small' }),
        button('Test', async () => {
          saveKey();
          keyStatus.textContent = 'TESTING…'; keyStatus.className = 'badge';
          try { const name = await testKey(); keyStatus.textContent = 'ONLINE'; keyStatus.className = 'badge ok'; toast(`Connected · ${name}`, 'ok'); }
          catch (e) { keyStatus.textContent = 'FAILED'; keyStatus.className = 'badge bad'; toast(describeError(e), 'bad', 6000); }
        }, { cls: 'small' }),
        button('Show', (e) => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; e.currentTarget.querySelector('span').textContent = keyInput.type === 'password' ? 'Show' : 'Hide'; }, { cls: 'small' }),
        keyStatus),
      h('div', { class: 'muted', style: { fontSize: '14px' } }, 'Get a key at console.anthropic.com. It is stored only on this device and sent only to api.anthropic.com.'))));
    c1.append(field('Model', segmented(MODELS.map((m) => ({ value: m.id, label: m.label })), settings.get('model'), (v) => settings.set('model', v))));
    const callsign = h('input', { class: 'hinput', value: settings.get('callsign'), maxlength: 24 });
    callsign.addEventListener('change', () => { settings.set('callsign', callsign.value.trim() || 'Sir'); jarvis.resetConversation(); });
    c1.append(field('Jarvis calls you', callsign));
    c1.append(toggle('Web search', settings.get('webSearch'), (v) => settings.set('webSearch', v), 'Lets Jarvis look up news, weather and live facts'));

    // ------------------------------------------------ Voice
    c1.append(h('div', { class: 'section-title' }, 'Voice'));
    c1.append(toggle('Jarvis speaks', settings.get('voiceEnabled'), (v) => { settings.set('voiceEnabled', v); if (!v) speaker.stop(); }, canSpeak ? 'Uses the iPad’s built-in voices — no ElevenLabs' : 'Speech synthesis not available'));
    const wake = toggle('Wake word “Jarvis”', settings.get('wakeWord'), (v) => { if (!jarvis.setWakeWord(v)) wake.setValue(false); }, canListen ? 'Keeps the microphone listening while the Holomat is open' : 'Speech recognition not available in this browser');
    c1.append(wake);
    const rateRow = field('Speech rate', null, `${settings.get('speechRate').toFixed(2)}×`);
    rateRow.append(slider({ min: 0.7, max: 1.4, step: 0.05, value: settings.get('speechRate'), onInput: (v) => rateRow.setValueText(`${v.toFixed(2)}×`), onChange: (v) => settings.set('speechRate', v) }));
    c1.append(rateRow);
    const voiceList = h('div', { class: 'seg', style: { maxHeight: '200px', overflowY: 'auto' }, 'data-scroll': '' });
    const renderVoices = () => {
      const vs = listVoices();
      voiceList.replaceChildren();
      const cur = settings.get('voiceName');
      const auto = h('button', { class: 'hbtn small' + (!cur ? ' on' : ''), type: 'button' }, 'AUTO (British)');
      auto.addEventListener('click', () => { settings.set('voiceName', ''); renderVoices(); speaker.say(`Voice set to automatic, ${settings.get('callsign')}.`); });
      voiceList.append(auto);
      for (const v of vs.slice(0, 40)) {
        const b = h('button', { class: 'hbtn small' + (cur === v.name ? ' on' : ''), type: 'button', title: v.lang }, `${v.name} · ${v.lang}`);
        b.addEventListener('click', () => { settings.set('voiceName', v.name); renderVoices(); speaker.say(`This is how I sound now, ${settings.get('callsign')}.`); });
        voiceList.append(b);
      }
    };
    renderVoices();
    setTimeout(renderVoices, 800);
    c1.append(field('Voice', voiceList));
    c1.append(h('div', { class: 'row', style: { marginTop: '10px' } }, button('Test voice', () => speaker.say(`All systems nominal, ${settings.get('callsign')}. Holomat voice check complete.`), { icon: 'speaker' })));

    // ------------------------------------------------ Hand tracking
    const c2 = col();
    c2.append(h('div', { class: 'section-title' }, 'Hand tracking · on-device'));
    const status = h('div', { class: 'mono', style: { fontSize: '14px', color: 'var(--c)', padding: '6px 0' } });
    const renderStatus = () => {
      const cal = hand.activeCalibration();
      status.textContent = `${hand.statusText.toUpperCase()}${hand.running ? ` · ${Math.round(hand.fps)} FPS · ${Math.round(hand.inferMs)} MS` : ''} · CALIBRATION ${cal ? 'LOCKED' : settings.get('calibration') ? 'OTHER ORIENTATION' : 'DEFAULT'}`;
    };
    renderStatus();
    const st = setInterval(renderStatus, 500);
    unsubs.push(() => clearInterval(st));
    c2.append(status);
    const trackT = toggle('Hand tracking', hand.running, async (v) => {
      settings.set('tracking', v);
      if (v) { try { await hand.start(); } catch (e) { toast(e.message, 'bad'); trackT.setValue(false); } }
      else hand.stop();
    }, 'MediaPipe hand landmarks, processed on the iPad CPU');
    c2.append(trackT);
    c2.append(h('div', { class: 'row', style: { padding: '8px 0' } },
      button('Calibrate hands', () => { panel.close(); runCalibration(); }, { icon: 'hand', cls: 'primary' }),
      button('Clear calibration', () => { settings.set('calibration', null); toast('Calibration cleared'); }, { cls: 'small' })));
    c2.append(field('Camera', segmented([{ value: 'user', label: 'Front' }, { value: 'environment', label: 'Rear / overhead' }], settings.get('facingMode'), (v) => settings.set('facingMode', v))));
    c2.append(field('Processor', segmented([{ value: 'CPU', label: 'CPU (default)' }, { value: 'GPU', label: 'GPU' }], settings.get('delegate'), (v) => settings.set('delegate', v))));
    c2.append(field('Hands', segmented([{ value: 1, label: 'One' }, { value: 2, label: 'Two' }], settings.get('maxHands'), (v) => settings.set('maxHands', v))));
    c2.append(field('Tap gesture', segmented([{ value: 'both', label: 'Pinch + dwell' }, { value: 'pinch', label: 'Pinch only' }, { value: 'dwell', label: 'Dwell only' }], settings.get('clickMode'), (v) => settings.set('clickMode', v))));
    const dwellRow = field('Dwell time', null, `${settings.get('dwellMs')} ms`);
    dwellRow.append(slider({ min: 500, max: 2000, step: 50, value: settings.get('dwellMs'), onInput: (v) => dwellRow.setValueText(`${v} ms`), onChange: (v) => settings.set('dwellMs', v) }));
    c2.append(dwellRow);
    const smoothRow = field('Smoothing', null, `${Math.round(settings.get('smoothing') * 100)}%`);
    smoothRow.append(slider({ min: 0, max: 1, step: 0.05, value: settings.get('smoothing'), onInput: (v) => smoothRow.setValueText(`${Math.round(v * 100)}%`), onChange: (v) => settings.set('smoothing', v) }));
    c2.append(smoothRow);
    c2.append(h('div', { class: 'muted mono', style: { fontSize: '13px', padding: '8px 0' } }, `Pinch thresholds: on < ${settings.get('pinchOn')} · off > ${settings.get('pinchOff')} (set by calibration)`));
    c2.append(toggle('Show hand skeleton', settings.get('showSkeleton'), (v) => settings.set('showSkeleton', v)));
    c2.append(toggle('Show camera monitor', settings.get('showMonitor'), (v) => settings.set('showMonitor', v)));
    c2.append(toggle('Mirror (uncalibrated)', settings.get('mirror'), (v) => settings.set('mirror', v), 'Flip left/right when no calibration is stored'));

    // ------------------------------------------------ Display
    const c3 = col();
    c3.append(h('div', { class: 'section-title' }, 'Display & sound'));
    const sw = h('div', { class: 'row' });
    for (const [name, hue] of Object.entries(THEMES)) {
      const b = h('button', { class: 'hbtn small', type: 'button', style: { borderColor: `hsl(${hue} 100% 60%)`, color: `hsl(${hue} 100% 75%)` } }, name);
      b.addEventListener('click', () => settings.set('hue', hue));
      sw.append(b);
    }
    c3.append(field('HUD colour', sw));
    c3.append(toggle('Sound effects', settings.get('sfx'), (v) => settings.set('sfx', v)));

    c3.append(h('div', { class: 'section-title' }, 'Install on iPad'));
    c3.append(h('div', { style: { fontSize: '16px', lineHeight: '1.45' } },
      isStandalone() ? h('div', { class: 'badge ok' }, 'RUNNING AS INSTALLED APP') : h('div', { class: 'badge warn' }, isIOS() ? 'RUNNING IN SAFARI' : 'RUNNING IN BROWSER'),
      h('ol', { style: { paddingLeft: '20px' } },
        h('li', null, 'Open the Holomat link in Safari.'),
        h('li', null, 'Tap the Share button, then “Add to Home Screen”.'),
        h('li', null, 'Launch Holomat from the Home Screen for full-screen mode. Allow the camera when asked.')),
      h('div', { class: 'muted' }, 'Everything except Claude runs offline on the iPad once installed.')));

    c3.append(h('div', { class: 'section-title' }, 'Data'));
    c3.append(h('div', { class: 'row' },
      button('Reset Jarvis memory', () => { jarvis.forgetMemories(); jarvis.resetConversation(); toast('Jarvis memory cleared'); }, { cls: 'small' }),
      button('Reset settings', async () => { if (await confirmBox('RESET SETTINGS', 'Restore default settings? Your API key is kept.')) { settings.reset(); panel.close(); toast('Settings restored'); } }, { cls: 'small' }),
      button('Erase everything', async () => {
        if (await confirmBox('ERASE ALL DATA', 'Delete the API key, calibration, saved circuits, chats and scores from this iPad?', 'Erase')) {
          clearAllData(); location.reload();
        }
      }, { cls: 'small danger' })));
    c3.append(h('div', { class: 'muted mono', style: { fontSize: '12px', marginTop: '22px', display: 'flex', gap: '8px', alignItems: 'center' } }, glyph('jarvis', 'gi'), 'J.A.R.V.I.S. HOLOMAT 1.0 · CLAUDE API · MEDIAPIPE · THREE.JS'));

    return () => unsubs.forEach((f) => f());
  },
};
