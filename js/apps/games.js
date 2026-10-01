// HOLO ARCADE — 2D games built for hand tracking (and touch).
import { h, button, glyph, toast } from '../core/ui.js';
import { sfx } from '../core/audio.js';
import { stage, picker, pointerTracker, loop, Particles, themeColors, best, saveBest, drawGrid, glowText } from './game-kit.js';

const GAMES = [
  { id: 'pong', title: 'NEON PONG', icon: 'games', desc: 'Your hand is the paddle. Play the CPU, or two hands / two players at one table.', run: pong },
  { id: 'orbs', title: 'ORB STRIKE', icon: 'target', desc: 'Pinch or tap energy orbs before they fade. Smaller orbs, bigger points. Avoid red.', run: orbs },
  { id: 'snake', title: 'HOLO SNAKE', icon: 'wire', desc: 'Point where to go — the snake follows your fingertip. Eat the data cores.', run: snake },
  { id: 'memory', title: 'MEMORY MATRIX', icon: 'grid', desc: 'Flip holo-tiles and match the pairs in as few moves as you can.', run: memory },
];

export default {
  mount({ body, panel, opts }) {
    let stop = null;
    const back = button('Games', () => showPicker(), { icon: 'back', cls: 'small' });
    back.style.display = 'none';
    panel.addTool(back);

    const showPicker = () => {
      stop && stop(); stop = null;
      back.style.display = 'none';
      panel.setSub('Hand-controlled arcade games');
      body.replaceChildren(picker(GAMES.map((g) => ({ ...g, tag: best(g.id) ? `BEST ${best(g.id)}` : '' })), start));
    };
    const start = (id) => {
      const g = GAMES.find((x) => x.id === id);
      if (!g) return;
      stop && stop();
      body.replaceChildren();
      back.style.display = '';
      panel.setSub(g.title);
      stop = g.run(body);
    };
    if (opts.item && GAMES.some((g) => g.id === opts.item)) start(opts.item); else showPicker();
    return () => { stop && stop(); };
  },
};

