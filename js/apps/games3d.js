// 3D HOLO SIM — three holographic 3D games (three.js), controlled by hand or touch.
import * as THREE from '../../vendor/three/three.module.js';
import { h, button } from '../core/ui.js';
import { sfx } from '../core/audio.js';
import { stage, picker, pointerTracker, loop, themeColors, best, saveBest } from './game-kit.js';

const GAMES = [
  { id: 'runner', title: 'STAR RUNNER', icon: 'play', desc: 'Pilot a holo-fighter through an asteroid field. Your fingertip steers; fly through rings.', run: runner },
  { id: 'stack', title: 'HOLO STACK', icon: 'games3d', desc: 'Pinch or tap to drop each sliding block. Stack as high as you can — overhang gets sliced off.', run: stack },
  { id: 'breaker', title: 'ORB BREAKER', icon: 'grid', desc: '3D brick breaker laid flat on the table. Move your hand left and right to guide the paddle.', run: breaker },
];

export default {
  mount({ body, panel, opts }) {
    let stop = null;
    const back = button('3D Games', () => showPicker(), { icon: 'back', cls: 'small' });
    back.style.display = 'none';
    panel.addTool(back);
    const showPicker = () => {
      stop && stop(); stop = null;
      back.style.display = 'none';
      panel.setSub('Holographic 3D games');
      body.replaceChildren(picker(GAMES.map((g) => ({ ...g, tag: best(g.id) ? `BEST ${best(g.id)}` : '' })), start));
    };
    const start = (id) => {
      const g = GAMES.find((x) => x.id === id);
      if (!g) return;
      stop && stop();
      body.replaceChildren();
      back.style.display = '';
      panel.setSub(g.title);
      try { stop = g.run(body); }
      catch (e) { body.append(h('div', { class: 'center-fill' }, h('h3', null, '3D unavailable'), h('p', { class: 'muted' }, e.message))); }
    };
    if (opts.item && GAMES.some((g) => g.id === opts.item)) start(opts.item); else showPicker();
    return () => { stop && stop(); };
  },
};

// ------------------------------------------------------------------ shared 3D scaffolding
function scene3d(container, { fov = 60, ortho = false } = {}) {
  const st = stage(container, { webgl: true });
  const renderer = new THREE.WebGLRenderer({ canvas: st.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const C = themeColors();
  const color = new THREE.Color().setHSL(C.hue / 360, 1, 0.6);
  const hi = new THREE.Color().setHSL(C.hue / 360, 1, 0.8);
  let camera;
  if (ortho) camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500);
  else camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 600);
  const api = { st, renderer, scene, camera, color, hi, C, orthoSize: 12 };
  st.onResize = (w, hh) => {
    renderer.setSize(w, hh, false);
    const aspect = w / hh;
    if (ortho) {
      const s = api.orthoSize;
      camera.left = -s * aspect; camera.right = s * aspect; camera.top = s; camera.bottom = -s;
    } else camera.aspect = aspect;
    camera.updateProjectionMatrix();
  };
  api.dispose = () => {
    st.unfit();
    scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => m.dispose?.()); });
    renderer.dispose();
    renderer.forceContextLoss?.();
  };
  return api;
}

function holoMesh(geo, col, opacity = 0.22) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending })));
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.95 })));
  return g;
}

class Shards {
  constructor(scene) { this.scene = scene; this.list = []; this.geo = new THREE.TetrahedronGeometry(0.18); }
  burst(pos, col, n = 18, speed = 7) {
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.geo, mat);
      m.position.copy(pos);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      this.scene.add(m);
      this.list.push({ m, v, life: 1, mat });
    }
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.m.position.addScaledVector(p.v, dt); p.v.y -= 9 * dt; p.m.rotation.x += dt * 6; p.m.rotation.y += dt * 4;
      p.life -= dt * 1.4; p.mat.opacity = Math.max(0, p.life);
      if (p.life <= 0) { this.scene.remove(p.m); this.list.splice(i, 1); }
    }
  }
}

