/**
 * Tests for the sailing opening's rules (src/sail/raceHub.js), on a fake clock, then the same
 * race for real over WebSockets against a presence server started on a spare port.
 *
 *   npm run sail:test
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRaceHub, COUNTDOWN_MS, OPEN_LEAD_MS, SAIL_SECONDS } from '../src/sail/raceHub.js';

const require = createRequire(pathToFileURL(`${process.cwd()}/package.json`));
const WebSocket = require('ws');

let failed = 0;
function ok(cond, name, detail = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failed++;
}

function harness(threshold = 3) {
  let clock = 1_000_000;
  const inbox = new Map();
  const hub = createRaceHub({
    token: 'secret', threshold, now: () => clock,
    deliver: (c, m) => inbox.get(c).push(m),
  });
  const client = (id, view = 'player') => {
    const c = { id };
    inbox.set(c, []);
    hub.handle(c, { type: 'sail_join', view, id, name: id });
    return c;
  };
  return {
    hub, client, inbox,
    advance: (ms) => { clock += ms; },
    host: (c, action, extra = {}) => hub.handle(c, { type: 'sail_host', token: 'secret', action, ...extra }),
    last: (c, type) => [...inbox.get(c)].reverse().find((m) => m.type === type),
    /** Sail at full speed in steps, like a phone holding the button. */
    sail(c, seconds) {
      for (let t = 0; t < seconds * 4; t++) {
        clock += 250;
        const prev = c._p || 0;
        c._p = Math.min(1, prev + 0.25 / SAIL_SECONDS);
        hub.handle(c, { type: 'sail_progress', p: c._p });
      }
    },
  };
}

console.log('\nRace rules (fake clock)');
{
  const h = harness(3);
  const led = h.client('led', 'led');
  const a = h.client('a'), b = h.client('b'), c = h.client('c'), d = h.client('d');
  h.hub.tick();
  ok(h.last(led, 'sail_state').boats === 4, 'LED is not counted as a boat, four phones are');
  ok(h.hub.stats().phase === 'harbor', 'starts in the harbor');

  h.hub.handle(a, { type: 'sail_progress', p: 0.5 });
  ok(h.last(a, 'sail_snap') === undefined, 'boats cannot move before the host starts');

  h.hub.handle(a, { type: 'sail_host', token: 'wrong', action: 'start' });
  ok(h.hub.stats().phase === 'harbor' && h.last(a, 'sail_host_result').ok === false, 'a phone without the token cannot start the race');

  h.host(led, 'start');
  ok(h.hub.stats().phase === 'sailing', 'host Start begins the race');
  h.hub.handle(a, { type: 'sail_progress', p: 0.5 });
  h.hub.tick();
  ok(h.last(led, 'sail_snap') === undefined, 'no moving during the countdown');

  h.advance(COUNTDOWN_MS + 1000);
  h.hub.handle(a, { type: 'sail_progress', p: 1 });
  h.hub.tick();
  const cheat = h.last(led, 'sail_snap');
  ok(cheat && cheat.b[1] < 200 && h.hub.stats().arrived === 0, 'claiming p=1 straight away does not arrive', `clamped to ${cheat && cheat.b[1] / 1000}`);

  h.sail(b, SAIL_SECONDS);
  ok(h.hub.stats().arrived === 1 && h.last(led, 'sail_arrived').rank === 1, 'a full 15 s run arrives first');
  h.sail(c, SAIL_SECONDS);
  ok(h.hub.stats().arrived === 2 && h.hub.stats().phase === 'sailing', 'two of three: still sailing');

  const rejoin = { id: 'b2' };
  h.inbox.set(rejoin, []);
  h.hub.handle(rejoin, { type: 'sail_join', view: 'player', id: 'b', name: 'b' });
  ok(h.last(rejoin, 'sail_welcome').you.rank === 1, 'a refresh keeps your boat and your place');
  ok(h.hub.stats().arrived === 2, 'and does not count you twice');

  h.sail(d, SAIL_SECONDS);
  const st = h.last(led, 'sail_state');
  ok(h.hub.stats().phase === 'open' && st.phase === 'open', 'the third arrival opens the marketplace');
  ok(st.openAt - st.now === OPEN_LEAD_MS, 'every screen gets the same start time for the animation');

  const late = h.client('late');
  ok(h.last(late, 'sail_welcome').phase === 'open', 'a phone joining afterwards goes straight to the open state');
  h.hub.handle(late, { type: 'sail_progress', p: 0.2 });
  ok(h.hub.stats().arrived === 3, 'nobody arrives after opening');

  h.host(led, 'reset');
  ok(h.hub.stats().phase === 'harbor' && h.hub.stats().arrived === 0, 'host Reset returns to the harbor');
  ok(h.last(b, 'sail_welcome') !== undefined, 'phones are told about the reset');
}
{
  const h = harness(30);
  const led = h.client('led', 'led');
  const phone = h.client('p');
  h.hub.handle(phone, { type: 'sail_host', token: 'wrong', action: 'sound', value: false });
  h.hub.tick();
  ok(h.last(phone, 'sail_state').soundOn === true, 'a phone without the token cannot silence the room');
  h.host(led, 'sound', { value: false });
  ok(h.last(phone, 'sail_state').soundOn === false, 'the host fades the sound on every device');
  h.host(led, 'reset');
  ok(h.last(phone, 'sail_welcome').soundOn === true, 'Reset brings the sound back');
}
{
  const h = harness(30);
  const led = h.client('led', 'led');
  const a = h.client('a');
  h.host(led, 'start');
  h.advance(COUNTDOWN_MS);
  h.sail(a, SAIL_SECONDS);
  ok(h.hub.stats().phase === 'sailing', 'threshold 30: one arrival is not enough');
  h.host(led, 'threshold', { value: 1 });
  ok(h.hub.stats().phase === 'open', 'lowering the threshold below the arrivals opens at once');
}
{
  const h = harness(30);
  const led = h.client('led', 'led');
  h.client('a');
  h.host(led, 'start');
  h.host(led, 'open');
  ok(h.hub.stats().phase === 'open', 'host "Open now" works with almost nobody there');
  const before = h.last(led, 'sail_state').openAt;
  h.advance(5000);
  h.host(led, 'open');
  ok(h.last(led, 'sail_state').openAt === before, 'pressing it twice does not restart the animation');
}
{
  const h = harness(3);
  const led = h.client('led', 'led');
  h.host(led, 'start');
  h.advance(COUNTDOWN_MS);
  const a = h.client('a');
  h.advance(5000);
  h.sail(a, SAIL_SECONDS);
  ok(h.hub.stats().arrived === 1, 'someone joining mid-race can still sail the full route');
  const c = h.client('a-again');
  h.hub.drop(c);
  h.hub.handle({ orphan: true }, { type: 'sail_progress', p: 1 });
  ok(h.hub.stats().arrived === 1, 'messages from an unknown connection are ignored');
}

