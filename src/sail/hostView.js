/**
 * The operator's panel: no 3D, so it works on any phone. The host starts the race, adjusts how
 * many boats it takes, and can open the marketplace by hand if the room is short of 30 boats.
 * Open now and Reset take two presses, because a slip here would be on the big screen.
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
      <div><b id="h-arrived">0</b><span>At the lighthouse</span></div>
    </div>
    <button id="h-start" class="host-btn go" type="button">Start the sail</button>
    <div class="host-threshold">
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
    <p class="host-links"><a href="/sail/?view=led" target="_blank" rel="noopener">Open the LED screen</a></p>`;
  root.append(box);
  const $ = (id) => box.querySelector(`#${id}`);

  const NAMES = { harbor: 'In the harbor', sailing: 'Sailing', open: 'Open!' };
  let armed = null;
  let armTimer = 0;
  function confirmThen(btn, label, confirmLabel, run) {
    btn.addEventListener('click', () => {
      if (armed === btn) {
        clearTimeout(armTimer);
        armed = null;
        btn.textContent = label;
        btn.classList.remove('armed');
        run();
        return;
      }
      armed = btn;
      btn.textContent = confirmLabel;
      btn.classList.add('armed');
      clearTimeout(armTimer);
      armTimer = setTimeout(() => {
        armed = null;
        btn.textContent = label;
        btn.classList.remove('armed');
      }, 4000);
    });
  }

  const net = connect({
    state: render,
    welcome: render,
    status: render,
    hostResult(m) {
      if (!m.ok) $('h-note').textContent = 'The server refused that: this link has the wrong host token.';
    },
  });

  function render() {
    if (!net) return;
    const s = net.state;
    $('h-phase').textContent = net.connected ? (NAMES[s.phase] || s.phase) : 'No server';
    $('h-boats').textContent = s.boats;
    $('h-arrived').textContent = s.arrived;
    $('h-goal').textContent = s.threshold;
    $('h-start').disabled = !net.connected || s.phase !== 'harbor';
    $('h-open').disabled = !net.connected || s.phase === 'open';
    $('h-sound').disabled = !net.connected;
    $('h-sound').textContent = s.soundOn === false ? 'Bring the sound back' : 'Fade out the sound';
    const note = !net.connected
      ? 'Waiting for the race server. A free Render service can take a minute to wake up.'
      : s.phase === 'sailing' && s.boats > 0 && s.boats < s.threshold
        ? `Only ${s.boats} boats online and ${s.threshold} needed. Lower the number or use "Open now".`
        : '';
    if (note) $('h-note').textContent = note;
    else if (!$('h-note').textContent.startsWith('The server')) $('h-note').textContent = '';
  }

  $('h-start').addEventListener('click', () => net.host('start'));
  $('h-sound').addEventListener('click', () => net.host('sound', { value: net.state.soundOn === false }));
  $('h-minus').addEventListener('click', () => net.host('threshold', { value: Math.max(1, net.state.threshold - 5) }));
  $('h-plus').addEventListener('click', () => net.host('threshold', { value: net.state.threshold + 5 }));
  confirmThen($('h-open'), 'Open the marketplace now', 'Press again to open', () => net.host('open'));
  confirmThen($('h-reset'), 'Reset to the harbor', 'Press again to reset everyone', () => net.host('reset'));
  setInterval(render, 1000);
}