// ------------------------------------------------------------------ NEON PONG
function pong(container) {
  const st = stage(container);
  const input = pointerTracker(st.canvas);
  const C = themeColors();
  const fx = new Particles();
  const WIN = 7;
  let mode = null; // 'cpu' | 'duo'
  let L, Rr, ball, scoreL, scoreR, serveT, over;

  const reset = () => {
    L = { y: st.h / 2, score: 0 }; Rr = { y: st.h / 2, score: 0 };
    scoreL = 0; scoreR = 0; over = false;
    serve(1);
  };
  const serve = (dir) => {
    const sp = Math.max(320, st.w * 0.42);
    const a = (Math.random() - 0.5) * 0.9;
    ball = { x: st.w / 2, y: st.h / 2, vx: Math.cos(a) * sp * dir, vy: Math.sin(a) * sp, r: Math.max(8, st.w * 0.009), trail: [] };
    serveT = 0.9;
  };
  const menu = () => st.overlay('NEON PONG', 'Move your hand (or finger) up and down to steer the paddle. First to 7 wins.', [
    ['VS CPU', () => { mode = 'cpu'; st.clearOverlay(); reset(); }, 'primary'],
    ['2 PLAYERS', () => { mode = 'duo'; st.clearOverlay(); reset(); }],
  ]);
  menu();

  const stopLoop = loop((dt) => {
    const { ctx, w, h: hh } = st;
    if (!w) return;
    const ph = hh * 0.2, pw = Math.max(10, w * 0.012), mx = w * 0.04;
    if (mode && !over) {
      // input: CPU mode → any pointer drives left; duo → left/right halves
      const pts = input.all();
      if (mode === 'cpu') { const p = input.latest(); if (p) L.y += (p.y - L.y) * Math.min(1, dt * 18); }
      else {
        const lp = pts.filter((p) => p.x < w / 2).sort((a, b) => b.t - a.t)[0];
        const rp = pts.filter((p) => p.x >= w / 2).sort((a, b) => b.t - a.t)[0];
        if (lp) L.y += (lp.y - L.y) * Math.min(1, dt * 18);
        if (rp) Rr.y += (rp.y - Rr.y) * Math.min(1, dt * 18);
      }
      if (mode === 'cpu') {
        const target = ball.vx > 0 ? ball.y + (Math.sin(performance.now() / 400) * ph * 0.3) : hh / 2;
        const maxV = hh * (0.9 + scoreL * 0.08);
        Rr.y += Math.max(-maxV * dt, Math.min(maxV * dt, target - Rr.y));
      }
      L.y = Math.max(ph / 2, Math.min(hh - ph / 2, L.y));
      Rr.y = Math.max(ph / 2, Math.min(hh - ph / 2, Rr.y));

      if (serveT > 0) serveT -= dt;
      else {
        ball.x += ball.vx * dt; ball.y += ball.vy * dt;
        ball.trail.push([ball.x, ball.y]); if (ball.trail.length > 14) ball.trail.shift();
        if (ball.y < ball.r) { ball.y = ball.r; ball.vy *= -1; sfx.tick(); }
        if (ball.y > hh - ball.r) { ball.y = hh - ball.r; ball.vy *= -1; sfx.tick(); }
        const hitPaddle = (px, py, side) => {
          if (Math.abs(ball.x - px) < pw / 2 + ball.r && Math.abs(ball.y - py) < ph / 2 + ball.r && Math.sign(ball.vx) === side) {
            const off = (ball.y - py) / (ph / 2);
            const sp = Math.min(Math.hypot(ball.vx, ball.vy) * 1.06, w * 1.6);
            const ang = off * 1.0;
            ball.vx = -side * Math.cos(ang) * sp; ball.vy = Math.sin(ang) * sp;
            ball.x = px - side * (pw / 2 + ball.r);
            sfx.hit(); fx.burst(ball.x, ball.y, C.hi, 14, 160);
          }
        };
        hitPaddle(mx, L.y, -1);
        hitPaddle(w - mx, Rr.y, 1);
        if (ball.x < -40 || ball.x > w + 40) {
          const leftScored = ball.x > w;
          if (leftScored) scoreL++; else scoreR++;
          sfx.score(); fx.burst(leftScored ? w - 10 : 10, ball.y, leftScored ? C.ok : C.bad, 40, 300);
          if (scoreL >= WIN || scoreR >= WIN) {
            over = true;
            const youWin = scoreL > scoreR;
            if (mode === 'cpu' && youWin) saveBest('pong', scoreL - scoreR);
            st.overlay(mode === 'cpu' ? (youWin ? 'VICTORY' : 'DEFEAT') : (youWin ? 'LEFT WINS' : 'RIGHT WINS'), `${scoreL} — ${scoreR}`, [['REMATCH', () => { st.clearOverlay(); reset(); }, 'primary'], ['MODE', menu]]);
          } else serve(leftScored ? 1 : -1);
        }
      }
    }
    fx.update(dt);

    // draw
    ctx.clearRect(0, 0, w, hh);
    drawGrid(ctx, w, hh, C.c);
    ctx.strokeStyle = C.dim; ctx.setLineDash([10, 14]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, hh); ctx.stroke(); ctx.setLineDash([]);
    if (mode) {
      glowText(ctx, String(scoreL), w * 0.4, hh * 0.12, Math.min(70, hh * 0.1), C.c);
      glowText(ctx, String(scoreR), w * 0.6, hh * 0.12, Math.min(70, hh * 0.1), C.c);
      const paddle = (x, y) => { ctx.shadowColor = C.c; ctx.shadowBlur = 18; ctx.fillStyle = C.hi; ctx.fillRect(x - pw / 2, y - ph / 2, pw, ph); ctx.shadowBlur = 0; };
      paddle(mx, L.y); paddle(w - mx, Rr.y);
      ball.trail.forEach(([x, y], i) => { ctx.globalAlpha = (i / ball.trail.length) * 0.5; ctx.fillStyle = C.c; ctx.beginPath(); ctx.arc(x, y, ball.r * (i / ball.trail.length), 0, 7); ctx.fill(); });
      ctx.globalAlpha = 1; ctx.shadowColor = '#fff'; ctx.shadowBlur = 20; ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      if (mode === 'duo') { ctx.font = '600 13px "Share Tech Mono"'; ctx.fillStyle = C.dim; ctx.textAlign = 'center'; ctx.fillText('PLAYER 1 · LEFT HALF', w * 0.25, hh - 20); ctx.fillText('PLAYER 2 · RIGHT HALF', w * 0.75, hh - 20); }
    }
    fx.draw(ctx);
  });
  return () => { stopLoop(); input.destroy(); st.unfit(); };
}

