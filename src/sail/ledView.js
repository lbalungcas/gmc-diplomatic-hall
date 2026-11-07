/**
 * The big screen: the whole fleet from the side, sailing left to right toward the lighthouse,
 * with the QR code to join, the live count, and who just arrived.
 *
 * It takes keyboard commands if opened with the host token: S start, O open now, R reset. If the
 * server is unreachable, O plays the opening on this screen alone, so the ceremony can always
 * happen in the room.
 */
import * as THREE from 'three';
import { createOpening, CUES } from './opening.js';
import { createSayings } from './sayings.js';
import { createAudio } from './audio.js';

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

async function drawQr(canvas, text) {
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 3;
  const scale = Math.floor(600 / (n + quiet * 2));
  const size = scale * (n + quiet * 2);
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#132A57';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
  }
}

export async function startLed(root, world, connect, { token }) {
  const { camera } = world;
  const audio = createAudio();

  const hud = el('div', 'led-hud');
  const title = el('div', 'led-title', '<span>Sail to the Lighthouse</span>');
  const counter = el('div', 'led-counter', '<div class="led-num"><b>0</b><i>/ 30</i></div><div class="led-sub">boats at the lighthouse</div><div class="led-meter"><div></div></div>');
  const num = counter.querySelector('b');
  const goal = counter.querySelector('i');
  const sub = counter.querySelector('.led-sub');
  const meter = counter.querySelector('.led-meter div');
  const arrivalsBox = el('div', 'led-arrivals');
  const join = el('div', 'led-join');
  const joinUrl = `${location.origin}/sail/`;
  const qrCanvas = document.createElement('canvas');
  join.append(qrCanvas, el('div', 'led-join-text', `<strong>Scan to set sail</strong><span>${joinUrl.replace(/^https?:\/\//, '')}</span>`));
  const big = el('div', 'big hidden');
  const status = el('div', 'pill warn hidden', 'Connecting to the race server…');
  const soundChip = el('button', 'led-sound', '🔊 Click for sound');
  soundChip.type = 'button';
  hud.append(title, counter, arrivalsBox, join, big, status, soundChip);
  root.append(hud);
  drawQr(qrCanvas, joinUrl).catch((err) => console.warn('[sail] QR failed', err));

  const unlock = () => {
    audio.unlock();
    soundChip.remove();
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  navigator.wakeLock?.request('screen').catch(() => {});

  const opening = await createOpening(world, { isLed: true, onCue: (name) => audio.cue(name) });
  const sayings = createSayings(world, { isLed: true });

  let localOpenAt = 0;     // set when the opening has to run without the server

  const net = connect({
    status(v) {
      status.classList.toggle('hidden', v);
    },
    arrived() {
      audio.bell();
      renderArrivals();
    },
    welcome() {
      renderArrivals();
      localOpenAt = 0;
      world.shown.clear();
      if (net.state.phase === 'harbor') opening.hide();
    },
  });

  function renderArrivals() {
    const rows = net.arrivals.slice(-6).reverse();
    arrivalsBox.innerHTML = rows.map((a) => `<div class="led-row"><b>#${a.rank}</b><span>${a.name}</span></div>`).join('');
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'o') {
      if (net.connected && token) net.host('open');
      else if (!localOpenAt) localOpenAt = Date.now() + 500;
    } else if (token && k === 's') net.host('start');
    else if (k === 'r') {
      if (localOpenAt) { localOpenAt = 0; opening.hide(); }
      if (token) net.host('reset');
    }
    else if (k === 'f') document.documentElement.requestFullscreen?.();
    else if (k === 'm') audio.setMuted(!audio.muted);
  });

  // Overview: from the side, so the route runs across the wide screen with the lighthouse at right.
  const FOV = 30;
  // The route takes the left three quarters of the screen; the panels have the right of it.
  const look = new THREE.Vector3(0, 9, -122);
  const basePos = new THREE.Vector3();
  function placeOverview(t) {
    const halfSpan = 142;
    const dist = (halfSpan / Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / camera.aspect;
    basePos.set(dist * 0.95 + Math.sin(t * 0.1) * 1.5, dist * 0.27, look.z);
  }

  const prev = { t: performance.now() };
  let clock = 0;
  let override = null;
  let lastCount = null;

  function loop(nowMs) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (nowMs - prev.t) / 1000);
    prev.t = nowMs;
    clock += dt;
    const t = clock;
    const s = net.state;
    const now = net.serverNow();

    const open = s.phase === 'open' || !!localOpenAt;
    world.updateFleet(net.boats.values(), t, dt, { glide: open });

    let leader = 0;
    for (const b of world.shown.values()) leader = Math.max(leader, b.p);
    const started = s.phase === 'sailing' && now >= s.startAt;
    sayings.updateOverview(leader, started && !open);
    if (open) sayings.hide();

    placeOverview(t);
    let openT = -1;
    if (override != null) openT = override;
    else if (localOpenAt) openT = (Date.now() - localOpenAt) / 1000;
    else if (s.phase === 'open') openT = (now - s.openAt) / 1000;
    if (open || override != null) {
      opening.update(Math.max(openT, 0), t, basePos, look, FOV);
    } else {
      world.setBoatScale(3.2);
      camera.position.copy(basePos);
      camera.fov = FOV;
      camera.updateProjectionMatrix();
      camera.lookAt(look);
    }

    audio.setScene(!open ? (s.phase === 'sailing' ? 'sail' : 'harbor') : openT < CUES.open + 2.2 ? 'hush' : 'open');

    audio.setSoundOn(s.soundOn !== false);

    // --- Panels.
    const inOpening = open || override != null;
    hud.classList.toggle('opening', inOpening);
    join.classList.toggle('hidden', inOpening || s.phase !== 'harbor');
    counter.classList.toggle('hidden', inOpening);
    title.classList.toggle('hidden', inOpening);
    arrivalsBox.classList.toggle('hidden', inOpening || s.phase === 'harbor');

    if (s.phase === 'harbor') {
      num.textContent = s.boats;
      goal.textContent = '';
      sub.textContent = s.boats === 1 ? 'boat in the harbor' : 'boats in the harbor';
      meter.style.width = '0%';
    } else {
      num.textContent = s.arrived;
      goal.textContent = `/ ${s.threshold}`;
      sub.textContent = 'boats at the lighthouse';
      meter.style.width = `${Math.min(100, (s.arrived / s.threshold) * 100)}%`;
    }

    let bigText = '';
    if (s.phase === 'sailing' && !inOpening) {
      const rem = (s.startAt - now) / 1000;
      if (rem > 0) bigText = rem > 3 ? 'Get ready…' : String(Math.ceil(rem));
      else if (rem > -1.2) bigText = 'SAIL!';
    }
    if (bigText !== lastCount && bigText && bigText !== 'Get ready…') {
      if (bigText === 'SAIL!') audio.go();
      else audio.tick();
    }
    lastCount = bigText;
    big.textContent = bigText;
    big.classList.toggle('hidden', !bigText);
    big.classList.toggle('small', bigText === 'Get ready…');

    world.frame(t, dt);
  }
  requestAnimationFrame(loop);

  audio.setClock(net.serverNow);
  window.__sail = { world, net, opening, audio, seek: (v) => { override = v; } };
}
