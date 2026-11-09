/**
 * Screenshots of the sailing opening on the real GPU, for reviewing against the art.
 *
 *   node scripts/capture-sail.mjs <outDir> [baseUrl]
 *
 * Uses ?demo=, so it needs only the Vite dev server. Phone is 390x844 @2x; LED is 2560x1200 (the
 * hall LED's 2.13:1).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(pathToFileURL(`${process.cwd()}/package.json`));
const WebSocket = require('ws');
const OUT = process.argv[2];
const BASE = process.argv[3] || 'http://127.0.0.1:5173';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session({ port, size, dpr, url, run }) {
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    `--remote-debugging-port=${port}`, '--headless=new', '--use-angle=d3d11', '--enable-gpu', '--mute-audio', '--hide-scrollbars',
    `--force-device-scale-factor=${dpr}`, `--window-size=${size}`, `--user-data-dir=${OUT}\\profile-${port}`, 'about:blank',
  ], { stdio: 'ignore' });
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    await sleep(400);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r) => ws.on('open', r));
  let id = 0;
  const pend = new Map();
  const errors = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
  });
  const send = (method, params = {}) => new Promise((res) => { pend.set(++id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.navigate', { url: `${BASE}${url}` });
  for (let i = 0; i < 60 && !url.includes('view=host'); i++) {
    if (await ev('!!window.__sail')) break;
    await sleep(500);
  }
  const shoot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
    const hud = await ev('window.__sail ? JSON.stringify(window.__sail.world.hud()) : ""');
    console.log(name, hud);
  };
  await run({ ev, shoot });
  if (errors.length) console.log('page errors:', errors.slice(0, 8));
  chrome.kill();
}

const OPENING_FRAMES = [1.5, 3.6, 5.1, 6.1, 7.6, 8.4, 9.6, 14];
const LIT_FRAMES = [1.5, 3.6, 6.1, 9.6, 13.5, 16];
const waitFor = async (ev, expr, ms = 40000) => {
  for (let i = 0; i < ms / 250; i++) {
    if (await ev(expr)) return true;
    await sleep(250);
  }
  return false;
};
const startTapping = (ev, every = 220) => ev(`(() => { const r = document.getElementById('sail-root'); clearInterval(window.__tapper); window.__tapper = setInterval(() => r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 600 })), ${every}); return 1; })()`);

// ---- Phone: name the boat, race the bots, the challenge, light the lighthouse, the welcome.
await session({
  port: 9351, size: '390,844', dpr: 2, url: '/sail/?demo=12&hold',
  run: async ({ ev, shoot }) => {
    await sleep(1500);
    await shoot('phone-0-name');
    await ev(`(() => { const i = document.querySelector('.naming input'); i.value = 'tangina'; document.querySelector('.naming').requestSubmit(); return 1; })()`);
    await sleep(300);
    await shoot('phone-0-name-refused');
    await ev(`(() => { const i = document.querySelector('.naming input'); i.value = 'Brave Otter'; document.querySelector('.naming').requestSubmit(); return 1; })()`);
    await sleep(800);
    await shoot('phone-1-harbor');
    await ev('window.__sail.net.host("start")');
    await sleep(2200);
    await shoot('phone-2-countdown');
    await sleep(2600);
    await startTapping(ev, 300);
    await sleep(3500);
    await shoot('phone-3-sail-early');
    await sleep(4000);
    await shoot('phone-4-sail-mid');
    await waitFor(ev, 'window.__sail.net.state.phase === "challenge"');
    await sleep(1500);
    await shoot('phone-5-first');
    await sleep(3200);
    await shoot('phone-6-challenge');
    await ev('window.__sail.net.host("light")');
    await sleep(800);
    await shoot('phone-7-together');
    await waitFor(ev, 'window.__sail.net.serverNow() > window.__sail.net.state.energyAt + 1500');
    await startTapping(ev, 150);
    await sleep(2500);
    await shoot('phone-8-energy');
    await waitFor(ev, 'window.__sail.net.state.phase === "open"');
    await sleep(4500);
    await shoot('phone-9-bulb');
    await waitFor(ev, '!document.querySelector(".welcome").classList.contains("hidden")');
    await sleep(800);
    await shoot('phone-10-welcome');
    console.log('phone state', await ev('JSON.stringify(window.__sail.net.state)'));
  },
});

// ---- LED: the names, the race, the challenge, the lighting, then the finale frame by frame.
await session({
  port: 9352, size: '2560,1200', dpr: 1, url: '/sail/?view=led&demo=30&hold',
  run: async ({ ev, shoot }) => {
    await sleep(2500);
    await shoot('led-1-harbor');
    await ev('window.__sail.net.host("start")');
    await sleep(1500);
    await shoot('led-2-countdown');
    await sleep(9500);
    await shoot('led-3-sailing');
    await waitFor(ev, 'window.__sail.net.state.phase === "challenge"');
    await sleep(1800);
    await shoot('led-4-first');
    await sleep(3200);
    await shoot('led-5-challenge');
    await ev('window.__sail.net.host("light")');
    await sleep(900);
    await shoot('led-6-together');
    await sleep(3000);
    await shoot('led-7-countdown');
    await waitFor(ev, 'window.__sail.net.state.taps / window.__sail.net.state.energyGoal > 0.45');
    await shoot('led-8-energy');
    await waitFor(ev, 'window.__sail.net.state.phase === "open"');
    for (const t of LIT_FRAMES) {
      await ev(`window.__sail.seek(${t})`);
      await sleep(900);
      await shoot(`led-lit-${String(t).replace('.', '_')}`);
    }
  },
});

// ---- LED, classic: the fallback still plays the opening as first built.
await session({
  port: 9354, size: '2560,1200', dpr: 1, url: '/sail/?view=led&demo=30&hold&mode=classic',
  run: async ({ ev, shoot }) => {
    await sleep(2500);
    await ev('window.__sail.net.host("threshold", { value: 5 })');
    await ev('window.__sail.net.host("start")');
    await waitFor(ev, 'window.__sail.net.state.phase === "open"');
    for (const t of [6.1, 14]) {
      await ev(`window.__sail.seek(${t})`);
      await sleep(900);
      await shoot(`classic-open-${String(t).replace('.', '_')}`);
    }
  },
});

// ---- Host panel, in the harbor and once the race is won.
await session({
  port: 9353, size: '390,844', dpr: 2, url: '/sail/?view=host&demo=12&token=demo',
  run: async ({ ev, shoot }) => {
    await sleep(800);
    await shoot('host-1-harbor');
    await waitFor(ev, 'document.getElementById("h-phase").textContent === "Race won"', 30000);
    await sleep(600);
    await shoot('host-2-won');
  },
}).catch((e) => console.log('host capture failed', e.message));
process.exit(0);
