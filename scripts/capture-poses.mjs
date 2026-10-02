/**
 * Reference-pose screenshot harness.
 *
 * Drives Chrome over CDP (using the `ws` package already in the project) so the visual overhaul
 * can be compared pose-for-pose. Software WebGL via SwiftShader, so absolute shading differs
 * slightly from a GPU, but texture detail / albedo / material response all read correctly.
 *
 * Usage: node shoot.mjs <outDir> [baseUrl]
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
  { name: '1-entrance',  x: 9.68,  y: 1.45, z: -1.6,   yaw: 0,           pitch: -0.02, note: 'arrival: clusters C7-C9 with the stage beyond' },
  { name: '2-overview',  x: 9.68,  y: 5.6,  z: -0.9,   yaw: 0,           pitch: -0.42, note: 'high overview of all eight clusters, seating and LED wall', fly: true },
  { name: '3-cluster',   x: 12.53, y: 1.45, z: -8.6,   yaw: 0,           pitch: -0.10, note: 'cluster C5 (OCSEA): panels, graphics, counter, TV, plant' },
  { name: '4-stage',     x: 9.68,  y: 1.45, z: -19.6,  yaw: 0,           pitch: 0.12,  note: 'stage set, LED wall, truss, standees, seating' },
  { name: '5-terrazzo',  x: 9.68,  y: 1.45, z: -8.3,   yaw: 0,           pitch: -0.62, note: 'HALL FLOOR close up - terrazzo' },
  { name: '6-foyer',     x: 24.5,  y: 1.45, z: -9.0,   yaw: -0.9,        pitch: -0.08, note: 'organizer stands + foyer walls' },
  { name: '8-organizer', x: 22.4,  y: 1.45, z: -9.9,   yaw: -Math.PI / 2, pitch: -0.04, note: 'KNH pop-up organizer stand, front on' },
  { name: '9-west-wall', x: 6.83,  y: 1.45, z: -14.1,  yaw: 1.0,         pitch: 0.18,  note: 'exit doors + lintels under the 7 m ceiling' },
  { name: '10-from-stage', x: 9.68, y: 1.45, z: -23.9,  yaw: Math.PI,     pitch: -0.05, note: 'from the stage front back over the seats to clusters C1-C3 (booths 1-6)' },
  { name: '11-chairs',   x: 6.2,   y: 1.25, z: -23.9,  yaw: 2.55,        pitch: -0.38, note: 'audience chair close-up' },
  { name: '7-lectern',   x: 5.35,  y: 2.1,  z: -25.35, yaw: Math.PI,     pitch: -0.10, note: 'view from the lectern back over the hall', fly: true },
];

mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu-sandbox',
  `--user-data-dir=${OUT}\\chrome-profile`,
  '--window-size=1600,900',
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

console.log('navigating to', `${BASE}/game/?stats=1`);
await cdp.send('Page.navigate', { url: `${BASE}/game/?stats=1` });
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