function hudRow(st, items) {
  const els = {};
  st.hud.replaceChildren(...items.map(([key, label, align]) => {
    els[key] = h('div', { class: 'gh-big' }, '0');
    return h('div', { style: { textAlign: align || 'left' } }, h('div', { class: 'gh-small' }, label), els[key]);
  }));
  return els;
}

// ------------------------------------------------------------------ STAR RUNNER
function runner(container) {
  const g = scene3d(container, { fov: 70 });
  const { st, scene, camera, renderer, color, hi } = g;
  const input = pointerTracker(st.canvas);
  const shards = new Shards(scene);
  scene.fog = new THREE.Fog(0x000000, 40, 150);
  camera.position.set(0, 1.2, 9);
  camera.lookAt(0, 0, -20);

  // ship
  const ship = new THREE.Group();
  const body = holoMesh(new THREE.ConeGeometry(0.6, 2.2, 4), hi, 0.3);
  body.rotation.x = -Math.PI / 2;
  const wings = holoMesh(new THREE.BoxGeometry(2.8, 0.08, 0.7), color, 0.25);
  wings.position.z = 0.4;
  const engine = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  engine.position.z = 1.1;
  ship.add(body, wings, engine);
  scene.add(ship);

  // grid floor + ceiling
  const grid = new THREE.GridHelper(200, 60, color, color);
  grid.material.transparent = true; grid.material.opacity = 0.25;
  grid.position.y = -5;
  const grid2 = grid.clone(); grid2.position.y = 7; grid2.material = grid.material.clone(); grid2.material.opacity = 0.08;
  scene.add(grid, grid2);
  // stars
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) { starPos[i * 3] = (Math.random() - 0.5) * 120; starPos[i * 3 + 1] = (Math.random() - 0.5) * 60; starPos[i * 3 + 2] = -Math.random() * 160; }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: hi, size: 0.18, transparent: true, opacity: 0.8 }));
  scene.add(stars);

  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const ringGeo = new THREE.TorusGeometry(1.8, 0.09, 8, 36);
  const red = new THREE.Color(0xff5c6c);
  let objs = [], speed, score, shields, spawnT, running = false, inv = 0, dist;
  const ui = hudRow(st, [['score', 'SCORE'], ['shields', 'SHIELDS', 'center'], ['speed', 'SPEED', 'right']]);

  const begin = () => {
    objs.forEach((o) => scene.remove(o.mesh)); objs = [];
    speed = 30; score = 0; shields = 3; spawnT = 0; inv = 0; dist = 0; running = true;
    ship.position.set(0, 0, 0); ship.visible = true;
    st.clearOverlay();
  };
  st.overlay('STAR RUNNER', 'Steer with your fingertip (or drag). Fly through the rings, dodge the red asteroids.', [['LAUNCH', begin, 'primary']]);

  const target = new THREE.Vector2();
  const stopLoop = loop((dt, now) => {
    if (!st.w) return;
    const p = input.latest();
    if (p) target.set((p.x / st.w - 0.5) * 2 * 6.5, -(p.y / st.h - 0.5) * 2 * 3.6);
    if (running) {
      speed += dt * 0.9;
      dist += speed * dt;
      score += Math.round(speed * dt);
      ship.position.x += (target.x - ship.position.x) * Math.min(1, dt * 7);
      ship.position.y += (target.y - ship.position.y) * Math.min(1, dt * 7);
      ship.rotation.z = -(target.x - ship.position.x) * 0.25;
      ship.rotation.x = (target.y - ship.position.y) * 0.15;
      inv = Math.max(0, inv - dt);
      ship.visible = inv <= 0 || Math.floor(now / 90) % 2 === 0;
      spawnT -= dt;
      if (spawnT <= 0) {
        spawnT = Math.max(0.18, 0.55 - speed * 0.004);
        const isRing = Math.random() < 0.28;
        const mesh = isRing ? holoMesh(ringGeo, hi, 0.4) : holoMesh(rockGeo, red, 0.18);
        const s = isRing ? 1 : 0.6 + Math.random() * 1.6;
        mesh.scale.setScalar(s);
        mesh.position.set((Math.random() - 0.5) * 15, (Math.random() - 0.5) * 8, -150);
        mesh.userData.spin = new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(2);
        scene.add(mesh);
        objs.push({ mesh, ring: isRing, r: s, done: false });
      }
      for (let i = objs.length - 1; i >= 0; i--) {
        const o = objs[i];
        o.mesh.position.z += speed * dt;
        if (!o.ring) { o.mesh.rotation.x += o.mesh.userData.spin.x * dt; o.mesh.rotation.y += o.mesh.userData.spin.y * dt; }
        else o.mesh.rotation.z += dt;
        const dz = o.mesh.position.z - ship.position.z;
        if (!o.done && Math.abs(dz) < 1.2) {
          const d = Math.hypot(o.mesh.position.x - ship.position.x, o.mesh.position.y - ship.position.y);
          if (o.ring && d < 1.9) { o.done = true; score += 250; sfx.score(); shards.burst(o.mesh.position, hi, 24, 8); scene.remove(o.mesh); objs.splice(i, 1); continue; }
          if (!o.ring && d < o.r * 0.95 + 0.7 && inv <= 0) {
            o.done = true; shields--; inv = 1.5; sfx.boom(); shards.burst(ship.position, red, 30, 9);
            scene.remove(o.mesh); objs.splice(i, 1);
            if (shields <= 0) {
              running = false; ship.visible = false;
              const rec = saveBest('runner', score);
              st.overlay(rec ? 'NEW RECORD' : 'SHIP DESTROYED', `Score ${score}${rec ? '' : ` · best ${best('runner')}`}`, [['RELAUNCH', begin, 'primary']]);
            }
            continue;
          }
        }
        if (o.mesh.position.z > 14) { scene.remove(o.mesh); objs.splice(i, 1); }
      }
    } else {
      ship.rotation.y += dt * 0.6;
    }
    const sp = running ? speed : 12;
    grid.position.z = (grid.position.z + sp * dt) % (200 / 60);
    grid2.position.z = grid.position.z;
    const arr = starGeo.attributes.position.array;
    for (let i = 0; i < 900; i++) { arr[i * 3 + 2] += sp * dt * 0.6; if (arr[i * 3 + 2] > 10) arr[i * 3 + 2] = -160; }
    starGeo.attributes.position.needsUpdate = true;
    engine.scale.setScalar(0.8 + Math.random() * 0.5);
    shards.update(dt);
    ui.score.textContent = score; ui.shields.textContent = '◆'.repeat(Math.max(0, shields)) || '—'; ui.speed.textContent = Math.round(sp * 10);
    renderer.render(scene, camera);
  });
  return () => { stopLoop(); input.destroy(); g.dispose(); };
}

