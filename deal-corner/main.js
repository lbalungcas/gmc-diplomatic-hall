import { TRACKS, FACILITATORS } from './experts.js';

const PHOTO_DIR = '/deal-corner/experts/';
const TEAM_PHOTO_DIR = '/deal-corner/facilitators/';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const icon = (name) => el('i', `fa-solid ${name}`);

const initials = (name) => name
  .replace(/\(.*?\)|,.*$/g, '')
  .split(/\s+/)
  .filter((w) => /^[A-Z]/.test(w) && !/\.$/.test(w))
  .map((w) => w[0])
  .filter((_, i, a) => i === 0 || i === a.length - 1)
  .join('');

function photo(expert, dir = PHOTO_DIR) {
  const wrap = el('div', 'dc-photo');
  const fallback = () => {
    const box = el('div', 'dc-initials', initials(expert.name));
    box.setAttribute('aria-hidden', 'true');
    wrap.replaceChildren(box);
  };
  if (!expert.photo) {
    fallback();
    return wrap;
  }
  const img = new Image(160, 160);
  img.src = dir + expert.photo;
  img.alt = `${expert.name}, ${expert.role}`;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener('error', fallback, { once: true });
  wrap.append(img);
  return wrap;
}

function expertCard(expert, track, i) {
  const card = el('article', 'dc-expert dc-reveal');
  card.style.setProperty('--delay', `${Math.min(i, 5) * 0.07}s`);

  const top = el('div', 'dc-expert-top');
  const id = `bio-${track.id}-${expert.slug}`;
  const who = el('div');
  who.append(el('h3', null, expert.name), el('p', 'dc-role', expert.role));
  const org = el('span', 'dc-org');
  org.append(icon('fa-building-columns'), document.createTextNode(expert.org));
  who.append(org);
  top.append(photo(expert), who);

  const bio = el('p', 'dc-bio', expert.bio);
  bio.id = id;

  const more = el('button', 'dc-more');
  more.type = 'button';
  more.setAttribute('aria-controls', id);
  more.setAttribute('aria-expanded', 'false');
  const label = el('span', null, 'Read full bio');
  more.append(label, icon('fa-chevron-down'));
  more.addEventListener('click', () => {
    const open = card.classList.toggle('open');
    more.setAttribute('aria-expanded', String(open));
    label.textContent = open ? 'Show less' : 'Read full bio';
  });

  card.setAttribute('aria-label', `${expert.name}, ${track.name}`);
  card.append(top, bio, more);
  return card;
}

function comingSoon() {
  const box = el('div', 'dc-soon dc-reveal');
  const ic = el('div', 'dc-soon-icon');
  ic.append(icon('fa-user-clock'));
  const text = el('div');
  text.append(el('strong', null, 'Experts coming soon'), el('p', null, 'Experts for this track will be announced soon.'));
  box.append(ic, text);
  return box;
}

function trackSection(track) {
  const section = el('section', 'dc-track');
  section.id = track.id;
  section.setAttribute('aria-labelledby', `${track.id}-title`);

  const container = el('div', 'container');
  const head = el('header', 'dc-track-head dc-reveal');
  const tile = el('div', 'thematic-icon');
  tile.append(icon(track.icon));

  const body = el('div');
  const tag = el('span', 'thematic-tag', `Track ${track.no}`);
  const n = track.experts.length;
  if (n) tag.append(el('span', 'dc-track-count', `${n} ${n === 1 ? 'expert' : 'experts'}`));
  const title = el('h2', null, track.name);
  title.id = `${track.id}-title`;
  const blurb = el('p');
  blurb.innerHTML = track.blurb;
  const target = el('div', 'thematic-metric');
  target.append(icon('fa-circle-arrow-right'), document.createTextNode(` Target: ${track.target}`));
  body.append(tag, title, blurb, target);
  head.append(tile, body);

  const grid = el('div', 'dc-experts');
  if (n) track.experts.forEach((x, i) => grid.append(expertCard(x, track, i)));
  else grid.append(comingSoon());

  container.append(head, grid);
  section.append(container);
  return section;
}

