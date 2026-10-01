# J.A.R.V.I.S. Holomat

A holographic, hand-tracked tabletop interface for **iPad**, installable as a PWA.
You control it with your hands through the iPad camera.

The home screen is built from the Holomat drawing in `assets/home-design.jpg`. The
armor hologram stands in the middle (cut out of the drawing by `npm run hologram`)
and everything around it is live:
- a heading tape that follows your hand
- counters for hands and timers
- the clock and date
- a system status list
- a honeycomb, which tracks your hand
- a spinning globe
- a column of quick actions
- **SIGNAL** (hand-tracking quality) and **BATTERY** arcs

**Tap the arc reactor** and it powers up. The **8 modules** then burst out of it:

| Module | What it does |
|---|---|
| **Games** | Arcade games built for hands: Neon Pong (vs CPU, or two hands for two players), Orb Strike, Holo Snake, Memory Matrix |
| **Multiplayer** | Play another Holomat **online** (peer-to-peer WebRTC with a 5-letter room code) or two players at one table: Tic-Tac-Toe, Connect Four, real-time Air Hockey |
| **Circuit Lab** | PCB / circuit designer (resistors, caps, LEDs, transistors, DIP ICs, headers, power flags…). The **Claude Engineer** designs a whole board from a description, reviews your board, or answers questions. Includes a netlist + design-rule check, saved boards, and PNG / netlist / JSON export |
| **Claude** | Talk to Claude by text or voice, with streamed replies it can read aloud |
| **Ruler** | **Detects your iPad model** and its true pixel density, then shows real-scale cm/inch rulers and measures lines, angles and areas on the glass. Includes credit-card calibration for other screens |
| **3D Games** | Three.js holographic games: Star Runner, Holo Stack, Orb Breaker |
| **J.A.R.V.I.S.** | Voice assistant powered by Claude. It can open apps, start timers, change the HUD colour, run calibration, report status, remember things, and search the web. It speaks with the iPad's built-in voices (**no ElevenLabs**) |
| **System** | Claude API key and model, hand-tracking options, voice, theme, install help |

## How it runs

- **Hand tracking runs entirely on the iPad CPU.** MediaPipe Hand Landmarker runs as WebAssembly with SIMD on the CPU delegate. It runs in a background Web Worker where Safari supports that (iPadOS 17+) and on the main thread otherwise. Camera frames never leave the device.
- **Everything else is local too.** Only Claude requests (sent straight to `api.anthropic.com` with your key) and the multiplayer handshake use the network. After the first load the app works offline from the service-worker cache.
- No build step: plain ES modules, with all libraries and fonts vendored in `vendor/`.

## Hand controls

| Gesture | Action |
|---|---|
| Point with your index finger | Moves the holo cursor (the HUD also shows your hand skeleton) |
| **Pinch** (thumb + index) | Tap |
| Hold the cursor still on a button | Dwell tap (a progress ring fills; can be turned off) |
| Pinch and move | Drag: sliders, game paddles, circuit parts, scrolling lists |
| Two hands | Two cursors: two-player Pong and Air Hockey on one table, pinch-zoom in the Circuit Lab |

Touch still works everywhere, so you can mix hands and fingers.

### Hand calibration (CALIBRATE button)

1. **Palm scan**: hold your hand open.
2. **Pinch scan**: pinch and hold. This sets *your* pinch thresholds.
3. **Spatial mapping**: touch or point at 5 targets. The Holomat fits a perspective transform (homography) from the camera's view to the screen, so it works whatever angle the camera sits at.
4. **Verify**: hit the test targets, then press Done.

Calibration is saved per orientation and per camera. Two setups work well:
- **Front camera** (default): iPad propped up, you point at it in the air.
- **Rear / overhead camera**: a classic holomat rig with a camera looking down at the iPad on the table. Choose *Rear / overhead* under SYSTEM › Camera, then calibrate.

## Setup

### 1. Host it on HTTPS

Camera access and Home Screen install both need HTTPS. Any static host works.

