/**
 * The operator's panel: no 3D, so it works on any phone.
 *
 * Two-part opening: Start the sail; when the first boat wins, work the room, then Light the
 * lighthouse; if the room is slow, Finish lighting now. Classic: Start, and the opening plays when
 * enough boats arrive. Either way the host can hide any boat name before it reaches the big screen.
 * Anything that would be a slip on the big screen takes two presses.
 */
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export function startHost(root, connect) {
  document.getElementById('sail-loading')?.remove();
  const box = el('div', 'host');
  box.innerHTML = `
    <h1>Sail to the Lighthouse</h1>
    <p class="host-link">Host panel</p>
    <div class="host-status">
      <div><b id="h-phase">…</b><span>Stage</span></div>
      <div><b id="h-boats">0</b><span>Boats online</span></div>
      <div><b id="h-arrived">0</b><span id="h-third">At the lighthouse</span></div>
    </div>
    <div class="host-mode" role="radiogroup" aria-label="Opening style">
      <button id="h-together" type="button" role="radio">Two-part opening</button>
      <button id="h-classic" type="button" role="radio">Classic</button>
    </div>
    <p id="h-winner" class="host-winner hidden"></p>
    <button id="h-start" class="host-btn go" type="button">Start the sail</button>
    <button id="h-light" class="host-btn go hidden" type="button">Light the lighthouse</button>
    <button id="h-finish" class="host-btn warn hidden" type="button">Finish lighting now</button>
    <div id="h-threshold" class="host-threshold">
      <span>Boats needed to open</span>
      <div class="host-stepper">
        <button id="h-minus" type="button" aria-label="Fewer">−</button>
        <b id="h-goal">30</b>
        <button id="h-plus" type="button" aria-label="More">+</button>
      </div>
    </div>
    <button id="h-open" class="host-btn warn" type="button">Open the marketplace now</button>
    <button id="h-sound" class="host-btn quiet" type="button">Fade out the sound</button>
    <button id="h-reset" class="host-btn quiet" type="button">Reset to the harbor</button>
    <p id="h-note" class="host-note"></p>
    <h2 class="host-h2">Boat names <span id="h-count"></span></h2>
    <p class="host-help">Newest first. Hide turns a name into a plain number on every screen.</p>
    <ul id="h-names" class="host-names"></ul>
    <p class="host-links"><a href="/sail/?view=led" target="_blank" rel="noopener">Open the LED screen</a></p>`;
  root.append(box);
  const $ = (id) => box.querySelector(`#${id}`);

  const NAMES = { harbor: 'In the harbor', sailing: 'Sailing', challenge: 'Race won', energy: 'Lighting', open: 'Open!' };
  let armed = null;
  let armTimer = 0;
  function arm(btn, label, confirmLabel, run) {
    if (armed === btn) {
      clearTimeout(armTimer);
      armed = null;
      btn.textContent = label;
      btn.classList.remove('armed');
      run();
      return;
    }
    if (armed) armed.dispatchEvent(new Event('disarm'));
    armed = btn;
    btn.textContent = confirmLabel;
    btn.classList.add('armed');
    clearTimeout(armTimer);
    armTimer = setTimeout(() => btn.dispatchEvent(new Event('disarm')), 4000);
    btn.addEventListener('disarm', () => {
      if (armed === btn) armed = null;
      btn.textContent = label;
      btn.classList.remove('armed');
    }, { once: true });
  }
  function confirmThen(btn, label, confirmLabel, run) {
    btn.addEventListener('click', () => arm(btn, label, confirmLabel, run));
  }

  let namesDirty = true;
  const net = connect({
    state: render,
    welcome() { namesDirty = true; render(); },
    boat() { namesDirty = true; },
    status: render,
    hostResult(m) {
      if (!m.ok) $('h-note').textContent = 'The server refused that: this link has the wrong host token.';
    },
  });

  function renderNames() {
    namesDirty = false;
    const all = [...net.boats.values()].sort((a, b) => b.n - a.n);
    $('h-count').textContent = `(${all.length})`;
    $('h-names').replaceChildren(...all.map((b) => {
      const li = el('li');
      const name = el('span');
      name.textContent = b.name;
      li.append(name);
      if (b.name !== `Boat ${b.n + 1}`) {
        const hide = el('button', 'host-hide', 'Hide');
        hide.type = 'button';
        hide.addEventListener('click', () => arm(hide, 'Hide', 'Press again', () => net.host('hide', { n: b.n })));
        li.append(hide);
      }
      return li;
    }));
  }

  function render() {
    if (!net) return;
    const s = net.state;
    const together = s.mode !== 'classic';
    $('h-phase').textContent = net.connected ? (NAMES[s.phase] || s.phase) : 'No server';
    $('h-boats').textContent = s.boats;
    const lighting = together && s.phase === 'energy';
    $('h-arrived').textContent = lighting ? `${Math.round((s.taps / Math.max(1, s.energyGoal)) * 100)}%` : s.arrived;
    $('h-third').textContent = lighting ? 'Lit' : 'At the lighthouse';
    $('h-goal').textContent = s.threshold;
    $('h-together').classList.toggle('on', together);
    $('h-classic').classList.toggle('on', !together);
    $('h-together').setAttribute('aria-checked', String(together));
    $('h-classic').setAttribute('aria-checked', String(!together));
    $('h-together').disabled = $('h-classic').disabled = !net.connected || s.phase !== 'harbor';
    $('h-threshold').classList.toggle('hidden', together);
    $('h-start').disabled = !net.connected || s.phase !== 'harbor';
    $('h-light').classList.toggle('hidden', !together || (s.phase !== 'challenge' && s.phase !== 'energy'));
    $('h-light').disabled = !net.connected || s.phase !== 'challenge';
    $('h-finish').classList.toggle('hidden', !lighting);
    $('h-open').disabled = !net.connected || s.phase === 'open';
    $('h-open').textContent = armed === $('h-open') ? $('h-open').textContent
      : together ? 'Skip to the opening now' : 'Open the marketplace now';
    $('h-sound').disabled = !net.connected;
    $('h-sound').textContent = s.soundOn === false ? 'Bring the sound back' : 'Fade out the sound';
    const w = $('h-winner');
    w.classList.toggle('hidden', !(together && s.winnerName && s.phase !== 'harbor'));
    w.textContent = s.phase === 'challenge'
      ? `${s.winnerName} won the race. Hype the room, then press Light the lighthouse.`
      : `Winner: ${s.winnerName}`;
    const note = !net.connected && net.noAnswer
      ? 'The server is online but does not answer the race: it is running old code. On Render, the gmc-presence service must be connected to this project (gmc-diplomatic-hall, branch main) and redeployed.'
      : !net.connected
      ? 'Waiting for the race server. A free Render service can take a minute to wake up.'
      : !together && s.phase === 'sailing' && s.boats > 0 && s.boats < s.threshold
        ? `Only ${s.boats} boats online and ${s.threshold} needed. Lower the number or use "Open now".`
        : '';
    if (note) $('h-note').textContent = note;
    else if (!$('h-note').textContent.startsWith('The server')) $('h-note').textContent = '';
    if (namesDirty) renderNames();
  }

  $('h-together').addEventListener('click', () => net.host('mode', { value: 'together' }));
  $('h-classic').addEventListener('click', () => net.host('mode', { value: 'classic' }));
  $('h-start').addEventListener('click', () => net.host('start'));
  $('h-light').addEventListener('click', () => net.host('light'));
  $('h-sound').addEventListener('click', () => net.host('sound', { value: net.state.soundOn === false }));
  $('h-minus').addEventListener('click', () => net.host('threshold', { value: Math.max(1, net.state.threshold - 5) }));
  $('h-plus').addEventListener('click', () => net.host('threshold', { value: net.state.threshold + 5 }));
  confirmThen($('h-finish'), 'Finish lighting now', 'Press again to finish', () => net.host('open'));
  confirmThen($('h-open'), $('h-open').textContent, 'Press again to open', () => net.host('open'));
  confirmThen($('h-reset'), 'Reset to the harbor', 'Press again to reset everyone', () => net.host('reset'));
  setInterval(render, 500);
}
