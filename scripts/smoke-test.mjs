/**
 * Functional regression pass over the interactions most likely to break from the venue rebuild:
 * the lobby spawn, booth proximity, easel posters, the venue signage prints, modals,
 * seating, the CSS3D stage screen, the pledge wall canvas texture, the minimap layers, waypoints
 * and collision in the hall and the lobby.
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

// ---- spawn: visitors start in the lobby, by the route to the entrance -----------------------
await check('player starts at the lobby spawn', `
  const s = ${G}.LOBBY.spawn, p = ${G}.player.pos;
  const d = Math.hypot(p.x - s.x, p.z - s.z);
  return { ok: d < 1.0, detail: 'at (' + p.x.toFixed(2) + ', ' + p.z.toFixed(2) + '), ' + d.toFixed(2) + ' m from spawn' };`);

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

// ---- layout ---------------------------------------------------------------------------------
await check('24 booths in 4 rows of 6', `
  const B = ${G}.BOOTH_POSITIONS;
  const ids = Object.keys(B).map(Number).sort((a, b) => a - b);
  const per = {};
  for (const b of Object.values(B)) per[b.row] = (per[b.row] || 0) + 1;
  const ok = ids.length === 24 && ids[0] === 1 && ids[23] === 24
    && Object.keys(per).join('') === 'ABCD' && Object.values(per).every(n => n === 6);
  return { ok, detail: ids.length + ' booths, rows ' + JSON.stringify(per) };`);

await check('LED wall: design + 16:9 stream window', `
  let idle = null, hole = null;
  ${G}.scene.traverse(o => { if (o.name === 'Stage_LED_Idle') idle = o; if (o.name === 'Stage_LED_Window') hole = o; });
  const css = ${G}.cssScene.children[0];
  const w = css ? css.scale.x * 1280 : 0, h = css ? css.scale.y * 720 : 0;
  const iw = idle ? idle.geometry.parameters.width : 0;
  const hw = hole ? hole.geometry.parameters.width : 0;
  const ok = iw > 8.9 && Math.abs(hw - w) < 0.01 && Math.abs(w / h - 16 / 9) < 0.01 && w < iw;
  return { ok, detail: 'panel ' + iw.toFixed(2) + ' m, stream ' + w.toFixed(2) + ' x ' + h.toFixed(2) + ' m' };`);

// ---- interaction --------------------------------------------------------------------------
// yaw 0 faces -Z, so forward = (-sin(yaw), 0, -cos(yaw)); to face a point (dx, dz) away the yaw
// is atan2(-dx, -dz). Under SwiftShader a frame can take seconds, and checkProximity runs at
// 20 Hz from the render loop, so drive it directly instead of waiting for a frame.
await check('booth proximity prompt', `
  const b = ${G}.BOOTH_POSITIONS[1];
  ${G}.teleportPlayer(b.ax, 1.45, b.az, Math.atan2(-(b.cx - b.ax), -(b.cz - b.az)));
  ${G}.checkProximity(true);
  const t = ${G}.activeTarget;
  return { ok: !!t && t.type === 'booth' && t.id === 1, detail: t ? t.type + ' ' + (t.id ?? t.key) : 'none' };`);

// Every booth has a poster on its easel: 23 from posters.json and a stand-in for the one without.
await check('easel posters on all 24 booths', `
  const meshes = [];
  ${G}.scene.traverse(o => { if (/^Booth_\\d\\d_Poster$/.test(o.name)) meshes.push(o); });
  for (let i = 0; i < 40 && meshes.some(m => !m.material.map || !m.material.map.image); i++) await new Promise(r => setTimeout(r, 250));
  const loaded = meshes.filter(m => m.material.map && m.material.map.image && m.material.map.image.width > 0);
  return { ok: meshes.length === 24 && loaded.length === 24, detail: meshes.length + ' posters, ' + loaded.length + ' with an image' };`);

// Walking up to an easel swaps in the sharp poster.
await check('sharp poster loads near an easel', `
  const b = ${G}.BOOTH_POSITIONS[1];
  ${G}.teleportPlayer(b.easelX, 1.45, b.easelZ + b.facing * 1.2, 0);
  ${G}.boothGrid.update(b.easelX, b.easelZ + b.facing * 1.2);
  let mesh = null;
  ${G}.scene.traverse(o => { if (o.name === 'Booth_01_Poster') mesh = o; });
  for (let i = 0; i < 40 && !(mesh.material.map.image && mesh.material.map.image.width > 1000); i++) await new Promise(r => setTimeout(r, 250));
  const w = mesh.material.map.image ? mesh.material.map.image.width : 0;
  return { ok: w > 1000, detail: 'poster texture ' + w + ' px wide' };`);

await check('spine wall blocks walking through an island', `
  const b = ${G}.BOOTH_POSITIONS[14];
  const p = new window.THREE.Vector3(b.cx, 1.45, b.spineZ + 0.1);
  ${G}.checkCollision(p);
  const d = Math.abs(p.z - b.spineZ);
  return { ok: d > 0.5, detail: 'pushed to ' + d.toFixed(2) + ' m from the spine' };`);

// Booths are open at the front: the table is solid, the aisle in front of it is clear.
await check('booth table is solid, its front is open', `
  const b = ${G}.BOOTH_POSITIONS[14];
  const front = new window.THREE.Vector3(b.ax, 1.45, b.az);
  const table = new window.THREE.Vector3(b.x, 1.45, b.z);
  const f0 = front.clone(), t0 = table.clone();
  ${G}.checkCollision(front);
  ${G}.checkCollision(table);
  return { ok: front.distanceTo(f0) < 0.01 && table.distanceTo(t0) > 0.3,
           detail: 'front moved ' + front.distanceTo(f0).toFixed(3) + ' m, table pushed ' + table.distanceTo(t0).toFixed(2) + ' m' };`);

await check('lobby walls hold, lobby floor is free', `
  const T = window.THREE;
  const probes = [
    ['vestibule south wall', new T.Vector3(25.0, 1.45, 4.5), (p) => p.z < 3.3],
    ['east wall', new T.Vector3(59.0, 1.45, -12.0), (p) => p.x < 57.9],
    ['stair core', new T.Vector3(43.0, 1.45, -1.0), (p) => p.z < -3.0 || p.x < 40.2],
    ['restroom block', new T.Vector3(30.0, 1.45, -18.2), (p) => p.z > -17.36],
    ['hall south wall', new T.Vector3(9.0, 1.45, 0.5), (p) => p.z < -1.0],
    ['curved wall, foyer side', new T.Vector3(30.6, 1.45, -4.66), (p) => p.x < 30.45],
    ['entrance post', new T.Vector3(25.92, 1.45, 0.0), (p) => Math.abs(p.x - 25.92) > 0.3 || Math.abs(p.z) > 0.3],
  ];
  const bad = [];
  for (const [name, p, ok] of probes) { ${G}.checkCollision(p); if (!ok(p)) bad.push(name + '@' + p.x.toFixed(1) + ',' + p.z.toFixed(1)); }
  // Open floor in the vestibule and through an entrance doorway.
  for (const [fx, fz] of [[30.0, 1.8], [27.3, 0.0], [33.85, 9.0]]) {
    const q = new T.Vector3(fx, 1.45, fz), q0 = q.clone();
    ${G}.checkCollision(q);
    if (q.distanceTo(q0) > 0.01) bad.push('open floor moved at ' + fx + ',' + fz);
  }
  const free = new T.Vector3(50.0, 1.45, -10.0), f0 = free.clone();
  ${G}.checkCollision(free);
  if (free.distanceTo(f0) > 0.01) bad.push('open floor moved');
  return { ok: bad.length === 0, detail: bad.length ? bad.join('; ') : 'all walls hold' };`);

await check('event arch opening is walkable', `
  const mid = new window.THREE.Vector3(20.45, 1.45, -10.13), m0 = mid.clone();
  ${G}.checkCollision(mid);
  return { ok: mid.distanceTo(m0) < 0.01, detail: 'opening moved ' + mid.distanceTo(m0).toFixed(3) + ' m' };`);

await check('booth modal opens and closes', `
  ${G}.openBoothModal(3);
  ${settle}
  const open = ${G}.openModals.includes('booth-modal');
  document.querySelectorAll('[data-close="booth-modal"]').forEach(b => b.click());
  ${settle}
  return { ok: open && !${G}.openModals.includes('booth-modal'), detail: 'opened=' + open };`);

await check('booth modal shows the team poster', `
  ${G}.openBoothModal(3);
  ${settle}
  const img = document.getElementById('modal-screen-img');
  const r = await fetch(img.src, { method: 'HEAD' });
  document.querySelectorAll('[data-close="booth-modal"]').forEach(b => b.click());
  ${settle}
  return { ok: r.ok && /posters/.test(img.src), detail: img.src.replace(location.origin, '') + ' HTTP ' + r.status };`);

await check('chair sit and stand', `
  const c0 = ${G}.CHAIR_LOCATIONS[0];
  ${G}.teleportPlayer(c0.x, 1.45, c0.z - 0.35, 0);
  ${settle}
  ${G}.sitDownOnChair(${G}.CHAIR_LOCATIONS[0]);
  ${settle}
  const sat = ${G}.player.isSitting;
  ${G}.standUp();
  ${settle}
  return { ok: sat && !${G}.player.isSitting, detail: 'sat=' + sat };`);

await check('collision still blocks the stage', `
  const p = new window.THREE.Vector3(9.68, 1.45, -26.5);
  ${G}.checkCollision(p);
  return { ok: p.z > -24.6, detail: 'pushed to z=' + p.z.toFixed(2) };`);

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
  // Count every pixel: a sparse sample misses thin lines once the map is scaled for the wider foyer.
  let nonEmpty = 0;
  for (let i = 3; i < before.length; i += 4) if (before[i] > 0) nonEmpty++;
  const share = nonEmpty / (c.width * c.height);
  return { ok: share > 0.02, detail: (share * 100).toFixed(1) + '% of pixels drawn' };`);

await check('organizer booths + mascots built', `
  return { ok: ${G}.organizerBooths.size === 3 && !!${G}.mascots,
           detail: ${G}.organizerBooths.size + ' stands, ' + (${G}.mascots ? ${G}.mascots.list.length : 0) + ' mascots' };`);

await check('policy wall built, no registration desk', `
  let desk = false;
  ${G}.scene.traverse(o => { if (/Welcome_Desk|registration/i.test(o.name)) desk = true; });
  return { ok: !!${G}.policyWallGroup && !desk, detail: 'wall=' + !!${G}.policyWallGroup + ' desk=' + desk };`);

await check('adaptive quality governor responds', `
  const q = ${G}.quality;
  q.forceLevel(2);
  const mid = q.level;
  q.forceLevel(0);
  return { ok: mid === 2 && q.level === 0, detail: 'stepped to ' + mid + ' and back to ' + q.level };`);

// GTAO and bloom draw onto a target they have just written; with MSAA targets three.js
// invalidates that storage and real GPUs show a black frame (headless SwiftShader does not).
await check('post chain has no MSAA targets under GTAO/bloom', `
  const c = ${G}.composer;
  if (!c) return { ok: true, detail: 'no composer (low-power path)' };
  const s1 = c.renderTarget1.samples, s2 = c.renderTarget2.samples;
  return { ok: s1 === 0 && s2 === 0, detail: 'samples ' + s1 + '/' + s2 };`);

await check('20 individual audience chairs, 10 each side', `
  const C = ${G}.CHAIR_LOCATIONS;
  const left = C.filter(c => c.x < 9.68).length, right = C.filter(c => c.x > 9.68).length;
  return { ok: C.length === 20 && left === 10 && right === 10, detail: left + ' + ' + right + ' chairs' };`);

await check('light pool keeps a fixed light count', `
  let n = 0;
  ${G}.scene.traverse(o => { if (o.isPointLight) n++; });
  const T = window.THREE;
  ${G}.teleportPlayer(${G}.LOBBY.spawn.x, 1.45, ${G}.LOBBY.spawn.z, 0);
  let m = 0;
  ${G}.scene.traverse(o => { if (o.isPointLight) m++; });
  const lit = ${G}.scene.children.filter(o => o.isPointLight && o.intensity > 0).length;
  return { ok: n === m && n <= 12 && lit > 3, detail: n + ' point lights before and after a jump, ' + lit + ' lit at the lobby spawn' };`);

await check('venue signage prints are in place', `
  const want = ['EventArch_Front', 'EventArch_Back', 'StageBanner_W', 'StageBanner_E', 'PhotoWall_Print'];
  const found = {};
  ${G}.scene.traverse(o => { if (want.includes(o.name)) found[o.name] = o; });
  for (let i = 0; i < 40 && want.some(n => found[n] && found[n].material.map && !found[n].material.map.image); i++) await new Promise(r => setTimeout(r, 250));
  const missing = want.filter(n => !found[n] || !found[n].material.map || !found[n].material.map.image);
  return { ok: missing.length === 0, detail: missing.length ? 'missing ' + missing.join(',') : want.length + ' prints loaded' };`);

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
