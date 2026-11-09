/**
 * The big screen: the whole fleet from the side, sailing left to right toward the lighthouse,
 * with the QR code to join, the boats' names, the live count, and who just arrived.
 *
 * In the two-part opening it then carries the challenge, and the room's energy filling the meter as
 * the lighthouse lights up. Once it is lit, the bulb rises out of it and the marketplace opens
 * (src/sail/opening.js), and the partners' billboard follows. Classic goes straight to the opening.
 *
 * It takes keyboard commands if opened with the host token: S start, L light the lighthouse,
 * O open now, R reset. If the server is unreachable, O plays the opening on this screen alone, so
 * the ceremony can always happen in the room.
 */
import * as THREE from 'three';
import { createOpening, CUES } from './opening.js';
import { createSayings } from './sayings.js';
import { createAudio } from './audio.js';
import { LINES, CHALLENGE_ASK, BILLBOARD_AT, createBillboard } from './together.js';
import { createNameTags } from './nameTags.js';

const NAMES_SHOWN = 48;
const LIT = 3.2;            // the lantern's level once the room has lit it

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));

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
  const namesBox = el('div', 'led-names');
  const join = el('div', 'led-join');
  const joinUrl = `${location.origin}/sail/`;
  const qrCanvas = document.createElement('canvas');
  join.append(qrCanvas, el('div', 'led-join-text', `<strong>Scan to set sail</strong><span>${joinUrl.replace(/^https?:\/\//, '')}</span>`));
  const banner = el('div', 'led-banner hidden', '<b></b><span></span>');
  const bannerBig = banner.querySelector('b');
  const bannerSmall = banner.querySelector('span');
  const energyBox = el('div', 'led-energy hidden', '<div class="led-energy-pct">0%</div><div class="led-energy-tube"><div></div></div><div class="led-energy-label">Energy</div>');
  const energyPct = energyBox.querySelector('.led-energy-pct');
  const energyFill = energyBox.querySelector('.led-energy-tube div');
  const big = el('div', 'big hidden');
  const status = el('div', 'pill warn hidden', 'Connecting to the race server…');
  const soundChip = el('button', 'led-sound', '🔊 Click for sound');
  soundChip.type = 'button';
  hud.append(title, counter, arrivalsBox, namesBox, join, banner, energyBox, big, status, soundChip);
  root.append(hud);
  const billboard = createBillboard(hud);
  const tags = createNameTags(hud, camera, { max: 10 });
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
  let namesDirty = true;

  const net = connect({
    status(v) {
      status.classList.toggle('hidden', v);
    },
    arrived() {
      audio.bell();
      renderArrivals();
    },
    boat() {
      namesDirty = true;
    },
    welcome() {
      renderArrivals();
      namesDirty = true;
      localOpenAt = 0;
      world.shown.clear();
      if (net.state.phase === 'harbor') opening.hide();
    },
  });

  let standingsAt = 0;
  let standingsKey = '';
  function renderStandings(names) {
    const key = names.join('|');
    if (key === standingsKey) return;
    standingsKey = key;
    const head = el('div', 'led-board-head', 'Leaders');
    arrivalsBox.replaceChildren(head, ...names.map((name, i) => {
      const row = el('div', `led-row${i === 0 ? ' lead' : ''}`);
      row.append(el('b', '', String(i + 1)));
      const s = el('span');
      s.textContent = name;
      row.append(s);
      return row;
    }));
  }

  function renderArrivals() {
    if (net.state.mode !== 'classic') return;     // the two-part race shows its leaders instead
    const rows = net.arrivals.slice(-6).reverse();
    arrivalsBox.replaceChildren(...rows.map((a) => {
      const row = el('div', 'led-row');
      row.append(el('b', '', `#${a.rank}`));
      const name = el('span');
      name.textContent = a.name;
      row.append(name);
      return row;
    }));
  }

  /** The names as boats join, newest first, like a live poll's lobby. */
  function renderNames() {
    namesDirty = false;
    const all = [...net.boats.values()].sort((a, b) => b.n - a.n);
    const chips = all.slice(0, NAMES_SHOWN).map((b, i) => {
      const chip = el('span', i === 0 ? 'fresh' : '');
      chip.textContent = b.name;
      return chip;
    });
    if (all.length > NAMES_SHOWN) chips.push(el('span', 'more', `+${all.length - NAMES_SHOWN} more`));
    namesBox.replaceChildren(...chips);
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'o') {
      if (net.connected && token) net.host('open');
      else if (!localOpenAt) localOpenAt = Date.now() + 500;
    } else if (token && k === 's') net.host('start');
    else if (token && k === 'l') net.host('light');
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
  let shownEnergy = 0;

  function loop(nowMs) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (nowMs - prev.t) / 1000);
    prev.t = nowMs;
    clock += dt;
    const t = clock;
    const s = net.state;
    const now = net.serverNow();
    const together = s.mode !== 'classic';
    const ph = s.phase;

    const open = ph === 'open' || !!localOpenAt;
    const gathered = together && (ph === 'challenge' || ph === 'energy');
    world.updateFleet(net.boats.values(), t, dt, { glide: open || gathered });

    let leader = 0;
    for (const b of world.shown.values()) leader = Math.max(leader, b.p);
    const started = ph === 'sailing' && now >= s.startAt;
    sayings.updateOverview(leader, started && !open);
    if (open || gathered) sayings.hide();

    placeOverview(t);
    let openT = -1;
    if (override != null) openT = override;
    else if (localOpenAt) openT = (Date.now() - localOpenAt) / 1000;
    else if (ph === 'open') openT = (now - s.openAt) / 1000;
    const inOpening = open || override != null;

    // --- The room's energy, eased so the meter and the lantern rise smoothly between updates.
    const energy = ph === 'energy' ? clamp01(s.taps / Math.max(1, s.energyGoal)) : ph === 'open' ? 1 : 0;
    shownEnergy += (energy - shownEnergy) * (1 - Math.exp(-dt * 4));

    if (inOpening) {
      opening.setStartLantern(together ? LIT : 1);
      opening.update(Math.max(openT, 0), t, basePos, look, FOV);
    } else {
      world.setBoatScale(3.2);
      camera.position.copy(basePos);
      camera.fov = FOV;
      camera.updateProjectionMatrix();
      camera.lookAt(look);
    }

    // --- The race: the leading boats carry their place and name over the mast, and in the
    // two-part race (which ends at the first arrival) a live board shows the top five.
    const racing = started && !inOpening && !gathered;
    if (racing) {
      const leaders = [...world.drawnBoats()].sort((a, b) => b[1].p - a[1].p).slice(0, 10);
      tags.update(leaders.map(([n, at], i) => ({ pos: at.pos, name: `${i + 1}. ${net.boats.get(n)?.name ?? ''}`, cls: i === 0 ? 'lead' : '' })));
      if (together && t - standingsAt > 0.4) {
        standingsAt = t;
        renderStandings(leaders.slice(0, 5).map(([n]) => net.boats.get(n)?.name ?? ''));
      }
    } else {
      tags.hide();
    }

    // --- The lighthouse goes dark when the race is won, and the room lights it again.
    if (gathered) {
      world.setLantern(0.25 + shownEnergy * (LIT - 0.25));
      world.beams.userData.fade = shownEnergy;
      world.beams.visible = shownEnergy > 0.02;
      world.setDawn(0);
    } else if (!inOpening && ph !== 'open') {
      world.setLantern(1);
      world.beams.userData.fade = 1;
      world.beams.visible = true;
    }

    const scene = !inOpening
      ? (ph === 'challenge' ? 'harbor' : ph === 'harbor' ? 'harbor' : 'sail')
      : openT < CUES.open + 2.2 ? 'hush' : 'open';
    audio.setScene(scene);
    audio.setSoundOn(s.soundOn !== false);

    // --- Panels.
    hud.classList.toggle('opening', inOpening);
    join.classList.toggle('hidden', inOpening || ph !== 'harbor');
    title.classList.toggle('hidden', inOpening || gathered);
    counter.classList.toggle('hidden', inOpening || gathered);
    arrivalsBox.classList.toggle('hidden', inOpening || gathered || ph === 'harbor' || (together && !started));
    if (ph === 'harbor') standingsKey = '';
    namesBox.classList.toggle('hidden', inOpening || ph !== 'harbor');
    if (namesDirty && ph === 'harbor') renderNames();

    if (ph === 'harbor') {
      num.textContent = s.boats;
      goal.textContent = '';
      sub.textContent = s.boats === 1 ? 'boat in the harbor' : 'boats in the harbor';
      meter.parentElement.classList.add('hidden');
    } else if (together) {
      num.textContent = s.boats;
      goal.textContent = '';
      sub.textContent = 'boats racing';
      meter.parentElement.classList.add('hidden');
    } else {
      num.textContent = s.arrived;
      goal.textContent = `/ ${s.threshold}`;
      sub.textContent = 'boats at the lighthouse';
      meter.parentElement.classList.remove('hidden');
      meter.style.width = `${Math.min(100, (s.arrived / s.threshold) * 100)}%`;
    }

    // --- The challenge, then the call to light it together.
    let bigLine = '';
    let smallLine = '';
    let bigText = '';
    if (!inOpening && ph === 'challenge') {
      const ct = (now - s.challengeAt) / 1000;
      if (ct >= 0) {
        if (ct < CHALLENGE_ASK) bigLine = LINES.first(s.winnerName);
        else { bigLine = LINES.challenge(s.winnerName); smallLine = ''; }
      }
    } else if (!inOpening && ph === 'energy') {
      const rem = (s.energyAt - now) / 1000;
      if (rem > 3) bigLine = LINES.together;
      else if (rem > 0) bigText = String(Math.ceil(rem));
      else {
        smallLine = LINES.tap;
        if (rem > -1.2) bigText = 'TAP!';
      }
    } else if (ph === 'sailing' && !inOpening) {
      const rem = (s.startAt - now) / 1000;
      if (rem > 0) bigText = rem > 3 ? 'Get ready…' : String(Math.ceil(rem));
      else if (rem > -1.2) bigText = 'SAIL!';
    }
    if (bannerBig.textContent !== bigLine) bannerBig.textContent = bigLine;
    if (bannerSmall.textContent !== smallLine) bannerSmall.textContent = smallLine;
    banner.classList.toggle('hidden', !bigLine && !smallLine);
    banner.classList.toggle('only-small', !bigLine);

    if (bigText !== lastCount && bigText && bigText !== 'Get ready…') {
      if (bigText === 'SAIL!' || bigText === 'TAP!') audio.go();
      else audio.tick();
    }
    lastCount = bigText;
    big.textContent = bigText;
    big.classList.toggle('hidden', !bigText);
    big.classList.toggle('small', bigText === 'Get ready…');

    energyBox.classList.toggle('hidden', !(ph === 'energy' && !inOpening));
    const pct = Math.round(shownEnergy * 100);
    energyPct.textContent = `${pct}%`;
    energyFill.style.height = `${shownEnergy * 100}%`;

    // --- After IS NOW OPEN!, the partners.
    billboard.update(inOpening && together ? openT - BILLBOARD_AT : -1);

    world.frame(t, dt);
  }
  requestAnimationFrame(loop);

  audio.setClock(net.serverNow);
  window.__sail = { world, net, opening, audio, seek: (v) => { override = v; } };
}
