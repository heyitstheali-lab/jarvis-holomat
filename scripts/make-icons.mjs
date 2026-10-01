// Renders icons/icon.svg to the PNG sizes iOS / Android need (uses Playwright's Chromium).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'icons/icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['apple-touch-icon.png', 180, 0], ['maskable-512.png', 512, 0.12]]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(`<html><body style="margin:0;background:#010a10;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await page.screenshot({ path: join(root, 'icons', name), omitBackground: false });
}
await browser.close();
console.log('icons ok');