function facilitatorCard(person, i) {
  const card = el('article', 'dc-member dc-reveal');
  card.style.setProperty('--delay', `${Math.min(i, 5) * 0.07}s`);
  const who = el('div');
  who.append(el('h3', null, person.name), el('p', 'dc-role', person.role));
  card.append(photo(person, TEAM_PHOTO_DIR), who);
  if (i === 0) card.classList.add('dc-member-lead');
  return card;
}

function chip(track) {
  const li = el('li');
  const a = el('a', 'dc-chip');
  a.href = `#${track.id}`;
  a.dataset.track = track.id;
  a.title = track.name;
  a.setAttribute('aria-label', `Track ${track.no}: ${track.name}`);
  a.append(el('b', null, track.no), document.createTextNode(track.chip || track.name));
  li.append(a);
  return li;
}

// Only offer "Read full bio" where the four-line clamp actually hides something.
function syncMoreButtons() {
  document.querySelectorAll('.dc-expert').forEach((card) => {
    if (card.classList.contains('open')) return;
    const bio = card.querySelector('.dc-bio');
    card.querySelector('.dc-more').hidden = bio.scrollHeight <= bio.clientHeight + 2;
  });
}

function stickChipsUnderHeader() {
  const header = document.getElementById('mainHeader');
  const chips = document.getElementById('dcChips');
  const place = () => {
    const h = header ? header.offsetHeight : 76;
    chips.style.top = `${h}px`;
    document.querySelectorAll('.dc-track').forEach((s) => { s.style.scrollMarginTop = `${h + chips.offsetHeight + 12}px`; });
  };
  place();
  window.addEventListener('resize', place, { passive: true });
}

function spyOnTracks() {
  const chips = new Map([...document.querySelectorAll('.dc-chip')].map((c) => [c.dataset.track, c]));
  const visible = new Set();
  const pick = () => {
    const first = TRACKS.find((t) => visible.has(t.id));
    chips.forEach((c, id) => {
      const on = first && id === first.id;
      c.classList.toggle('active', !!on);
      if (on) c.setAttribute('aria-current', 'true');
      else c.removeAttribute('aria-current');
    });
    const active = first && chips.get(first.id);
    if (active) {
      const list = active.closest('.dc-chips-list');
      const left = active.offsetLeft - list.clientWidth / 2 + active.clientWidth / 2;
      list.scrollTo({ left, behavior: 'smooth' });
    }
  };
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => (e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id)));
    pick();
  }, { rootMargin: '-35% 0px -55% 0px' });
  document.querySelectorAll('.dc-track').forEach((s) => io.observe(s));
}

function reveal() {
  const items = document.querySelectorAll('.dc-reveal');
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    items.forEach((n) => n.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  items.forEach((n) => io.observe(n));
}

function render() {
  const experts = new Set(TRACKS.flatMap((t) => t.experts.map((x) => x.slug))).size;
  document.getElementById('dcTrackCount').textContent = TRACKS.length;
  document.getElementById('dcExpertCount').textContent = experts;

  document.getElementById('dcChipsList').replaceChildren(...TRACKS.map(chip));
  document.getElementById('dcTracks').replaceChildren(...TRACKS.map(trackSection));
  document.getElementById('dcTeamList').replaceChildren(...FACILITATORS.map(facilitatorCard));

  stickChipsUnderHeader();
  spyOnTracks();
  reveal();
  syncMoreButtons();
  window.addEventListener('resize', syncMoreButtons, { passive: true });
  document.fonts?.ready.then(syncMoreButtons);

  // A link such as /deal-corner/#ocsea lands on its track once the sections exist.
  if (location.hash) {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) requestAnimationFrame(() => target.scrollIntoView());
  }
}

render();
