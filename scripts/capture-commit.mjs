/**
 * Screenshots of the commitment wall on the real GPU, for review.
 *
 *   node scripts/capture-commit.mjs <outDir> [baseUrl]
 *
 * Uses ?demo=, so it needs only the Vite dev server. Wall is 2560x1200 (the hall LED's 2.13:1).
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

async function session({ port, size, dpr, url, ready = '!!window.__commit', run }) {
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    `--remote-debugging-port=${port}`, '--headless=new', '--use-angle=d3d11', '--enable-gpu', '--mute-audio', '--hide-scrollbars',
    `--force-device-scale-factor=${dpr}`, `--window-size=${size}`, `--user-data-dir=${OUT}\\profile-${port}-${Date.now()}`, 'about:blank',
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
  for (let i = 0; i < 60; i++) {
    if (await ev(ready)) break;
    await sleep(500);
  }
  const shoot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
    console.log(name);
  };
  await run({ ev, shoot, send });
  if (errors.length) console.log('page errors:', errors.slice(0, 8));
  chrome.kill();
}

const FRAMES = [1, 4, 5.3, 7.5, 10, 12.5, 15, 16.2, 16.9, 19, 23, 25.5, 28, 33];
const shootFinale = async ({ ev, shoot }, prefix) => {
  for (const t of FRAMES) {
    await ev(`window.__commit.seek(${t})`);
    await sleep(700);
    await shoot(`${prefix}-${String(t).replace('.', '_').padStart(4, '0')}`);
  }
};

const only = process.argv[4];

if (!only || only === 'wall') {
  await session({
    port: 9391, size: '2560,1200', dpr: 1, url: '/commit/?view=wall&demo=150',
    run: async (s) => {
      await sleep(2500);
      await s.shoot('wall-1-live');
      await sleep(3500);
      await s.shoot('wall-2-live');
      console.log(await s.ev('JSON.stringify({ n: window.__commit.net.items.size })'));
      await shootFinale(s, 'wall150');
      console.log(await s.ev('JSON.stringify(window.__commit.finale.stats())'));
    },
  });
}
if (!only || only === 'few') {
  await session({
    port: 9392, size: '2560,1200', dpr: 1, url: '/commit/?view=wall&demo=4',
    run: async (s) => {
      await sleep(1500);
      await s.shoot('few-1-live');
      await s.ev('window.__commit.seek(15)');
      await sleep(700);
      await s.shoot('few-2-bulb');
    },
  });
  await session({
    port: 9393, size: '2560,1200', dpr: 1, url: '/commit/?view=wall&demo=600',
    run: async (s) => {
      await sleep(1500);
      await s.ev('window.__commit.seek(15)');
      await sleep(900);
      await s.shoot('many-bulb');
      console.log(await s.ev('JSON.stringify(window.__commit.finale.stats())'));
    },
  });
}
if (!only || only === 'phone') {
  await session({
    port: 9394, size: '390,844', dpr: 2, url: '/commit/?demo=20',
    run: async (s) => {
      await sleep(800);
      await s.shoot('phone-1-compose');
      await s.ev(`(() => { const t = document.querySelector('textarea'); t.value = 'call me on 09171234567'; document.querySelector('.compose').requestSubmit(); return 1; })()`);
      await sleep(300);
      await s.shoot('phone-2-contact');
      await s.ev(`(() => { const t = document.querySelector('textarea'); t.value = 'listen to children before deciding for them'; document.querySelector('.compose').requestSubmit(); return 1; })()`);
      await sleep(600);
      await s.shoot('phone-3-sent');
      const now = await s.ev('window.__commit.net.serverNow()');
      for (const [t, name] of [[3, 'watch'], [14, 'hold'], [16.8, 'flash'], [20, 'lit'], [28, 'end']]) {
        await s.ev(`window.__commit.setFinale(window.__commit.net.serverNow() - ${t * 1000})`);
        await sleep(350);
        await s.shoot(`phone-finale-${name}`);
      }
      void now;
    },
  });
  await session({
    port: 9395, size: '820,1000', dpr: 1, url: '/commit/?view=admin&demo=8&token=demo', ready: '!!document.querySelector("#a-list li")',
    run: async (s) => {
      await sleep(600);
      await s.shoot('admin');
    },
  });
}
process.exit(0);
