/**
 * The phone: name your boat, then tap anywhere to sail it to the lighthouse. Four taps a second is
 * full speed, about 30 seconds; slower tapping is simply slower.
 *
 * In the two-part opening the first boat home wins, and the room is asked whether that boat can
 * change the world alone. Then everyone taps again, this time to send energy to the lighthouse,
 * until the room has lit it. The bulb rises out of it, the marketplace opens, and the phone says
 * "You are part of the solution."
 */
import * as THREE from 'three';
import { ROUTE, LH_Z } from './world.js';
import { createOpening, CUES } from './opening.js';
import { createSayings } from './sayings.js';
import { createAudio } from './audio.js';
import { SAIL_SECONDS } from './raceHub.js';
import { screenName, NAME_MAX } from '../commit/moderate.js';
import { pickBoatName } from './boatNames.js';
import { LINES, CHALLENGE_ASK } from './together.js';
import { createNameTags } from './nameTags.js';

const FULL_SPEED = 1 / (SAIL_SECONDS - 0.2);    // the ramp-up costs about 0.2 s
const FULL_RATE = 4;                            // taps a second for full speed
const RATE_WINDOW = 1.5;                        // seconds of tapping that sets the speed
const SEND_EVERY = 0.25;
const LIT = 3.2;
const NAME_SORRY = {
  empty: 'Use at least two letters.',
  contact: 'No numbers, emails or links, please.',
  block: 'Please choose a different name.',
};

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function startPlayer(root, world, connect) {
  const { camera } = world;
  const audio = createAudio({ musicLevel: 0.7 });   // the LED carries the music in the room

  // --- HUD.
  const hud = el('div', 'hud');
  const bar = el('div', 'route');
  bar.innerHTML = '<div class="route-track"><div class="route-fill"></div><div class="route-boat">⛵</div></div><div class="route-end" aria-hidden="true"></div>';
  const fill = bar.querySelector('.route-fill');
  const boatDot = bar.querySelector('.route-boat');
  const energyBar = el('div', 'energy-bar hidden', '<div class="energy-track"><div></div></div><b>0%</b>');
  const energyFill = energyBar.querySelector('.energy-track div');
  const energyPct = energyBar.querySelector('b');
  const count = el('div', 'pill count');
  const reconnect = el('div', 'pill warn hidden', 'Reconnecting…');
  const card = el('div', 'card');
  const big = el('div', 'big hidden');
  const pad = el('div', 'tapzone hidden', '<b>TAP TAP TAP!</b><i class="tap-meter"><i></i></i><span></span>');
  const padLabel = pad.querySelector('b');
  const padMeter = pad.querySelector('.tap-meter i');
  const padNote = pad.querySelector('span');
  // Every tap answers under the finger: a ring on the glass, and a +1 once taps are energy.
  const tapFx = el('div', 'tapfx');
  const ripples = Array.from({ length: 8 }, () => {
    const r = el('i', 'ripple', '<b>+1</b>');
    tapFx.append(r);
    return r;
  });
  let rippleNext = 0;
  const flash = el('div', 'flash');
  const welcome = el('div', 'welcome hidden', `<strong>${LINES.phoneDone}</strong><p>${LINES.phoneWelcome}</p><em>Look up at the big screen!</em>`);
  const cta = el('a', 'cta hidden', 'Learn More');
  cta.href = '/';      // the Youth Innovations Marketplace website
  const mute = el('button', 'mute', '🔊');
  mute.type = 'button';
  mute.setAttribute('aria-label', 'Sound on or off');

  // Naming your boat comes first: it is what puts you in the race.
  const naming = el('form', 'naming hidden');
  naming.innerHTML = `
    <h1>Name your boat</h1>
    <p>Pick a fun name for your boat. Please don't use your full name.</p>
    <input type="text" maxlength="${NAME_MAX}" autocomplete="off" autocapitalize="words" enterkeyhint="go" aria-label="Boat name">
    <p class="naming-error" role="alert"></p>
    <button type="submit" class="naming-go">Set sail</button>
    <button type="button" class="naming-pick">Pick a name for me</button>`;
  const nameInput = naming.querySelector('input');
  const nameError = naming.querySelector('.naming-error');
  const tags = createNameTags(hud, camera, { max: 4 });
  hud.append(flash, tapFx, bar, energyBar, count, reconnect, card, big, pad, welcome, cta, mute, naming);
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
  let tapTimes = [];
  let rock = 0;           // the boat's lean, kicked each way by each tap
  let side = 'L';
  let hasTapped = false;
  let sailingNow = false;
  let energyNow = false;
  let pendingTaps = 0;
  let myTaps = 0;
  let naming_ = false;
  let notice = '';
  let noticeUntil = 0;

  let sparksOwed = 0;     // your own taps, waiting to leave your boat as sparks
  let pulseAt = -100;     // when a ring of light last left the lighthouse

  /** One tap, anywhere: a stroke of the paddle while racing, a spark of energy afterwards. */
  function tap(x = window.innerWidth / 2, y = window.innerHeight - 80) {
    if (!sailingNow && !energyNow) return;
    hasTapped = true;
    side = side === 'L' ? 'R' : 'L';
    rock = side === 'L' ? 0.13 : -0.13;
    if (sailingNow) tapTimes.push(clock);
    if (energyNow) { pendingTaps++; myTaps++; sparksOwed = Math.min(6, sparksOwed + 1); }
    const r = ripples[rippleNext];
    rippleNext = (rippleNext + 1) % ripples.length;
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    r.className = 'ripple';
    void r.offsetWidth;      // restart it
    r.className = energyNow ? 'ripple go energy' : 'ripple go';
    pad.classList.remove('hit');
    void pad.offsetWidth;      // restart the flash
    pad.classList.add('hit');
    audio.paddle(side);
    navigator.vibrate?.(8);
  }

  root.addEventListener('pointerdown', (ev) => {
    if (ev.target === cta || ev.target === mute || naming.contains(ev.target)) return;
    audio.unlock();
    keepAwake();
    tap(ev.clientX, ev.clientY);
    ev.preventDefault();
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.repeat || naming_) return;
    if (e.code === 'Space' || e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'Enter') { audio.unlock(); tap(); }
  });
  mute.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    mute.textContent = audio.muted ? '🔇' : '🔊';
  });

  naming.addEventListener('submit', (ev) => {
    ev.preventDefault();
    audio.unlock();
    keepAwake();
    const r = screenName(nameInput.value);
    if (!r.ok) {
      nameError.textContent = NAME_SORRY[r.reason] || NAME_SORRY.block;
      return;
    }
    nameError.textContent = '';
    naming.querySelector('.naming-go').disabled = true;
    net.setName(r.name);
  });
  naming.querySelector('.naming-pick').addEventListener('click', () => {
    nameInput.value = pickBoatName();
    nameError.textContent = '';
  });
  nameInput.addEventListener('input', () => { nameError.textContent = ''; });

  let p = 0;
  let speed = 0;
  let sentP = -1;
  let sinceSend = 0;
  let sinceTaps = 0;
  let lastCountdown = null;
  let phaseSeen = '';
  let finalShown = false;
  let shownEnergy = 0;
  let rush = 0;           // 0..1, how close to full speed, eased: it widens the view
  let gauge = 0;          // 0..1, how close your tapping is to full speed: the meter on the pad
  let tapsSeen = 0;       // the room's taps as last seen, to turn new ones into sparks
  let roomOwed = 0;
  let roomCarry = 0;

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
    nameResult(m) {
      naming.querySelector('.naming-go').disabled = false;
      if (!m.ok) nameError.textContent = NAME_SORRY[m.reason] || NAME_SORRY.block;
      else if (m.hidden) {
        notice = `The host renamed your boat to ${m.name}.`;
        noticeUntil = clock + 6;
      }
    },
    arrived(m) {
      // Every arrival sends a ring of light out from the lighthouse; yours lights your screen too.
      if (clock - pulseAt > 1.2) pulseAt = clock;
      if (net.you && m.n === net.you.n) {
        audio.bell();
        navigator.vibrate?.(120);
        flash.classList.remove('go');
        void flash.offsetWidth;
        flash.classList.add('go');
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
    const ph = s.phase;
    const now = net.serverNow();
    const portrait = camera.aspect < 1.05;
    const baseFov = (portrait ? 66 : 50) + rush * 5;     // the view opens up as you pick up speed
    const together = s.mode !== 'classic';
    const gathered = together && (ph === 'challenge' || ph === 'energy');
    const you = net.you;
    const winner = together && you && s.winner === you.n;

    reconnect.classList.toggle('hidden', net.connected);
    const pillText = net.wasConnected ? 'Reconnecting…' : net.noAnswer ? 'The race isn’t ready yet. Please wait…' : 'Connecting…';
    if (reconnect.textContent !== pillText) reconnect.textContent = pillText;

    // --- Naming: until the server has given you a boat.
    naming_ = !you && net.connected;
    if (naming.classList.contains('hidden') === naming_) {
      naming.classList.toggle('hidden', !naming_);
      if (naming_ && !nameInput.value) nameInput.placeholder = pickBoatName();
    }

    // --- Sailing.
    const started = ph === 'sailing' && now >= s.startAt;
    const sailing = started && p < 1 && !!you;
    sailingNow = sailing;
    energyNow = ph === 'energy' && now >= s.energyAt && !!you;
    tapTimes = tapTimes.filter((at) => t - at < RATE_WINDOW);
    const tapRate = tapTimes.length / RATE_WINDOW;
    const paddling = tapRate > 0;
    const target = sailing ? FULL_SPEED * Math.min(1, tapRate / FULL_RATE) : 0;
    speed += (target - speed) * (1 - Math.exp(-dt * (target > speed ? 8 : 1.6)));
    if (sailing) p = Math.min(1, p + speed * dt);
    else if ((ph === 'open' || gathered) && p < 1 && you) p = Math.min(1, p + dt / 9);     // everyone drifts in
    rush += ((sailing ? clamp01(speed / FULL_SPEED) : 0) - rush) * (1 - Math.exp(-dt * 3));
    gauge += ((sailing ? clamp01(tapRate / FULL_RATE) : 0) - gauge) * (1 - Math.exp(-dt * 10));

    sinceSend += dt;
    if ((started || gathered) && you && !you.rank && sinceSend >= SEND_EVERY && (p !== sentP || p >= 1)) {
      sinceSend = 0;
      sentP = p;
      net.sendProgress(p);
    }
    sinceTaps += dt;
    if (pendingTaps && sinceTaps >= SEND_EVERY) {
      sinceTaps = 0;
      net.sendTaps(pendingTaps);
      pendingTaps = 0;
    }

    // --- Your boat and everyone else's.
    const selfN = you ? you.n : -1;
    const selfPos = world.updateFleet(net.boats.values(), t, dt, {
      self: selfN, selfP: p, glide: ph === 'open' || gathered, selfRock: rock,
    });
    rock *= Math.exp(-dt * 5);
    const bx = selfPos ? selfPos.x : 0;
    const bz = selfPos ? selfPos.z : -ROUTE * p;

    sayings.updateChase(bx, bz, started && p > 0 && p < 1);
    if (ph === 'open' || gathered) sayings.hide();

    // --- Camera: behind your boat, drawing back to take in the lighthouse as you arrive.
    const arrive = THREE.MathUtils.smoothstep(p, 0.86, 1);
    world.setMoonLevel(1 - arrive);     // close in, the lantern is the only light in the sky
    basePos.set(
      bx * (1 - arrive * 0.35),
      (portrait ? 7.2 : 8) + arrive * 2.6 + (ph === 'harbor' ? 2 : 0),
      bz + (portrait ? 17 : 19) + arrive * 10 + (ph === 'harbor' ? 5 : 0),
    );
    baseLook.set(bx * (1 - arrive), (portrait ? 4.2 : 2.6) + arrive * 8, Math.min(bz - 22, LH_Z * 0.5 + bz * 0.5));
    const k = 1 - Math.exp(-dt * 5);
    smoothPos.lerp(basePos, k);
    smoothLook.lerp(baseLook, k);

    // --- The room's energy, and the lighthouse it lights.
    const energy = ph === 'energy' ? clamp01(s.taps / Math.max(1, s.energyGoal)) : ph === 'open' ? 1 : 0;
    shownEnergy += (energy - shownEnergy) * (1 - Math.exp(-dt * 4));

    // Taps turn into sparks that fly to the lantern: yours from your own boat, one each, and a
    // share of everyone else's from the boats around you.
    if (energyNow) {
      if (s.taps > tapsSeen) roomOwed = Math.min(30, roomOwed + (s.taps - tapsSeen) * 0.4);
      const out = Math.min(roomOwed, 22 * dt);
      roomOwed -= out;
      roomCarry += out;
      const n = roomCarry | 0;
      roomCarry -= n;
      if (n) world.emitFromFleet(n);
      if (sparksOwed && selfPos) {
        sparksOwed--;
        world.emitSpark(selfPos.x, selfPos.y + 2.4, selfPos.z);
      }
    } else {
      roomOwed = 0;
      sparksOwed = 0;
    }
    tapsSeen = s.taps || 0;

    // --- Opening: on the server's clock, or at a forced time while testing.
    const openT = override != null ? override : ph === 'open' ? (now - s.openAt) / 1000 : -1;
    if (openT >= 0 || ph === 'open') {
      opening.setStartLantern(together ? LIT : 1);
      opening.update(Math.max(openT, 0), t, smoothPos, smoothLook, baseFov);
    } else {
      camera.position.copy(smoothPos);
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
      camera.lookAt(smoothLook);
      const ringAge = clock - pulseAt;
      world.setPulse(14 + ringAge * 46, ringAge < 2.4 ? 1 - ringAge / 2.4 : 0);
      if (gathered) {
        world.setLantern(0.25 + shownEnergy * (LIT - 0.25));
        world.beams.userData.fade = shownEnergy;
        world.beams.visible = shownEnergy > 0.02;
        world.setDawn(0);
      } else {
        world.setLantern(1);
        world.beams.userData.fade = 1;
        world.beams.visible = true;
        world.setDawn(0);
      }
    }

    // --- The boats around yours carry their names, so you can see who you're racing.
    if (ph === 'harbor' || ph === 'sailing') {
      const near = [];
      for (const [n, at] of world.drawnBoats()) {
        if (n === selfN) continue;
        const d = at.pos.distanceTo(camera.position);
        if (d < 70) near.push({ d, pos: at.pos, name: net.boats.get(n)?.name ?? '' });
      }
      near.sort((a, b) => a.d - b.d);
      tags.update(near.slice(0, 4));
    } else {
      tags.hide();
    }

    if (openT > 2) world.marker.visible = world.ring.visible = false;

    audio.setScene(ph === 'harbor' || ph === 'challenge' ? 'harbor'
      : ph === 'sailing' || ph === 'energy' ? 'sail'
        : openT < CUES.open + 2.2 ? 'hush' : 'open');
    audio.setSoundOn(s.soundOn !== false);

    // --- HUD.
    const pct = `${(p * 100).toFixed(1)}%`;
    fill.style.width = pct;
    boatDot.style.left = pct;
    const inOpening = ph === 'open';
    bar.classList.toggle('hidden', inOpening || ph === 'harbor' || gathered || !you);
    energyBar.classList.toggle('hidden', ph !== 'energy');
    energyFill.style.width = `${shownEnergy * 100}%`;
    energyPct.textContent = `${Math.round(shownEnergy * 100)}%`;
    count.classList.toggle('hidden', inOpening || gathered || naming_);
    count.textContent = ph === 'harbor'
      ? `⛵ ${s.boats} boat${s.boats === 1 ? '' : 's'} in the harbor`
      : together ? '🏁 First to the lighthouse wins!' : `💡 ${s.arrived} / ${s.threshold} at the lighthouse`;

    if (ph !== phaseSeen) {
      phaseSeen = ph;
      if (ph === 'harbor') {
        lastCountdown = null;
        finalShown = false;
        hasTapped = false;
        tapTimes = [];
        myTaps = 0;
        pendingTaps = 0;
        cta.classList.add('hidden');
        welcome.classList.add('hidden');
      }
    }

    let bigText = '';
    if (ph === 'sailing' && now < s.startAt) {
      const rem = (s.startAt - now) / 1000;
      bigText = rem > 3 ? 'Get ready…' : String(Math.ceil(rem));
    } else if (started && now - s.startAt < 1200 && p < 0.08) {
      bigText = 'SAIL!';
    } else if (ph === 'energy') {
      const rem = (s.energyAt - now) / 1000;
      if (rem > 0 && rem <= 3) bigText = String(Math.ceil(rem));
      else if (rem <= 0 && rem > -1.2) bigText = 'TAP!';
    }
    if (bigText !== lastCountdown && bigText) {
      if (bigText === 'SAIL!' || bigText === 'TAP!') audio.go();
      else if (bigText !== 'Get ready…') audio.tick();
    }
    lastCountdown = bigText;
    big.textContent = bigText;
    big.classList.toggle('hidden', !bigText || naming_);
    big.classList.toggle('small', bigText === 'Get ready…');

    const showPad = sailing || energyNow || (ph === 'sailing' && now < s.startAt && !!you);
    pad.classList.toggle('hidden', !showPad);
    pad.classList.toggle('energy', energyNow);
    const flatOut = sailing && gauge > 0.9;
    pad.classList.toggle('max', flatOut);
    const padText = flatOut ? 'FULL SPEED!' : 'TAP TAP TAP!';
    if (padLabel.textContent !== padText) padLabel.textContent = padText;
    padMeter.style.transform = `scaleX(${gauge.toFixed(3)})`;
    const noteText = energyNow ? `Your energy: ${myTaps}` : '';
    if (padNote.textContent !== noteText) padNote.textContent = noteText;

    const name = you ? esc(you.name) : '';
    const winnerName = esc(s.winnerName);
    const ct = (now - s.challengeAt) / 1000;
    if (naming_) {
      setCard('');
    } else if (notice && clock < noticeUntil) {
      setCard(`<strong>Heads up</strong><span>${esc(notice)}</span>`);
    } else if (ph === 'harbor') {
      setCard(you
        ? `<strong>Welcome aboard, ${name}!</strong><span>When the host says go, tap anywhere, as fast as you can.${together ? ' The first boat to the lighthouse wins!' : ''}${audio.unlocked ? '' : ' Tap now to turn the sound on.'}</span>`
        : '<strong>Connecting…</strong><span>One moment.</span>');
    } else if (inOpening) {
      setCard('');
    } else if (ph === 'challenge') {
      if (ct < 0) setCard('');
      else if (winner) setCard(`<strong>You reached the lighthouse first!</strong><span>${ct < CHALLENGE_ASK ? 'Look at the big screen.' : 'But can you change the world alone? Look at the big screen.'}</span>`);
      else setCard(`<strong>${ct < CHALLENGE_ASK ? esc(LINES.first(s.winnerName)) : esc(LINES.challenge(s.winnerName))}</strong><span>Look at the big screen.</span>`);
    } else if (ph === 'energy') {
      const rem = (s.energyAt - now) / 1000;
      if (rem > 3) setCard(`<strong>${LINES.together}</strong><span>Get ready to tap!</span>`);
      else if (rem > 0) setCard('');
      else setCard(`<strong>Light the lighthouse!</strong><span>Tap anywhere, as fast as you can. ${winner ? 'Everyone is helping you.' : `Help ${winnerName}!`}</span>`);
    } else if (p >= 1) {
      const rank = you && you.rank;
      if (together) setCard(`<strong>${rank ? `You made it! Boat #${rank}` : 'You made it!'}</strong><span>Look at the big screen.</span>`);
      else {
        const left = Math.max(0, s.threshold - s.arrived);
        setCard(`<strong>${rank ? `You made it! Boat #${rank}` : 'You made it!'}</strong><span>${left ? `${left} more boat${left === 1 ? '' : 's'} to light up the marketplace…` : 'Here it comes…'}</span>`);
      }
    } else if (sailing && !hasTapped) {
      setCard('<strong>Tap, tap, tap!</strong><span>Tap anywhere to sail. The faster you tap, the faster you go.</span>');
    } else if (sailing && !paddling) {
      setCard('<strong>Keep tapping!</strong><span>Tap, tap, tap!</span>');
    } else {
      setCard('');
    }

    if (inOpening && !finalShown && openT > CUES.cta) {
      finalShown = true;
      cta.classList.remove('hidden');
      if (together) {
        welcome.classList.remove('hidden');
        navigator.vibrate?.([120, 60, 200]);
      }
    }

    world.frame(t, dt);
  }
  requestAnimationFrame(loop);

  audio.setClock(net.serverNow);
  window.__sail = { world, net, opening, audio, seek: (v) => { override = v; }, get p() { return p; }, setP: (v) => { p = v; } };
}
