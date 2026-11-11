/**
 * The big screen. By day: the night sea from the morning's opening, the fleet anchored at the
 * lighthouse, and commitments as cards in the sky, taking turns so everyone's gets its moment.
 * At the close: the finale (src/commit/finale.js).
 *
 * The cards are HTML, which keeps the text crisp and costs almost nothing. When the finale begins,
 * each word's position on its card is measured, so the words lift off from exactly where they were.
 *
 * With the host token in the URL: E starts the finale, R resets it. If the server can't be reached,
 * E plays it here anyway from the commitments this screen last saw, so the moment can always happen.
 */
import * as THREE from 'three';
import { createWorld, LH_Z, LANTERN_Y } from '../sail/world.js';
import { createAudio } from '../sail/audio.js';
import { createFinale } from './finale.js';
import { T, captions, closingLines } from './timeline.js';

const CACHE_KEY = 'gmc_commit_wall_cache';
const COLORS = ['yellow', 'pink', 'blue', 'orange', 'white'];
const SLOTS = 18;
const ROTATE_MS = 3000;
const LIGHT_MS = 760;       // how long a new commitment's light takes to fly from the lighthouse to its card
const FLEET = Array.from({ length: 30 }, (_, n) => ({ n, p: 1, rank: 1 }));

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const hash = (s) => {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = Math.imul(h, 31) + s.charCodeAt(i);
  return Math.abs(h);
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

export async function startWall(root, connect, { token }) {
  const canvas = document.createElement('canvas');
  canvas.id = 'commit-canvas';
  root.append(canvas);
  const world = await createWorld(canvas, { isLed: true });
  const { camera, renderer } = world;
  // The view looks straight at the lighthouse here, so the waves run across it the other way.
  world.scene.getObjectByName('Sea').material.uniforms.uWaveAxis.value = 0;
  world.setBoatScale(1.5);
  // The moon sits low at the right here, clear of the cards and of where the bulb will form.
  world.setMoon(0.498, 0.078, -0.863);
  let clock = 0;

  // --- Chrome.
  const cardsBox = el('div', 'cards');
  const hud = el('div', 'wall-hud');
  const title = el('div', 'wall-title', 'Our Commitments');
  const counter = el('div', 'wall-count');
  const countNum = el('b', '', '0');
  const countLabel = el('span', '', 'commitments');
  counter.append(countNum, countLabel);
  const join = el('div', 'wall-join');
  const qr = document.createElement('canvas');
  const joinUrl = `${location.origin}/commit/`;
  const joinText = el('div', 'wall-join-text');
  joinText.append(el('strong', '', 'Scan to add your light'), el('span', '', joinUrl.replace(/^https?:\/\//, '')));
  join.append(qr, joinText);
  const empty = el('div', 'wall-empty', 'Be the first to add your light.');
  const offline = el('div', 'wall-offline', 'Connecting to the server…');
  const soundChip = el('button', 'wall-sound', '🔊 Click once for sound');
  soundChip.type = 'button';
  const caption = el('div', 'finale-caption');
  const closing = el('div', 'finale-closing');
  const closing1 = el('div', 'finale-line1');
  const closing2 = el('div', 'finale-line2');
  closing.append(closing1, closing2);
  hud.append(title, counter, join, empty, offline, soundChip, caption, closing);
  root.append(cardsBox, hud);
  drawQr(qr, joinUrl).catch((err) => console.warn('[commit] QR failed', err));

  const audio = createAudio();
  audio.setSoundOn(false);     // silent all day; the finale brings the sound
  const unlock = () => {
    audio.unlock();
    soundChip.remove();
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  navigator.wakeLock?.request('screen').catch(() => {});

  const finale = await createFinale(world, { onCue: (name) => audio.cue(name) });

  // --- The cards.
  const slots = Array.from({ length: SLOTS }, (_, i) => {
    const node = el('article', 'card hidden');
    const r = hash(`slot${i}`);
    node.style.setProperty('--tilt', `${((r % 50) - 25) / 10}deg`);
    node.style.setProperty('--dx', `${(r % 28) - 14}%`);
    node.style.setProperty('--dy', `${((r >> 3) % 24) - 12}%`);
    node.style.setProperty('--bob', `${5 + (r % 40) / 10}s`);
    node.style.setProperty('--delay', `${-(r % 50) / 10}s`);
    cardsBox.append(node);
    return { node, item: null };
  });

  // A commitment that has just come in is carried up from the lighthouse as a light, and its card
  // opens where the light lands. `quiet` is for filling the wall on load: cards only, in a ripple.
  let quiet = 0;
  let finaleOn = false;
  let kick = 0;            // the lantern flares for each new commitment
  let pulseAt = -100;      // and a ring of light leaves the island
  const lanternAt = new THREE.Vector3();
  function sendLight(node) {
    lanternAt.set(0, LANTERN_Y, LH_Z).project(camera);
    const x0 = (lanternAt.x * 0.5 + 0.5) * window.innerWidth;
    const y0 = (-lanternAt.y * 0.5 + 0.5) * window.innerHeight;
    const r = node.getBoundingClientRect();
    const x1 = r.left + r.width / 2;
    const y1 = r.top + r.height / 2;
    const xm = x0 + (x1 - x0) * 0.3 + (x1 < x0 ? 1 : -1) * window.innerWidth * 0.04;
    const ym = y0 + (y1 - y0) * 0.55;
    const light = el('i', 'comet');
    hud.append(light);
    const fly = light.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(0.4)`, opacity: 0 },
      { transform: `translate(${xm}px, ${ym}px) scale(1.3)`, opacity: 1, offset: 0.4 },
      { transform: `translate(${x1}px, ${y1}px) scale(0.9)`, opacity: 1 },
    ], { duration: LIGHT_MS, easing: 'cubic-bezier(0.35, 0, 0.25, 1)' });
    fly.onfinish = fly.oncancel = () => light.remove();
  }

  function fillCard(slot, item, isNew) {
    slot.item = item;
    const { node } = slot;
    const arriving = isNew && !quiet && !finaleOn && !document.hidden;
    // No entrances once the finale has begun: the cards are held still for their words to lift off.
    const entrance = finaleOn ? '' : isNew ? ' fresh' : ' swap';
    if (entrance) {
      // Hidden for a moment first, so the entrance plays again even if the classes are unchanged.
      node.className = 'card hidden';
      void node.offsetWidth;
    }
    node.style.setProperty('--wait', arriving ? `${LIGHT_MS - 90}ms` : quiet ? `${(quiet - 1) * 55}ms` : '0ms');
    node.className = `card ${COLORS[hash(item.id) % COLORS.length]}${entrance}${arriving ? ' lit' : ''}`;
    if (arriving) {
      sendLight(node);
      kick = 1.3;
      pulseAt = clock;
      world.emitFromFleet(14);
    }
    node.replaceChildren(el('small', '', 'I commit to'));
    const body = el('p');
    item.text.split(/\s+/).forEach((word, i) => {
      if (i) body.append(' ');
      body.append(el('span', 'w', word));
    });
    node.append(body);
    node.dataset.id = item.id;
  }

  const arrivals = [];     // new commitments get a slot first
  let queueIndex = 0;
  let nextSlot = 0;
  function showNext() {
    let item = arrivals.shift();
    let isNew = !!item;
    if (!item) {
      const all = [...net.items.values()];
      if (all.length <= SLOTS && slots.filter((s) => s.item).length >= all.length) return;
      if (!all.length) return;
      const shown = new Set(slots.map((s) => s.item && s.item.id));
      for (let i = 0; i < all.length; i++) {
        const c = all[(queueIndex + i) % all.length];
        if (!shown.has(c.id)) {
          item = c;
          queueIndex = (queueIndex + i + 1) % all.length;
          break;
        }
      }
      isNew = false;
      if (!item) return;
    }
    // Reuse a gap if there is one, otherwise the longest-shown card.
    let slot = slots.find((s) => !s.item);
    if (!slot) {
      slot = slots[nextSlot];
      nextSlot = (nextSlot + 1) % SLOTS;
    }
    fillCard(slot, item, isNew);
  }
  function rebuildCards() {
    for (const s of slots) {
      s.item = null;
      s.node.className = 'card hidden';
    }
    arrivals.length = 0;
    queueIndex = 0;
    const all = [...net.items.values()].slice(-SLOTS);
    all.forEach((item, i) => {
      quiet = i + 1;
      arrivals.push(item);
      showNext();
    });
    quiet = 0;
  }

  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify([...net.items.values()])); } catch { /* private mode */ }
  }

  let prepared = false;
  const prepareFinale = () => {
    prepared = true;
    const rects = new Map();
    for (const s of slots) {
      if (!s.item || s.node.classList.contains('hidden')) continue;
      const list = [];
      const size = parseFloat(getComputedStyle(s.node.querySelector('p')).fontSize) * 1.3;
      s.node.querySelectorAll('.w').forEach((w) => {
        const r = w.getBoundingClientRect();
        list.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, size });
      });
      rects.set(s.item.id, list);
    }
    finale.prepare([...net.items.values()], rects);
  };

  let localAt = 0;     // set when the finale has to run without the server
  const net = connect({
    welcome() {
      // Joining while the finale is already under way: the cards go straight to their places.
      finaleOn = !!net.state.finaleAt;
      rebuildCards();
      saveCache();
      localAt = 0;
      prepared = false;
    },
    item(item) {
      arrivals.push(item);
      showNext();
      saveCache();
    },
    removed(id) {
      // Off the wall at once, even mid-finale: a safety decision outranks a smooth animation.
      for (const s of slots) {
        if (s.item && s.item.id === id) {
          s.item = null;
          s.node.className = 'card hidden';
        }
      }
      saveCache();
      prepared = false;
    },
  });
  // Nothing from the server yet (it may be asleep, or down): show what this screen last saw.
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    if (!net.items.size && !net.demo) {
      net.items = new Map(cached.map((i) => [i.id, i]));
      rebuildCards();
    }
  } catch { /* nothing cached */ }

  setInterval(showNext, ROTATE_MS);

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'e') {
      override = null;
      if (net.connected && token) net.admin('finale');
      else if (!localAt) localAt = Date.now() + 800;
    } else if (k === 'r') {
      override = null;
      localAt = 0;
      if (token) net.admin('resetFinale');
    } else if (k === 'f') document.documentElement.requestFullscreen?.();
    else if (k === 'm') audio.setMuted(!audio.muted);
  });

  // The preview needs no keyboard or console, so it can be tried on a tablet too.
  const demoButton = net.demo ? el('button', 'wall-demo') : null;
  if (demoButton) {
    demoButton.type = 'button';
    demoButton.addEventListener('click', () => {
      override = null;
      localAt = localAt ? 0 : Date.now() + 800;
    });
    hud.append(demoButton);
  }

  // --- The camera: the lighthouse small on the horizon, the sky left for the cards.
  const look = new THREE.Vector3();
  const FOV = 40;
  camera.position.set(0, 10, LH_Z + 220);
  const tilt = Math.atan(0.68 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
  look.set(0, 10 + 220 * Math.tan(tilt), LH_Z);

  const capText = (t, n) => {
    for (const c of captions(n)) {
      if (t >= c.from && t <= c.to) {
        const a = Math.min(1, (t - c.from) / 0.5, (c.to - t) / 0.5);
        return { text: c.text, a };
      }
    }
    return null;
  };

  let override = null;
  let prevMs = performance.now();
  let wasActive = false;
  let countShown = null;
  function loop(nowMs) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (nowMs - prevMs) / 1000);
    prevMs = nowMs;
    clock += dt;
    const s = net.state;
    const finaleAt = localAt || s.finaleAt;
    const now = localAt ? Date.now() : net.serverNow();
    const t = override != null ? override : finaleAt ? (now - finaleAt) / 1000 : -1;
    const active = override != null || !!finaleAt;

    camera.fov = FOV;
    camera.updateProjectionMatrix();
    camera.lookAt(look);
    world.updateFleet(FLEET, clock, dt);

    if (active && !prepared) prepareFinale();
    if (!active && wasActive) {
      finale.hide();
      prepared = false;
      rebuildCards();
    }
    wasActive = active;
    finaleOn = active;
    if (active) {
      finale.update(Math.max(t, 0), clock);
      // When the bulb catches, light rolls out across the water.
      const a = t - T.ignite;
      world.setPulse(14 + a * 58, a >= 0 && a < 3.4 ? 1 - a / 3.4 : 0);
      kick = 0;
    } else {
      // By day: the lantern flares for each new commitment, and a spark drifts up now and then.
      kick *= Math.exp(-dt * 1.6);
      world.setLantern(1 + kick);
      const a = clock - pulseAt;
      world.setPulse(14 + a * 46, a < 2.6 ? 1 - a / 2.6 : 0);
      if (Math.random() < dt * 0.7) world.emitFromFleet(1);
    }

    const n = net.items.size;
    if (demoButton) {
      const label = localAt ? 'Back to the wall' : '▶ Play the finale';
      if (demoButton.textContent !== label) demoButton.textContent = label;
    }
    net.demoPaused = active;     // as on the real server, the wall closes for the finale
    // --- Panels.
    const total = localAt ? n : (s.count || n);
    if (total !== countShown) {
      // The number jumps when it grows.
      if (countShown != null && total > countShown && !active) {
        countNum.classList.remove('bump');
        void countNum.offsetWidth;
        countNum.classList.add('bump');
      }
      countShown = total;
      countNum.textContent = total;
    }
    countLabel.textContent = (s.count || n) === 1 ? 'commitment' : 'commitments';
    const gone = active && t > 0;
    hud.classList.toggle('finale', gone);
    empty.classList.toggle('hidden', !!n || active);
    offline.classList.toggle('hidden', net.connected || active);
    cardsBox.classList.toggle('glowing', active && t >= T.cardsGlow);
    cardsBox.classList.toggle('dissolving', active && t >= T.dissolve);
    cardsBox.classList.toggle('hidden', active && t >= T.dissolve + 1.4);

    const cap = active ? capText(t, n) : null;
    caption.style.opacity = cap ? cap.a : 0;
    if (cap && caption.textContent !== cap.text) caption.textContent = cap.text;

    const lines = closingLines(n);
    if (closing1.textContent !== lines.line1) closing1.textContent = lines.line1;
    if (closing2.textContent !== lines.line2) closing2.textContent = lines.line2;
    closing1.style.opacity = active ? Math.min(1, Math.max(0, (t - T.close) / 0.7)) : 0;
    closing2.style.opacity = active ? Math.min(1, Math.max(0, (t - T.close - 1.2) / 0.7)) : 0;

    audio.setSoundOn(active);
    audio.setScene(active && t > T.close + 2.2 ? 'open' : 'hush');

    world.frame(clock, dt);
    if (active) {
      renderer.autoClear = false;
      renderer.clearDepth();
      finale.render();
      renderer.autoClear = true;
    }
  }
  requestAnimationFrame(loop);

  window.__commit = { world, net, finale, audio, seek: (v) => { override = v; }, slots };
}
