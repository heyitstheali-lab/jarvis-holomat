// Cuts the holographic armor bust out of the home-screen drawing
// (assets/home-design.jpg): crop, then luma-key the dark background to
// transparency, un-premultiplied so it composites like emitted light.
//   npm run hologram
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'assets/home-design.jpg');
const OUT = join(root, 'assets/armor-hologram.webp');
const CROP = { x: 630, y: 330, w: 740, h: 660 };
const b64 = readFileSync(SRC).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
const res = await page.evaluate(async ({ b64, CROP }) => {
  const img = new Image();
  img.src = 'data:image/jpeg;base64,' + b64;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  // key
  const black = 40, white = 128;
  const out = document.createElement('canvas');
  out.width = CROP.w; out.height = CROP.h;
  const octx = out.getContext('2d');
  const src = ctx.getImageData(CROP.x, CROP.y, CROP.w, CROP.h);
  const d = src.data;
  const feather = 36;
  for (let y = 0; y < CROP.h; y++) for (let x = 0; x < CROP.w; x++) {
    const i = (y * CROP.w + x) * 4;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const v = Math.max(r, g, b);
    let a = Math.min(1, Math.max(0, (v - black) / (white - black)));
    a = a * a * (3 - 2 * a); // smoothstep
    const edge = Math.min(1, x / feather, y / feather, (CROP.w - 1 - x) / feather, (CROP.h - 1 - y) / feather);
    a *= Math.max(0, edge);
    // above the shoulders keep only the helmet column (drops the drawing's HUD lines)
    if (y < 285) {
      const dx = x < 190 ? 190 - x : x > 550 ? x - 550 : 0;
      const fy = Math.min(1, (285 - y) / 30);
      a *= 1 - Math.min(1, dx / 30) * fy;
    }
    if (a < 0.004) { d[i + 3] = 0; continue; }
    // un-premultiply against black so it composites like emitted light
    const k = 1 / Math.max(a, 0.25);
    d[i] = Math.min(255, Math.max(0, (r - black * 0.6) * k));
    d[i + 1] = Math.min(255, Math.max(0, (g - black * 0.6) * k));
    d[i + 2] = Math.min(255, Math.max(0, (b - black * 0.6) * k));
    d[i + 3] = Math.round(a * 255);
  }
  octx.putImageData(src, 0, 0);
  const webp = out.toDataURL('image/webp', 0.9);
  return { webp };
}, { b64, CROP });
writeFileSync(OUT, Buffer.from(res.webp.split(',')[1], 'base64'));

await browser.close();
console.log('hologram ok');
