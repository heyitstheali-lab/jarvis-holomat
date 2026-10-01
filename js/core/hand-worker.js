/* Hand landmark inference off the main thread (classic worker).
   Runs MediaPipe's HandLandmarker on the iPad CPU (WASM + SIMD) so the HUD,
   games and 3D scenes stay smooth while tracking. */
/* global Vision */
importScripts('../../vendor/mediapipe/vision_bundle.js');

let landmarker = null;

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      landmarker = await createLandmarker(m);
      self.postMessage({ type: 'ready', delegate: m.delegate });
    } catch (err) {
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  } else if (m.type === 'frame') {
    let out = null;
    let ms = 0;
    try {
      const t0 = performance.now();
      const r = landmarker.detectForVideo(m.bitmap, m.ts);
      ms = performance.now() - t0;
      out = pack(r);
    } catch (err) {
      self.postMessage({ type: 'result', id: m.id, error: String((err && err.message) || err) });
      return;
    } finally {
      if (m.bitmap && m.bitmap.close) m.bitmap.close();
    }
    self.postMessage({ type: 'result', id: m.id, result: out, ms });
  } else if (m.type === 'options' && landmarker) {
    try { await landmarker.setOptions(m.options); } catch (err) { /* ignore */ }
  }
};

async function createLandmarker(m) {
  const { FilesetResolver, HandLandmarker } = self.Vision;
  const simd = await FilesetResolver.isSimdSupported();
  const base = simd ? m.wasmLocal : m.wasmCdn;
  const sfx = simd ? '' : '_nosimd';
  const fileset = { wasmLoaderPath: `${base}/vision_wasm${sfx}_internal.js`, wasmBinaryPath: `${base}/vision_wasm${sfx}_internal.wasm` };
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: m.model, delegate },
    runningMode: 'VIDEO',
    numHands: m.numHands,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    return await HandLandmarker.createFromOptions(fileset, opts(m.delegate));
  } catch (err) {
    if (m.delegate !== 'CPU') return HandLandmarker.createFromOptions(fileset, opts('CPU'));
    throw err;
  }
}

function pack(r) {
  return {
    landmarks: r.landmarks || [],
    handedness: (r.handedness || r.handednesses || []).map((c) => (c && c[0] ? { name: c[0].categoryName, score: c[0].score } : { name: '', score: 0 })),
  };
}
