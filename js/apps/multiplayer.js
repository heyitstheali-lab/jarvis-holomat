// MULTIPLAYER LINK — play another Holomat online (peer-to-peer WebRTC via PeerJS;
// share a 5-letter room code) or two players on the same table.
import { h, button, glyph, toast } from '../core/ui.js';
import { sfx } from '../core/audio.js';
import { stage, pointerTracker, loop, Particles, themeColors, glowText } from './game-kit.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREFIX = 'jarvis-holomat-';
const GAMES = [
  { id: 'tictactoe', title: 'TIC-TAC-TOE', icon: 'grid', desc: 'Classic 3×3. Host plays X.' },
  { id: 'connect4', title: 'CONNECT FOUR', icon: 'games', desc: 'Drop discs, line up four.' },
  { id: 'hockey', title: 'AIR HOCKEY', icon: 'target', desc: 'Real-time. Your hand is the striker.' },
];

export default {
  mount({ body, panel, opts }) {
    let peer = null, conn = null, game = null, role = null, pingT = null, rtt = 0;
    const statusEl = h('span', { class: 'badge' }, 'OFFLINE');
    panel.addTool(statusEl);
    const leaveBtn = panel.addTool(button('Leave', () => { teardown(); lobby(); }, { cls: 'small danger' }));
    leaveBtn.style.display = 'none';
    const setStatus = (t, cls = '') => { statusEl.textContent = t; statusEl.className = `badge ${cls}`; };

    const send = (msg) => { if (conn && conn.open) conn.send(msg); };
    const teardown = () => {
      clearInterval(pingT); pingT = null;
      game?.destroy(); game = null;
      try { conn?.close(); } catch {}
      try { peer?.destroy(); } catch {}
      conn = null; peer = null; role = null;
      leaveBtn.style.display = 'none';
      setStatus('OFFLINE');
    };

    async function loadPeer() {
      const { Peer } = await import('../../vendor/peerjs/peerjs.mjs');
      return Peer;
    }

    // ---------------------------------------------------------------- lobby
    function lobby() {
      panel.setSub('Online peer-to-peer · or two players at one table');
      const card = (icon, title, desc, fn) => {
        const c = h('div', { class: 'hcard', 'data-click': '' }, glyph(icon, 'hc-glyph'), h('div', { class: 'hc-title' }, title), h('div', { class: 'hc-desc' }, desc));
        c.addEventListener('click', fn);
        return c;
      };
      body.replaceChildren(h('div', { class: 'scroll', 'data-scroll': '', style: { flex: '1' } }, h('div', { class: 'card-grid' },
        card('multiplayer', 'HOST ONLINE', 'Create a room and share the code with a friend on another Holomat (or any browser).', host),
        card('link', 'JOIN ONLINE', 'Enter a friend’s 5-character room code to connect.', join),
        card('hand', 'SAME TABLE', 'Two players on this iPad — take turns, or one hand each for air hockey.', () => pickGame('local')))));
    }

    // ---------------------------------------------------------------- host
    async function host() {
      teardown();
      const code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
      const codeEl = h('div', { class: 'code-display' }, code);
      const msg = h('div', { class: 'muted', style: { fontSize: '18px' } }, 'Connecting to the matchmaking server…');
      body.replaceChildren(h('div', { class: 'center-fill' }, h('div', { class: 'hud-font', style: { color: 'var(--c)' } }, 'ROOM CODE'), codeEl, msg,
        button('Cancel', () => { teardown(); lobby(); }, { cls: 'small' })));
      leaveBtn.style.display = '';
      setStatus('HOSTING…');
      try {
        const Peer = await loadPeer();
        peer = new Peer(PREFIX + code, { debug: 1 });
      } catch (e) { msg.textContent = `Could not start networking: ${e.message}`; return; }
      peer.on('open', () => { msg.textContent = 'Waiting for an opponent to join with this code…'; setStatus('WAITING', 'warn'); });
      peer.on('error', (err) => {
        if (err.type === 'unavailable-id') { host(); return; }
        msg.textContent = netError(err); setStatus('ERROR', 'bad'); sfx.error();
      });
      peer.on('connection', (c) => {
        if (conn) { c.on('open', () => { c.send({ t: 'busy' }); setTimeout(() => c.close(), 300); }); return; }
        conn = c; role = 'host';
        c.on('open', () => { wire(); sfx.success(); toast('Opponent connected', 'ok'); pickGame('host'); });
      });
    }

    // ---------------------------------------------------------------- join
    function join() {
      teardown();
      let code = '';
      const disp = h('div', { class: 'code-display' }, '·····');
      const msg = h('div', { class: 'muted', style: { fontSize: '17px', minHeight: '1.4em' } }, 'Enter the room code shown on the host’s screen');
      const upd = () => { disp.textContent = (code + '·····').slice(0, 5); };
      const pad = h('div', { class: 'keypad' });
      for (const ch of CODE_CHARS) pad.append(button(ch, () => { if (code.length < 5) { code += ch; upd(); } }));
      pad.append(button('⌫', () => { code = code.slice(0, -1); upd(); }, { cls: 'danger' }));
      pad.append(button('GO', () => connect(), { cls: 'primary' }));
      const connect = async () => {
        if (code.length !== 5) { toast('Room codes have 5 characters', 'warn'); return; }
        msg.textContent = 'Connecting…'; setStatus('CONNECTING', 'warn');
        try {
          const Peer = await loadPeer();
          peer = new Peer(undefined, { debug: 1 });
        } catch (e) { msg.textContent = `Could not start networking: ${e.message}`; return; }
        leaveBtn.style.display = '';
        peer.on('error', (err) => { msg.textContent = netError(err); setStatus('ERROR', 'bad'); sfx.error(); });
        peer.on('open', () => {
          conn = peer.connect(PREFIX + code, { reliable: true });
          role = 'guest';
          conn.on('open', () => { wire(); sfx.success(); waitForHost(); });
        });
      };
      body.replaceChildren(h('div', { class: 'center-fill' }, disp, msg, pad));
    }

    function waitForHost() {
      panel.setSub('Connected · waiting for the host to pick a game');
      body.replaceChildren(h('div', { class: 'center-fill' }, glyph('multiplayer', 'hc-glyph'), h('div', { class: 'hud-font', style: { color: 'var(--c-hi)', fontSize: '20px' } }, 'LINK ESTABLISHED'), h('div', { class: 'muted' }, 'The host is choosing a game…')));
    }

    function netError(err) {
      const t = err?.type;
      if (t === 'peer-unavailable') return 'No room with that code — check it and try again.';
      if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Cannot reach the matchmaking server. Check the internet connection.';
      if (t === 'browser-incompatible') return 'This browser does not support WebRTC.';
      return `Network error: ${err?.message || t}`;
    }

    function wire() {
      leaveBtn.style.display = '';
      setStatus('LINKED', 'ok');
      conn.on('data', (m) => {
        if (!m || typeof m !== 'object') return;
        if (m.t === 'ping') { send({ t: 'pong', at: m.at }); return; }
        if (m.t === 'pong') { rtt = Math.round(performance.now() - m.at); setStatus(`LINKED · ${rtt}MS`, 'ok'); return; }
        if (m.t === 'busy') { toast('That room is already full', 'bad'); teardown(); lobby(); return; }
        if (m.t === 'start') { startGame(m.game, 'guest'); return; }
        if (m.t === 'lobby') { game?.destroy(); game = null; waitForHost(); return; }
        game?.onMessage(m);
      });
      conn.on('close', () => { if (conn) { toast('Opponent disconnected', 'warn'); teardown(); lobby(); } });
      conn.on('error', () => {});
      pingT = setInterval(() => send({ t: 'ping', at: performance.now() }), 2000);
    }

    // ---------------------------------------------------------------- game select
    function pickGame(mode) {
      game?.destroy(); game = null;
      panel.setSub(mode === 'local' ? 'Same table · pick a game' : 'Opponent connected · pick a game');
      const grid = h('div', { class: 'card-grid' });
      for (const g of GAMES) {
        const c = h('div', { class: 'hcard', 'data-click': '' }, glyph(g.icon, 'hc-glyph'), h('div', { class: 'hc-title' }, g.title), h('div', { class: 'hc-desc' }, g.desc));
        c.addEventListener('click', () => { if (mode === 'host') send({ t: 'start', game: g.id }); startGame(g.id, mode); });
        grid.append(c);
      }
      body.replaceChildren(h('div', { class: 'scroll', 'data-scroll': '', style: { flex: '1' } }, grid));
    }

    function startGame(id, mode) {
      game?.destroy();
      body.replaceChildren();
      const g = GAMES.find((x) => x.id === id);
      panel.setSub(`${g.title} · ${mode === 'local' ? 'same table' : mode === 'host' ? 'you are player 1' : 'you are player 2'}`);
      const back = () => { if (mode === 'host') { send({ t: 'lobby' }); pickGame('host'); } else if (mode === 'local') pickGame('local'); };
      const ctx = { container: body, mode, send, back };
      game = id === 'tictactoe' ? ticTacToe(ctx) : id === 'connect4' ? connectFour(ctx) : airHockey(ctx);
    }

    if (opts.item && GAMES.some((g) => g.id === opts.item)) startGame(opts.item, 'local'); else lobby();
    return () => teardown();
  },
};

