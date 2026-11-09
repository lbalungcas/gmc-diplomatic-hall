/**
 * The authority for the sailing opening: who is in the race, how far they have got, who reached
 * the lighthouse first, how much energy the room has sent, and when the marketplace opens.
 *
 * Pure logic with no I/O, so the same code runs on the presence server (server/sail.js) and in
 * the browser for `/sail/?demo=30` (src/sail/net.js), and can be tested with a fake clock.
 *
 * Two ways to open, chosen by the host in the harbor:
 *
 *   together (the default)
 *     harbor     guests name their boats; nobody moves
 *     sailing    the host pressed Start; boats may move from `startAt`
 *     challenge  the first boat reached the lighthouse. The screens ask whether that boat can
 *                change the world alone, while the host works the room
 *     energy     the host pressed "Light the lighthouse": from `energyAt` every phone taps to send
 *                energy, until the room's taps reach `energyGoal`
 *     open       the lighthouse is lit; every screen plays the finale from `openAt`
 *
 *   classic (the fallback: the opening as first built)
 *     harbor, sailing, then open as soon as `threshold` boats reach the lighthouse
 *
 * Clients report progress and taps; the hub trusts neither. A boat cannot be further along than
 * its time since setting off allows, and a phone cannot send taps faster than a person can tap.
 */
import { screenName } from '../commit/moderate.js';

export const SAIL_SECONDS = 30;          // full sail, start to lighthouse
const FASTEST_SECONDS = 28;              // the clamp; the slack absorbs clock jitter, not cheating
export const COUNTDOWN_MS = 4000;        // 3, 2, 1, SAIL!
export const OPEN_LEAD_MS = 1200;        // beat between the deciding moment and the animation
export const ENERGY_LEAD_MS = 5000;      // "No one can. Let's light it together." then 3, 2, 1
export const DEFAULT_THRESHOLD = 30;
export const TAPS_EACH = 60;             // energy needed per boat online: about 8 to 15 s of the room tapping
export const MIN_ENERGY = 60;
const MAX_ENERGY = 8000;
const TAP_RATE = 12;                     // the most taps a second one phone is credited with
const MAX_BOATS = 600;                   // about 230 attendees are expected; this is a safety cap
const PROGRESS_MIN_INTERVAL_MS = 120;
const RECENT_ARRIVALS = 12;