- **GitHub Pages** (workflow included): in the repo, go to *Settings → Pages → Source: GitHub Actions*, then push to `main`. The site appears at `https://<user>.github.io/<repo>/`.
- **Netlify / Cloudflare Pages / Vercel**: deploy the repository folder as a static site. There is no build command.
- **Local development**: run `npm start` (http://localhost:8080). Use a desktop browser, or an HTTPS tunnel to reach it from the iPad.

### 2. Install on the iPad

Open the URL in **Safari**, tap **Share → Add to Home Screen**, then launch *Holomat* from the Home Screen. Tap **TAP TO INITIALIZE** and allow the camera (and the microphone and speech recognition for voice).

### 3. Add your Claude API key

Open **SYSTEM** and paste a key from [console.anthropic.com](https://console.anthropic.com). Press **Test**, which checks the key without spending tokens.

- The key is stored only in this iPad's local storage and sent only to `api.anthropic.com` (direct browser access).
- The default model is **Claude Opus 5.5**. You can switch to Sonnet 5.5 or Haiku 4.5 in SYSTEM.
- For Opus/Sonnet the app enables Anthropic's server-side **refusal fallback** (`fallbacks: "default"`, beta). If a request is declined by a safety classifier, the API retries it on the recommended fallback model. If your account doesn't support the beta, the app automatically retries without it.
- Jarvis uses **web search** for live facts (you can turn it off in SYSTEM). If your organisation has web search disabled, Jarvis carries on without it.

## Talking to Jarvis

Tap **TALK** on the HUD, use the mic in the Jarvis console, or turn on the **“Jarvis” wake word** (SYSTEM › Voice). Things to try:

- “Status report”
- “Open the arcade” / “Start Star Runner”
- “Set a five-minute timer for tea”
- “Switch to red alert colours”
- “Calibrate my hands”
- “Remember that I prefer metric units”

Tap the subtitle bar to dismiss it and silence Jarvis.

## Multiplayer

Peer-to-peer WebRTC through [PeerJS](https://peerjs.com). The free public PeerJS broker is used only to exchange the connection handshake; gameplay goes directly between the two devices. **Host** shows a 5-character room code, and the other player enters it under **Join**. The other player can also use a desktop browser.

## Requirements

- iPad with iPadOS 16.4 or later in Safari (17+ recommended, which lets hand tracking run in a worker).
- Any recent Chromium, Firefox or Safari browser on desktop also works (use touch or a mouse instead of hands).

## Development

```
index.html            HUD shell, boot screen
css/holo.css          holographic theme
js/main.js            app host, boot sequence, quick actions
js/hud.js             home screen: the drawing's HUD, armor hologram, arc-reactor launcher
js/core/hand.js       camera + MediaPipe, cursor smoothing, pinch/dwell → synthetic pointer events
js/core/hand-worker.js  CPU inference in a Web Worker
js/core/calibration.js  palm/pinch scan + 5-point homography
js/core/claude.js     Anthropic SDK (browser), streaming + client tool loop
js/core/jarvis.js     assistant: voice loop, wake word, Holomat tools, timers
js/core/speech.js     speechSynthesis / SpeechRecognition
js/core/device.js     iPad model + pixel density detection
js/apps/*.js          the 8 modules
vendor/               three.js, MediaPipe, PeerJS, Anthropic SDK, fonts (generated)
models/               hand_landmarker.task
assets/               home-design.jpg (the drawing) + armor-hologram.webp (cut-out)
sw.js, manifest.webmanifest, icons/   PWA
```

```bash
npm install          # dev tooling only
npm run vendor       # re-copy / re-bundle vendor/ and download the hand model
npm run icons        # render icons/icon.svg to PNGs
npm run hologram     # re-cut assets/armor-hologram.webp from assets/home-design.jpg
npm start            # serve on :8080
npm run check        # headless smoke test (boots, starts tracking with a fake camera, opens every app)
```

After changing app files, bump `VERSION` in `sw.js` so installed iPads pick up the update.
