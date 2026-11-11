/**
 * The phone: write what you commit to, and watch it go. Plain HTML with no 3D, so it loads quickly on
 * any phone on venue Wi-Fi. During the finale the screen itself becomes part of the show: at the
 * moment the bulb catches on the big screen, every phone in the room lights up.
 */
import { MAX_LEN, screenCommitment } from './moderate.js';
import { MAX_PER_VISITOR } from './wallHub.js';
import { T, closingLines } from './timeline.js';

const IDEAS = [
  'listen to children before deciding for them',
  'speak up when I see violence',
  'keep my friends safe online',
  'bring what I learned home to my community',
];
const SORRY = {
  block: 'Please keep it respectful, and try different words.',
  contact: 'Please leave out phone numbers, emails and links, to keep everyone safe.',
  empty: 'Write a little more, then try again.',
  too_fast: 'One moment, then try again.',
  limit: `You've added ${MAX_PER_VISITOR} commitments. Thank you!`,
  closed: 'The wall has closed. Thank you!',
  full: 'The wall is full. Thank you!',
};

const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function startPhone(root, connect) {
  root.innerHTML = `
    <main class="phone">
      <div class="phone-logo" role="img" aria-label="Youth Innovations Marketplace, November 17 2026">
        <svg viewBox="50 24 250 327" aria-hidden="true" stroke-width="14" stroke-linejoin="round">
          <polygon fill="#F2C667" stroke="#F2C667" points="175,39 284,102 284,218 175,281 66,218 66,102"/>
          <polygon fill="#F8DFA5" stroke="#F8DFA5" points="175,121 202,153 215,164 215,202 175,228 135,202 135,164 148,153"/>
          <polygon fill="#FFF" stroke="#FFF" points="115,284 175,314 234,284 234,311 175,336 115,311"/>
        </svg>
        <img src="/sail/logotype.webp" alt="" width="1686" height="936">
      </div>
      <p class="phone-count" aria-live="polite"></p>
      <form class="compose">
        <label for="text">I commit to…</label>
        <textarea id="text" rows="3" maxlength="${MAX_LEN}" autocomplete="off" enterkeyhint="send"></textarea>
        <div class="compose-row"><p class="compose-error" role="alert"></p><span class="compose-left"></span></div>
        <button type="submit" class="compose-go">Add my light</button>
        <p class="compose-note">No names, phone numbers or personal stories, please: this may show on the big screen after our team reads it.</p>
      </form>
      <section class="sent" hidden>
        <div class="spark" aria-hidden="true"></div>
        <h1>Thank you!</h1>
        <p class="sent-status" aria-live="polite"></p>
        <button type="button" class="sent-more">Add another</button>
      </section>
      <ul class="mine"></ul>
      <p class="help">Need to talk to someone? Visit the <strong>Safeguarding Booth</strong> or find any Safeguarding focal person. They are here all day.</p>
      <p class="pill warn offline" hidden>Connecting…</p>
    </main>
    <div class="glow" hidden>
      <div class="glow-text"></div>
      <a class="glow-link" href="/" hidden>Learn More</a>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const input = $('textarea');
  const error = $('.compose-error');
  const left = $('.compose-left');
  const compose = $('.compose');
  const sent = $('.sent');
  const status = $('.sent-status');
  const mineList = $('.mine');
  const glow = $('.glow');
  const glowText = $('.glow-text');
  const glowLink = $('.glow-link');
  const offlinePill = $('.offline');

  input.placeholder = IDEAS[Math.floor(Math.random() * IDEAS.length)];
  let wake = null;
  const keepAwake = () => {
    if (wake || !navigator.wakeLock) return;
    navigator.wakeLock.request('screen').then((w) => {
      wake = w;
      w.addEventListener('release', () => { wake = null; });
    }).catch(() => {});
  };

  const updateLeft = () => {
    const rem = MAX_LEN - input.value.length;
    left.textContent = rem <= 30 ? String(rem) : '';
  };
  input.addEventListener('input', () => {
    error.textContent = '';
    updateLeft();
  });

  const describe = (status_) => (status_ === 'approved' ? 'On the wall' : 'Our team is reading it');
  function renderMine() {
    mineList.replaceChildren();
    for (const item of net.items.values()) {
      const li = document.createElement('li');
      const text = document.createElement('span');
      text.textContent = item.text;
      const tag = document.createElement('em');
      tag.textContent = describe(item.status);
      tag.className = item.status;
      li.append(text, tag);
      mineList.append(li);
    }
    $('.sent-more').hidden = net.items.size >= MAX_PER_VISITOR;
    noteApprovals();
  }

  /** Your light leaving the phone: one bright spark, and a few small ones after it. */
  function sendLight() {
    const spark = $('.spark');
    spark.classList.remove('go');
    void spark.offsetWidth;
    spark.classList.add('go');
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    for (let i = 0; i < 7; i++) {
      const mote = document.createElement('i');
      mote.className = 'mote';
      sent.append(mote);
      const dx = (Math.random() - 0.5) * 46;
      const fly = mote.animate([
        { transform: `translate(${dx * 0.2}vw, 0) scale(0.4)`, opacity: 0 },
        { transform: `translate(${dx * 0.6}vw, -12vh) scale(1)`, opacity: 0.95, offset: 0.25 },
        { transform: `translate(${dx}vw, ${-48 - Math.random() * 22}vh) scale(0.3)`, opacity: 0 },
      ], { duration: 1100 + Math.random() * 700, delay: 120 + i * 70, easing: 'cubic-bezier(0.3, 0, 0.3, 1)', fill: 'backwards' });
      fly.onfinish = fly.oncancel = () => mote.remove();
    }
  }

  function showSent(item) {
    compose.hidden = true;
    sent.hidden = false;
    sendLight();
    status.classList.remove('pop');
    status.textContent = item.status === 'approved'
      ? 'Your light is on the wall. Look up!'
      : 'Our team is reading it. It will join the wall soon.';
  }

  // When the team approves a commitment you are still looking at, say so: that is the moment to look up.
  const seenStatus = new Map();
  function noteApprovals() {
    let justApproved = false;
    for (const item of net.items.values()) {
      const before = seenStatus.get(item.id);
      if (before && before !== 'approved' && item.status === 'approved') justApproved = true;
      seenStatus.set(item.id, item.status);
    }
    if (!justApproved || sent.hidden) return;
    status.textContent = 'Your light is on the wall. Look up!';
    status.classList.remove('pop');
    void status.offsetWidth;
    status.classList.add('pop');
    sendLight();
    navigator.vibrate?.(60);
  }

  compose.addEventListener('submit', (ev) => {
    ev.preventDefault();
    keepAwake();
    const screened = screenCommitment(input.value);
    if (SORRY[screened.verdict]) {
      error.textContent = SORRY[screened.verdict];
      return;
    }
    if (!net.state.open) {
      error.textContent = SORRY.closed;
      return;
    }
    net.post(input.value);
    $('.compose-go').disabled = true;
    $('.compose-go').textContent = net.connected ? 'Sending…' : 'Waiting for the connection…';
  });
  // Enter sends, as on a chat app: a commitment is one line.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      compose.requestSubmit();
    }
  });
  $('.sent-more').addEventListener('click', () => {
    sent.hidden = true;
    compose.hidden = false;
    input.value = '';
    updateLeft();
    input.focus();
  });

  const net = connect({
    welcome: renderMine,
    mine: renderMine,
    result(m) {
      const go = $('.compose-go');
      go.disabled = false;
      go.textContent = 'Add my light';
      if (m.ok) {
        renderMine();
        showSent(m.item);
      } else {
        error.textContent = SORRY[m.reason] || SORRY.empty;
      }
    },
  });
  renderMine();

  // --- The finale, on the shared clock.
  let lastPhase = '';
  let buzzed = false;
  function frame() {
    requestAnimationFrame(frame);
    const s = net.state;
    if (offlinePill.hidden !== net.connected) offlinePill.hidden = net.connected;
    const count = $('.phone-count');
    const label = s.open ? `${s.count} commitment${s.count === 1 ? '' : 's'} on the wall so far` : 'The wall has closed';
    if (count.textContent !== label) count.textContent = label;

    if (!s.finaleAt) {
      if (!glow.hidden) {
        glow.hidden = true;
        lastPhase = '';
        buzzed = false;
      }
      return;
    }
    const t = (net.serverNow() - s.finaleAt) / 1000;
    if (t < 0) return;
    glow.hidden = false;

    let phase;
    let bg;
    let ink = '#FFFFFF';
    if (t < 9) {
      phase = 'watch';
      bg = [15, 31, 66];
    } else if (t < T.ignite) {
      phase = 'hold';
      // A heartbeat, quickening and brightening as the bulb comes together.
      const k = clamp01((t - 9) / (T.ignite - 9));
      const beat = 0.5 + 0.5 * Math.sin(t * (2.2 + k * 5));
      const v = 0.05 + k * k * 0.3 * beat;
      bg = [lerp(15, 255, v), lerp(31, 217, v), lerp(66, 138, v)];
    } else {
      phase = t < T.close ? 'lit' : 'end';
      const flash = 1 - clamp01((t - T.ignite) / 1.2);
      const breathe = 0.5 + 0.5 * Math.sin(t * 1.4);
      bg = [255, lerp(lerp(217, 233, breathe), 255, flash), lerp(lerp(120, 165, breathe), 255, flash)];
      ink = '#1B3461';
      if (!buzzed) {
        buzzed = true;
        navigator.vibrate?.([120, 60, 200]);
      }
    }
    glow.style.background = `rgb(${bg.map(Math.round).join(',')})`;
    glow.style.color = ink;

    if (phase !== lastPhase) {
      lastPhase = phase;
      glowText.replaceChildren();
      const line = (tag, text) => {
        const e = document.createElement(tag);
        e.textContent = text;
        glowText.append(e);
      };
      if (phase === 'watch') {
        line('h1', 'Look at the big screen');
      } else if (phase === 'hold') {
        line('h1', 'Hold your phone up high');
        const mine = [...net.items.values()].find((i) => i.status === 'approved');
        line('p', mine ? `“${mine.text}” is part of this.` : 'Every commitment is becoming one light.');
      } else if (phase === 'end') {
        const c = closingLines(s.count);
        line('h1', 'Thank you');
        line('p', c.line2.replace(' Thank you.', ''));
      }
      glowLink.hidden = phase !== 'end';
    }
  }
  requestAnimationFrame(frame);

  window.__commit = { net, setFinale: (at) => { net.state.finaleAt = at; } };
}