const clean = (v, max) => String(v ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * @param {object}   opts
 * @param {string}   opts.token     host token; host actions are refused without it
 * @param {function} opts.deliver   (client, message) => void
 * @param {function} [opts.now]     clock, injectable for tests
 * @param {string}   [opts.mode]    'together' or 'classic'
 */
export function createRaceHub({ token = '', deliver, now = Date.now, threshold = DEFAULT_THRESHOLD, mode: initialMode = 'together' }) {
  const clients = new Map();     // client -> { view, boat, lastProgressAt, tapAt, tapBudget }
  const boats = new Map();       // visitor id -> boat
  let mode = initialMode === 'classic' ? 'classic' : 'together';
  let phase = 'harbor';
  let startAt = 0;
  let openAt = 0;
  let challengeAt = 0;
  let energyAt = 0;
  let energyGoal = 0;
  let taps = 0;
  let winner = null;
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
    phase, mode, threshold: goal, arrived: arrivals.length, boats: onlineBoats(), startAt, openAt, soundOn,
    challengeAt, energyAt, energyGoal, taps, winner: winner ? winner.n : -1, winnerName: winner ? winner.name : '',
    now: now(),
  });
  const rosterRow = (b) => [b.n, b.name, Math.round(b.p * 1000), b.rank];
  const arrivalRow = (b) => ({ n: b.n, name: b.name, rank: b.rank });
  const youRow = (b) => (b ? { n: b.n, name: b.name, p: b.p, rank: b.rank } : null);

  function broadcast(msg) {
    for (const client of clients.keys()) deliver(client, msg);
  }
  const sendState = () => broadcast({ type: 'sail_state', ...stateFields() });

  function welcome(client) {
    const c = clients.get(client);
    deliver(client, {
      type: 'sail_welcome',
      you: youRow(c.boat),
      roster: [...boats.values()].map(rosterRow),
      arrivals: arrivals.slice(-RECENT_ARRIVALS).map(arrivalRow),
      ...stateFields(),
    });
  }

  function open() {
    if (phase === 'open') return;
    phase = 'open';
    openAt = now() + OPEN_LEAD_MS;
    sendState();
  }

  function reset() {
    phase = 'harbor';
    startAt = 0;
    openAt = 0;
    challengeAt = 0;
    energyAt = 0;
    energyGoal = 0;
    taps = 0;
    winner = null;
    soundOn = true;
    arrivals = [];
    dirtyBoats.clear();
    const online = new Set();
    for (const c of clients.values()) if (c.boat) online.add(c.boat);
    for (const [id, b] of boats) if (!online.has(b)) boats.delete(id);
    for (const b of boats.values()) { b.p = 0; b.rank = 0; b.sailFrom = 0; }
    for (const client of clients.keys()) welcome(client);
  }

  function announce(boat) {
    for (const other of clients.keys()) deliver(other, { type: 'sail_boat', n: boat.n, name: boat.name });
  }

  /**
   * A phone joins as a visitor, and gets a boat once it has a name that passes the screen. The
   * same visitor again (a refresh, a dropped connection) gets their boat back, place and all.
   */
  function join(client, msg) {
    const view = msg.view === 'led' || msg.view === 'host' ? msg.view : 'player';
    const prev = clients.get(client);
    const entry = prev && prev.view === view ? prev : { view, boat: null, lastProgressAt: 0, tapAt: 0, tapBudget: 0 };
    clients.set(client, entry);
    if (view === 'player') {
      const id = clean(msg.id, 64);
      let boat = id ? boats.get(id) : null;
      const wanted = msg.name != null && msg.name !== '' ? screenName(msg.name) : null;
      if (wanted && !wanted.ok) {
        deliver(client, { type: 'sail_name_result', ok: false, reason: wanted.reason });
      }
      if (boat) {
        for (const [other, c] of clients) {
          if (other !== client && c.boat === boat) c.boat = null;
        }
        if (wanted && wanted.ok && wanted.name !== boat.name) {
          boat.name = wanted.name;
          announce(boat);
        }
      } else if (id && wanted && wanted.ok && boats.size < MAX_BOATS) {
        boat = { id, n: nextN++, name: wanted.name, p: 0, rank: 0, sailFrom: 0 };
        boats.set(id, boat);
        announce(boat);
      }
      entry.boat = boat || null;
      if (wanted && wanted.ok && boat) deliver(client, { type: 'sail_name_result', ok: true, name: boat.name });
    }
    dirtyState = true;
    welcome(client);
  }

  function arrive(b) {
    b.p = 1;
    arrivals.push(b);
    b.rank = arrivals.length;
    broadcast({ type: 'sail_arrived', ...arrivalRow(b) });
    dirtyState = true;
    if (mode === 'classic') {
      if (arrivals.length >= goal) open();
    } else if (phase === 'sailing') {
      // The first boat home wins the race, and the room learns it isn't over.
      winner = b;
      phase = 'challenge';
      challengeAt = now() + OPEN_LEAD_MS;
      sendState();
    }
  }

  function progress(client, msg) {
    const c = clients.get(client);
    const b = c && c.boat;
    const moving = phase === 'sailing' || (mode === 'together' && (phase === 'challenge' || phase === 'energy'));
    if (!b || !moving || b.rank) return;
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
    if (p >= 0.999) arrive(b);
  }

  /** Taps arrive in small batches. Each phone earns at most TAP_RATE a second, banked up to one second's worth. */
  function energy(client, msg) {
    const c = clients.get(client);
    if (!c || !c.boat || phase !== 'energy') return;
    const t = now();
    if (t < energyAt) return;
    const since = c.tapAt ? (t - c.tapAt) / 1000 : 1;
    c.tapAt = t;
    c.tapBudget = Math.min(TAP_RATE, c.tapBudget + since * TAP_RATE);
    const n = Math.min(Math.floor(c.tapBudget), Math.max(0, Math.floor(Number(msg.n) || 0)));
    if (!n) return;
    c.tapBudget -= n;
    taps += n;
    dirtyState = true;
    if (taps >= energyGoal) {
      taps = energyGoal;
      open();
    }
  }

  function startEnergy() {
    if (phase !== 'challenge') return;
    phase = 'energy';
    energyAt = now() + ENERGY_LEAD_MS;
    energyGoal = Math.min(MAX_ENERGY, Math.max(MIN_ENERGY, onlineBoats() * TAPS_EACH));
    taps = 0;
    for (const c of clients.values()) { c.tapAt = 0; c.tapBudget = 0; }
    sendState();
  }

  function host(client, msg) {
    if (!token || msg.token !== token) {
      deliver(client, { type: 'sail_host_result', ok: false, error: 'bad_token', action: msg.action });
      return;
    }
    const a = msg.action;
    if (a === 'start') {
      if (phase === 'harbor') {
        phase = 'sailing';
        startAt = now() + COUNTDOWN_MS;
        sendState();
      }
    } else if (a === 'light') {
      startEnergy();
    } else if (a === 'open') {
      open();
    } else if (a === 'reset') {
      reset();
    } else if (a === 'sound') {
      // Fades every device, for handing over to the live performance.
      soundOn = msg.value !== false;
      sendState();
    } else if (a === 'mode') {
      if (phase === 'harbor' && (msg.value === 'together' || msg.value === 'classic')) {
        mode = msg.value;
        sendState();
      }
    } else if (a === 'hide') {
      // A name the host doesn't want on the big screen becomes a plain number.
      const boat = [...boats.values()].find((b) => b.n === Number(msg.n));
      if (boat) {
        boat.name = `Boat ${boat.n + 1}`;
        announce(boat);
        dirtyState = true;
        for (const [cl, c] of clients) {
          if (c.boat === boat) deliver(cl, { type: 'sail_name_result', ok: true, name: boat.name, hidden: true });
        }
      }
    } else if (a === 'threshold') {
      const v = Math.round(Number(msg.value));
      if (Number.isFinite(v) && v >= 1 && v <= MAX_BOATS) {
        goal = v;
        dirtyState = true;
        if (mode === 'classic' && phase === 'sailing' && arrivals.length >= goal) open();
      }
    }
    deliver(client, { type: 'sail_host_result', ok: true, action: a });
  }

  return {
    /** Route one `sail_*` message from a client. */
    handle(client, msg) {
      if (msg.type === 'sail_join') join(client, msg);
      else if (!clients.has(client)) return;
      else if (msg.type === 'sail_progress') progress(client, msg);
      else if (msg.type === 'sail_tap') energy(client, msg);
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
        sendState();
      }
    },

    stats: () => ({
      phase, mode, threshold: goal, arrived: arrivals.length, boats: onlineBoats(), clients: clients.size,
      taps, energyGoal, winner: winner ? winner.name : '',
    }),
  };
}