// ------------------------------------------------------------------ HOLO STACK
function stack(container) {
  const g = scene3d(container, { ortho: true });
  const { st, scene, camera, renderer, C } = g;
  g.orthoSize = 11;
  const input = pointerTracker(st.canvas);
  const shards = new Shards(scene);
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(10, 20, 8);
  scene.add(sun);
  camera.position.set(14, 16, 14);
  camera.lookAt(0, 0, 0);
  const BOX_H = 1;
  let blocks = [], falling = [], cur = null, level = 0, running = false, camY = 0, dirAxis = 'x', t = 0, perfectStreak = 0;
  const ui = hudRow(st, [['score', 'HEIGHT'], ['streak', 'PERFECT', 'right']]);

  const colorFor = (i) => new THREE.Color().setHSL(((C.hue + i * 9) % 360) / 360, 0.95, 0.58);
  const makeBlock = (w, d, x, y, z, i) => {
    const geo = new THREE.BoxGeometry(w, BOX_H, d);
    const col = colorFor(i);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.55, transparent: true, opacity: 0.9 }));
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })));
    mesh.position.set(x, y, z);
    scene.add(mesh);
    return { mesh, w, d, x, z, y };
  };
  const clearAll = () => { [...blocks, ...falling].forEach((b) => scene.remove(b.mesh)); if (cur) scene.remove(cur.mesh); blocks = []; falling = []; cur = null; };
  const begin = () => {
    clearAll();
    level = 0; camY = 0; perfectStreak = 0; t = 0;
    const base = makeBlock(6, 6, 0, -BOX_H, 0, 0);
    blocks.push(base);
    spawn();
    running = true;
    st.clearOverlay();
  };
  const spawn = () => {
    const top = blocks[blocks.length - 1];
    level++;
    dirAxis = level % 2 ? 'x' : 'z';
    cur = makeBlock(top.w, top.d, dirAxis === 'x' ? -9 : top.x, top.y + BOX_H, dirAxis === 'z' ? -9 : top.z, level);
    t = 0;
  };
  const drop = () => {
    if (!running || !cur) return;
    const top = blocks[blocks.length - 1];
    const ax = dirAxis;
    const size = ax === 'x' ? cur.w : cur.d;
    const delta = (ax === 'x' ? cur.mesh.position.x - top.x : cur.mesh.position.z - top.z);
    const overlap = size - Math.abs(delta);
    if (overlap <= 0) {
      // miss: block falls, game over
      falling.push({ ...cur, v: 0, spin: 1 });
      cur = null; running = false; sfx.boom();
      const rec = saveBest('stack', level - 1);
      setTimeout(() => st.overlay(rec ? 'NEW RECORD' : 'TOWER COMPLETE', `Height ${level - 1}${rec ? '' : ` · best ${best('stack')}`}`, [['BUILD AGAIN', begin, 'primary']]), 700);
      return;
    }
    let nx = cur.mesh.position.x, nz = cur.mesh.position.z;
    if (Math.abs(delta) < 0.18) {
      // perfect: snap
      if (ax === 'x') nx = top.x; else nz = top.z;
      perfectStreak++; sfx.success();
      shards.burst(new THREE.Vector3(nx, cur.y, nz), colorFor(level), 14, 5);
      scene.remove(cur.mesh);
      blocks.push(makeBlock(cur.w, cur.d, nx, cur.y, nz, level));
    } else {
      perfectStreak = 0; sfx.hit();
      const keepW = ax === 'x' ? overlap : cur.w, keepD = ax === 'z' ? overlap : cur.d;
      const center = ax === 'x' ? top.x + delta / 2 : top.z + delta / 2;
      if (ax === 'x') nx = center; else nz = center;
      // sliced piece
      const cutSize = size - overlap;
      const sign = Math.sign(delta);
      const cutCenter = (ax === 'x' ? nx : nz) + sign * (overlap / 2 + cutSize / 2);
      const piece = makeBlock(ax === 'x' ? cutSize : cur.w, ax === 'z' ? cutSize : cur.d, ax === 'x' ? cutCenter : nx, cur.y, ax === 'z' ? cutCenter : nz, level);
      falling.push({ ...piece, v: 0, spin: sign });
      scene.remove(cur.mesh);
      blocks.push(makeBlock(keepW, keepD, nx, cur.y, nz, level));
    }
    cur = null;
    spawn();
  };
  input.on('down', () => drop());
  st.overlay('HOLO STACK', 'Pinch (or tap) to drop the sliding block. Line it up perfectly for a bonus.', [['START', begin, 'primary']]);

  const stopLoop = loop((dt) => {
    if (!st.w) return;
    if (cur && running) {
      t += dt * (1.4 + level * 0.06);
      const pos = Math.sin(t) * 9;
      if (dirAxis === 'x') cur.mesh.position.x = pos; else cur.mesh.position.z = pos;
    }
    for (let i = falling.length - 1; i >= 0; i--) {
      const f = falling[i];
      f.v += 22 * dt;
      f.mesh.position.y -= f.v * dt;
      f.mesh.rotation.z += f.spin * dt * 1.5;
      f.mesh.material.opacity = Math.max(0, f.mesh.material.opacity - dt * 0.6);
      if (f.mesh.position.y < camY - 30) { scene.remove(f.mesh); falling.splice(i, 1); }
    }
    const top = blocks[blocks.length - 1];
    const wantY = top ? top.y : 0;
    camY += (wantY - camY) * Math.min(1, dt * 3);
    camera.position.set(14, 16 + camY, 14);
    camera.lookAt(0, camY, 0);
    shards.update(dt);
    ui.score.textContent = Math.max(0, level - 1);
    ui.streak.textContent = perfectStreak ? `×${perfectStreak}` : '—';
    renderer.render(scene, camera);
  });
  return () => { stopLoop(); input.destroy(); g.dispose(); };
}

