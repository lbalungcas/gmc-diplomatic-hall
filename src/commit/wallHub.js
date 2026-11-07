/**
 * The authority for the commitment wall: what has been written, what has been approved, and when
 * the finale starts.
 *
 * Pure logic with no I/O, so the same code runs on the presence server (server/commit.js) and in the
 * browser for `?demo=N`, and can be tested on a fake clock.
 *
 * What each screen may see is the point of this file:
 *   phone   only its own commitments and their status
 *   wall    only approved commitments, with no information about who wrote them
 *   admin   everything, once the host token is checked
 */
import { screenCommitment } from './moderate.js';

export const FINALE_LEAD_MS = 1500;
const POST_MIN_INTERVAL_MS = 4000;
export const MAX_PER_VISITOR = 3;
const MAX_TOTAL = 3000;

const clean = (v, max) => String(v ?? '').slice(0, max);

/**
 * @param {string}   opts.token    host token
 * @param {function} opts.deliver  (client, message) => void
 * @param {object}   [opts.store]  { save(item), remove(id), clear() }, called on every change
 * @param {function} [opts.now]    clock, injectable for tests
 * @param {boolean}  [opts.approveFirst]  every commitment waits for a moderator
 */
export function createWallHub({ token = '', deliver, store = null, now = Date.now, approveFirst = true, storage = () => 'memory' }) {
  const clients = new Map();     // client -> { view, visitor, lastPostAt }
  const items = new Map();       // id -> { id, visitor, text, status, note, ts }
  let finaleAt = 0;
  let moderated = approveFirst;
  let seq = 0;
  let dirty = false;

  const forWall = (i) => ({ id: i.id, text: i.text, ts: i.ts });
  const forOwner = (i) => ({ id: i.id, text: i.text, status: i.status });
  const forAdmin = (i) => ({ id: i.id, text: i.text, status: i.status, note: i.note || '', ts: i.ts });
  const byTime = (a, b) => a.ts - b.ts;
  const approved = () => [...items.values()].filter((i) => i.status === 'approved').sort(byTime);

  function counts() {
    let live = 0;
    let waiting = 0;
    for (const i of items.values()) {
      if (i.status === 'approved') live++;
      else waiting++;
    }
    return { live, waiting };
  }

  function stateMsg() {
    const { live, waiting } = counts();
    return { type: 'commit_state', count: live, waiting, finaleAt, moderated, open: !finaleAt, storage: storage(), now: now() };
  }

  function toViews(msgFor) {
    for (const [client, c] of clients) {
      const m = msgFor(c);
      if (m) deliver(client, m);
    }
  }

  function welcome(client) {
    const c = clients.get(client);
    const list = [...items.values()];
    deliver(client, {
      ...stateMsg(),
      type: 'commit_welcome',
      view: c.view,
      items: c.view === 'admin' ? list.sort(byTime).map(forAdmin)
        : c.view === 'wall' ? approved().map(forWall)
          : list.filter((i) => i.visitor === c.visitor).sort(byTime).map(forOwner),
    });
  }

  function notifyOwner(item, removed = false) {
    toViews((c) => (c.view === 'phone' && c.visitor === item.visitor
      ? { type: 'commit_mine', item: forOwner(item), removed }
      : null));
  }

  function goLive(item) {
    const addMsg = { type: 'commit_add', item: forWall(item) };
    toViews((c) => (c.view === 'wall' ? addMsg : null));
    notifyOwner(item);
  }

  function post(client, msg) {
    const c = clients.get(client);
    const reply = (ok, extra) => deliver(client, { type: 'commit_result', cid: clean(msg.cid, 40), ok, ...extra });
    if (c.view !== 'phone' || !c.visitor) return;
    if (finaleAt) return reply(false, { reason: 'closed' });
    const screened = screenCommitment(msg.text);
    if (screened.verdict === 'empty' || screened.verdict === 'block' || screened.verdict === 'contact') {
      return reply(false, { reason: screened.verdict });
    }
    const mine = [...items.values()].filter((i) => i.visitor === c.visitor);
    // The same words again (a retry after a dropped connection) is not a new commitment.
    const twin = mine.find((i) => i.text.toLowerCase() === screened.text.toLowerCase());
    if (twin) return reply(true, { item: forOwner(twin) });
    const t = now();
    if (t - c.lastPostAt < POST_MIN_INTERVAL_MS) return reply(false, { reason: 'too_fast' });
    if (mine.length >= MAX_PER_VISITOR) return reply(false, { reason: 'limit' });
    if (items.size >= MAX_TOTAL) return reply(false, { reason: 'full' });
    c.lastPostAt = t;
    const item = {
      id: `c${t.toString(36)}${(seq++).toString(36)}`,
      visitor: c.visitor,
      text: screened.text,
      status: moderated || screened.verdict === 'flag' ? 'pending' : 'approved',
      note: screened.note || '',
      ts: t,
    };
    items.set(item.id, item);
    store?.save(item);
    dirty = true;
    reply(true, { item: forOwner(item) });
    const adminMsg = { type: 'commit_admin_add', item: forAdmin(item) };
    toViews((v) => (v.view === 'admin' ? adminMsg : null));
    if (item.status === 'approved') goLive(item);
  }

  function approve(item) {
    if (item.status === 'approved') return;
    item.status = 'approved';
    store?.save(item);
    const msg = { type: 'commit_admin_update', item: forAdmin(item) };
    toViews((v) => (v.view === 'admin' ? msg : null));
    goLive(item);
    dirty = true;
  }

  function admin(client, msg) {
    if (!token || msg.token !== token) {
      deliver(client, { type: 'commit_denied' });
      return;
    }
    const a = msg.action;
    if (a === 'approve') {
      const item = items.get(msg.id);
      if (item) approve(item);
    } else if (a === 'approveAll') {
      // Commitments the screen flagged must be read one at a time, so they are left out.
      for (const item of items.values()) if (item.status === 'pending' && !item.note) approve(item);
    } else if (a === 'remove') {
      // Permanent: the safeguarding plan requires content with personal information to be deleted.
      const item = items.get(msg.id);
      if (item) {
        items.delete(item.id);
        store?.remove(item.id);
        const gone = { type: 'commit_remove', id: item.id };
        toViews((v) => (v.view === 'wall' || v.view === 'admin' ? gone : null));
        notifyOwner(item, true);
        dirty = true;
      }
    } else if (a === 'moderated') {
      moderated = msg.value !== false;
      dirty = true;
    } else if (a === 'finale') {
      if (!finaleAt) {
        finaleAt = now() + FINALE_LEAD_MS;
        const s = stateMsg();
        toViews(() => s);
      }
    } else if (a === 'resetFinale') {
      finaleAt = 0;
      dirty = true;
    } else if (a === 'clear') {
      // After a rehearsal, so test words can't end up in the real bulb.
      items.clear();
      finaleAt = 0;
      store?.clear();
      for (const c of clients.keys()) welcome(c);
    }
  }

  return {
    handle(client, msg) {
      if (msg.type === 'commit_join') {
        let view = msg.view === 'wall' ? 'wall' : msg.view === 'admin' ? 'admin' : 'phone';
        if (view === 'admin' && (!token || msg.token !== token)) {
          deliver(client, { type: 'commit_denied' });
          view = 'wall';
        }
        clients.set(client, { view, visitor: clean(msg.id, 64), lastPostAt: 0 });
        dirty = true;
        welcome(client);
      } else if (!clients.has(client)) {
        return;
      } else if (msg.type === 'commit_post') post(client, msg);
      else if (msg.type === 'commit_admin') admin(client, msg);
      else if (msg.type === 'commit_ping') deliver(client, { type: 'commit_pong', t: msg.t, now: now() });
    },

    drop(client) {
      clients.delete(client);
    },

    /** Saved commitments, from the store at start-up. */
    hydrate(list) {
      for (const i of list) if (i && i.id && i.text) items.set(i.id, i);
      for (const c of clients.keys()) welcome(c);
    },

    /** Call a few times a second: the counts, at most that often. */
    tick() {
      if (!dirty) return;
      dirty = false;
      const s = stateMsg();
      toViews(() => s);
    },

    stats: () => ({ ...counts(), finaleAt, moderated, storage: storage(), clients: clients.size }),
  };
}
