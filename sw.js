// Holomat service worker: app shell precached; everything else (incl. the
// hand-tracking model + wasm) cached on first use so the Holomat runs offline.
const VERSION = 'holomat-v1.1.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/holo.css',
  './js/main.js',
  './js/hud.js',
  './js/core/store.js',
  './js/core/audio.js',
  './js/core/ui.js',
  './js/core/filters.js',
  './js/core/homography.js',
  './js/core/hand.js',
  './js/core/hand-worker.js',
  './js/core/calibration.js',
  './js/core/claude.js',
  './js/core/speech.js',
  './js/core/device.js',
  './js/core/jarvis.js',
  './js/apps/game-kit.js',
  './js/apps/games.js',
  './js/apps/multiplayer.js',
  './js/apps/circuit.js',
  './js/apps/chat.js',
  './js/apps/ruler.js',
  './js/apps/games3d.js',
  './js/apps/jarvis.js',
  './js/apps/settings.js',
  './vendor/anthropic/sdk.mjs',
  './vendor/peerjs/peerjs.mjs',
  './vendor/three/three.module.js',
  './vendor/three/three.core.js',
  './vendor/mediapipe/vision_bundle.js',
  './vendor/fonts/orbitron-500.woff2',
  './vendor/fonts/orbitron-700.woff2',
  './vendor/fonts/orbitron-900.woff2',
  './vendor/fonts/rajdhani-500.woff2',
  './vendor/fonts/rajdhani-600.woff2',
  './vendor/fonts/rajdhani-700.woff2',
  './vendor/fonts/share-tech-mono-400.woff2',
  './assets/armor-hologram.webp',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/apple-touch-icon.png',
];
// large binaries: cache-first, fetched once
const HEAVY = /\.(wasm|task)$/;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // add individually so one missing file can't break the install
    await Promise.all(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdnWasm = url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@mediapipe');
  if (!sameOrigin && !cdnWasm) return; // Claude API, PeerJS signalling etc. go straight to the network

  if (HEAVY.test(url.pathname) || cdnWasm) {
    e.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req));
    return;
  }
  e.respondWith(staleWhileRevalidate(req, e));
});

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put('./index.html', res.clone()).catch(() => {});
    return res;
  } catch {
    return (await cache.match(req)) || (await cache.match('./index.html')) || Response.error();
  }
}

async function staleWhileRevalidate(req, e) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  if (hit) { e.waitUntil(fresh); return hit; }
  return (await fresh) || Response.error();
}
