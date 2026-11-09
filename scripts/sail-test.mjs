/**
 * Tests for the sailing opening's rules (src/sail/raceHub.js), on a fake clock, then the whole
 * two-part opening for real over WebSockets against a presence server started on a spare port.
 *
 *   npm run sail:test
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRaceHub, COUNTDOWN_MS, OPEN_LEAD_MS, SAIL_SECONDS, ENERGY_LEAD_MS, TAPS_EACH, MIN_ENERGY,
} from '../src/sail/raceHub.js';

const require = createRequire(pathToFileURL(`${process.cwd()}/package.json`));
const WebSocket = require('ws');

let failed = 0;
function ok(cond, name, detail = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failed++;
}

function harness({ threshold = 3, mode = 'together' } = {}) {
  let clock = 1_000_000;
  const inbox = new Map();
  const hub = createRaceHub({
    token: 'secret', threshold, mode, now: () => clock,
    deliver: (c, m) => inbox.get(c).push(m),
  });
  /** A phone that names its boat (or a screen, for views other than player). */
  const client = (id, view = 'player', name = `Boat ${id}`) => {
    const c = { id };
    inbox.set(c, []);
    hub.handle(c, { type: 'sail_join', view, id, ...(view === 'player' ? { name } : {}) });
    return c;
  };
  return {
    hub, client, inbox,
    advance: (ms) => { clock += ms; },
    host: (c, action, extra = {}) => hub.handle(c, { type: 'sail_host', token: 'secret', action, ...extra }),
    last: (c, type) => [...inbox.get(c)].reverse().find((m) => m.type === type),
    /** Sail at full speed in steps, like a phone tapping steadily. */
    sail(c, seconds) {
      for (let t = 0; t < seconds * 4; t++) {
        clock += 250;
        const prev = c._p || 0;
        c._p = Math.min(1, prev + 0.25 / SAIL_SECONDS);
        hub.handle(c, { type: 'sail_progress', p: c._p });
      }
    },
    /** Everyone in `phones` taps `rate` times a second for `seconds`, sending every 250 ms. */
    tap(phones, rate, seconds) {
      for (let t = 0; t < seconds * 4; t++) {
        clock += 250;
        for (const ph of phones) hub.handle(ph, { type: 'sail_tap', n: Math.round(rate / 4) });
      }
    },
  };
}

console.log('\nBoat names');
{
  const h = harness();
  const led = h.client('led', 'led');
  const anon = { id: 'anon' };
  h.inbox.set(anon, []);
  h.hub.handle(anon, { type: 'sail_join', view: 'player', id: 'anon' });
  ok(h.last(anon, 'sail_welcome').you === null, 'a phone without a name has no boat yet');
  h.hub.handle(anon, { type: 'sail_join', view: 'player', id: 'anon', name: 'tangina mo' });
  ok(h.last(anon, 'sail_name_result').ok === false && h.last(anon, 'sail_welcome').you === null, 'a rude name is refused by the server, whatever the phone checked');
  h.hub.handle(anon, { type: 'sail_join', view: 'player', id: 'anon', name: 'call 09171234567' });
  ok(h.last(anon, 'sail_name_result').reason === 'contact', 'contact details are refused');
  h.hub.handle(anon, { type: 'sail_join', view: 'player', id: 'anon', name: '  Brave   <b>Otter</b> ' });
  const you = h.last(anon, 'sail_welcome').you;
  ok(you && you.name === 'Brave bOtterb', 'a good name gets a boat, cleaned of markup', you && you.name);
  ok(h.last(led, 'sail_boat')?.name === you.name, 'the big screen hears the new name');
  h.hub.handle(anon, { type: 'sail_join', view: 'player', id: 'anon', name: 'Sea Spark' });
  ok(h.last(anon, 'sail_welcome').you.name === 'Sea Spark' && h.hub.stats().boats === 1, 'naming again renames the same boat');
  h.host(led, 'hide', { n: you.n });
  ok(h.last(led, 'sail_boat').name === `Boat ${you.n + 1}`, 'the host can hide a name');
  ok(h.last(anon, 'sail_name_result').hidden === true, 'and the phone is told');
  const sneaky = { id: 's' };
  h.inbox.set(sneaky, []);
  h.hub.handle(sneaky, { type: 'sail_host', token: 'nope', action: 'hide', n: 0 });
  ok(h.last(sneaky, 'sail_host_result') === undefined, 'a connection that never joined is ignored');
}

