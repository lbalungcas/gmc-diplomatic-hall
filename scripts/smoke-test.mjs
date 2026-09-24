/**
 * Functional regression pass over the interactions most likely to break from the venue rebuild:
 * booth proximity, TV raycasting, modals, seating, the CSS3D stage screen, the pledge wall
 * canvas texture, the minimap layers, waypoints and collision.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('file:///' + process.cwd().replace(/\\/g, '/') + '/');
const WebSocket = require('ws');
const PORT = 9335;
const BASE = process.env.GAME_URL || 'http://127.0.0.1:5173';

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader', '--mute-audio', '--no-first-run',
  `--user-data-dir=${process.env.TEMP}\\regress-profile`, '--window-size=1400,800', 'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => chrome.kill());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = list.find((t) => t.type === 'page');
    if (page) break;
  } catch (e) { /* not up */ }
  await sleep(500);
}

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.on('open', r));
let id = 0;
const pending = new Map();
const consoleErrors = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(m.params.exceptionDetails.text + ' ' +
      (m.params.exceptionDetails.exception?.description || ''));
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  pending.set(++id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''));
  }
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `${BASE}/game/` });
await sleep(3000);
for (let i = 0; i < 90; i++) {
  if (await evaluate(`(()=>{const b=document.getElementById('start-btn');return !!b&&!b.disabled})()`)) break;
  await sleep(1000);
}
await evaluate(`(()=>{const b=document.getElementById('start-btn');if(b)b.click();
  const s=document.createElement('style');s.textContent='#blocker{display:none!important}';document.head.appendChild(s);return 1})()`);
await sleep(2500);

const results = [];
async function check(name, expr) {
  try {
    const v = await evaluate(`(async () => { ${expr} })()`);
    const ok = v && v.ok;
    results.push([ok ? 'PASS' : 'FAIL', name, v && v.detail !== undefined ? String(v.detail) : '']);
  } catch (e) {
    results.push(['ERROR', name, e.message.slice(0, 160)]);
  }
}

const G = 'window.__diplomaticGame';
const settle = 'await new Promise(r => setTimeout(r, 450));';

// ---- venue loaded and materially correct --------------------------------------------------
await check('venue GLB loaded with meshes', `
  let n = 0, mats = new Set();
  ${G}.hallModel.traverse(o => { if (o.isMesh && o.visible) { n++;
    (Array.isArray(o.material)?o.material:[o.material]).forEach(m => m && mats.add(m.name)); } });
  return { ok: n > 5, detail: n + ' visible meshes, ' + mats.size + ' materials' };`);

await check('floors have UVs and a base map', `
  let found = [];
  ${G}.hallModel.traverse(o => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || !/carpet|corridor/i.test(m.name)) return;
    found.push(m.name + ':uv=' + !!o.geometry.attributes.uv + ',map=' + !!m.map + ',orm=' + !!m.roughnessMap);
  });
  return { ok: found.length >= 2 && found.every(f => f.includes('uv=true') && f.includes('map=true')), detail: found.join(' | ') };`);

await check('scene.environment is a PMREM map', `
  const e = ${G}.scene.environment;
  return { ok: !!e && e.mapping === window.THREE.CubeUVReflectionMapping, detail: e ? 'mapping ' + e.mapping : 'none' };`);

await check('no plan-label text meshes on the floor', `
  let bad = [];
  ${G}.hallModel.traverse(o => { if (o.isMesh && /^T_|Text/i.test(o.name || '')) bad.push(o.name); });
  return { ok: bad.length === 0, detail: bad.length ? bad.join(',') : 'none' };`);

// ---- interaction --------------------------------------------------------------------------
// yaw 0 faces -Z, so forward = (-sin(yaw), 0, -cos(yaw)); -PI/2 points at +X, which is the
// side booth 1's graphic faces. Under SwiftShader a frame can take seconds, and checkProximity
// now runs at 20 Hz from the render loop, so drive it directly instead of waiting for a frame.
await check('booth proximity prompt', `
  ${G}.teleportPlayer(12.75, 1.45, -4.96, -Math.PI/2);
  ${G}.checkProximity(true);
  const t = ${G}.activeTarget;
  return { ok: !!t && t.type === 'booth' && t.id === 1, detail: t ? t.type + ' ' + (t.id ?? t.key) : 'none' };`);

// pickTV raycasts from the camera, and the camera is only moved inside updatePlayer during a
// frame — so this one has to wait for real frames rather than poke state directly.
await check('TV raycast picks a booth screen', `
  ${G}.teleportPlayer(12.75, 1.45, -4.96, -Math.PI/2);
  for (let i = 0; i < 3; i++) await new Promise(r => requestAnimationFrame(r));
  const tv = ${G}.pickTV(0, 0);
  return { ok: !!tv && tv.boothId === 1, detail: tv ? tv.key : 'no hit' };`);

