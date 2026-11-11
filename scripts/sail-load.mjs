/**
 * A measured load test for the sailing opening: a full room of phones runs the whole two-part
 * opening while other people walk the 3D hall on the same server, and some phones go dark.
 *
 *   npm run sail:load -- [phones=250] [hallVisitors=15] [darkPhones=10]
 *
 * It starts its own presence server on a spare port, with no database, so it touches nothing real.
 * For each stage it reports how hard the server worked (CPU, as a share of one core), how long a
 * ping took, and what was sent to the phones: race messages, and hall messages, which should be none.
 *
 * scripts/sail-bots.mjs is the other half: bots against a server you are running, for rehearsals.
 */
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SAIL_SECONDS } from '../src/sail/raceHub.js';

const require = createRequire(pathToFileURL(`${process.cwd()}/package.json`));
const WebSocket = require('ws');
const N = Number(process.argv[2] || 250);
const HALL = Number(process.argv[3] || 15);
const DARK = Math.min(N - 1, Number(process.argv[4] || 10));
const PORT = 8797;
const TOKEN = 'load-token';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['server/presence.js'], {
  env: {
    ...process.env, PORT: String(PORT), ANALYTICS_TOKEN: TOKEN, SAIL_TOKEN: '', SUPABASE_URL: '', VITE_SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '', ENGAGEMENT_PATH: join(tmpdir(), `sail-load-${process.pid}.json`),
    PLEDGES_FILE: join(tmpdir(), `sail-load-pledges-${process.pid}.json`),
    COMMITMENTS_PATH: join(tmpdir(), `sail-load-commit-${process.pid}.json`),
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let serverErr = '';
server.stderr.on('data', (d) => { serverErr += d.toString(); });
process.on('exit', () => server.kill());
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {}
  await sleep(250);
}
const health = async () => (await fetch(`http://127.0.0.1:${PORT}/health`)).json();

/** CPU time the server process has used so far, in ms (NaN if the OS won't say). */
function cpuMs() {
  try {
    if (process.platform === 'win32') {
      return Number(execSync(`powershell -NoProfile -Command "(Get-Process -Id ${server.pid}).TotalProcessorTime.TotalMilliseconds"`).toString().trim());
    }
    const [s, m = 0, h = 0] = execSync(`ps -p ${server.pid} -o cputime=`).toString().trim().split(':').reverse().map(Number);
    return (h * 3600 + m * 60 + s) * 1000;
  } catch {
    return NaN;
  }
}

const sent = { race: 0, raceBytes: 0, hall: 0, hallBytes: 0, hallTypes: {} };
const rtts = [];

function phone(i) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/presence`);
  const c = { ws, phase: 'harbor', startAt: 0, energyAt: 0, offset: 0, p: 0, rank: 0, me: -1, dark: false, closed: false, last: null,
    delay: Math.random() * 8000, rate: 3 + Math.random() * 4 };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (String(m.type).startsWith('sail_')) { sent.race++; sent.raceBytes += raw.length; }
    else { sent.hall++; sent.hallBytes += raw.length; sent.hallTypes[m.type] = (sent.hallTypes[m.type] || 0) + 1; }
    if (m.type === 'sail_pong') { rtts.push(Date.now() - m.t); return; }
    if (m.now) c.offset = m.now - Date.now();
    if (m.type === 'sail_welcome' || m.type === 'sail_state') {
      if (m.type === 'sail_welcome') { c.p = m.you ? m.you.p : 0; c.rank = m.you ? m.you.rank : 0; c.me = m.you ? m.you.n : -1; }
      c.phase = m.phase;
      c.startAt = m.startAt;
      c.energyAt = m.energyAt || 0;
      c.last = m;
    }
    if (m.type === 'sail_arrived' && m.n === c.me) c.rank = m.rank;
  });
  ws.on('error', () => {});
  ws.on('close', () => { c.closed = true; });
  return new Promise((res) => ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'sail_join', view: 'player', id: `load-${i}`, name: `Ship ${i}` }));
    let last = Date.now();
    // What a real phone sends: progress or taps every 250 ms, and a ping every 5 s.
    setInterval(() => {
      if (c.dark || ws.readyState !== WebSocket.OPEN) return;
      const t = Date.now();
      const dt = t - last;
      last = t;
      if (c.phase === 'energy' && t + c.offset >= c.energyAt) {
        ws.send(JSON.stringify({ type: 'sail_tap', n: Math.round((c.rate * dt) / 1000 + Math.random() * 0.5) }));
      }
      const moving = c.phase === 'sailing' || c.phase === 'challenge' || c.phase === 'energy';
      if (!moving || c.rank || t + c.offset < c.startAt + c.delay) return;
      c.p = Math.min(1, c.p + dt / (SAIL_SECONDS * 1000));
      ws.send(JSON.stringify({ type: 'sail_progress', p: c.p }));
    }, 250);
    setInterval(() => {
      if (!c.dark && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sail_ping', t: Date.now() }));
    }, 5000);
    res(c);
  }));
}

const led = { ws: new WebSocket(`ws://127.0.0.1:${PORT}/presence`), last: null };
led.ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === 'sail_state' || m.type === 'sail_welcome') led.last = m;
});
await new Promise((r) => led.ws.on('open', r));
led.ws.send(JSON.stringify({ type: 'sail_join', view: 'led', id: 'led' }));
const host = (action) => led.ws.send(JSON.stringify({ type: 'sail_host', token: TOKEN, action }));

