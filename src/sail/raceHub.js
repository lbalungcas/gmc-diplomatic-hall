/**
 * The authority for the sailing opening: who is in the race, how far they have got, who has
 * reached the lighthouse, and when the marketplace opens.
 *
 * Pure logic with no I/O, so the same code runs on the presence server (server/sail.js) and in
 * the browser for `/sail/?demo=30` (src/sail/net.js), and can be tested with a fake clock.
 *
 * Phases:
 *   harbor   boats gather; nobody moves
 *   sailing  the host pressed Start; boats may move from `startAt` (a few seconds ahead, for the
 *            on-screen countdown). Late arrivals join in and sail from where they are
 *   open     `threshold` boats reached the lighthouse (or the host forced it); every screen plays
 *            the opening animation from `openAt`, on the server's clock
 *
 * The client reports progress; the hub never trusts it. A boat cannot be further along than its
 * time since setting off allows, so it cannot arrive early by sending p = 1.
 */

export const SAIL_SECONDS = 15;          // full sail, start to lighthouse
const FASTEST_SECONDS = 14;              // the clamp; the slack absorbs clock jitter, not cheating
export const COUNTDOWN_MS = 4000;        // 3, 2, 1, SAIL!
export const OPEN_LEAD_MS = 1200;        // beat between the deciding arrival and the animation
export const DEFAULT_THRESHOLD = 30;
const MAX_BOATS = 600;                   // about 230 attendees are expected; this is a safety cap
const PROGRESS_MIN_INTERVAL_MS = 120;
const RECENT_ARRIVALS = 12;

