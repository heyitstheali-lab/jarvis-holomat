// Headless smoke test: boots the Holomat in Chromium with a fake camera, opens
// every app, and fails on any page error / console error.
//   npm start   (in another terminal)   then   npm run check
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.HOLOMAT_URL || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '';
const apps = ['games', 'multiplayer', 'circuit', 'claude', 'ruler', 'games3d', 'jarvis', 'settings'];

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, permissions: ['camera', 'microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/^INFO:/.test(m.text()) && !/peerjs|0\.peerjs\.com|Failed to load resource.*(peerjs|anthropic)/i.test(m.text())) errors.push(`console: ${m.text()}`);
});
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(1200);
await shot('00-boot');
await page.click('.boot-go');
await page.waitForTimeout(2600);
await shot('01-hud');

// wait for the hand tracker (fake camera → model loads, no hands detected)
const status = await page.waitForFunction(() => {
  const s = window.holomat?.hand?.status;
  return s === 'running' || s === 'error' ? s : null;
}, null, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => 'timeout');
const backend = await page.evaluate(() => window.holomat.hand.backend + ' / ' + window.holomat.hand.statusText);
console.log('hand tracking:', status, backend);

for (const id of apps) {
  await page.evaluate((a) => window.holomat.openApp(a), id);
  await page.waitForTimeout(1500);
  await shot(`app-${id}`);
  const ok = await page.evaluate((a) => !!document.querySelector(`[data-panel="${a}"]`), id);
  console.log(`app ${id}:`, ok ? 'mounted' : 'MISSING');
  if (!ok) errors.push(`app ${id} did not mount`);
}
await page.evaluate(() => document.querySelector('.panel-close')?.click());
await page.waitForTimeout(600);

await browser.close();
if (errors.length) {
  console.error('\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\nsmoke test passed');