// ------------------------------------------------------------------ ORB BREAKER
function breaker(container) {
  const g = scene3d(container, { fov: 50 });
  const { st, scene, camera, renderer, color, hi } = g;
  const input = pointerTracker(st.canvas);
  const shards = new Shards(scene);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const pl = new THREE.PointLight(0xffffff, 40, 40);
  pl.position.set(0, 8, 0);
  scene.add(pl);
  camera.position.set(0, 17, 15);
  camera.lookAt(0, 0, -2);
  const X = 8, ZTOP = -12, ZBOT = 7;
  // board
  const board = new THREE.GridHelper(2 * X, 16, color, color);
  board.material.transparent = true; board.material.opacity = 0.18;
  board.scale.z = (ZBOT - ZTOP) / (2 * X); board.position.z = (ZBOT + ZTOP) / 2;
  scene.add(board);
  const wallGeo = new THREE.BoxGeometry(0.3, 1, ZBOT - ZTOP);
  const wl = holoMesh(wallGeo, color, 0.15); wl.position.set(-X - 0.15, 0.5, (ZBOT + ZTOP) / 2);
  const wr = holoMesh(wallGeo, color, 0.15); wr.position.set(X + 0.15, 0.5, (ZBOT + ZTOP) / 2);
  const wt = holoMesh(new THREE.BoxGeometry(2 * X + 0.6, 1, 0.3), color, 0.15); wt.position.set(0, 0.5, ZTOP - 0.15);
  scene.add(wl, wr, wt);
  const paddleW = 3.2;
  const paddle = holoMesh(new THREE.BoxGeometry(paddleW, 0.5, 0.6), hi, 0.5);
  paddle.position.set(0, 0.25, 5.5);
  scene.add(paddle);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.35, 20, 20), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const ballGlow = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 16), new THREE.MeshBasicMaterial({ color: hi, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
  ball.add(ballGlow);
  scene.add(ball);
  const brickGeo = new THREE.BoxGeometry(1.7, 0.7, 0.8);
  let bricks = [], vel = new THREE.Vector3(), lives, score, levelN, running = false, stuck = true;
  const ui = hudRow(st, [['score', 'SCORE'], ['level', 'LEVEL', 'center'], ['lives', 'LIVES', 'right']]);

  const buildLevel = () => {
    bricks.forEach((b) => scene.remove(b.mesh)); bricks = [];
    const rows = Math.min(7, 3 + levelN);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 8; c++) {
        if (levelN > 1 && (r + c + levelN) % 5 === 0) continue;
        const col = new THREE.Color().setHSL(((g.C.hue + r * 22) % 360) / 360, 1, 0.6);
        const mesh = holoMesh(brickGeo, col, 0.35);
        mesh.position.set(-X + 1 + c * 2, 0.35, ZTOP + 1.2 + r * 1.1);
        scene.add(mesh);
        bricks.push({ mesh, col });
      }
    }
  };
  const resetBall = () => { stuck = true; vel.set(0, 0, 0); };
  const launch = () => {
    if (!running || !stuck) return;
    stuck = false;
    const sp = 11 + levelN * 1.2;
    const a = (Math.random() - 0.5) * 0.8;
    vel.set(Math.sin(a) * sp, 0, -Math.cos(a) * sp);
    sfx.click();
  };
  const begin = () => { lives = 3; score = 0; levelN = 1; buildLevel(); resetBall(); running = true; st.clearOverlay(); };
  input.on('down', launch);
  st.overlay('ORB BREAKER', 'Move your hand left/right to steer the paddle. Pinch or tap to launch the orb.', [['START', begin, 'primary']]);

  const stopLoop = loop((dt) => {
    if (!st.w) return;
    const p = input.latest();
    if (p) {
      const tx = (p.x / st.w - 0.5) * 2 * (X + 1.5);
      paddle.position.x += (Math.max(-X + paddleW / 2, Math.min(X - paddleW / 2, tx)) - paddle.position.x) * Math.min(1, dt * 14);
    }
    if (running) {
      if (stuck) ball.position.set(paddle.position.x, 0.35, paddle.position.z - 0.8);
      else {
        // sub-step for stable collisions
        const steps = 3;
        for (let s = 0; s < steps; s++) {
          ball.position.addScaledVector(vel, dt / steps);
          if (ball.position.x < -X + 0.35) { ball.position.x = -X + 0.35; vel.x = Math.abs(vel.x); sfx.tick(); }
          if (ball.position.x > X - 0.35) { ball.position.x = X - 0.35; vel.x = -Math.abs(vel.x); sfx.tick(); }
          if (ball.position.z < ZTOP + 0.35) { ball.position.z = ZTOP + 0.35; vel.z = Math.abs(vel.z); sfx.tick(); }
          // paddle
          if (vel.z > 0 && Math.abs(ball.position.z - paddle.position.z) < 0.65 && Math.abs(ball.position.x - paddle.position.x) < paddleW / 2 + 0.3) {
            const off = (ball.position.x - paddle.position.x) / (paddleW / 2);
            const sp = vel.length() * 1.01;
            const ang = off * 1.05;
            vel.set(Math.sin(ang) * sp, 0, -Math.cos(ang) * sp);
            ball.position.z = paddle.position.z - 0.66;
            sfx.hit();
          }
          // bricks
          for (let i = bricks.length - 1; i >= 0; i--) {
            const b = bricks[i].mesh.position;
            const dx = ball.position.x - b.x, dz = ball.position.z - b.z;
            if (Math.abs(dx) < 0.85 + 0.35 && Math.abs(dz) < 0.4 + 0.35) {
              if (Math.abs(dx) / 1.2 > Math.abs(dz) / 0.75) vel.x = Math.sign(dx) * Math.abs(vel.x); else vel.z = Math.sign(dz) * Math.abs(vel.z);
              shards.burst(bricks[i].mesh.position, bricks[i].col, 16, 6);
              scene.remove(bricks[i].mesh); bricks.splice(i, 1);
              score += 10 * levelN; sfx.score();
              break;
            }
          }
        }
        if (ball.position.z > ZBOT) {
          lives--; sfx.boom();
          if (lives <= 0) {
            running = false;
            const rec = saveBest('breaker', score);
            st.overlay(rec ? 'NEW RECORD' : 'GAME OVER', `Score ${score}${rec ? '' : ` · best ${best('breaker')}`}`, [['PLAY AGAIN', begin, 'primary']]);
          }
          resetBall();
        }
        if (!bricks.length) { levelN++; sfx.success(); buildLevel(); resetBall(); }
      }
    }
    ballGlow.scale.setScalar(1 + Math.sin(performance.now() / 120) * 0.15);
    shards.update(dt);
    ui.score.textContent = score ?? 0; ui.level.textContent = levelN ?? 1; ui.lives.textContent = '◆'.repeat(Math.max(0, lives ?? 3));
    renderer.render(scene, camera);
  });
  return () => { stopLoop(); input.destroy(); g.dispose(); };
}