const clean = (v, max) => String(v ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * @param {object}   opts
 * @param {string}   opts.token     host token; host actions are refused without it
 * @param {function} opts.deliver   (client, message) => void
 * @param {function} [opts.now]     clock, injectable for tests
 */
export function createRaceHub({ token = '', deliver, now = Date.now, threshold = DEFAULT_THRESHOLD }) {
  const clients = new Map();     // client -> { view, boat, lastProgressAt }
  const boats = new Map();       // visitor id -> boat
  let phase = 'harbor';
  let startAt = 0;
  let openAt = 0;
  let goal = threshold;
  let soundOn = true;
  let nextN = 0;
  let arrivals = [];
  let dirtyState = false;
  const dirtyBoats = new Set();

  const onlineBoats = () => {
    let n = 0;
    for (const c of clients.values()) if (c.boat) n++;
    return n;
  };

  const stateFields = () => ({
    phase, threshold: goal, arrived: arrivals.length, boats: onlineBoats(), startAt, openAt, soundOn, now: now(),
  });
  const rosterRow = (b) => [b.n, b.name, Math.round(b.p * 1000), b.rank];
  const arrivalRow = (b) => ({ n: b.n, name: b.name, rank: b.rank });

  function broadcast(msg) {
    for (const client of clients.keys()) deliver(client, msg);
  }

  function welcome(client) {
    const c = clients.get(client);
    deliver(client, {
      type: 'sail_welcome',
      you: c.boat ? { n: c.boat.n, name: c.boat.name, p: c.boat.p, rank: c.boat.rank } : null,
      roster: [...boats.values()].map(rosterRow),
      arrivals: arrivals.slice(-RECENT_ARRIVALS).map(arrivalRow),
      ...stateFields(),
    });
  }

  function open() {
    if (phase === 'open') return;
    phase = 'open';
    openAt = now() + OPEN_LEAD_MS;
    broadcast({ type: 'sail_state', ...stateFields() });
  }

  function reset() {
    phase = 'harbor';
    startAt = 0;
    openAt = 0;
    soundOn = true;
    arrivals = [];
    dirtyBoats.clear();
    const online = new Set();
    for (const c of clients.values()) if (c.boat) online.add(c.boat);
    for (const [id, b] of boats) if (!online.has(b)) boats.delete(id);
    for (const b of boats.values()) { b.p = 0; b.rank = 0; b.sailFrom = 0; }
    for (const client of clients.keys()) welcome(client);
  }

  function join(client, msg) {
    const prev = clients.get(client);
    if (prev && prev.boat) return welcome(client);
    const view = msg.view === 'led' || msg.view === 'host' ? msg.view : 'player';
    const entry = { view, boat: null, lastProgressAt: 0 };
    clients.set(client, entry);
    if (view === 'player') {
      const id = clean(msg.id, 64);
      let boat = id ? boats.get(id) : null;
      if (boat) {
        // The same visitor again: a refresh, or a dropped connection. Keep their place.
        for (const [other, c] of clients) {
          if (other !== client && c.boat === boat) c.boat = null;
        }
      } else if (id && boats.size < MAX_BOATS) {
        // Named by the server: nothing a visitor types can reach the LED.
        const n = nextN++;
        boat = { id, n, name: `Boat ${n + 1}`, p: 0, rank: 0, sailFrom: 0 };
        boats.set(id, boat);
        for (const other of clients.keys()) {
          if (other !== client) deliver(other, { type: 'sail_boat', n: boat.n, name: boat.name });
        }
      }
      entry.boat = boat || null;
    }
    dirtyState = true;
    welcome(client);
  }

  function progress(client, msg) {
    const c = clients.get(client);
    const b = c && c.boat;
    if (!b || phase !== 'sailing' || b.rank) return;
    const t = now();
    if (t < startAt || t - c.lastProgressAt < PROGRESS_MIN_INTERVAL_MS) return;
    c.lastProgressAt = t;
    if (!b.sailFrom) b.sailFrom = Math.max(startAt, t - 200);
    const claimed = Number(msg.p);
    if (!Number.isFinite(claimed)) return;
    const allowed = (t - b.sailFrom) / (FASTEST_SECONDS * 1000) + 0.01;
    const p = Math.min(1, Math.max(b.p, Math.min(claimed, allowed)));
    if (p === b.p) return;
    b.p = p;
    dirtyBoats.add(b);
    if (p >= 0.999) {
      b.p = 1;
      arrivals.push(b);
      b.rank = arrivals.length;
      broadcast({ type: 'sail_arrived', ...arrivalRow(b) });
      dirtyState = true;
      if (arrivals.length >= goal) open();
    }
  }

  function host(client, msg) {
    if (!token || msg.token !== token) {
      deliver(client, { type: 'sail_host_result', ok: false, error: 'bad_token', action: msg.action });
      return;
    }
    if (msg.action === 'start') {
      if (phase === 'harbor') {
        phase = 'sailing';
        startAt = now() + COUNTDOWN_MS;
        broadcast({ type: 'sail_state', ...stateFields() });
      }
    } else if (msg.action === 'open') {
      open();
    } else if (msg.action === 'reset') {
      reset();
    } else if (msg.action === 'sound') {
      // Fades every device, for handing over to the live performance.
      soundOn = msg.value !== false;
      broadcast({ type: 'sail_state', ...stateFields() });
    } else if (msg.action === 'threshold') {
      const v = Math.round(Number(msg.value));
      if (Number.isFinite(v) && v >= 1 && v <= MAX_BOATS) {
        goal = v;
        dirtyState = true;
        if (phase === 'sailing' && arrivals.length >= goal) open();
      }
    }
    deliver(client, { type: 'sail_host_result', ok: true, action: msg.action });
  }

  return {
    /** Route one `sail_*` message from a client. */
    handle(client, msg) {
      if (msg.type === 'sail_join') join(client, msg);
      else if (!clients.has(client)) return;
      else if (msg.type === 'sail_progress') progress(client, msg);
      else if (msg.type === 'sail_host') host(client, msg);
      else if (msg.type === 'sail_ping') deliver(client, { type: 'sail_pong', t: msg.t, now: now() });
    },

    /** A client went away. Its boat stays where it is, so a reconnect picks it back up. */
    drop(client) {
      if (clients.delete(client)) dirtyState = true;
    },

    /** Call about 4 times a second: sends what changed since the last call, in one message. */
    tick() {
      if (dirtyBoats.size) {
        const b = [];
        for (const boat of dirtyBoats) b.push(boat.n, Math.round(boat.p * 1000));
        dirtyBoats.clear();
        broadcast({ type: 'sail_snap', b });
      }
      if (dirtyState) {
        dirtyState = false;
        broadcast({ type: 'sail_state', ...stateFields() });
      }
    },

    stats: () => ({ phase, threshold: goal, arrived: arrivals.length, boats: onlineBoats(), clients: clients.size }),
  };
}