console.log('\nTwo-part opening (fake clock)');
{
  const h = harness();
  const led = h.client('led', 'led');
  const a = h.client('a'), b = h.client('b'), c = h.client('c'), d = h.client('d');
  h.hub.tick();
  ok(h.last(led, 'sail_state').boats === 4 && h.last(led, 'sail_state').mode === 'together', 'four boats, two-part mode by default');

  h.hub.handle(a, { type: 'sail_progress', p: 0.5 });
  ok(h.last(a, 'sail_snap') === undefined, 'boats cannot move before the host starts');
  h.host(led, 'start');
  h.advance(COUNTDOWN_MS);
  h.hub.handle(a, { type: 'sail_progress', p: 1 });
  ok(h.hub.stats().arrived === 0, 'claiming p=1 straight away does not arrive');

  h.sail(b, SAIL_SECONDS);
  let st = h.last(led, 'sail_state');
  ok(st.phase === 'challenge' && st.winnerName === 'Boat b', 'the first boat home wins, and the challenge begins', st.winnerName);
  ok(st.challengeAt - st.now === OPEN_LEAD_MS, 'every screen gets the same moment for the challenge');
  h.sail(c, SAIL_SECONDS);
  ok(h.hub.stats().arrived === 2 && h.hub.stats().phase === 'challenge', 'others still reach the lighthouse; it stays a challenge');

  h.tap([a, b, c, d], 8, 2);
  ok(h.hub.stats().taps === 0, 'taps before the host lights the lighthouse count for nothing');
  h.hub.handle(a, { type: 'sail_host', token: 'wrong', action: 'light' });
  ok(h.hub.stats().phase === 'challenge', 'a phone without the token cannot start the lighting');
  h.host(led, 'light');
  st = h.last(led, 'sail_state');
  ok(st.phase === 'energy' && st.energyAt - st.now === ENERGY_LEAD_MS, 'Light the lighthouse: the energy stage, after a lead-in');
  ok(st.energyGoal === Math.max(MIN_ENERGY, 4 * TAPS_EACH), 'the energy needed scales with the boats online', `${st.energyGoal}`);
  h.tap([a], 8, 1);
  ok(h.hub.stats().taps === 0, 'no taps count during the lead-in');
  h.advance(ENERGY_LEAD_MS);

  h.hub.handle(a, { type: 'sail_tap', n: 1000 });
  ok(h.hub.stats().taps <= 12, 'one phone cannot send a burst of fake taps', `${h.hub.stats().taps} credited`);
  const before = h.hub.stats().taps;
  h.tap([a], 40, 2);
  ok(h.hub.stats().taps - before <= 2 * 12 + 1, 'nor tap faster than a person can', `${h.hub.stats().taps - before} in 2 s`);
  h.tap([a, b, c, d], 6, 1);
  ok(h.hub.stats().phase === 'energy', 'part-way: still lighting', `${h.hub.stats().taps}/${h.hub.stats().energyGoal}`);
  h.tap([a, b, c, d], 6, 14);
  st = h.last(led, 'sail_state');
  ok(st.phase === 'open' && st.openAt - st.now === OPEN_LEAD_MS, 'when the room fills the meter, the marketplace opens');
  ok(st.taps === st.energyGoal, 'the meter ends exactly full');
  h.tap([a], 6, 1);
  ok(h.hub.stats().taps === st.energyGoal, 'taps after opening are ignored');

  const late = h.client('late');
  ok(h.last(late, 'sail_welcome').phase === 'open', 'a phone joining afterwards goes straight to the open state');

  h.host(led, 'reset');
  const r = h.last(led, 'sail_welcome');
  ok(r.phase === 'harbor' && r.winner === -1 && r.taps === 0, 'host Reset clears the winner and the energy');
}
{
  const h = harness();
  const led = h.client('led', 'led');
  h.client('a');
  h.host(led, 'start');
  h.host(led, 'light');
  ok(h.hub.stats().phase === 'sailing', 'Light does nothing until a boat has won');
  h.host(led, 'open');
  ok(h.hub.stats().phase === 'open', 'host "Skip to the opening" works at any stage');
  const before = h.last(led, 'sail_state').openAt;
  h.advance(5000);
  h.host(led, 'open');
  ok(h.last(led, 'sail_state').openAt === before, 'pressing it twice does not restart the finale');
}
{
  const h = harness();
  const led = h.client('led', 'led');
  const a = h.client('a');
  h.host(led, 'start');
  h.advance(COUNTDOWN_MS);
  h.sail(a, SAIL_SECONDS);
  h.host(led, 'light');
  h.advance(ENERGY_LEAD_MS);
  h.tap([a], 8, 3);
  ok(h.hub.stats().phase === 'energy', 'one person alone has a lot to light', `${h.hub.stats().taps}/${h.hub.stats().energyGoal}`);
  h.host(led, 'open');
  ok(h.hub.stats().phase === 'open', 'Finish lighting now opens it');
  h.host(led, 'reset');
  h.host(led, 'mode', { value: 'classic' });
  ok(h.hub.stats().mode === 'classic', 'the host can switch to the classic opening in the harbor');
  h.host(led, 'start');
  h.host(led, 'mode', { value: 'together' });
  ok(h.hub.stats().mode === 'classic', 'but not once the race has started');
}

