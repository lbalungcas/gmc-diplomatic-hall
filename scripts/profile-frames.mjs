/**
 * Frame-time profile on the real GPU, uncapped (no vsync), at fixed poses.
 *
 * Usage: node scripts/profile-frames.mjs [baseUrl] [query]
 *   e.g. node scripts/profile-frames.mjs http://127.0.0.1:5173 device=tablet
 *
 * For each pose: average and p95 frame time over 3 s, draw calls and triangles, and the same
 * with a booth pop-up open (which should cost next to nothing once the 3D view pauses behind it).
 */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const BASE = process.argv[2] || 'http://127.0.0.1:5173';
const QUERY = process.argv[3] ? `&${process.argv[3]}` : '';
const PORT = 9345;
const POSES = [
  { name: 'lobby spawn', x: 35.4, z: -3.6, yaw: 0 },
  { name: 'organizer stands', x: 43.45, z: -14.0, yaw: 0 },
  { name: 'booth row (oblique)', x: 1.6, z: -4.6, yaw: -1.15 },
  { name: 'alley between islands', x: 1.3, z: -12.33, yaw: -1.5708 },
  { name: 'stage + seating', x: 9.68, z: -19.6, yaw: 0 },
];

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
  '--disable-gpu-vsync', '--disable-frame-rate-limit', '--mute-audio', '--no-first-run',
  `--user-data-dir=${process.env.TEMP}/profile-frames`, '--window-size=1600,900', 'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => chrome.kill());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
for (let i = 0; i < 60 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} await sleep(500); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.on('open', r));
let id = 0; const pending = new Map();
ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr, userGesture = false) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

await send('Page.navigate', { url: `${BASE}/game/?stats=1${QUERY}` });
for (let i = 0; i < 120; i++) { if (await ev(`(() => { const b = document.getElementById('start-btn'); return !!b && !b.disabled; })()`)) break; await sleep(1000); }
await ev(`(() => { document.getElementById('start-btn').click(); return 1; })()`);
await sleep(3000);
const info = await ev(`(() => { const g = window.__diplomaticGame; const q = g.quality; if (q && q.forceLevel) q.forceLevel(0);
  document.getElementById('blocker').style.display = 'none';
  const gl = g.renderer.getContext(); const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return { gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?', lowPower: document.body.classList.contains('low-power') || /tablet/.test(location.search), dpr: g.renderer.getPixelRatio() }; })()`);
console.log('GPU:', info.gpu, '| pixel ratio', info.dpr, QUERY ? `| ${QUERY.slice(1)}` : '| desktop');

// Frame times measured in the page with rAF, independent of the game's own loop.
const measure = `(async () => {
  const g = window.__diplomaticGame; const times = []; let last = performance.now();
  const end = last + 3000;
  await new Promise((done) => { const tick = (now) => { times.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); });
  times.sort((a, b) => a - b);
  const avg = times.reduce((s, x) => s + x, 0) / times.length;
  const p95 = times[Math.floor(times.length * 0.95)];
  const ri = g.renderer.info.render;
  return { avg: +avg.toFixed(2), p95: +p95.toFixed(2), calls: ri.calls, tris: ri.triangles };
})()`;

// Tablets show a photo loop after 10 s without a touch, which pauses the hall: a keypress counts as
// activity and keeps it away while measuring.
const stayAwake = `(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); return 1; })()`;
const rows = [];
for (const p of POSES) {
  await ev(`(() => { const g = window.__diplomaticGame; g.teleportPlayer(${p.x}, 1.45, ${p.z}, ${p.yaw}); return 1; })()`);
  await sleep(2500);
  await ev(stayAwake);
  const open = await ev(measure);
  rows.push({ pose: p.name, ...open });
}
// A booth pop-up open in front of the booth row.
await ev(`(() => { const g = window.__diplomaticGame; const b = g.BOOTH_POSITIONS[21]; g.teleportPlayer(b.ax, 1.45, b.az, 0); return 1; })()`);
await sleep(2500);
await ev(stayAwake);
const before = await ev(measure);
rows.push({ pose: 'booth 21, walking', ...before });
await ev(`(() => { const g = window.__diplomaticGame; g.checkProximity(true); g.handleInteract(); return g.openModals; })()`, true);
await sleep(2500);
const modal = await ev(measure);
rows.push({ pose: 'booth 21, pop-up open', ...modal });

console.log('\n  ' + 'pose'.padEnd(26) + 'avg ms'.padStart(8) + 'p95 ms'.padStart(8) + '  fps'.padStart(7) + 'calls'.padStart(7) + '  tris');
for (const r of rows) console.log('  ' + r.pose.padEnd(26) + String(r.avg).padStart(8) + String(r.p95).padStart(8) + String(Math.round(1000 / r.avg)).padStart(7) + String(r.calls).padStart(7) + '  ' + (r.tris / 1000).toFixed(1) + 'k');
process.exit(0);
