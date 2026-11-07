/**
 * Rehearsal: N phones post made-up commitments to a commitment wall.
 *
 *   node scripts/commit-bots.mjs [count=60] [url=ws://127.0.0.1:8787/presence] [--token=HOST --approve]
 *
 * With --approve the host token approves them too. After a rehearsal, use "Clear everything" on the
 * admin panel so these words can't end up in the real bulb.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { SAMPLES } from '../src/commit/samples.js';

const require = createRequire(pathToFileURL(`${process.cwd()}/package.json`));
const WebSocket = require('ws');

const args = process.argv.slice(2);
const plain = args.filter((a) => !a.startsWith('--'));
const COUNT = Number(plain[0] || 60);
const URL_ = plain[1] || 'ws://127.0.0.1:8787/presence';
const token = (args.find((a) => a.startsWith('--token=')) || '').split('=')[1] || '';
const approve = args.includes('--approve');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sent = 0;
let rejected = 0;
await Promise.all(Array.from({ length: COUNT }, async (_, i) => {
  await sleep(i * 60);
  await new Promise((done) => {
    const ws = new WebSocket(URL_);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'commit_join', view: 'phone', id: `bot-${process.pid}-${i}` }));
      ws.send(JSON.stringify({ type: 'commit_post', cid: 'b', text: SAMPLES[i % SAMPLES.length] }));
    });
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type !== 'commit_result') return;
      if (m.ok) sent++;
      else rejected++;
      ws.close();
      done();
    });
    ws.on('error', (e) => { console.error(e.message); done(); });
  });
}));
console.log(`posted ${sent}, refused ${rejected}`);

if (approve) {
  const ws = new WebSocket(URL_);
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'commit_join', view: 'admin', token }));
  ws.send(JSON.stringify({ type: 'commit_admin', token, action: 'approveAll' }));
  await sleep(500);
  ws.close();
  console.log('approved');
}
process.exit(0);