console.log('\nClassic opening (fake clock)');
{
  const h = harness({ threshold: 3, mode: 'classic' });
  const led = h.client('led', 'led');
  const a = h.client('a'), b = h.client('b'), c = h.client('c'), d = h.client('d');
  h.host(led, 'start');
  h.advance(COUNTDOWN_MS);
  h.sail(b, SAIL_SECONDS);
  ok(h.hub.stats().phase === 'sailing', 'the first arrival does not stop a classic race');
  h.sail(c, SAIL_SECONDS);
  const rejoin = { id: 'b2' };
  h.inbox.set(rejoin, []);
  h.hub.handle(rejoin, { type: 'sail_join', view: 'player', id: 'b' });
  ok(h.last(rejoin, 'sail_welcome').you.rank === 1, 'a refresh keeps your boat and your place');
  h.sail(d, SAIL_SECONDS);
  ok(h.hub.stats().phase === 'open', 'the third arrival opens the marketplace');
  void a;
}
{
  const h = harness({ threshold: 30, mode: 'classic' });
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
  const h = harness();
  const led = h.client('led', 'led');
  const phone = h.client('p');
  h.host(led, 'sound', { value: false });
  ok(h.last(phone, 'sail_state').soundOn === false, 'the host fades the sound on every device');
  h.host(led, 'reset');
  ok(h.last(phone, 'sail_welcome').soundOn === true, 'Reset brings the sound back');
}

