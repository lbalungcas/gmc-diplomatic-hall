/**
 * Headless check of the Deal Corner Experts page (/deal-corner/) and the landing page's links to it.
 *
 *   npm run build && npx vite preview --port 5392 --strictPort --host 127.0.0.1
 *   node scripts/check-deal-corner.mjs [baseUrl] [screenshotDir]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire('file:///' + process.cwd().replace(/\\/g, '/') + '/');
const WebSocket = require('ws');
const BASE = process.argv[2] || 'http://127.0.0.1:5392';
const SHOTS = process.argv[3] || '';
const PORT = 9337;

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--hide-scrollbars', '--mute-audio', '--no-first-run',
  `--user-data-dir=${process.env.TEMP}\\deal-corner-check`, '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => chrome.kill());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
for (let i = 0; i < 60 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up */ }
  if (!page) await sleep(500);
}

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.on('open', r));
let id = 0;
const pending = new Map();
const errors = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`${m.params.entry.text} ${m.params.entry.url || ''}`);
});
const send = (method, params = {}) => new Promise((res, rej) => {
  pending.set(++id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const viewport = (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
const go = async (path) => { await send('Page.navigate', { url: BASE + path }); await sleep(1800); };
const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
};

const results = [];
const check = async (name, expr) => {
  try {
    const v = await evaluate(expr);
    results.push([v && v.ok ? 'PASS' : 'FAIL', name, v && v.detail !== undefined ? String(v.detail) : '']);
  } catch (e) {
    results.push(['ERROR', name, e.message.slice(0, 160)]);
  }
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await viewport(1440, 900);
await go('/deal-corner/');

await check('seven tracks in order, 01 to 07', `
  const nos = [...document.querySelectorAll('.dc-track .thematic-tag')].map(t => t.firstChild.textContent);
  return { ok: nos.join() === 'Track 01,Track 02,Track 03,Track 04,Track 05,Track 06,Track 07', detail: nos.join(' | ') };`);
await check('14 expert cards; Amina on Child Marriage and ASRH; no track says coming soon', `
  const cards = document.querySelectorAll('.dc-expert').length;
  const cefmu = document.querySelectorAll('#child-marriage .dc-expert').length;
  const asrh = [...document.querySelectorAll('#asrh .dc-expert h3')].map(h => h.textContent);
  const soon = document.querySelectorAll('.dc-soon').length;
  const ids = [...document.querySelectorAll('[id]')].map(n => n.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  return { ok: cards === 14 && cefmu === 4 && asrh.join() === 'Dr. Amina Moni' && !soon && !dupes.length,
    detail: cards + ' cards, ' + cefmu + ' on Child Marriage, ASRH: ' + asrh.join() + '; coming soon: ' + soon + '; duplicate ids: ' + (dupes.join() || 'none') };`);
await check('facilitators after the tracks, the lead first, photos load', `
  const team = document.getElementById('facilitators');
  const after = document.getElementById('dcTracks').compareDocumentPosition(team) & Node.DOCUMENT_POSITION_FOLLOWING;
  const before = team.compareDocumentPosition(document.querySelector('.dc-cta')) & Node.DOCUMENT_POSITION_FOLLOWING;
  const people = [...team.querySelectorAll('.dc-member')].map(m => m.querySelector('h3').textContent + ' (' + m.querySelector('.dc-role').textContent + ')');
  const imgs = [...team.querySelectorAll('img')];
  imgs.forEach(i => { i.loading = 'eager'; });
  await Promise.all(imgs.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  const broken = imgs.filter(i => !i.naturalWidth).length;
  return { ok: !!after && !!before && people.length === 4 && people[0] === 'Lance Balungcas (Deal Corner Lead)' && imgs.length === 4 && !broken,
    detail: people.join(', ') + '; broken photos: ' + broken };`);
await check('hero counts come from the data', `
  const t = document.getElementById('dcTrackCount').textContent, e = document.getElementById('dcExpertCount').textContent;
  return { ok: t === '7' && e === '13', detail: t + ' tracks, ' + e + ' experts' };`);
await check('every expert has a photo and it loads', `
  const imgs = [...document.querySelectorAll('.dc-expert .dc-photo img')];
  imgs.forEach(i => { i.loading = 'eager'; });
  await Promise.all(imgs.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  const broken = imgs.filter(i => !i.naturalWidth).map(i => i.alt);
  const initials = [...document.querySelectorAll('.dc-initials')].map(n => n.textContent);
  return { ok: imgs.length === 14 && !broken.length && !initials.length, detail: imgs.length + ' photos, broken: ' + (broken.join('; ') || 'none') + ', initials: ' + initials.join() };`);
await check('all seven chips fit on one row at 1440 px', `
  const list = document.getElementById('dcChipsList');
  return { ok: list.scrollWidth <= list.clientWidth + 1, detail: list.scrollWidth + ' of ' + list.clientWidth + ' px' };`);
await check('no contact details on the page', `
  const text = document.body.innerText;
  const hit = text.match(/[\\w.+-]+@doj\\.gov\\.ph|0999-?9188070/);
  return { ok: !hit, detail: hit ? hit[0] : 'none' };`);
await shot('desk-top');

await check('clicking a chip scrolls its track under the sticky bars and marks the chip', `
  document.querySelector('.dc-chip[data-track="ocsea"]').click();
  await new Promise(r => setTimeout(r, 1500));
  const head = document.querySelector('#ocsea .dc-track-head').getBoundingClientRect();
  const bars = document.getElementById('dcChips').getBoundingClientRect().bottom;
  const active = document.querySelector('.dc-chip.active')?.dataset.track;
  return { ok: head.top >= bars - 2 && head.top < bars + 80 && active === 'ocsea', detail: 'head at ' + Math.round(head.top) + ', bars end ' + Math.round(bars) + ', active ' + active };`);
await shot('desk-ocsea');
await evaluate(`document.getElementById('facilitators').scrollIntoView(); document.querySelectorAll('.dc-reveal').forEach(n => n.classList.add('in')); return 1;`);
await sleep(600);
await shot('desk-team');

await check('"Read full bio" opens and closes the whole bio', `
  const card = document.querySelector('#ocsea .dc-expert');
  const bio = card.querySelector('.dc-bio'), btn = card.querySelector('.dc-more');
  const shut = bio.clientHeight;
  btn.click();
  const open = bio.clientHeight, expanded = btn.getAttribute('aria-expanded'), label = btn.textContent.trim();
  btn.click();
  return { ok: open > shut && expanded === 'true' && label === 'Show less' && btn.getAttribute('aria-expanded') === 'false',
    detail: shut + ' px -> ' + open + ' px, label "' + label + '"' };`);

await go('/deal-corner/#child-protection');
await check('a link to /deal-corner/#child-protection lands on Track 07', `
  const head = document.querySelector('#child-protection .dc-track-head').getBoundingClientRect();
  return { ok: head.top > 0 && head.top < 400, detail: 'Track 07 header at ' + Math.round(head.top) + ' px' };`);

await go('/');
await check('landing page links to the experts page (nav, drawer, Deal Corner card, agenda, footer)', `
  const where = ['.desktop-nav', '.mobile-nav-links', '#space-deal-corner', '#pane-deal-corner', '.main-footer'];
  const found = where.filter(sel => document.querySelector(sel + ' a[href="/deal-corner/"]'));
  return { ok: found.length === where.length, detail: 'found in ' + found.join(', ') };`);
await evaluate(`setTimeout(() => document.querySelector('.desktop-nav a[href="/deal-corner/"]').click(), 50); return 1;`);
await sleep(2200);
await check('clicking "Experts" in the landing nav opens the page', `
  return { ok: location.pathname === '/deal-corner/' && !!document.querySelector('.dc-expert'), detail: location.pathname };`);
await evaluate(`setTimeout(() => document.querySelector('.desktop-nav a[href="/#thematics"]').click(), 50); return 1;`);
await sleep(2200);
await check('"Themes" on the experts page goes back to the landing section', `
  return { ok: location.pathname === '/' && location.hash === '#thematics', detail: location.pathname + location.hash };`);

for (const [w, h, name] of [[768, 1024, 'tab'], [390, 844, 'mob']]) {
  await viewport(w, h, w < 500);
  for (const path of ['/', '/deal-corner/']) {
    await go(path);
    await check(`${w} px ${path}: the header fits, menu button on screen`, `
      const t = document.getElementById('mobileMenuBtn').getBoundingClientRect();
      const visible = getComputedStyle(document.getElementById('mobileMenuBtn')).display !== 'none';
      const vw = document.documentElement.clientWidth;
      const wide = innerWidth === ${w} ? [] : [...document.querySelectorAll('body *')]
        .filter(n => n.getBoundingClientRect().right > ${w} + 1 && n.getBoundingClientRect().width > 0 && ![...n.children].some(c => c.getBoundingClientRect().right > ${w} + 1))
        .slice(0, 4).map(n => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + '.' + [...n.classList].join('.'));
      return { ok: innerWidth === ${w} && (!visible || (t.right <= vw && t.left >= 0)),
        detail: 'layout width ' + innerWidth + ', ' + (visible ? 'menu button at ' + Math.round(t.left) + '-' + Math.round(t.right) : 'desktop nav') + (wide.length ? '; too wide: ' + wide.join(', ') : '') };`);
    if (w < 500) {
      await check(`${w} px ${path}: the menu drawer opens on screen`, `
        document.getElementById('mobileMenuBtn').click();
        await new Promise(r => setTimeout(r, 500));
        const d = document.getElementById('mobileDrawer').getBoundingClientRect();
        document.getElementById('closeDrawerBtn').click();
        await new Promise(r => setTimeout(r, 400));
        return { ok: d.right <= innerWidth + 1 && d.left >= 0 && d.height >= innerHeight - 1, detail: 'drawer ' + Math.round(d.left) + '-' + Math.round(d.right) + ', ' + Math.round(d.height) + ' px tall' };`);
    }
  }
  await check(`${w} px: the page does not scroll sideways; the chips scroll inside their bar`, `
    window.scrollTo(400, window.scrollY);
    await new Promise(r => setTimeout(r, 100));
    const x = window.scrollX;
    const list = document.getElementById('dcChipsList');
    const grid = getComputedStyle(document.querySelector('.dc-experts')).gridTemplateColumns.split(' ').length;
    return { ok: x === 0 && list.scrollWidth > list.clientWidth, detail: 'page scrollX ' + x + ', chips ' + list.scrollWidth + ' of ' + list.clientWidth + ' px, ' + grid + ' card column(s)' };`);
  await shot(`${name}-top`);
  await check(`${w} px: a chip jump keeps the header and chip bar stuck on screen`, `
    document.querySelector('.dc-chip[data-track="corporal-punishment"]').click();
    await new Promise(r => setTimeout(r, 1500));
    const header = document.getElementById('mainHeader').getBoundingClientRect();
    const bar = document.getElementById('dcChips').getBoundingClientRect();
    const head = document.querySelector('#corporal-punishment .dc-track-head').getBoundingClientRect();
    return { ok: Math.abs(header.top) < 1 && Math.abs(bar.top - header.bottom) < 1 && head.top >= bar.bottom - 2 && head.top < bar.bottom + 80,
      detail: 'header ' + Math.round(header.top) + '-' + Math.round(header.bottom) + ', bar ' + Math.round(bar.top) + '-' + Math.round(bar.bottom) + ', track at ' + Math.round(head.top) };`);
  await shot(`${name}-track`);
  await evaluate(`document.getElementById('facilitators').scrollIntoView(); document.querySelectorAll('.dc-reveal').forEach(n => n.classList.add('in')); return 1;`);
  await sleep(600);
  await shot(`${name}-team`);
}

await check('no script errors', `return { ok: true };`);
if (errors.length) results.push(['FAIL', 'console errors', errors.slice(0, 3).join(' || ')]);

for (const [s, n, d] of results) console.log(`${s.padEnd(5)} ${n}${d ? `  (${d})` : ''}`);
const bad = results.filter((r) => r[0] !== 'PASS').length;
console.log(bad ? `\n${bad} failed` : '\nAll passed');
process.exit(bad ? 1 : 0);