// ------------------------------------------------------------------ ORB STRIKE
function orbs(container) {
  const st = stage(container);
  const input = pointerTracker(st.canvas);
  const C = themeColors();
  const fx = new Particles();
  const DURATION = 45;
  let list = [], score = 0, combo = 1, time = 0, spawnT = 0, running = false, lastHit = 0;
  const scoreEl = h('div', { class: 'gh-big' }, '0');
  const timeEl = h('div', { class: 'gh-big' }, DURATION);
  const comboEl = h('div', { class: 'gh-small' }, '');
  st.hud.append(h('div', null, h('div', { class: 'gh-small' }, 'SCORE'), scoreEl, comboEl), h('div', { style: { textAlign: 'right' } }, h('div', { class: 'gh-small' }, 'TIME'), timeEl));

  const begin = () => { list = []; score = 0; combo = 1; time = DURATION; spawnT = 0; running = true; st.clearOverlay(); };
  st.overlay('ORB STRIKE', 'Pinch (or tap) the energy orbs before they fade. Red orbs cost you 5 seconds.', [['START', begin, 'primary']]);

  input.on('down', (p) => {
    if (!running) return;
    let hit = false;
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i];
      const r = o.r * o.scale;
      if (Math.hypot(p.x - o.x, p.y - o.y) <= r + 18) {
        list.splice(i, 1); hit = true;
        if (o.bad) { time = Math.max(0, time - 5); combo = 1; sfx.error(); fx.burst(o.x, o.y, C.bad, 40, 260); }
        else {
          const now = performance.now();
          combo = now - lastHit < 1400 ? Math.min(8, combo + 1) : 1;
          lastHit = now;
          const pts = Math.round((90 - Math.min(80, r)) * combo / 4) * 5;
          score += pts; sfx.score(); fx.burst(o.x, o.y, C.hi, 30, 240);
          o.popText = { x: o.x, y: o.y, t: 0.8, txt: `+${pts}` };
          pops.push(o.popText);
        }
        break;
      }
    }
    if (!hit) { combo = 1; sfx.tick(); }
  });
  const pops = [];

  const stopLoop = loop((dt, now) => {
    const { ctx, w, h: hh } = st;
    if (!w) return;
    if (running) {
      time -= dt;
      spawnT -= dt;
      const rate = 0.75 - Math.min(0.45, (DURATION - time) * 0.01);
      if (spawnT <= 0) {
        spawnT = rate;
        const r = 22 + Math.random() * 46;
        list.push({ x: r + Math.random() * (w - 2 * r), y: r + 50 + Math.random() * (hh - 2 * r - 50), r, life: 0, max: 2.2 + Math.random() * 1.6, bad: Math.random() < 0.14, scale: 0, phase: Math.random() * 6 });
      }
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i];
        o.life += dt;
        const k = o.life / o.max;
        o.scale = k < 0.15 ? k / 0.15 : k > 0.8 ? Math.max(0, (1 - k) / 0.2) : 1;
        if (o.life >= o.max) { list.splice(i, 1); if (!o.bad) combo = 1; }
      }
      if (time <= 0) {
        running = false; time = 0;
        const rec = saveBest('orbs', score);
        sfx.success();
        st.overlay(rec ? 'NEW RECORD' : 'TIME UP', `Score ${score}${rec ? '' : ` · best ${best('orbs')}`}`, [['PLAY AGAIN', begin, 'primary']]);
      }
    }
    scoreEl.textContent = score; timeEl.textContent = Math.ceil(time); comboEl.textContent = combo > 1 ? `COMBO ×${combo}` : '';
    fx.update(dt);

    ctx.clearRect(0, 0, w, hh);
    drawGrid(ctx, w, hh, C.c, 48);
    for (const o of list) {
      const r = o.r * o.scale;
      const col = o.bad ? C.bad : C.c;
      const pulse = 1 + Math.sin(now / 160 + o.phase) * 0.05;
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, r * pulse);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, o.bad ? '#ff9aa5' : C.hi); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, r * pulse, 0, 7); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(o.x, o.y, r * 1.25, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - o.life / o.max)); ctx.stroke();
    }
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i]; p.t -= dt; p.y -= 40 * dt;
      if (p.t <= 0) { pops.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, p.t * 2); glowText(ctx, p.txt, p.x, p.y, 20, C.hi); ctx.globalAlpha = 1;
    }
    fx.draw(ctx);
  });
  return () => { stopLoop(); input.destroy(); st.unfit(); };
}