console.log('\nThe whole two-part opening over WebSockets');
const PORT = 8799;
const server = spawn(process.execPath, ['server/presence.js'], {
  env: {
    ...process.env, PORT: String(PORT), ANALYTICS_TOKEN: 'test-token', SAIL_TOKEN: '', SUPABASE_URL: '', VITE_SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '', ENGAGEMENT_PATH: join(tmpdir(), `sail-test-${process.pid}.json`),
    PLEDGES_FILE: join(tmpdir(), `sail-test-pledges-${process.pid}.json`),
    COMMITMENTS_PATH: join(tmpdir(), `sail-test-commit-${process.pid}.json`),
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
    ws.send(JSON.stringify({ type: 'sail_join', view, id, ...(view === 'player' ? { name: `Ship ${id.slice(6)}` } : {}) }));
    res({ ws, inbox, send: (m) => ws.send(JSON.stringify(m)), last: (t) => [...inbox].reverse().find((m) => m.type === t) });
  }));
}

const N = 40;
const led = await connect('led', 'led');
const phones = await Promise.all(Array.from({ length: N }, (_, i) => connect('player', `phone-${i}`)));
await sleep(600);
ok(led.last('sail_state')?.boats === N, `${N} named boats in the harbor`, `LED sees ${led.last('sail_state')?.boats}`);
const hall = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
ok(hall.visitors === 0, 'boats are not hall visitors', `hall visitors ${hall.visitors}`);
ok(hall.sail && hall.sail.mode === 'together', '/health reports the race and its mode');

led.send({ type: 'sail_host', token: 'nope', action: 'start' });
await sleep(150);
ok(led.last('sail_host_result')?.ok === false, 'wrong host token refused');
led.send({ type: 'sail_host', token: 'test-token', action: 'start' });
await sleep(150);
ok(led.last('sail_state')?.phase === 'sailing', 'host Start received by the LED');
await sleep(COUNTDOWN_MS);

// Phone 7 taps fastest; the rest set off a little later.
const t0 = Date.now();
const timer = setInterval(() => {
  const t = Date.now() - t0;
  phones.forEach((ph, i) => {
    const p = Math.min(1, Math.max(0, t - (i === 7 ? 0 : 600 + i * 40)) / (SAIL_SECONDS * 1000));
    if (p > 0) ph.send({ type: 'sail_progress', p });
  });
}, 250);
let challenge = null;
for (let i = 0; i < 200 && !challenge; i++) {
  await sleep(250);
  const s = led.last('sail_state');
  if (s?.phase === 'challenge') challenge = s;
}
const took = (Date.now() - t0) / 1000;
ok(!!challenge, 'the first boat home starts the challenge');
ok(challenge && challenge.winnerName === 'Ship 7', 'and it is the fastest boat', challenge?.winnerName);
ok(took > SAIL_SECONDS - 1 && took < SAIL_SECONDS + 2, `after about ${SAIL_SECONDS} seconds of sailing`, `${took.toFixed(1)} s`);
await sleep(300);
const challengeAts = new Set(phones.map((p) => p.last('sail_state')?.challengeAt));
ok(challengeAts.size === 1, 'every phone shows the challenge at the same moment');

led.send({ type: 'sail_host', token: 'test-token', action: 'light' });
await sleep(200);
const energySt = led.last('sail_state');
ok(energySt?.phase === 'energy' && energySt.energyGoal === N * TAPS_EACH, 'Light the lighthouse: everyone has energy to send', `goal ${energySt?.energyGoal}`);
await sleep(energySt.energyAt - energySt.now + 50);
const e0 = Date.now();
const tapper = setInterval(() => phones.forEach((ph) => ph.send({ type: 'sail_tap', n: 2 })), 250);
let opened = null;
for (let i = 0; i < 80 && !opened; i++) {
  await sleep(250);
  const s = led.last('sail_state');
  if (s?.phase === 'open') opened = s;
}
clearInterval(tapper);
clearInterval(timer);
ok(!!opened, 'the room lights the lighthouse and the marketplace opens', `${((Date.now() - e0) / 1000).toFixed(1)} s of tapping at 8 a second`);
await sleep(300);
const openAts = new Set(phones.map((p) => p.last('sail_state')?.openAt));
ok(openAts.size === 1 && [...openAts][0] === opened?.openAt, `all ${N} phones and the LED share one opening time`);

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
