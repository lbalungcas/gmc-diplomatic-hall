/**
 * Tests for the commitment wall: the screening, who can see what, the finale, the bulb layout, and a
 * real server, including that commitments survive it restarting.
 *
 *   npm run commit:test
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { screenCommitment, cleanCommitment, MAX_LEN } from '../src/commit/moderate.js';
import { createWallHub, FINALE_LEAD_MS, MAX_PER_VISITOR } from '../src/commit/wallHub.js';
import { layoutMosaic } from '../src/commit/mosaic.js';
import { SAMPLES } from '../src/commit/samples.js';

const require = createRequire(pathToFileURL(`${process.cwd()}/package.json`));
const WebSocket = require('ws');

let failed = 0;
function ok(cond, name, detail = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failed++;
}

console.log('\nScreening');
const expect = {
  block: ['fuck this', 'FUUUCK', 'sh1t', 'f u c k', 'p.u.t.a', 'putang ina', 'gago ka', 'a$$hole', 'you ass'],
  contact: ['call me 0917 123 4567', 'maria@gmail.com', 'www.example.com', 'follow @maria_ph', 'see example.org', 'text +63 917 555 1234'],
  flag: ['end child sexual abuse in my town', 'stop rape culture', 'protect children from online porn', 'my uncle hurts me', 'i was abused', 'help me please', 'I want to die'],
  ok: [
    'make my class safer', 'push it forward together', 'gagawin ko ang lahat para sa mga bata', 'protect children every day',
    'listen to young people in 2026', 'assist the Dickens reading club', 'end violence against children', 'pass kind laws',
    'put a stop to bullying', 'tumulong sa kapwa', 'shape policies with youth', ...SAMPLES,
  ],
  empty: ['', '   ', 'a', '!!!', '😀😀😀'],
};
for (const [verdict, list] of Object.entries(expect)) {
  for (const text of list) {
    const got = screenCommitment(text).verdict;
    if (got !== verdict || text.length < 40) ok(got === verdict, `${verdict}: "${text}"`, got === verdict ? '' : `got ${got}`);
  }
}
ok(screenCommitment('my uncle hurts me').note.includes('Safeguarding'), 'a possible disclosure tells the moderator to alert the Safeguarding Team');
ok(cleanCommitment('I commit to listen') === 'listen', 'the "I commit to" prefix is not repeated', cleanCommitment('I commit to listen'));
ok(cleanCommitment('I will commit: listen') === 'listen', 'nor its variations');
ok(cleanCommitment('<b>hi</b> there 😀') === 'bhi/b there', 'markup and emoji are stripped', cleanCommitment('<b>hi</b> there 😀'));
ok(cleanCommitment('x'.repeat(500)).length === MAX_LEN, 'length is capped');

console.log('\nWho can see what (fake clock)');
function harness(opts = {}) {
  let clock = 1_000_000;
  const inbox = new Map();
  const saved = new Map();
  const hub = createWallHub({
    token: 'secret', now: () => clock, deliver: (c, m) => inbox.get(c).push(m),
    store: { save: (i) => saved.set(i.id, i), remove: (id) => saved.delete(id), clear: () => saved.clear() },
    ...opts,
  });
  const client = (view, id, token) => {
    const c = { id };
    inbox.set(c, []);
    hub.handle(c, { type: 'commit_join', view, id, token });
    return c;
  };
  const h = {
    hub, client, inbox, saved,
    advance: (ms) => { clock += ms; },
    last: (c, type) => [...inbox.get(c)].reverse().find((m) => m.type === type),
    all: (c, type) => inbox.get(c).filter((m) => m.type === type),
    post: (c, text) => { hub.handle(c, { type: 'commit_post', cid: 'x', text }); return h.last(c, 'commit_result'); },
    admin: (c, action, extra = {}) => hub.handle(c, { type: 'commit_admin', token: 'secret', action, ...extra }),
  };
  return h;
}
{
  const h = harness();
  const wall = h.client('wall');
  const admin = h.client('admin', 'a', 'secret');
  const p1 = h.client('phone', 'v1');
  const p2 = h.client('phone', 'v2');
  const r = h.post(p1, 'protect every child');
  ok(r.ok && r.item.status === 'pending', 'a commitment waits for a moderator by default');
  ok(h.all(wall, 'commit_add').length === 0, 'the wall does not see it yet');
  ok(h.all(p2, 'commit_add').length === 0 && !JSON.stringify(h.inbox.get(p2)).includes('protect every child'), 'another phone never sees it');
  ok(h.last(admin, 'commit_admin_add').item.text === 'protect every child', 'the moderator does');
  ok(h.saved.size === 1, 'it is saved');

  const fake = h.client('admin', 'x', 'wrong');
  ok(h.last(fake, 'commit_denied') && h.last(fake, 'commit_welcome').view === 'wall' && !JSON.stringify(h.last(fake, 'commit_welcome').items).includes('protect'), 'a wrong token gets no pending commitments');
  h.hub.handle(p2, { type: 'commit_admin', token: 'nope', action: 'finale' });
  ok(!h.hub.stats().finaleAt && h.last(p2, 'commit_denied'), 'a phone cannot start the finale');

  const id = r.item.id;
  h.admin(admin, 'approve', { id });
  const added = h.last(wall, 'commit_add');
  ok(added.item.text === 'protect every child', 'approved: it appears on the wall');
  ok(!('visitor' in added.item), 'with nothing about who wrote it');
  ok(h.last(p1, 'commit_mine').item.status === 'approved', 'and the writer is told');
  h.hub.tick();
  ok(h.last(wall, 'commit_state').count === 1, 'the count goes up');

  h.advance(5000);
  const f = h.post(p2, 'stop child sexual abuse');
  ok(f.ok && h.last(admin, 'commit_admin_add').item.note, 'sensitive words are held and marked for the moderator');
  h.advance(5000);
  const plain = h.post(p2, 'mentor one young person');
  h.admin(admin, 'approveAll');
  ok(h.last(wall, 'commit_add').item.text === 'mentor one young person' && !h.all(wall, 'commit_add').some((m) => m.item.id === f.item.id), '"Approve all" leaves out what was marked');

  h.admin(admin, 'remove', { id: plain.item.id });
  ok(h.last(wall, 'commit_remove').id === plain.item.id && !h.saved.has(plain.item.id), 'removing takes it off the wall and deletes it for good');
  ok(h.last(p2, 'commit_mine').removed === true, 'and its writer is told');

  const bad = h.client('phone', 'bad');
  const before = h.saved.size;
  ok(h.post(bad, 'fuck this').reason === 'block' && h.saved.size === before, 'a blocked commitment is refused and never stored');
  ok(h.post(bad, 'call 09171234567').reason === 'contact', 'contact details are refused, with their own message');
}
{
  const h = harness({ approveFirst: false });
  const wall = h.client('wall');
  const admin = h.client('admin', 'a', 'secret');
  const p = h.client('phone', 'v');
  ok(h.post(p, 'plant more kindness').item.status === 'approved' && h.all(wall, 'commit_add').length === 1, 'auto-show mode: it goes straight to the wall');
  h.advance(5000);
  ok(h.post(p, 'report all abuse').item.status === 'pending', 'but flagged words are still held');
  ok(h.post(p, 'report all abuse').ok && h.saved.size === 2, 'a retry of the same words is not a second commitment');
  ok(h.post(p, 'too soon after').reason === 'too_fast', 'posting too quickly is refused');
  h.advance(5000);
  h.post(p, 'third one');
  h.advance(5000);
  ok(h.post(p, 'a fourth one').reason === 'limit', `${MAX_PER_VISITOR} commitments per person`);

  const other = h.client('phone', 'other');
  h.admin(admin, 'finale');
  const st = h.last(wall, 'commit_state');
  ok(st.finaleAt - st.now === FINALE_LEAD_MS && st.open === false, 'the finale gives every screen one start time');
  ok(h.post(other, 'late words').reason === 'closed', 'and closes the wall');
  const before = st.finaleAt;
  h.advance(3000);
  h.admin(admin, 'finale');
  ok(h.hub.stats().finaleAt === before, 'pressing it twice does not restart it');
  const late = h.client('wall');
  ok(h.last(late, 'commit_welcome').finaleAt === before, 'a wall refreshed mid-finale lands in the right moment');
  h.admin(admin, 'resetFinale');
  ok(!h.hub.stats().finaleAt, 'the finale can be reset after a rehearsal');
  h.admin(admin, 'clear');
  ok(h.hub.stats().live === 0 && h.hub.stats().waiting === 0 && h.saved.size === 0, '"Clear everything" empties the wall and the store');
  ok(h.last(late, 'commit_welcome').items.length === 0, 'on every screen');
}

console.log('\nThe bulb made of words');
{
  // A plain circle stands in for the bulb.
  const spans = (y) => {
    const d = y - 0.5;
    const half = Math.sqrt(Math.max(0, 0.25 - d * d));
    return half > 0 ? [[0.5 - half, 0.5 + half]] : [];
  };
  const area = Math.PI * 0.25;
  const words = (n) => Array.from({ length: n }, (_, i) => 1 + (i % 7) * 0.6);
  for (const n of [1, 3, 40, 500, 3500, 20000]) {
    const { slots, rowH } = layoutMosaic(words(n), spans, area);
    const placed = new Set(slots.filter((s) => !s.ghost).map((s) => s.word));
    ok(placed.size === n, `${n} words: every one is in the bulb`, `${slots.length} slots, row ${(rowH * 1000).toFixed(1)}/1000`);
    const outside = slots.filter((s) => Math.hypot(s.x - 0.5, s.y - 0.5) > 0.5 + rowH).length;
    ok(outside === 0, `${n} words: all inside the shape`);
    if (n <= 3) ok(slots.length > n * 2, `${n} words: repeated enough to still fill it`);
  }
  ok(layoutMosaic([], spans, area).slots.length === 0, 'no commitments: no crash');
}

console.log('\nA real server, restarted');
const PORT = 8801;
const FILE = join(tmpdir(), `commit-test-${process.pid}.json`);
const startServer = () => spawn(process.execPath, ['server/presence.js'], {
  env: {
    ...process.env, PORT: String(PORT), SAIL_TOKEN: 'host-token', SUPABASE_URL: '', VITE_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '',
    COMMITMENTS_PATH: FILE, ENGAGEMENT_PATH: join(tmpdir(), `commit-test-e-${process.pid}.json`), PLEDGES_FILE: join(tmpdir(), `commit-test-p-${process.pid}.json`),
  },
  stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUp() {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch {}
    await sleep(250);
  }
}
function connect(view, id, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/presence`);
  const inbox = [];
  ws.on('message', (raw) => inbox.push(JSON.parse(raw.toString())));
  return new Promise((res) => ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'commit_join', view, id, token }));
    res({ ws, inbox, send: (m) => ws.send(JSON.stringify(m)), last: (t) => [...inbox].reverse().find((m) => m.type === t) });
  }));
}
let server = startServer();
process.on('exit', () => server.kill());
await waitUp();
const N = 40;
const adm = await connect('admin', 'adm', 'host-token');
const phones = await Promise.all(Array.from({ length: N }, (_, i) => connect('phone', `p${i}`)));
phones.forEach((p, i) => p.send({ type: 'commit_post', cid: 'c', text: SAMPLES[i % SAMPLES.length] }));
await sleep(700);
ok(phones.every((p) => p.last('commit_result')?.ok), `${N} phones post at once`);
adm.send({ type: 'commit_admin', token: 'host-token', action: 'approveAll' });
await sleep(300);
const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
ok(health.commit.live === N && health.visitors === 0, 'approved, and none of them count as hall visitors');
ok(health.commit.storage === 'file', 'with no database, the server says so', health.commit.storage);
await sleep(800);      // the file write is debounced
server.kill();
await sleep(500);
server = startServer();
await waitUp();
await sleep(400);
const wall = await connect('wall', 'w');
await sleep(300);
ok(wall.last('commit_welcome')?.items.length === N, 'after a restart, every commitment is still there', `${wall.last('commit_welcome')?.items.length}`);
const back = await connect('phone', 'p3');
await sleep(200);
ok(back.last('commit_welcome')?.items[0]?.status === 'approved', 'and a phone gets its own back, with its status');
server.kill();
try { rmSync(FILE); } catch {}
console.log(failed ? `\n${failed} FAILED\n` : '\nAll passed\n');
process.exit(failed ? 1 : 0);
