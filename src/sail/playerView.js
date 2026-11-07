/**
 * The phone: your boat from behind. You tap left and right in turn, like
 * paddling: the route is dead straight, so there is nothing to steer. The left and right halves of
 * the screen are the paddles, and one thumb going side to side works as well as two. Keeping up
 * three taps a second is full speed, which takes 15 seconds; slower tapping is simply slower.
 */
import * as THREE from 'three';
import { boatPosition, ROUTE, LH_Z } from './world.js';
import { createOpening, CUES } from './opening.js';
import { createSayings } from './sayings.js';
import { createAudio } from './audio.js';
import { SAIL_SECONDS } from './raceHub.js';

const FULL_SPEED = 1 / (SAIL_SECONDS - 0.2);    // the ramp-up costs about 0.2 s
const FULL_RATE = 3;                            // taps a second for full speed
const RATE_WINDOW = 1.5;                        // seconds of tapping that sets the speed
const SEND_EVERY = 0.25;

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export async function startPlayer(root, world, connect) {
  const { camera } = world;
  const audio = createAudio({ musicLevel: 0.7 });   // the LED carries the music in the room

  // --- HUD.
  const hud = el('div', 'hud');
  const bar = el('div', 'route');
  bar.innerHTML = '<div class="route-track"><div class="route-fill"></div><div class="route-boat">⛵</div></div><div class="route-end" aria-hidden="true"></div>';
  const fill = bar.querySelector('.route-fill');
  const boatDot = bar.querySelector('.route-boat');
  const count = el('div', 'pill count');
  const reconnect = el('div', 'pill warn hidden', 'Reconnecting…');
  const card = el('div', 'card');
  const big = el('div', 'big hidden');
  const padL = el('div', 'pad left hidden', '<span>◀</span><b>LEFT</b>');
  const padR = el('div', 'pad right hidden', '<b>RIGHT</b><span>▶</span>');
  const cta = el('a', 'cta hidden', 'Learn More');
  cta.href = '/';      // the Youth Innovations Marketplace website
  const mute = el('button', 'mute', '🔊');
  mute.type = 'button';
  mute.setAttribute('aria-label', 'Sound on or off');
  hud.append(bar, count, reconnect, card, big, padL, padR, cta, mute);
  root.append(hud);

  // A phone waiting in the harbor shouldn't go to sleep and drop out of the race.
  let wake = null;
  const keepAwake = () => {
    if (wake || !navigator.wakeLock) return;
    navigator.wakeLock.request('screen').then((w) => {
      wake = w;
      w.addEventListener('release', () => { wake = null; });
    }).catch(() => {});
  };

  let clock = 0;
  let lastSide = null;
  let tapTimes = [];
  let rock = 0;           // the boat's lean, kicked each way by each tap
  let hasTapped = false;
  let sailingNow = false;

  /** One tap on one side. The same side twice in a row does nothing: it has to be left, right. */
  function paddle(side) {
    if (!sailingNow || side === lastSide) return;
    lastSide = side;
    hasTapped = true;
    tapTimes.push(clock);
    rock = side === 'L' ? 0.13 : -0.13;
    const pad = side === 'L' ? padL : padR;
    pad.classList.remove('hit');
    void pad.offsetWidth;      // restart the flash
    pad.classList.add('hit');
    audio.paddle(side);
    navigator.vibrate?.(8);
  }

  // Half the screen each: on a phone in a crowd you shouldn't have to aim.
  root.addEventListener('pointerdown', (ev) => {
    if (ev.target === cta || ev.target === mute) return;
    audio.unlock();
    keepAwake();
    paddle(ev.clientX < window.innerWidth / 2 ? 'L' : 'R');
    ev.preventDefault();
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { audio.unlock(); paddle('L'); }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { audio.unlock(); paddle('R'); }
  });
  mute.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    mute.textContent = audio.muted ? '🔇' : '🔊';
  });

  let p = 0;
  let speed = 0;
  let sentP = -1;
  let sinceSend = 0;
  let lastCountdown = null;
  let phaseSeen = '';
  let finalShown = false;

  const opening = await createOpening(world, { onCue: (name) => audio.cue(name) });
  const sayings = createSayings(world);

  const net = connect({
    welcome() {
      // A reconnect mid-race keeps your progress; a reset (or a restarted server) starts over.
      world.shown.clear();
      sentP = -1;
      if (net.state.phase === 'harbor') {
        p = 0;
        speed = 0;
        finalShown = false;
        opening.hide();
      } else if (net.you) {
        p = Math.max(p, net.you.p);
      }
    },
    status(v) {
      reconnect.classList.toggle('hidden', v);
    },
    arrived(m) {
      if (net.you && m.n === net.you.n) {
        audio.bell();
        navigator.vibrate?.(120);
      }
    },
  });

  const basePos = new THREE.Vector3(0, 5.2, 12);
  const baseLook = new THREE.Vector3(0, 3, -20);
  const smoothPos = new THREE.Vector3(0, 12, 26);
  const smoothLook = new THREE.Vector3(0, 2, -20);
  const prev = { t: performance.now() };
  let override = null;

  function setCard(html) {
    if (card.dataset.html !== html) {
      card.dataset.html = html;
      card.innerHTML = html;
    }
    card.classList.toggle('hidden', !html);
  }

  function loop(nowMs) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (nowMs - prev.t) / 1000);
    prev.t = nowMs;
    clock += dt;
    const t = clock;
    const s = net.state;
    const now = net.serverNow();
    const portrait = camera.aspect < 1.05;
    const baseFov = portrait ? 66 : 50;

    // --- Sailing.
    const started = s.phase === 'sailing' && now >= s.startAt;
    const sailing = started && p < 1 && !!net.you;
    sailingNow = sailing;
    tapTimes = tapTimes.filter((at) => t - at < RATE_WINDOW);
    const tapRate = tapTimes.length / RATE_WINDOW;
    const paddling = tapRate > 0;
    const target = sailing ? FULL_SPEED * Math.min(1, tapRate / FULL_RATE) : 0;
    speed += (target - speed) * (1 - Math.exp(-dt * (target > speed ? 8 : 1.6)));
    if (sailing) p = Math.min(1, p + speed * dt);
    else if (s.phase === 'open' && p < 1) p = Math.min(1, p + dt / 9);     // everyone drifts in

    sinceSend += dt;
    if (started && net.you && !net.you.rank && sinceSend >= SEND_EVERY && (p !== sentP || p >= 1)) {
      sinceSend = 0;
      sentP = p;
      net.sendProgress(p);
    }

    // --- Your boat and everyone else's.
    const selfN = net.you ? net.you.n : -1;
    const selfPos = world.updateFleet(net.boats.values(), t, dt, {
      self: selfN, selfP: p, glide: s.phase === 'open', selfRock: rock,
    });
    rock *= Math.exp(-dt * 5);
    const bx = selfPos ? selfPos.x : 0;
    const bz = selfPos ? selfPos.z : -ROUTE * p;

    sayings.updateChase(bx, bz, started && p > 0 && p < 1);
    if (s.phase === 'open') sayings.hide();

    // --- Camera: behind your boat, drawing back to take in the lighthouse as you arrive.
    const arrive = THREE.MathUtils.smoothstep(p, 0.86, 1);
    basePos.set(
      bx * (1 - arrive * 0.35),
      (portrait ? 7.2 : 8) + arrive * 2.6 + (s.phase === 'harbor' ? 2 : 0),
      bz + (portrait ? 17 : 19) + arrive * 10 + (s.phase === 'harbor' ? 5 : 0),
    );
    baseLook.set(bx * (1 - arrive), (portrait ? 4.2 : 2.6) + arrive * 8, Math.min(bz - 22, LH_Z * 0.5 + bz * 0.5));
    const k = 1 - Math.exp(-dt * 5);
    smoothPos.lerp(basePos, k);
    smoothLook.lerp(baseLook, k);

    // --- Opening: on the server's clock, or at a forced time while testing.
    const openT = override != null ? override : s.phase === 'open' ? (now - s.openAt) / 1000 : -1;
    if (openT >= 0 || s.phase === 'open') {
      opening.update(Math.max(openT, 0), t, smoothPos, smoothLook, baseFov);
    } else {
      camera.position.copy(smoothPos);
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
      camera.lookAt(smoothLook);
    }

    if (openT > 2) world.marker.visible = world.ring.visible = false;

    audio.setScene(s.phase === 'harbor' ? 'harbor'
      : s.phase === 'sailing' ? 'sail'
        : openT < CUES.open + 2.2 ? 'hush' : 'open');

    audio.setSoundOn(s.soundOn !== false);

    // --- HUD.
    const pct = `${(p * 100).toFixed(1)}%`;
    fill.style.width = pct;
    boatDot.style.left = pct;
    const inOpening = s.phase === 'open';
    bar.classList.toggle('hidden', inOpening || s.phase === 'harbor');
    count.classList.toggle('hidden', inOpening);
    count.textContent = s.phase === 'harbor' ? `⛵ ${s.boats} boats in the harbor` : `💡 ${s.arrived} / ${s.threshold} at the lighthouse`;

    if (s.phase !== phaseSeen) {
      phaseSeen = s.phase;
      if (s.phase === 'harbor') {
        lastCountdown = null;
        finalShown = false;
        lastSide = null;
        hasTapped = false;
        tapTimes = [];
        cta.classList.add('hidden');
      }
    }

    let bigText = '';
    if (s.phase === 'sailing' && now < s.startAt) {
      const rem = (s.startAt - now) / 1000;
      bigText = rem > 3 ? 'Get ready…' : String(Math.ceil(rem));
      if (bigText !== lastCountdown && rem <= 3) audio.tick();
    } else if (started && now - s.startAt < 1000 && !p) {
      bigText = 'SAIL!';
    } else if (started && now - s.startAt < 1200 && p < 0.08) {
      bigText = 'SAIL!';
    }
    if (bigText === 'SAIL!' && lastCountdown !== 'SAIL!') audio.go();
    lastCountdown = bigText;
    big.textContent = bigText;
    big.classList.toggle('hidden', !bigText);
    big.classList.toggle('small', bigText === 'Get ready…');

    const showPads = sailing || (s.phase === 'sailing' && now < s.startAt && !!net.you);
    padL.classList.toggle('hidden', !showPads);
    padR.classList.toggle('hidden', !showPads);
    padL.classList.toggle('next', sailing && lastSide !== 'L');
    padR.classList.toggle('next', sailing && lastSide === 'L');

    if (s.phase === 'harbor') {
      setCard(`<strong>Welcome aboard!</strong><span>Your boat is in the harbor. When the host says go, tap left and right, like paddling, to sail to the lighthouse.${audio.unlocked ? '' : ' Tap now to turn the sound on.'}</span>`);
    } else if (inOpening) {
      setCard('');
    } else if (p >= 1) {
      const rank = net.you && net.you.rank;
      const left = Math.max(0, s.threshold - s.arrived);
      setCard(`<strong>${rank ? `You made it! Boat #${rank}` : 'You made it!'}</strong><span>${left ? `${left} more boat${left === 1 ? '' : 's'} to light up the marketplace…` : 'Here it comes…'}</span>`);
    } else if (sailing && !hasTapped) {
      setCard('<strong>Tap left, then right!</strong><span>Keep going, like paddling, to sail.</span>');
    } else if (sailing && !paddling) {
      setCard('<strong>Keep tapping!</strong><span>Left, right, left, right.</span>');
    } else {
      setCard('');
    }

    if (inOpening && openT > CUES.cta && !finalShown) {
      finalShown = true;
      cta.classList.remove('hidden');
    }

    world.frame(t, dt);
  }
  requestAnimationFrame(loop);

  audio.setClock(net.serverNow);
  window.__sail = { world, net, opening, audio, seek: (v) => { override = v; }, get p() { return p; }, setP: (v) => { p = v; } };
}
