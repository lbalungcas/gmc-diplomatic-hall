/**
 * Rehearsal bots for the sailing opening: N phones that join the harbor, wait for the host's
 * Start and sail to the lighthouse.
 *
 *   node scripts/sail-bots.mjs [count=30] [url=ws://127.0.0.1:8787/presence] [--spread=8]
 *
 * --spread is how many seconds late the slowest bot sets off. Real phones never send more than
 * this does, so it is also the load test: try 230, the expected headcount.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(pathToFileURL(`${process.cwd()}/package.json`));
const WebSocket = require('ws');

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const plain = args.filter((a) => !a.startsWith('--'));
const COUNT = Number(plain[0] || 30);
const URL_ = plain[1] || 'ws://127.0.0.1:8787/presence';
const SPREAD = Number(flag('spread', 8));
const SAIL_MS = 15000;

let arrived = 0;

function bot(i) {
  const ws = new WebSocket(URL_);
  let phase = 'harbor';
  let startAt = 0;
  let offset = 0;
  let p = 0;
  let rank = 0;
  let me = -1;
  const delay = Math.random() * SPREAD * 1000;
  const id = `bot-${process.pid}-${i}`;
  let timer = null;

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'sail_join', view: 'player', id }));
    let last = Date.now();
    timer = setInterval(() => {
      const t = Date.now();
      const dt = t - last;
      last = t;
      if (phase !== 'sailing' || rank) return;
      if (t + offset < startAt + delay) return;
      p = Math.min(1, p + dt / SAIL_MS);
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sail_progress', p }));
    }, 250);
  });
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.now) offset = m.now - Date.now();
    if (m.type === 'sail_welcome' || m.type === 'sail_state') {
      if (m.type === 'sail_welcome') { p = m.you ? m.you.p : 0; rank = m.you ? m.you.rank : 0; me = m.you ? m.you.n : -1; }
      phase = m.phase;
      startAt = m.startAt;
    }
    if (m.type === 'sail_arrived' && m.n === me) {
      rank = m.rank;
      arrived++;
    }
  });
  ws.on('close', () => clearInterval(timer));
  ws.on('error', (e) => console.error(`bot ${i}:`, e.message));
}

for (let i = 0; i < COUNT; i++) setTimeout(() => bot(i), i * 25);
console.log(`${COUNT} bots joining ${URL_}; they sail when the host presses Start.`);
setInterval(() => console.log(`arrived: ${arrived}/${COUNT}`), 5000).unref?.();
process.stdin.resume();