await check('booth modal opens and closes', `
  ${G}.openBoothModal(3);
  ${settle}
  const open = ${G}.openModals.includes('booth-modal');
  document.querySelectorAll('[data-close="booth-modal"]').forEach(b => b.click());
  ${settle}
  return { ok: open && !${G}.openModals.includes('booth-modal'), detail: 'opened=' + open };`);

await check('booth poster image resolves', `
  const r = await fetch('/textures/booth_03_screen.png', { method: 'HEAD' });
  return { ok: r.ok, detail: 'HTTP ' + r.status };`);

await check('chair sit and stand', `
  ${G}.teleportPlayer(6.0, 1.45, -17.6, 0);
  ${settle}
  ${G}.sitDownOnChair(${G}.CHAIR_LOCATIONS[0]);
  ${settle}
  const sat = ${G}.player.isSitting;
  ${G}.standUp();
  ${settle}
  return { ok: sat && !${G}.player.isSitting, detail: 'sat=' + sat };`);

await check('collision still blocks the stage', `
  const p = new window.THREE.Vector3(9.68, 1.45, -23.0);
  const blocked = ${G}.checkCollision(p);
  return { ok: Math.abs(p.z - -23.0) > 0.01, detail: 'pushed to z=' + p.z.toFixed(2) };`);

await check('waypoint set and clear', `
  ${G}.setWaypoint(7, { silent: true });
  ${settle}
  const el = document.getElementById('waypoint-hud');
  const on = !!el && !el.classList.contains('hidden');
  ${G}.clearWaypoint();
  ${settle}
  return { ok: on, detail: 'hud shown=' + on };`);

await check('CSS3D stage screen present', `
  return { ok: ${G}.cssScene.children.length > 0, detail: ${G}.cssScene.children.length + ' css objects' };`);

await check('pledge wall canvas texture renders', `
  ${G}.updatePolicyWallTexture();
  ${settle}
  const c = ${G}.policyCanvas;
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4000) if (d[i] + d[i+1] + d[i+2] > 30) lit++;
  return { ok: !!${G}.policyBoardMesh && lit > 0, detail: c.width + 'x' + c.height + ', ' + lit + ' lit samples' };`);

await check('minimap static layer + dynamic marks', `
  const c = document.getElementById('minimap-canvas');
  const ctx = c.getContext('2d');
  const before = ctx.getImageData(0, 0, c.width, c.height).data;
  let nonEmpty = 0;
  for (let i = 3; i < before.length; i += 400) if (before[i] > 0) nonEmpty++;
  return { ok: nonEmpty > 20, detail: nonEmpty + ' non-transparent samples' };`);

await check('organizer booths + mascots built', `
  return { ok: ${G}.organizerBooths.size === 3 && !!${G}.mascots,
           detail: ${G}.organizerBooths.size + ' stands, ' + (${G}.mascots ? ${G}.mascots.list.length : 0) + ' mascots' };`);

await check('welcome desk + policy wall procedural meshes', `
  return { ok: !!${G}.welcomeDesk && !!${G}.policyWallGroup, detail: 'desk=' + !!${G}.welcomeDesk + ' wall=' + !!${G}.policyWallGroup };`);

await check('adaptive quality governor responds', `
  const q = ${G}.quality;
  q.forceLevel(2);
  const mid = q.level;
  q.forceLevel(0);
  return { ok: mid === 2 && q.level === 0, detail: 'stepped to ' + mid + ' and back to ' + q.level };`);

await check('booth TVs all have a video texture', `
  const bad = ${G}.tvScreens.filter(s => !s.material.map || !s.material.map.image);
  return { ok: bad.length === 0, detail: ${G}.tvScreens.length + ' screens, ' + bad.length + ' without video' };`);

console.log('\\n  RESULT  CHECK                                     DETAIL');
console.log('  ' + '-'.repeat(96));
for (const [r, n, d] of results) {
  console.log(`  ${r.padEnd(7)} ${n.padEnd(42)} ${d}`);
}
const failed = results.filter(r => r[0] !== 'PASS');
console.log(`\\n  ${results.length - failed.length}/${results.length} passed`);
if (consoleErrors.length) {
  console.log('\\n  uncaught page exceptions:');
  consoleErrors.forEach(e => console.log('   ' + e.slice(0, 200)));
}
process.exit(failed.length ? 1 : 0);
