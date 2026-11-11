/**
 * The moderator's panel. Plain HTML, so it works on a phone or a laptop. Everything people write is
 * shown with textContent, never as HTML.
 *
 * Whoever runs this should also know the Safeguarding Team's contact: a commitment marked as a
 * possible disclosure means someone may be asking for help.
 */
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A button that needs a second press within 4 seconds. */
function twoPress(btn, confirmLabel, run) {
  const label = btn.textContent;
  let timer = 0;
  btn.addEventListener('click', () => {
    if (btn.classList.contains('armed')) {
      clearTimeout(timer);
      btn.classList.remove('armed');
      btn.textContent = label;
      run();
      return;
    }
    btn.classList.add('armed');
    btn.textContent = confirmLabel;
    timer = setTimeout(() => {
      btn.classList.remove('armed');
      btn.textContent = label;
    }, 4000);
  });
}

export function startAdmin(root, connect) {
  root.innerHTML = `
    <div class="admin">
      <header>
        <h1>Commitment Wall</h1>
        <p>Moderator panel</p>
      </header>
      <p class="admin-alert" id="a-denied" hidden>This link has the wrong host token, so nothing here will work.</p>
      <p class="admin-alert" id="a-store" hidden></p>
      <div class="admin-stats">
        <div><b id="a-waiting">0</b><span>Waiting</span></div>
        <div><b id="a-live">0</b><span>On the wall</span></div>
        <div><b id="a-conn">…</b><span>Server</span></div>
      </div>
      <div class="admin-tools">
        <button type="button" id="a-all" class="go">Approve all waiting</button>
        <label class="admin-switch"><input type="checkbox" id="a-mod"> <span>Read everything before it shows</span></label>
      </div>
      <div class="admin-tabs" role="tablist">
        <button type="button" data-tab="pending" class="on">Waiting</button>
        <button type="button" data-tab="approved">On the wall</button>
      </div>
      <ul class="admin-list" id="a-list"></ul>
      <section class="admin-finale">
        <h2>Closing the Marketplace</h2>
        <p>Plays the finale on the wall and every phone, and closes the wall. It uses everything on the wall at that moment; anything still waiting is left out.</p>
        <button type="button" id="a-finale" class="warn">Start the finale</button>
        <button type="button" id="a-reset" class="quiet">Reset the finale</button>
      </section>
      <section class="admin-finale">
        <h2>After a rehearsal</h2>
        <p>Deletes every commitment for good, so rehearsal words can't end up in the real bulb.</p>
        <button type="button" id="a-clear" class="quiet">Clear everything</button>
      </section>
      <p class="admin-links"><a href="/commit/?view=wall" target="_blank" rel="noopener">Open the wall</a> · <a href="/commit/" target="_blank" rel="noopener">Open the phone page</a></p>
    </div>`;
  const $ = (id) => root.querySelector(`#${id}`);
  let tab = 'pending';

  function row(item) {
    const li = el('li', item.note ? 'flagged' : '');
    if (item.note) li.append(el('strong', 'admin-note', item.note));
    li.append(el('p', 'admin-text', item.text));
    const tools = el('div', 'admin-row');
    tools.append(el('time', '', new Date(item.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
    if (item.status !== 'approved') {
      const yes = el('button', 'go', 'Approve');
      yes.type = 'button';
      yes.addEventListener('click', () => net.admin('approve', { id: item.id }));
      tools.append(yes);
    }
    const no = el('button', 'quiet', 'Remove');
    no.type = 'button';
    twoPress(no, 'Press again to delete', () => net.admin('remove', { id: item.id }));
    tools.append(no);
    li.append(tools);
    return li;
  }

  function render() {
    const list = [...net.items.values()].filter((i) => i.status === tab);
    // Oldest first while waiting, so nobody is left behind; newest first on the wall.
    list.sort((a, b) => (tab === 'pending' ? a.ts - b.ts : b.ts - a.ts));
    const box = $('a-list');
    box.replaceChildren(...list.map(row));
    if (!list.length) box.append(el('li', 'admin-empty', tab === 'pending' ? 'Nothing waiting.' : 'Nothing on the wall yet.'));
    renderState();
  }

  function renderState() {
    const s = net.state;
    let live = 0;
    let waiting = 0;
    for (const i of net.items.values()) {
      if (i.status === 'approved') live++;
      else waiting++;
    }
    $('a-waiting').textContent = waiting;
    $('a-live').textContent = live;
    $('a-conn').textContent = net.connected ? 'Connected' : net.noAnswer ? 'Old server' : 'Offline';
    $('a-mod').checked = s.moderated;
    $('a-finale').disabled = !net.connected || !!s.finaleAt;
    $('a-all').disabled = !net.connected || !waiting;
    const store = $('a-store');
    const oldServer = !net.connected && net.noAnswer;
    store.hidden = !(oldServer || (net.connected && s.storage === 'file'));
    store.textContent = oldServer
      ? 'The server is online but does not answer the wall: it is running old code. On Render, the gmc-presence service must be connected to this project (gmc-diplomatic-hall, branch main) and redeployed.'
      : 'Not saving to the database. If the server restarts, commitments could be lost. Run server/schema.sql in Supabase and restart it.';
    $('a-denied').hidden = !net.denied;
  }

  const net = connect({
    welcome: render,
    item: render,
    removed: render,
    state: renderState,
    status: renderState,
    denied: renderState,
  });

  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach((o) => o.classList.toggle('on', o === b));
    render();
  }));
  $('a-all').addEventListener('click', () => net.admin('approveAll'));
  $('a-mod').addEventListener('change', (e) => net.admin('moderated', { value: e.target.checked }));
  twoPress($('a-finale'), 'Press again to start', () => net.admin('finale'));
  twoPress($('a-reset'), 'Press again to reset', () => net.admin('resetFinale'));
  twoPress($('a-clear'), 'Press again to delete everything', () => net.admin('clear'));
  render();
  setInterval(renderState, 1000);
}