console.log(`\n${N} phones, ${HALL} people walking the hall, ${DARK} phones going dark\n`);
const phones = [];
for (let i = 0; i < N; i++) {
  phones.push(await phone(i));
  if (i % 10 === 9) await sleep(20);
}
let hallHeard = 0;
for (let i = 0; i < HALL; i++) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/presence`);
  ws.on('message', () => { hallHeard++; });
  ws.on('error', () => {});
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'join', id: `hall-${i}`, name: `Walker ${i}` }));
  let a = Math.random() * 6;
  // The hall sends a position up to 12 times a second while someone is walking.
  setInterval(() => {
    a += 0.05;
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'move', x: 9 + Math.cos(a) * 3, y: 1.45, z: -2 + Math.sin(a) * 3, yaw: a }));
  }, 85);
}
await sleep(1500);
let h = await health();
console.log(`In the harbor: ${h.sail.boats} boats, ${h.visitors} hall visitors`);

// Locked in a pocket, or out of the Wi-Fi: the connection is never closed, it just goes silent.
for (let i = 0; i < DARK; i++) {
  const c = phones[N - 1 - i];
  c.dark = true;
  c.ws._socket.pause();
}
const live = phones.filter((c) => !c.dark);

let mark = { cpu: cpuMs(), t: Date.now(), ...sent };
function report(label) {
  const secs = (Date.now() - mark.t) / 1000;
  const cpu = cpuMs() - mark.cpu;
  const sorted = rtts.splice(0).sort((a, b) => a - b);
  const at = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : '-');
  console.log(`${label}\n    ${secs.toFixed(1)} s | server CPU ${((cpu / (secs * 1000)) * 100).toFixed(1)}% of one core`
    + ` | ping p50 ${at(0.5)} ms, p95 ${at(0.95)} ms, worst ${at(1)} ms`
    + `\n    to the phones: ${sent.race - mark.race} race messages (${((sent.raceBytes - mark.raceBytes) / 1e6).toFixed(1)} MB),`
    + ` ${sent.hall - mark.hall} hall messages (${((sent.hallBytes - mark.hallBytes) / 1e6).toFixed(1)} MB)`);
  mark = { cpu: cpuMs(), t: Date.now(), ...sent };
}

await sleep(10000);
report('Waiting in the harbor');

host('start');
for (let i = 0; i < 240 && led.last?.phase !== 'challenge'; i++) await sleep(250);
report(`The race (won by ${led.last?.winnerName})`);
const sameChallenge = new Set(live.map((c) => c.last?.challengeAt)).size === 1;

await sleep(6000);
h = await health();
const counted = h.sail.boats;
host('light');
await sleep(600);
h = await health();
const goal = h.sail.energyGoal;
const tapFrom = Date.now() + 4400;
for (let i = 0; i < 400 && led.last?.phase !== 'open'; i++) await sleep(250);
const opened = led.last?.phase === 'open';
const tapSecs = (Date.now() - tapFrom) / 1000;
report('Lighting the lighthouse');
await sleep(400);
const sameOpen = new Set(live.map((c) => c.last?.openAt)).size === 1;

const check = (ok, text) => console.log(`  ${ok ? 'OK  ' : 'BAD '} ${text}`);
console.log('');
check(sent.hall === 0, `hall messages sent to race phones: ${sent.hall}${sent.hall ? ` ${JSON.stringify(sent.hallTypes)}` : ''}`);
check(hallHeard > 0, `hall visitors still hear each other: ${hallHeard} messages`);
check(counted === N - DARK, `boats counted online when the lighting began: ${counted} (really there: ${N - DARK})`);
check(opened, opened ? `lighthouse lit after ${tapSecs.toFixed(1)} s of tapping: ${goal} taps, ${(goal / counted).toFixed(0)} per boat` : 'the lighthouse was never lit');
check(sameChallenge && sameOpen, 'every live phone was given the same moment for the challenge and for the opening');
if (serverErr.trim()) console.log(`\nServer errors:\n${serverErr.slice(0, 2000)}`);
console.log('');
server.kill();
process.exit(0);
