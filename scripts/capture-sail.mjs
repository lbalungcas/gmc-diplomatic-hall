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

// ---- Phone: the real race against bots, then the opening frame by frame.
await session({
  port: 9351, size: '390,844', dpr: 2, url: '/sail/?demo=12&hold',
  run: async ({ ev, shoot }) => {
    await sleep(1500);
    await shoot('phone-1-harbor');
    await ev('window.__sail.net.host("start")');
    await sleep(2200);
    await shoot('phone-2-countdown');
    await sleep(2600);
    // Tap left and right, about 3.3 times a second.
    await ev(`(() => { const r = document.getElementById('sail-root'); let left = true; window.__tapper = setInterval(() => { r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: left ? 40 : 350 })); left = !left; }, 300); return 1; })()`);
    await sleep(3500);
    await shoot('phone-3-sail-early');
    await sleep(4000);
    await shoot('phone-4-sail-mid');
    await sleep(4500);
    await shoot('phone-5-sail-late');
    await sleep(3200);
    await shoot('phone-6-arrived');
    const race = await ev('JSON.stringify({ p: window.__sail.p, s: window.__sail.net.state })');
    console.log('race', race);
    for (const t of OPENING_FRAMES) {
      await ev(`window.__sail.seek(${t})`);
      await sleep(700);
      await shoot(`phone-open-${String(t).replace('.', '_')}`);
    }
  },
});

// ---- LED.
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
    await sleep(7000);
    await shoot('led-4-arriving');
    for (const t of OPENING_FRAMES) {
      await ev(`window.__sail.seek(${t})`);
      await sleep(700);
      await shoot(`led-open-${String(t).replace('.', '_')}`);
    }
  },
});

// ---- Host panel.
await session({
  port: 9353, size: '390,844', dpr: 2, url: '/sail/?view=host&demo=12&hold&token=demo',
  run: async ({ shoot }) => {
    await sleep(800);
    await shoot('host');
  },
}).catch(() => {});
process.exit(0);