// ------------------------------------------------------------------ HOLO SNAKE
function snake(container) {
  const st = stage(container);
  const input = pointerTracker(st.canvas);
  const C = themeColors();
  const fx = new Particles();
  let cols, rows, cell, ox, oy, body, dir, food, acc, speed, alive = false, score = 0, nextDir;
  const scoreEl = h('div', { class: 'gh-big' }, '0');
  st.hud.append(h('div', null, h('div', { class: 'gh-small' }, 'DATA CORES'), scoreEl), h('div', { class: 'gh-small', style: { textAlign: 'right' } }, 'POINT WHERE TO GO'));

  const layoutGrid = () => {
    cell = Math.max(18, Math.floor(Math.min(st.w / 32, st.h / 20)));
    cols = Math.floor(st.w / cell); rows = Math.floor((st.h - 10) / cell);
    ox = (st.w - cols * cell) / 2; oy = (st.h - rows * cell) / 2 + 5;
  };
  const placeFood = () => {
    for (let i = 0; i < 500; i++) {
      const f = [Math.floor(Math.random() * cols), Math.floor(Math.random() * rows)];
      if (!body.some(([x, y]) => x === f[0] && y === f[1])) { food = f; return; }
    }
  };
  const begin = () => {
    layoutGrid();
    const cx = Math.floor(cols / 2), cy = Math.floor(rows / 2);
    body = [[cx, cy], [cx - 1, cy], [cx - 2, cy]];
    dir = [1, 0]; nextDir = dir; acc = 0; speed = 7; score = 0; alive = true;
    placeFood(); st.clearOverlay();
  };
  st.overlay('HOLO SNAKE', 'Point (or touch) where you want to go — the snake turns toward your fingertip. Don’t hit the walls or yourself.', [['START', begin, 'primary']]);

  const stopLoop = loop((dt, now) => {
    const { ctx, w, h: hh } = st;
    if (!w) return;
    if (alive) {
      const p = input.latest();
      if (p) {
        const [hx, hy] = body[0];
        const px = (p.x - ox) / cell - (hx + 0.5), py = (p.y - oy) / cell - (hy + 0.5);
        let cand = Math.abs(px) > Math.abs(py) ? [Math.sign(px), 0] : [0, Math.sign(py)];
        if (Math.abs(px) < 0.6 && Math.abs(py) < 0.6) cand = dir;
        if (!(cand[0] === -dir[0] && cand[1] === -dir[1]) && (cand[0] || cand[1])) nextDir = cand;
        else if (cand[0] === -dir[0] && cand[1] === -dir[1]) {
          // reversing isn't allowed: turn sideways toward the target instead
          nextDir = dir[0] ? [0, py >= 0 ? 1 : -1] : [px >= 0 ? 1 : -1, 0];
        }
      }
      acc += dt * speed;
      while (acc >= 1 && alive) {
        acc -= 1;
        dir = nextDir;
        const head = [body[0][0] + dir[0], body[0][1] + dir[1]];
        if (head[0] < 0 || head[1] < 0 || head[0] >= cols || head[1] >= rows || body.some(([x, y]) => x === head[0] && y === head[1])) {
          alive = false; sfx.boom();
          fx.burst(ox + (body[0][0] + 0.5) * cell, oy + (body[0][1] + 0.5) * cell, C.bad, 60, 300);
          const rec = saveBest('snake', score);
          setTimeout(() => st.overlay(rec ? 'NEW RECORD' : 'SYSTEM CRASH', `${score} data cores${rec ? '' : ` · best ${best('snake')}`}`, [['RETRY', begin, 'primary']]), 600);
          break;
        }
        body.unshift(head);
        if (head[0] === food[0] && head[1] === food[1]) {
          score++; speed = Math.min(16, speed + 0.35); sfx.score();
          fx.burst(ox + (food[0] + 0.5) * cell, oy + (food[1] + 0.5) * cell, C.hi, 26, 200);
          placeFood();
        } else body.pop();
      }
    }
    scoreEl.textContent = score;
    fx.update(dt);

    ctx.clearRect(0, 0, w, hh);
    if (body) {
      ctx.strokeStyle = C.dim; ctx.lineWidth = 2; ctx.strokeRect(ox, oy, cols * cell, rows * cell);
      ctx.fillStyle = C.c; ctx.globalAlpha = 0.07;
      for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) if ((x + y) % 2 === 0) ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
      ctx.globalAlpha = 1;
      const fp = 0.5 + Math.sin(now / 150) * 0.12;
      ctx.shadowColor = C.warn; ctx.shadowBlur = 18; ctx.fillStyle = C.warn;
      ctx.beginPath(); ctx.arc(ox + (food[0] + 0.5) * cell, oy + (food[1] + 0.5) * cell, cell * fp * 0.6, 0, 7); ctx.fill();
      ctx.shadowColor = C.c; ctx.shadowBlur = 14;
      body.forEach(([x, y], i) => {
        ctx.fillStyle = i === 0 ? '#fff' : C.hi;
        ctx.globalAlpha = 1 - (i / body.length) * 0.6;
        const pad = i === 0 ? 1 : 3;
        ctx.fillRect(ox + x * cell + pad, oy + y * cell + pad, cell - pad * 2, cell - pad * 2);
      });
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    }
    fx.draw(ctx);
  });
  st.onResize = () => { if (!alive && body) layoutGrid(); };
  return () => { stopLoop(); input.destroy(); st.unfit(); };
}