{
  const h = harness(3);
  const rude = { id: 'r' };
  h.inbox.set(rude, []);
  h.hub.handle(rude, { type: 'sail_join', view: 'player', id: 'r', name: 'anything typed' });
  ok(h.last(rude, 'sail_welcome').you.name === 'Boat 1', 'boats are named by the server: no typed text reaches the LED');
}

console.log('\nFull race over WebSockets');
const PORT = 8799;
const server = spawn(process.execPath, ['server/presence.js'], {
  env: {
    ...process.env, PORT: String(PORT), ANALYTICS_TOKEN: 'test-token', SUPABASE_URL: '', VITE_SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '', ENGAGEMENT_PATH: join(tmpdir(), `sail-test-${process.pid}.json`),
    PLEDGES_FILE: join(tmpdir(), `sail-test-pledges-${process.pid}.json`),
  },
  stdio: 'ignore',
});
process.on('exit', () => server.kill());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {}
  await sleep(250);
}

function connect(view, id) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/presence`);
  const inbox = [];
  ws.on('message', (raw) => inbox.push(JSON.parse(raw.toString())));
  return new Promise((res) => ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'sail_join', view, id, name: id }));
    res({ ws, inbox, send: (m) => ws.send(JSON.stringify(m)), last: (t) => [...inbox].reverse().find((m) => m.type === t) });
  }));
}

const N = 40;
const led = await connect('led', 'led');
const phones = await Promise.all(Array.from({ length: N }, (_, i) => connect('player', `phone-${i}`)));
await sleep(600);
ok(led.last('sail_state')?.boats === N, `${N} phones in the harbor`, `LED sees ${led.last('sail_state')?.boats}`);
const hall = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
ok(hall.visitors === 0, 'boats are not hall visitors', `hall visitors ${hall.visitors}`);
ok(hall.sail && hall.sail.boats === N, '/health reports the race');

led.send({ type: 'sail_host', token: 'nope', action: 'start' });
await sleep(150);
ok(led.last('sail_host_result')?.ok === false, 'wrong host token refused');
led.send({ type: 'sail_host', token: 'test-token', action: 'threshold', value: 30 });
led.send({ type: 'sail_host', token: 'test-token', action: 'start' });
await sleep(150);
const startState = led.last('sail_state');
ok(startState?.phase === 'sailing', 'host Start received by the LED');
await sleep(COUNTDOWN_MS);

// Phones hold the sail for 15 s (a few set off late) and report 4 times a second, like the client.
const t0 = Date.now();
const delays = phones.map((_, i) => (i < 30 ? 0 : 3000));
const timer = setInterval(() => {
  const t = Date.now() - t0;
  phones.forEach((ph, i) => {
    const p = Math.min(1, Math.max(0, t - delays[i]) / (SAIL_SECONDS * 1000));
    if (p > 0) ph.send({ type: 'sail_progress', p });
  });
}, 250);
let opened = null;
for (let i = 0; i < 100 && !opened; i++) {
  await sleep(250);
  const s = led.last('sail_state');
  if (s?.phase === 'open') opened = s;
}
clearInterval(timer);
const took = (Date.now() - t0) / 1000;
ok(!!opened, 'the 30th arrival opens the marketplace');
ok(took > 14 && took < 17, 'it took about 15 seconds of sailing', `${took.toFixed(1)} s`);
ok(opened && opened.arrived >= 30, 'with 30 boats in', `${opened?.arrived} arrived`);
await sleep(300);
const openAts = new Set(phones.map((p) => p.last('sail_state')?.openAt));
ok(openAts.size === 1 && [...openAts][0] === opened?.openAt, 'all 40 phones and the LED share one opening time');
const ranks = led.inbox.filter((m) => m.type === 'sail_arrived').map((m) => m.rank);
ok(new Set(ranks).size === ranks.length && ranks[0] === 1, 'ranks are unique, starting at 1', `${ranks.length} ranks`);

// A hall visitor on the same server is untouched by all this.
const visitorWs = await new Promise((res) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/presence`);
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'join', id: 'hall-1', name: 'Hall' }));
    res(ws);
  });
});
await sleep(200);
const hall2 = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
ok(hall2.visitors === 1, 'the hall still works alongside the race');
visitorWs.close();

server.kill();
console.log(failed ? `\n${failed} FAILED\n` : '\nAll passed\n');
process.exit(failed ? 1 : 0);
