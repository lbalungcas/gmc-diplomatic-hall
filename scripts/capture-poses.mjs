/**
 * Reference-pose screenshot harness.
 *
 * Drives Chrome over CDP (using the `ws` package already in the project) so the visual overhaul
 * can be compared pose-for-pose. Software WebGL via SwiftShader, so absolute shading differs
 * slightly from a GPU, but texture detail / albedo / material response all read correctly.
 *
 * Usage: node scripts/capture-poses.mjs <outDir> [baseUrl]
 *
 * Environment:
 *   CAPTURE_GPU=1          hardware WebGL (ANGLE/D3D11) instead of SwiftShader. Use it to check
 *                          GPU behaviour: SwiftShader hid an MSAA black-screen bug once.
 *   CAPTURE_QUERY=...      extra query string, e.g. `device=tablet` for the tablet/kiosk path
 *   CAPTURE_SIZE=1280x800  window size;  CAPTURE_DPR=2  device scale factor
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('file:///' + process.cwd().replace(/\\/g, '/') + '/');
const WebSocket = require('ws');

const OUT = process.argv[2];
const BASE = process.argv[3] || 'http://127.0.0.1:5173';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;

// Camera poses chosen to cover every material group and the marketplace set. `fly: true` parks
// the camera like a seat (sitDownOnChair with a custom pose) so it can sit above eye level.
const POSES = [
  { name: '01-spawn',        x: 35.0,  y: 1.45, z: 1.7,    yaw: -0.838,  pitch: -0.04, note: 'arrival at registration beside the entrance, route arrows' },
  { name: '01c-walkway',     x: 38.0,  y: 1.45, z: -8.0,   yaw: 3.0,     pitch: -0.04, note: 'from the lobby toward the entrance: walkway clear, desk to the side' },
  { name: '01b-route',       x: 34.0,  y: 1.45, z: 2.4,    yaw: 1.35,    pitch: -0.3,  note: 'floor arrows along the vestibule to the entrance doors, entrance marker' },
  { name: '02-lobby-high',   x: 57.0,  y: 5.4,  z: -5.0,   yaw: 1.05,    pitch: -0.34, note: 'high view across the lobby: chandeliers, coffers, registration, curved wall', fly: true },
  { name: '03-organizers',   x: 43.45, y: 1.45, z: -14.0,  yaw: 0,       pitch: 0.02,  note: 'VEWU, KNH and TdH stands along Executive 3' },
  { name: '04-elevators',    x: 33.85, y: 1.45, z: 2.0,    yaw: 3.1416,  pitch: 0.05,  note: 'elevator hall: two banks of three cars' },
  { name: '05-media-hub',    x: 40.5,  y: 1.45, z: -8.0,   yaw: 1.4,     pitch: 0.08,  note: 'the YIM photowall over the curved wall, Youth Media Hub in front' },
  { name: '06-passage',      x: 38.0,  y: 1.45, z: -9.0,   yaw: 2.9,     pitch: -0.02, note: 'from the lobby south toward the vestibule, pillar, curved wall end' },
  { name: '07-vestibule',    x: 37.5,  y: 1.45, z: 1.8,    yaw: 1.5708,  pitch: 0.0,   note: 'vestibule: foyer entrance doors on the right, exterior doors on the left' },
  { name: '08-foyer-entry',  x: 27.3,  y: 1.45, z: -0.8,   yaw: 0.35,    pitch: 0.0,   note: 'inside the entrance doors: deal corner, arch, curved wall' },
  { name: '09-foyer-high',   x: 31.0,  y: 5.4,  z: -1.0,   yaw: 0.55,    pitch: -0.4,  note: 'high view of the foyer between the hall and the curved wall', fly: true },
  { name: '10-north-walls',  x: 29.5,  y: 1.45, z: -13.8,  yaw: 0,       pitch: 0.04,  note: 'policy (pledge) wall, partners wall and the closed door' },
  { name: '11-arch-front',   x: 27.0,  y: 1.45, z: -10.13, yaw: 1.5708,  pitch: 0.14,  note: 'event arch from the foyer' },
  { name: '12-arch-back',    x: 14.5,  y: 1.45, z: -10.13, yaw: -1.5708, pitch: 0.1,   note: 'event arch from the hall, booth entrance standee' },
  { name: '13-overview',     x: 9.68,  y: 5.6,  z: -0.9,   yaw: 0,       pitch: -0.42, note: 'high overview of both booth islands, benches and LED wall', fly: true },
  { name: '14-booth',        x: 8.48,  y: 1.45, z: -4.4,   yaw: 0,       pitch: -0.06, note: 'booth 21 front on, against the booth-style reference' },
  { name: '15-easel',        x: 7.75,  y: 1.45, z: -5.2,   yaw: 0.12,    pitch: -0.22, note: 'booth 21 easel poster, legibility' },
  { name: '17-chairs',       x: 9.68,  y: 1.45, z: -20.4,  yaw: 0,       pitch: -0.3,  note: 'the 20 audience chairs, 10 each side of the aisle' },
  { name: '16-stage',        x: 9.68,  y: 1.45, z: -19.6,  yaw: 0,       pitch: 0.12,  note: 'stage design: LED wall, banners, lectern, chairs, grass' },
];

mkdirSync(OUT, { recursive: true });

const GPU = process.env.CAPTURE_GPU === '1';
const QUERY = process.env.CAPTURE_QUERY ? `&${process.env.CAPTURE_QUERY}` : '';
const SIZE = (process.env.CAPTURE_SIZE || '1600x900').replace('x', ',');
const DPR = process.env.CAPTURE_DPR || '1';
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  '--headless=new',
  ...(GPU ? ['--use-angle=d3d11', '--enable-gpu'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']),
  `--force-device-scale-factor=${DPR}`,
  '--hide-scrollbars',
  '--mute-audio',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu-sandbox',
  `--user-data-dir=${OUT}\\chrome-profile`,
  `--window-size=${SIZE}`,
  'about:blank',
], { stdio: 'ignore' });

process.on('exit', () => chrome.kill());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await targets();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch (e) { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('Chrome devtools never came up');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expression);
    return r.result.value;
  }
}

const page = await waitForDevtools();
const cdp = new CDP(new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false }));
await new Promise((r) => cdp.ws.on('open', r));

await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Log.enable');

const errors = [];
cdp.ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
});

console.log('navigating to', `${BASE}/game/?stats=1${QUERY}`);
await cdp.send('Page.navigate', { url: `${BASE}/game/?stats=1${QUERY}` });
await sleep(3000);

// Wait for the GLB to finish loading (markVenueLoaded enables the start button).
for (let i = 0; i < 120; i++) {
  const ready = await cdp.eval(`(() => { const b = document.getElementById('start-btn'); return !!b && !b.disabled; })()`);
  if (ready) break;
  await sleep(1000);
}
console.log('venue loaded');

// Dismiss the blocker so the 3D view is unobstructed. Pointer lock will fail headless, which is
// fine: teleportPlayer sets the camera directly and the render loop keeps running.
await cdp.eval(`(() => {
  const b = document.getElementById('start-btn'); if (b) b.click();
  // Pointer lock always fails in headless, which makes the game re-show the "Walk Paused"
  // blocker. Force it hidden with a stylesheet so it cannot come back between poses.
  // Software WebGL is genuinely slow, so the adaptive governor would drop quality and make
  // before/after captures incomparable. Pin it to full.
  const q = window.__diplomaticGame && window.__diplomaticGame.quality;
  if (q && q.forceLevel) q.forceLevel(0);
  const s = document.createElement('style');
  s.textContent = '#blocker{display:none !important}';
  document.head.appendChild(s);
  return true;
})()`);
await sleep(2500);

const results = [];
for (const pose of POSES) {
  // teleportPlayer forces pitch to 0, so set it afterwards to frame floors and ceilings.
  await cdp.eval(`(() => {
    const g = window.__diplomaticGame;
    g.teleportPlayer(${pose.x}, ${pose.y}, ${pose.z}, ${pose.yaw});
    if (${!!pose.fly}) g.sitDownOnChair({ id: 'capture', x: ${pose.x}, y: ${pose.y}, z: ${pose.z}, yaw: ${pose.yaw}, pitch: ${pose.pitch}, label: 'capture' });
    g.player.pitch = ${pose.pitch};
    document.querySelectorAll('.toast, #toast-container > *').forEach(t => t.remove());
    return true;
  })()`);
  await cdp.eval(`(() => { const h = window.__diplomaticGame.perfHud; if (h) h.resetPeaks(); return true; })()`);
  await sleep(4000); // let the perf window fill and any lazy textures upload
  const stats = await cdp.eval(`(() => {
    const r = window.__diplomaticGame;
    const hud = document.getElementById('perf-hud');
    return { hud: hud ? hud.textContent : null };
  })()`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${pose.name}.png`, Buffer.from(shot.data, 'base64'));
  console.log(`--- ${pose.name} (${pose.note})\n${stats.hud}`);
  results.push({ pose: pose.name, note: pose.note, hud: stats.hud });
}

writeFileSync(`${OUT}/stats.json`, JSON.stringify({ base: BASE, results, errors }, null, 2));
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
console.log('wrote', OUT);
process.exit(0);