// ------------------------------------------------------------------ turn-based helper
function turnGame({ container, mode, send, back }, { title, me0, render, applyMove, winner, reset }) {
  // mode: local → both sides on this device; host → plays side 0, moves first in odd rounds
  let round = 0, turn = 0, over = false;
  const mySide = mode === 'host' ? 0 : mode === 'guest' ? 1 : null;
  const info = h('div', { class: 'hud-font', style: { fontSize: '18px', color: 'var(--c-hi)', minHeight: '1.4em', textAlign: 'center' } });
  const area = h('div', { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', flex: '1', minHeight: '0', width: '100%' } });
  const controls = h('div', { class: 'row', style: { justifyContent: 'center' } });
  container.append(h('div', { class: 'center-fill', style: { gap: '14px' } }, info, area, controls));
  const canMove = () => !over && (mode === 'local' || turn === mySide);
  const status = () => {
    const w = winner();
    if (w !== null) {
      over = true;
      const txt = w === 'draw' ? 'DRAW' : mode === 'local' ? `${me0[w]} WINS` : w === mySide ? 'YOU WIN' : 'YOU LOSE';
      info.textContent = txt;
      w === 'draw' ? sfx.click() : (mode === 'local' || w === mySide) ? sfx.success() : sfx.error();
      controls.replaceChildren(button('Rematch', () => { if (mode !== 'local') send({ t: 'rematch' }); restart(); }, { cls: 'primary big' }), mode !== 'guest' ? button('Games', back, { cls: 'big' }) : null);
    } else {
      info.textContent = mode === 'local' ? `${me0[turn]} TO MOVE` : turn === mySide ? `YOUR MOVE (${me0[mySide]})` : `OPPONENT’S MOVE (${me0[1 - mySide]})`;
      controls.replaceChildren(mode === 'host' || mode === 'local' ? button('Games', back, { cls: 'small' }) : null);
    }
  };
  const restart = () => { round++; turn = round % 2; over = false; reset(); area.replaceChildren(render(tryMove)); status(); };
  function tryMove(move) {
    if (!canMove()) { sfx.error(); return; }
    if (!applyMove(move, turn)) return;
    sfx.click();
    if (mode !== 'local') send({ t: 'move', move });
    turn = 1 - turn;
    area.replaceChildren(render(tryMove));
    status();
  }
  reset();
  area.append(render(tryMove));
  status();
  return {
    onMessage(m) {
      if (m.t === 'move' && !over && turn !== mySide) {
        if (applyMove(m.move, turn)) { turn = 1 - turn; sfx.tick(); area.replaceChildren(render(tryMove)); status(); }
      } else if (m.t === 'rematch') restart();
    },
    destroy() {},
  };
}

function ticTacToe(ctx) {
  let b;
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  return turnGame(ctx, {
    me0: ['X', 'O'],
    reset: () => { b = Array(9).fill(null); },
    applyMove: (i, side) => { if (typeof i !== 'number' || b[i] !== null) return false; b[i] = side; return true; },
    winner: () => {
      for (const [a, c, d] of LINES) if (b[a] !== null && b[a] === b[c] && b[a] === b[d]) return b[a];
      return b.every((x) => x !== null) ? 'draw' : null;
    },
    render: (move) => {
      const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', width: 'min(460px, 80vw, 58vh)' } });
      b.forEach((v, i) => {
        const cell = h('button', { class: 'hcard', type: 'button', style: { aspectRatio: '1', minHeight: '0', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-hud)', fontSize: 'clamp(40px, 9vmin, 84px)', fontWeight: '900', color: v === 0 ? 'var(--c-hi)' : '#ffc14d', textShadow: '0 0 18px currentColor' } }, v === null ? '' : v === 0 ? 'X' : 'O');
        cell.addEventListener('click', () => move(i));
        grid.append(cell);
      });
      return grid;
    },
  });
}

function connectFour(ctx) {
  const COLS = 7, ROWS = 6;
  let b;
  const at = (c, r) => (b[c] ? b[c][r] : undefined);
  return turnGame(ctx, {
    me0: ['CYAN', 'GOLD'],
    reset: () => { b = Array.from({ length: COLS }, () => []); },
    applyMove: (c, side) => { if (typeof c !== 'number' || c < 0 || c >= COLS || b[c].length >= ROWS) return false; b[c].push(side); return true; },
    winner: () => {
      const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
      for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
        const v = at(c, r); if (v === undefined) continue;
        for (const [dc, dr] of dirs) {
          let k = 1;
          while (k < 4 && at(c + dc * k, r + dr * k) === v) k++;
          if (k === 4) return v;
        }
      }
      return b.every((col) => col.length >= ROWS) ? 'draw' : null;
    },
    render: (move) => {
      const grid = h('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: '8px', width: 'min(720px, 92vw, 92vh)' } });
      for (let c = 0; c < COLS; c++) {
        const col = h('button', { class: 'hcard', type: 'button', style: { minHeight: '0', padding: '8px 4px', gap: '8px', display: 'flex', flexDirection: 'column-reverse', alignItems: 'center' } });
        for (let r = 0; r < ROWS; r++) {
          const v = b[c][r];
          col.append(h('div', { style: { width: '100%', aspectRatio: '1', borderRadius: '50%', border: '2px solid var(--c-a35)', background: v === 0 ? 'var(--c)' : v === 1 ? '#ffc14d' : 'transparent', boxShadow: v === undefined ? 'none' : '0 0 14px currentColor', color: v === 0 ? 'var(--c)' : '#ffc14d' } }));
        }
        col.addEventListener('click', () => move(c));
        grid.append(col);
      }
      return grid;
    },
  });
}

// ------------------------------------------------------------------ air hockey (real-time)
function airHockey({ container, mode, send, back }) {
  const st = stage(container);
  const input = pointerTracker(st.canvas);
  const C = themeColors();
  const fx = new Particles();
  const TW = 1.6, TH = 1, PR = 0.065, KR = 0.035, GOAL = 0.36, WIN = 7;
  // world: side 0 defends x=0 (left), side 1 defends x=TW (right)
  const S = { puck: { x: TW / 2, y: TH / 2, vx: 0, vy: 0 }, pads: [{ x: 0.2, y: 0.5, vx: 0, vy: 0 }, { x: TW - 0.2, y: 0.5, vx: 0, vy: 0 }], score: [0, 0], over: false, serveT: 1 };
  const remote = { x: TW - 0.2, y: 0.5 };
  const sim = mode !== 'guest';
  const flip = mode === 'guest'; // the guest sees the table rotated so they are on the left too
  let sendT = 0;
  const info = h('div', { class: 'gh-small' }, mode === 'local' ? 'LEFT HALF · PLAYER 1     RIGHT HALF · PLAYER 2' : 'DEFEND THE LEFT GOAL');
  st.hud.append(h('div', null, info));

  const view = () => {
    const s = Math.min((st.w - 40) / TW, (st.h - 60) / TH);
    return { s, ox: (st.w - TW * s) / 2, oy: (st.h - TH * s) / 2 + 14 };
  };
  const toWorld = (px, py) => {
    const v = view();
    let x = (px - v.ox) / v.s, y = (py - v.oy) / v.s;
    if (flip) { x = TW - x; y = TH - y; }
    return [x, y];
  };
  const clampPad = (p, side) => {
    p.x = Math.max(side === 0 ? PR : TW / 2 + PR, Math.min(side === 0 ? TW / 2 - PR : TW - PR, p.x));
    p.y = Math.max(PR, Math.min(TH - PR, p.y));
  };
  const movePad = (side, tx, ty, dt) => {
    const p = S.pads[side];
    const ox = p.x, oy = p.y;
    p.x += (tx - p.x) * Math.min(1, dt * 30); p.y += (ty - p.y) * Math.min(1, dt * 30);
    clampPad(p, side);
    p.vx = (p.x - ox) / Math.max(dt, 1e-3); p.vy = (p.y - oy) / Math.max(dt, 1e-3);
  };
  const resetPuck = (towards) => { Object.assign(S.puck, { x: TW / 2 + (towards === 0 ? -0.15 : 0.15), y: TH / 2, vx: 0, vy: 0 }); S.serveT = 0.8; };

  const stopLoop = loop((dt) => {
    if (!st.w) return;
    // ---- input
    const pts = input.all();
    if (mode === 'local') {
      for (const side of [0, 1]) {
        const p = pts.filter((q) => (toWorld(q.x, q.y)[0] < TW / 2) === (side === 0)).sort((a, b) => b.t - a.t)[0];
        if (p) { const [x, y] = toWorld(p.x, p.y); movePad(side, x, y, dt); }
      }
    } else {
      const p = input.latest();
      const me = mode === 'host' ? 0 : 1;
      if (p) { const [x, y] = toWorld(p.x, p.y); if (sim) movePad(me, x, y, dt); else { remote.x = x; remote.y = y; clampPad(remote, 1); } }
      if (sim) movePad(1, remote.x, remote.y, dt);
      else { S.pads[1].x = remote.x; S.pads[1].y = remote.y; } // guest: own striker is local & instant
      sendT -= dt;
      if (sendT <= 0) {
        sendT = 1 / 30;
        if (mode === 'host') send({ t: 'st', p: [S.puck.x, S.puck.y, S.puck.vx, S.puck.vy], a: [S.pads[0].x, S.pads[0].y], b: [S.pads[1].x, S.pads[1].y], s: S.score, o: S.over });
        else send({ t: 'pad', x: remote.x, y: remote.y });
      }
    }
    // ---- physics (host / local only)
    if (sim && !S.over) {
      const k = S.puck;
      if (S.serveT > 0) S.serveT -= dt;
      else {
        const steps = 4;
        for (let i = 0; i < steps; i++) {
          const h2 = dt / steps;
          k.x += k.vx * h2; k.y += k.vy * h2;
          if (k.y < KR) { k.y = KR; k.vy = Math.abs(k.vy); }
          if (k.y > TH - KR) { k.y = TH - KR; k.vy = -Math.abs(k.vy); }
          const inGoalMouth = Math.abs(k.y - TH / 2) < GOAL / 2;
          if (k.x < KR && !inGoalMouth) { k.x = KR; k.vx = Math.abs(k.vx); sfx.tick(); }
          if (k.x > TW - KR && !inGoalMouth) { k.x = TW - KR; k.vx = -Math.abs(k.vx); sfx.tick(); }
          for (const p of S.pads) {
            const dx = k.x - p.x, dy = k.y - p.y, d = Math.hypot(dx, dy);
            if (d < PR + KR && d > 1e-6) {
              const nx = dx / d, ny = dy / d;
              k.x = p.x + nx * (PR + KR); k.y = p.y + ny * (PR + KR);
              const rel = (k.vx - p.vx) * nx + (k.vy - p.vy) * ny;
              if (rel < 0) { k.vx -= 1.9 * rel * nx; k.vy -= 1.9 * rel * ny; }
              k.vx += p.vx * 0.25; k.vy += p.vy * 0.25;
              sfx.hit();
            }
          }
          const sp = Math.hypot(k.vx, k.vy), max = 3.2;
          if (sp > max) { k.vx *= max / sp; k.vy *= max / sp; }
        }
        k.vx *= 0.997; k.vy *= 0.997;
        if (k.x < -KR || k.x > TW + KR) {
          const scorer = k.x < 0 ? 1 : 0;
          S.score[scorer]++;
          sfx.score();
          if (S.score[scorer] >= WIN) S.over = true;
          resetPuck(scorer);
        }
      }
    }
    fx.update(dt);
    draw();
  });

  let goalFlash = 0, lastScore = '0-0';
  function draw() {
    const { ctx, w, h: hh } = st;
    const v = view();
    const P = (x, y) => (flip ? [v.ox + (TW - x) * v.s, v.oy + (TH - y) * v.s] : [v.ox + x * v.s, v.oy + y * v.s]);
    ctx.clearRect(0, 0, w, hh);
    // table
    ctx.strokeStyle = C.c; ctx.lineWidth = 3; ctx.shadowColor = C.c; ctx.shadowBlur = 12;
    ctx.strokeRect(v.ox, v.oy, TW * v.s, TH * v.s);
    ctx.shadowBlur = 0;
    ctx.fillStyle = C.c; ctx.globalAlpha = 0.05; ctx.fillRect(v.ox, v.oy, TW * v.s, TH * v.s); ctx.globalAlpha = 1;
    ctx.strokeStyle = C.dim; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(v.ox + TW * v.s / 2, v.oy); ctx.lineTo(v.ox + TW * v.s / 2, v.oy + TH * v.s); ctx.stroke();
    ctx.beginPath(); ctx.arc(v.ox + TW * v.s / 2, v.oy + TH * v.s / 2, 0.16 * v.s, 0, 7); ctx.stroke();
    // goals
    ctx.strokeStyle = C.warn; ctx.lineWidth = 6; ctx.shadowColor = C.warn; ctx.shadowBlur = 14;
    for (const gx of [v.ox, v.ox + TW * v.s]) { ctx.beginPath(); ctx.moveTo(gx, v.oy + (TH / 2 - GOAL / 2) * v.s); ctx.lineTo(gx, v.oy + (TH / 2 + GOAL / 2) * v.s); ctx.stroke(); }
    ctx.shadowBlur = 0;
    // score
    const myLeft = flip ? 1 : 0;
    glowText(ctx, String(S.score[myLeft]), w / 2 - 70, v.oy - 4 > 30 ? v.oy - 22 : 34, 34, C.hi);
    glowText(ctx, String(S.score[1 - myLeft]), w / 2 + 70, v.oy - 4 > 30 ? v.oy - 22 : 34, 34, C.warn);
    const sc = S.score.join('-');
    if (sc !== lastScore) { goalFlash = 1; lastScore = sc; const [gx, gy] = P(S.puck.x, S.puck.y); fx.burst(gx, gy, C.hi, 50, 300); }
    if (goalFlash > 0) { ctx.globalAlpha = goalFlash * 0.25; ctx.fillStyle = C.hi; ctx.fillRect(v.ox, v.oy, TW * v.s, TH * v.s); ctx.globalAlpha = 1; goalFlash -= 0.04; }
    // paddles + puck
    S.pads.forEach((p, i) => {
      const [x, y] = P(p.x, p.y);
      const col = i === 0 ? C.hi : C.warn;
      ctx.shadowColor = col; ctx.shadowBlur = 20; ctx.strokeStyle = col; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, PR * v.s, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, PR * v.s * 0.45, 0, 7); ctx.fillStyle = col; ctx.fill();
      ctx.shadowBlur = 0;
    });
    const [kx, ky] = P(S.puck.x, S.puck.y);
    ctx.shadowColor = '#fff'; ctx.shadowBlur = 22; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(kx, ky, KR * v.s, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    fx.draw(ctx);
    if (S.over && !st._ov) {
      const left = flip ? 1 : 0;
      const won = mode === 'local' ? (S.score[0] > S.score[1] ? 'PLAYER 1 WINS' : 'PLAYER 2 WINS') : S.score[left] > S.score[1 - left] ? 'YOU WIN' : 'YOU LOSE';
      st.overlay(won, `${S.score[left]} — ${S.score[1 - left]}`, mode === 'guest' ? [['WAITING FOR HOST…', () => {}]] : [['REMATCH', () => restart(true), 'primary'], ['GAMES', back]]);
    }
  }
  const restart = (announce) => {
    S.score = [0, 0]; S.over = false; lastScore = '0-0'; resetPuck(Math.random() < 0.5 ? 0 : 1); st.clearOverlay();
    if (announce && mode === 'host') send({ t: 'restart' });
  };

  return {
    onMessage(m) {
      if (m.t === 'pad' && mode === 'host') { remote.x = m.x; remote.y = m.y; }
      else if (m.t === 'st' && mode === 'guest') {
        [S.puck.x, S.puck.y, S.puck.vx, S.puck.vy] = m.p;
        S.pads[0].x = m.a[0]; S.pads[0].y = m.a[1];
        // keep our own paddle responsive locally, everything else from the host
        S.pads[1].x = remote.x; S.pads[1].y = remote.y;
        clampPad(S.pads[1], 1);
        S.score = m.s;
        if (S.over && !m.o) st.clearOverlay();
        S.over = m.o;
      } else if (m.t === 'restart' && mode === 'guest') { st.clearOverlay(); S.over = false; }
    },
    destroy() { stopLoop(); input.destroy(); st.unfit(); },
  };
}
