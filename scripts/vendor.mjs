// Copies / bundles third-party libraries into ./vendor so the PWA is fully
// self-hosted (works offline once installed, no CDN version drift).
//   npm install && npm run vendor
import { build } from 'esbuild';
import { cpSync, mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => join(root, 'node_modules', p);
const out = (p) => join(root, 'vendor', p);
const copy = (from, to) => { mkdirSync(dirname(to), { recursive: true }); cpSync(from, to); };

// three.js (r17x+ ships module + core as two files)
copy(nm('three/build/three.module.js'), out('three/three.module.js'));
copy(nm('three/build/three.core.js'), out('three/three.core.js'));

// MediaPipe Tasks Vision — JS bundle + SIMD wasm (the non-SIMD build is
// fetched from the CDN only on very old devices, see js/core/hand.js)
// (IIFE build → global `Vision`; loadable both in a classic Worker via
// importScripts and on the main thread via a <script> tag)
copy(nm('@mediapipe/tasks-vision/vision_bundle.js'), out('mediapipe/vision_bundle.js'));
copy(nm('@mediapipe/tasks-vision/wasm/vision_wasm_internal.js'), out('mediapipe/wasm/vision_wasm_internal.js'));
copy(nm('@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm'), out('mediapipe/wasm/vision_wasm_internal.wasm'));

// Self-hosted fonts (latin subset)
for (const [pkg, weights] of [['orbitron', [500, 700, 900]], ['rajdhani', [500, 600, 700]], ['share-tech-mono', [400]]]) {
  for (const w of weights) {
    copy(nm(`@fontsource/${pkg}/files/${pkg}-latin-${w}-normal.woff2`), out(`fonts/${pkg}-${w}.woff2`));
  }
}

// Anthropic SDK + PeerJS → single browser ES modules
const bundle = (contents, outfile) => build({
  stdin: { contents, resolveDir: root, loader: 'js' },
  bundle: true, format: 'esm', platform: 'browser', target: ['safari15'],
  minify: true, legalComments: 'eof', outfile,
});
await bundle(`export { default } from '@anthropic-ai/sdk';`, out('anthropic/sdk.mjs'));
await bundle(`export { Peer } from 'peerjs';`, out('peerjs/peerjs.mjs'));

// Hand landmark model (float16, ~7.5 MB)
const model = join(root, 'models/hand_landmarker.task');
if (!existsSync(model)) {
  const url = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model download failed: ${res.status}`);
  mkdirSync(dirname(model), { recursive: true });
  writeFileSync(model, Buffer.from(await res.arrayBuffer()));
}
console.log('vendor ok; model', (statSync(model).size / 1e6).toFixed(1), 'MB');