// ------------------------------------------------------------------ MEMORY MATRIX
function memory(container) {
  const SYMBOLS = ['games', 'multiplayer', 'circuit', 'ruler', 'games3d', 'jarvis', 'settings', 'hand'];
  const wrap = h('div', { class: 'center-fill' });
  container.append(wrap);
  let deck, open, matched, moves, lock, t0, timer;
  const info = h('div', { class: 'hud-font', style: { fontSize: '15px', color: 'var(--c-hi)' } });
  const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', width: 'min(620px, 92%, 70vh)' } });
  wrap.append(info, grid);

  const updateInfo = () => {
    const secs = t0 ? Math.floor((Date.now() - t0) / 1000) : 0;
    info.textContent = `MOVES ${moves} · PAIRS ${matched}/8 · TIME ${secs}s${best('memory') ? ` · BEST ${best('memory')} MOVES` : ''}`;
  };
  const begin = () => {
    deck = [...SYMBOLS, ...SYMBOLS].map((s) => ({ s, up: false, done: false })).sort(() => Math.random() - 0.5);
    open = []; matched = 0; moves = 0; lock = false; t0 = 0;
    grid.replaceChildren(...deck.map((card) => {
      const el = h('button', { class: 'hcard', type: 'button', style: { minHeight: '0', aspectRatio: '1', alignItems: 'center', justifyContent: 'center', padding: '0' } });
      card.el = el;
      el.addEventListener('click', () => flip(card));
      return el;
    }));
    render(); updateInfo();
  };
  const render = () => {
    for (const c of deck) {
      c.el.replaceChildren(c.up || c.done ? glyph(c.s, 'hc-glyph') : h('div', { class: 'hud-font', style: { fontSize: '22px', color: 'var(--c-dim)' } }, '◇'));
      c.el.style.background = c.done ? 'var(--c-a20)' : c.up ? 'var(--c-a10)' : '';
      c.el.style.opacity = c.done ? '0.55' : '1';
    }
  };
  const flip = (card) => {
    if (lock || card.up || card.done) return;
    if (!t0) t0 = Date.now();
    card.up = true; open.push(card); sfx.click(); render();
    if (open.length === 2) {
      moves++;
      const [a, b] = open;
      if (a.s === b.s) {
        a.done = b.done = true; matched++; open = []; sfx.score(); render();
        if (matched === 8) {
          const rec = saveBest('memory', moves, true);
          sfx.success();
          toast(rec ? `New record: ${moves} moves!` : `Solved in ${moves} moves`, 'ok');
          setTimeout(begin, 2200);
        }
      } else {
        lock = true;
        setTimeout(() => { a.up = b.up = false; open = []; lock = false; render(); }, 850);
      }
    }
    updateInfo();
  };
  begin();
  timer = setInterval(updateInfo, 1000);
  wrap.append(button('Shuffle', begin, { icon: 'refresh', cls: 'small' }));
  return () => clearInterval(timer);
}
